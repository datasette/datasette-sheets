import { beforeEach, afterEach, expect, test, describe, vi } from "vitest";
import { get, writable } from "svelte/store";
import {
  installDocumentShortcuts,
  handleDocumentKeydown,
} from "../sheetKeyboard";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  editingCell,
} from "../stores/spreadsheet";
import {
  clipboardRange,
  markCopyRange,
  clearClipboardMark,
} from "../stores/clipboard";
import { openOverlay, requestOverlay } from "../stores/openOverlay";
import { debugMode, debugLog, clearDebugLog } from "../stores/debug";
import type { CellId } from "../spreadsheet/types";

// [page-toolbar-01] Installer + the three responsibilities of the
// document keydown handler — Esc-clears-mark + Cmd+Shift+[/] tab
// cycle + debug-event capture. Each tested via a synthesized
// KeyboardEvent rather than ``userEvent.keyboard`` so we don't have
// to round-trip through a Svelte component just to fire a keydown.

// Mock persistence's sheet-side state. The real ``sheets`` /
// ``activeSheetId`` are derived from server-loaded data; for an
// isolated keyboard test we want a writable shim.
vi.mock("../stores/persistence", async () => {
  const sheets = writable<Array<{ id: string; name: string; color: string }>>(
    [],
  );
  const activeSheetId = writable<string | null>(null);
  const switchSheet = vi.fn(async (id: string) => {
    activeSheetId.set(id);
  });
  return { sheets, activeSheetId, switchSheet };
});

// Stub the clipboard module's `pasteValuesShortcut`. The real one
// reads `navigator.clipboard.read()`, which the browser test
// harness can't fake without permission grants — we just want to
// assert the keystroke routes here.
vi.mock("../clipboard/sheetClipboard", () => ({
  pasteValuesShortcut: vi.fn(async () => {}),
}));

const persistence = await import("../stores/persistence");
const sheetClipboard = await import("../clipboard/sheetClipboard");

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
  clearClipboardMark();
  openOverlay.set(null);
  clearDebugLog();
  debugMode.set(false);
  (persistence.sheets as ReturnType<typeof writable>).set([]);
  (persistence.activeSheetId as ReturnType<typeof writable>).set(null);
  (persistence.switchSheet as ReturnType<typeof vi.fn>).mockClear();
  (sheetClipboard.pasteValuesShortcut as ReturnType<typeof vi.fn>).mockClear();
});

function key(
  k: string,
  opts: KeyboardEventInit & { code?: string } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
}

describe("installDocumentShortcuts", () => {
  test("installs and removes the document-level keydown listener", () => {
    cells.setCellValue("A1", "x");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));
    markCopyRange(["A1"] as CellId[]);
    expect(get(clipboardRange).size).toBe(1);

    const teardown = installDocumentShortcuts();
    document.dispatchEvent(key("Escape"));
    expect(get(clipboardRange).size).toBe(0);

    teardown();
    // Re-arm the mark, then dispatch Esc again — should be a no-op
    // now that the listener is gone.
    markCopyRange(["A1"] as CellId[]);
    document.dispatchEvent(key("Escape"));
    expect(get(clipboardRange).size).toBe(1);
  });
});

describe("Esc clears the clipboard mark", () => {
  test("Esc on an active mark clears it", () => {
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));
    markCopyRange(["A1"] as CellId[]);

    handleDocumentKeydown(key("Escape"));
    expect(get(clipboardRange).size).toBe(0);
  });

  test("Esc while editing a cell does NOT clear the mark", () => {
    cells.setCellValue("A1", "x");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));
    markCopyRange(["A1"] as CellId[]);
    editingCell.set("A1");

    handleDocumentKeydown(key("Escape"));
    // Cell.svelte owns Esc-aborts-edit; the doc handler must not
    // pre-empt it by clearing transient page state first.
    expect(get(clipboardRange).size).toBe(1);
  });

  test("Esc dismisses an open overlay", () => {
    requestOverlay("toolbar:textColor");
    expect(get(openOverlay)).toBe("toolbar:textColor");

    handleDocumentKeydown(key("Escape"));
    expect(get(openOverlay)).toBeNull();
  });
});

