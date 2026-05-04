import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SheetSSEClient } from "../sse";

// Minimal EventSource stand-in. We expose hooks to drive `onopen`,
// `onerror`, and a `connected` server-sent event from the test, since
// the real lifecycle (initial open → server `connected` event → error
// → auto-reopen) is what the bug under test cares about.
class FakeEventSource {
  static last: FakeEventSource | null = null;
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (e: MessageEvent) => void>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    this.listeners.set(type, fn);
  }

  close(): void {
    this.closed = true;
  }

  // Test helpers
  fireOpen(): void {
    this.onopen?.();
  }
  fireError(): void {
    this.onerror?.();
  }
  fireServerEvent(type: string, data: unknown): void {
    const fn = this.listeners.get(type);
    fn?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  // Bypasses the JSON.stringify in fireServerEvent so tests can drive
  // a raw payload at the registered listener — used for the malformed
  // JSON test below.
  fireRawEvent(type: string, data: string): void {
    const fn = this.listeners.get(type);
    fn?.(new MessageEvent(type, { data }));
  }
}

let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
    FakeEventSource as unknown as typeof EventSource;
  FakeEventSource.last = null;
});

afterEach(() => {
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
    originalEventSource as typeof EventSource;
});

describe("SheetSSEClient connection lifecycle", () => {
  test("initial onopen does NOT fire onReconnect; subsequent onopen does", () => {
    const onConnected = vi.fn();
    const onDisconnect = vi.fn();
    const onReconnect = vi.fn();

    const client = new SheetSSEClient("db", "wb", "sh", "client-1", {
      onConnected,
      onDisconnect,
      onReconnect,
    });
    client.connect();

    const es = FakeEventSource.last!;
    expect(es).toBeTruthy();

    // 1) Initial open — should NOT be a reconnection.
    es.fireOpen();
    expect(onReconnect).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();

    // 2) Server `connected` event — onConnected fires, client.connected flips true.
    es.fireServerEvent("connected", { client_id: "client-1" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledWith("client-1");
    expect(client.connected).toBe(true);

    // 3) onerror — onDisconnect fires once, connected flips false.
    es.fireError();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(client.connected).toBe(false);

    // 4) Browser auto-reopens — this time onReconnect fires.
    es.fireOpen();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  test("onerror does not fire onDisconnect a second time without an intervening connected event", () => {
    const onDisconnect = vi.fn();
    const client = new SheetSSEClient("db", "wb", "sh", "client-1", {
      onDisconnect,
    });
    client.connect();
    const es = FakeEventSource.last!;

    es.fireOpen();
    es.fireServerEvent("connected", { client_id: "client-1" });
    es.fireError();
    es.fireError();

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  test("disconnect() clears the eventSource and a fresh connect() treats the next open as initial", () => {
    const onReconnect = vi.fn();
    const client = new SheetSSEClient("db", "wb", "sh", "client-1", {
      onReconnect,
    });

    client.connect();
    const first = FakeEventSource.last!;
    first.fireOpen();
    first.fireServerEvent("connected", { client_id: "client-1" });
    expect(client.connected).toBe(true);

    client.disconnect();
    expect(first.closed).toBe(true);
    expect(client.connected).toBe(false);

    client.connect();
    const second = FakeEventSource.last!;
    expect(second).not.toBe(first);

    second.fireOpen();
    // Fresh session — first open after a disconnect is not a reconnect.
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

// [tests-03 backfill] Each declared server event must round-trip
// through the matching callback with its parsed JSON body. The current
// suite covers ``connected`` already, but a regression in any other
// listener registration (typo in event name, dropped JSON.parse, wrong
// callback) would never surface without per-event coverage. Keeps the
// SSE event surface in lockstep with the SSECallbacks contract in
// sse.ts.
describe("SheetSSEClient event dispatch", () => {
  test("each server event parses its payload and invokes the matching callback", () => {
    const onCellUpdate = vi.fn();
    const onSheetMeta = vi.fn();
    const onPresence = vi.fn();
    const onRowsDeleted = vi.fn();
    const onColumnsDeleted = vi.fn();
    const onColumnsInserted = vi.fn();
    const onConnected = vi.fn();

    const client = new SheetSSEClient("db", "wb", "sh", "c1", {
      onCellUpdate,
      onSheetMeta,
      onPresence,
      onRowsDeleted,
      onColumnsDeleted,
      onColumnsInserted,
      onConnected,
    });
    client.connect();
    const es = FakeEventSource.last!;

    // ``cell-update`` — body is a CellUpdateEvent.
    const cellUpdateBody = {
      changes: [{ row_idx: 0, col_idx: 0, raw_value: "x", format_json: null }],
      actor: "alex",
    };
    es.fireServerEvent("cell-update", cellUpdateBody);
    expect(onCellUpdate).toHaveBeenCalledTimes(1);
    expect(onCellUpdate).toHaveBeenCalledWith(cellUpdateBody);

    // ``sheet-meta`` — name + color rename broadcast.
    es.fireServerEvent("sheet-meta", { name: "Renamed", color: "#abc" });
    expect(onSheetMeta).toHaveBeenCalledTimes(1);
    expect(onSheetMeta).toHaveBeenCalledWith({
      name: "Renamed",
      color: "#abc",
    });

    // ``presence`` — remote cursor + selection state.
    const presenceBody = {
      actor: "u1",
      display_name: "User One",
      profile_picture_url: null,
      cursor: { row: 1, col: 2 },
      selection: ["A1", "A2"],
      color: "#456",
    };
    es.fireServerEvent("presence", presenceBody);
    expect(onPresence).toHaveBeenCalledTimes(1);
    expect(onPresence).toHaveBeenCalledWith(presenceBody);

    // ``rows-deleted`` — server-confirmed row drops.
    es.fireServerEvent("rows-deleted", {
      row_indices: [3, 5],
      actor: null,
    });
    expect(onRowsDeleted).toHaveBeenCalledTimes(1);
    expect(onRowsDeleted).toHaveBeenCalledWith({
      row_indices: [3, 5],
      actor: null,
    });

    // ``columns-deleted`` — server-confirmed column drops.
    es.fireServerEvent("columns-deleted", {
      col_indices: [2, 4],
      actor: "u2",
    });
    expect(onColumnsDeleted).toHaveBeenCalledTimes(1);
    expect(onColumnsDeleted).toHaveBeenCalledWith({
      col_indices: [2, 4],
      actor: "u2",
    });

    // ``columns-inserted`` — newly-shifted blank columns.
    es.fireServerEvent("columns-inserted", {
      col_indices: [1, 2],
      actor: null,
    });
    expect(onColumnsInserted).toHaveBeenCalledTimes(1);
    expect(onColumnsInserted).toHaveBeenCalledWith({
      col_indices: [1, 2],
      actor: null,
    });

    // ``connected`` — server-issued client id.
    es.fireServerEvent("connected", { client_id: "c1" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledWith("c1");
  });

  // The current sse.ts handlers do an unguarded ``JSON.parse(e.data)``,
  // which throws synchronously on a malformed payload. Pin that
  // behaviour so a future "swallow errors silently" or "log + continue"
  // refactor is a deliberate decision, not a drift.
  test("a malformed JSON payload throws out of the event listener", () => {
    const onCellUpdate = vi.fn();
    const client = new SheetSSEClient("db", "wb", "sh", "c1", { onCellUpdate });
    client.connect();
    const es = FakeEventSource.last!;

    // ``fireRawEvent`` skips the JSON.stringify pass so the
    // listener receives an un-parseable string and the unguarded
    // ``JSON.parse`` in sse.ts throws synchronously.
    expect(() => es.fireRawEvent("cell-update", "{not-json")).toThrow();

    // Callback never fired because the parse threw before the dispatch.
    expect(onCellUpdate).not.toHaveBeenCalled();
  });
});
