import { beforeEach, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import {
  cells,
  clipboardBounds,
  clipboardMode,
  clipboardRange,
  markCopyRange,
  markCutRange,
  clearClipboardMark,
} from "../spreadsheet";
import type { CellId } from "../../spreadsheet/types";

const SHEETS_FOR_SHEET_SWITCH = [
  {
    id: "sheet-1",
    name: "One",
    color: "#111",
    created_at: "t",
    updated_at: "t",
    sort_order: 0,
  },
  {
    id: "sheet-2",
    name: "Two",
    color: "#222",
    created_at: "t",
    updated_at: "t",
    sort_order: 1,
  },
];

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listSheets: vi.fn(async () => SHEETS_FOR_SHEET_SWITCH),
    getSheet: vi.fn(async (_d: string, _w: string, id: string) => ({
      sheet: SHEETS_FOR_SHEET_SWITCH.find((s) => s.id === id)!,
      columns: [],
      cells: [],
    })),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
    saveCells: vi.fn(async () => ({ cells: [] })),
    saveColumns: vi.fn(async () => ({ columns: [] })),
  };
});

beforeEach(async () => {
  cells.clear();
  clearClipboardMark();
  const persistence = await import("../persistence");
  persistence.resetPersistenceStateForTests();
});

test("markCutRange populates the store, bounds, and mode", () => {
  markCutRange(["A1", "B1", "A2", "B2"] as CellId[]);

  expect(get(clipboardRange).size).toBe(4);
  expect(get(clipboardMode)).toBe("cut");
  expect(get(clipboardBounds)).toEqual({
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 1,
  });
});

test("markCopyRange uses the same range store but flips the mode", () => {
  markCopyRange(["A1", "A2"] as CellId[]);
  expect(get(clipboardRange)).toEqual(new Set(["A1", "A2"]));
  expect(get(clipboardMode)).toBe("copy");
});

test("clearClipboardMark resets the range, bounds, and mode", () => {
  markCutRange(["A1"] as CellId[]);
  expect(get(clipboardBounds)).not.toBeNull();
  expect(get(clipboardMode)).toBe("cut");

  clearClipboardMark();
  expect(get(clipboardRange).size).toBe(0);
  expect(get(clipboardBounds)).toBeNull();
  expect(get(clipboardMode)).toBeNull();
});

test("clipboardBounds handles a non-contiguous selection as a bounding box", () => {
  // Real selections are rectangular, but the store still tolerates a
  // scattered set — it should compute the enclosing box, not crash.
  markCutRange(["A1", "C3"] as CellId[]);
  expect(get(clipboardBounds)).toEqual({
    minRow: 1,
    maxRow: 3,
    minCol: 0,
    maxCol: 2,
  });
});

test("a fresh mark replaces the previous one, not merges it", () => {
  markCutRange(["A1", "A2"] as CellId[]);
  markCopyRange(["D4"] as CellId[]);

  expect(get(clipboardRange)).toEqual(new Set(["D4"]));
  expect(get(clipboardMode)).toBe("copy");
  expect(get(clipboardBounds)).toEqual({
    minRow: 4,
    maxRow: 4,
    minCol: 3,
    maxCol: 3,
  });
});

// [STORES-09] [sheet.clipboard.sheet-switch-clears-mark] The mark
// is scoped to the active sheet — cell IDs like "B2" mean different
// things on different sheets, so an outstanding cut/copy from sheet
// 1 must NOT visually leak onto sheet 2's B2. ``persistence.ts``
// installs an ``_activeSheetId.subscribe(clearClipboardMark)`` at
// module load time. ``initWorkbook`` flips the active sheet id from
// "" → "sheet-1" — that transition is enough to drive the
// subscriber and prove the wiring is intact.
test("flipping the active sheet id clears any outstanding clipboard mark", async () => {
  const persistence = await import("../persistence");
  persistence.setDatabase("testdb");
  persistence.setWorkbookId("wb1");

  markCopyRange(["A1", "B2"] as CellId[]);
  expect(get(clipboardRange).size).toBe(2);
  expect(get(clipboardMode)).toBe("copy");

  // ``initWorkbook`` ends up flipping ``_activeSheetId`` from "" to
  // "sheet-1" via ``transitionToSheet``. The clipboard subscriber on
  // that writable fires and clears the mark.
  await persistence.initWorkbook();

  expect(get(clipboardRange).size).toBe(0);
  expect(get(clipboardMode)).toBeNull();
});