describe("Cmd+Shift+[ / ] sheet cycling", () => {
  test("Cmd+Shift+] advances to the next sheet", () => {
    (persistence.sheets as ReturnType<typeof writable>).set([
      { id: "s1", name: "One", color: "#000" },
      { id: "s2", name: "Two", color: "#000" },
      { id: "s3", name: "Three", color: "#000" },
    ]);
    (persistence.activeSheetId as ReturnType<typeof writable>).set("s1");

    handleDocumentKeydown(
      key("]", { code: "BracketRight", metaKey: true, shiftKey: true }),
    );
    expect(persistence.switchSheet).toHaveBeenCalledWith("s2");
  });

  test("Cmd+Shift+[ moves to the previous sheet", () => {
    (persistence.sheets as ReturnType<typeof writable>).set([
      { id: "s1", name: "One", color: "#000" },
      { id: "s2", name: "Two", color: "#000" },
    ]);
    (persistence.activeSheetId as ReturnType<typeof writable>).set("s2");

    handleDocumentKeydown(
      key("[", { code: "BracketLeft", ctrlKey: true, shiftKey: true }),
    );
    expect(persistence.switchSheet).toHaveBeenCalledWith("s1");
  });

  test("wraps from the last sheet to the first", () => {
    (persistence.sheets as ReturnType<typeof writable>).set([
      { id: "s1", name: "One", color: "#000" },
      { id: "s2", name: "Two", color: "#000" },
    ]);
    (persistence.activeSheetId as ReturnType<typeof writable>).set("s2");

    handleDocumentKeydown(
      key("]", { code: "BracketRight", metaKey: true, shiftKey: true }),
    );
    expect(persistence.switchSheet).toHaveBeenCalledWith("s1");
  });

  test("does not switch while a cell is being edited", () => {
    (persistence.sheets as ReturnType<typeof writable>).set([
      { id: "s1", name: "One", color: "#000" },
      { id: "s2", name: "Two", color: "#000" },
    ]);
    (persistence.activeSheetId as ReturnType<typeof writable>).set("s1");
    editingCell.set("A1");

    handleDocumentKeydown(
      key("]", { code: "BracketRight", metaKey: true, shiftKey: true }),
    );
    expect(persistence.switchSheet).not.toHaveBeenCalled();
  });

  test("does nothing when only one sheet exists", () => {
    (persistence.sheets as ReturnType<typeof writable>).set([
      { id: "s1", name: "Only", color: "#000" },
    ]);
    (persistence.activeSheetId as ReturnType<typeof writable>).set("s1");

    handleDocumentKeydown(
      key("]", { code: "BracketRight", metaKey: true, shiftKey: true }),
    );
    expect(persistence.switchSheet).not.toHaveBeenCalled();
  });

  test("falls back to e.key when e.code is missing", () => {
    (persistence.sheets as ReturnType<typeof writable>).set([
      { id: "s1", name: "One", color: "#000" },
      { id: "s2", name: "Two", color: "#000" },
    ]);
    (persistence.activeSheetId as ReturnType<typeof writable>).set("s1");

    // Some browsers report the shifted glyph in ``e.key``; no code.
    handleDocumentKeydown(key("}", { metaKey: true, shiftKey: true }));
    expect(persistence.switchSheet).toHaveBeenCalledWith("s2");
  });
});

describe("Cmd+Shift+V routes to pasteValuesShortcut", () => {
  test("Cmd+Shift+V calls pasteValuesShortcut and preventDefault's", () => {
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const ev = key("v", {
      code: "KeyV",
      metaKey: true,
      shiftKey: true,
    });
    handleDocumentKeydown(ev);

    expect(sheetClipboard.pasteValuesShortcut).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(true);
  });

  test("does not fire while a cell is being edited", () => {
    selectedCell.set("A1");
    editingCell.set("A1");

    handleDocumentKeydown(
      key("v", { code: "KeyV", metaKey: true, shiftKey: true }),
    );

    expect(sheetClipboard.pasteValuesShortcut).not.toHaveBeenCalled();
  });

  test("plain Cmd+V (no Shift) is left to the document paste listener", () => {
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    handleDocumentKeydown(key("v", { code: "KeyV", metaKey: true }));

    expect(sheetClipboard.pasteValuesShortcut).not.toHaveBeenCalled();
  });
});

describe("debug-event capture", () => {
  test("logs keystrokes only when debug mode is on", () => {
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    handleDocumentKeydown(key("a"));
    expect(get(debugLog).length).toBe(0);

    debugMode.set(true);
    handleDocumentKeydown(key("a"));
    expect(get(debugLog).length).toBe(1);
    expect(get(debugLog)[0].key).toBe("a");
    expect(get(debugLog)[0].active).toBe("A1");
  });

  test("ignores modifier-only taps", () => {
    debugMode.set(true);
    handleDocumentKeydown(key("Shift", { shiftKey: true }));
    handleDocumentKeydown(key("Meta", { metaKey: true }));
    handleDocumentKeydown(key("Control", { ctrlKey: true }));
    handleDocumentKeydown(key("Alt", { altKey: true }));
    expect(get(debugLog).length).toBe(0);
  });

  test("snapshot captures clipboard state before Esc clears it", () => {
    debugMode.set(true);
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));
    markCopyRange(["A1"] as CellId[]);

    handleDocumentKeydown(key("Escape"));

    const log = get(debugLog);
    expect(log.length).toBe(1);
    // The log entry was pushed *before* Esc cleared the mark — so
    // the snapshot still records the active copy mode.
    expect(log[0].clipboardMode).toBe("copy");
    expect(log[0].clipboardRange).toBe("A1");
    // …and the mark itself is now cleared on the live store.
    expect(get(clipboardRange).size).toBe(0);
  });
});

afterEach(() => {
  // Ensure no stray document listener leaks between test files.
});
