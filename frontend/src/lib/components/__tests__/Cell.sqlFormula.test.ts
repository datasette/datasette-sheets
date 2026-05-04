import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Cell from "../Cell.svelte";
import { render } from "vitest-browser-svelte";
import {
  cells,
  editingCell,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import { clearAllPins, isPinned } from "../../engine";
import { clearSqlCache, setSqlDefaultDatabase } from "../../sql";
import type { CellId } from "../../spreadsheet/types";

// End-to-end `=SQL(...)` flow: committing a SQL formula pins a
// loading placeholder, the real fetch writes the result through
// the engine's pin API, and dependents read the spilled array
// like any other native spill.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
  clearAllPins();
  clearSqlCache();
  setSqlDefaultDatabase("tmp");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockOnce(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

async function settle() {
  // No expectation on any particular cell — just let the fetch +
  // recalc cascade run to completion for tests that assert against
  // multiple cells at once.
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

test("=SQL(...) pins #LOADING! then spills fetched rows with headers", async () => {
  mockOnce([
    { id: 1, name: "alex" },
    { id: 2, name: "bob" },
  ]);

  cells.setCellValue("A1" as CellId, '=SQL("select * from t")');

  // Synchronously after commit: anchor is pinned with #LOADING!.
  expect(isPinned("A1" as CellId)).toBe(true);
  expect(cells.getCell("A1" as CellId)?.computedValue).toBe("#LOADING!");

  await settle();

  // Fetch resolved — headers land at row 0, data rows below.
  expect(cells.getCell("A1" as CellId)?.computedValue).toBe("id");
  expect(cells.getCell("B1" as CellId)?.computedValue).toBe("name");
  expect(cells.getCell("A2" as CellId)?.computedValue).toBe(1);
  expect(cells.getCell("B2" as CellId)?.computedValue).toBe("alex");
  expect(cells.getCell("A3" as CellId)?.computedValue).toBe(2);
  expect(cells.getCell("B3" as CellId)?.computedValue).toBe("bob");

  // The anchor is classified as a spill anchor so it renders with
  // the accent-coloured left edge.
  expect(cells.getCell("A1" as CellId)?.isSpillAnchor).toBe(true);
  expect(cells.getCell("A2" as CellId)?.isSpillMember).toBe(true);
});

test("overwriting a SQL cell with plain text unpins", async () => {
  mockOnce([{ n: 1 }]);
  cells.setCellValue("A1" as CellId, '=SQL("select 1")');
  await settle();
  expect(isPinned("A1" as CellId)).toBe(true);

  cells.setCellValue("A1" as CellId, "hello");
  expect(isPinned("A1" as CellId)).toBe(false);
  expect(cells.getCell("A1" as CellId)?.computedValue).toBe("hello");
});

test("dependent formula referencing A1# sees the pinned spill", async () => {
  mockOnce([{ v: 10 }, { v: 20 }, { v: 30 }]);
  cells.setCellValue("A1" as CellId, '=SQL("select v from t")');
  // COUNT only counts numeric entries — the string header "v" is
  // skipped, so we get the three numeric rows.
  cells.setCellValue("B1" as CellId, "=COUNT(A1#)");
  await settle();

  expect(cells.getCell("B1" as CellId)?.computedValue).toBe(3);
});

test("HTTP failure surfaces #SQL! with the status message", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response("nope", { status: 503, statusText: "Unavailable" }),
  );

  cells.setCellValue("A1" as CellId, '=SQL("select 1")');
  await settle();

  const raw = String(cells.getCell("A1" as CellId)?.computedValue ?? "");
  expect(raw.startsWith("#SQL!")).toBe(true);
  expect(raw).toContain("503");
});

test("explicit dbname is honoured in the fetch URL", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{ x: 1 }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  cells.setCellValue("A1" as CellId, '=SQL("other", "select 1")');
  await settle();

  const call = spy.mock.calls[0][0];
  expect(String(call)).toMatch(/^\/other\.json\?/);
});

test("refreshSqlCell re-fires the fetch and updates the pinned value", async () => {
  const { refreshSqlCell } = await import("../../sql");

  // First fetch resolves to one row, second to a different row.
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ v: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ v: 99 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  cells.setCellValue("A1" as CellId, '=SQL("select v")');
  await settle();
  expect(cells.getCell("A2" as CellId)?.computedValue).toBe(1);

  refreshSqlCell("A1" as CellId, '=SQL("select v")');
  await settle();
  expect(cells.getCell("A2" as CellId)?.computedValue).toBe(99);
});

test("anchor renders with the spill-anchor class", async () => {
  mockOnce([{ v: 1 }]);
  cells.setCellValue("A1" as CellId, '=SQL("x")');
  await settle();

  render(Cell, { props: { cellId: "A1" as CellId } });
  const el = document.querySelector<HTMLElement>('[data-cell-id="A1"]');
  expect(el?.classList.contains("spill-anchor")).toBe(true);
});
