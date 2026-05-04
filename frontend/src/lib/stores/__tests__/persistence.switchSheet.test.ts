import { beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../spreadsheet/types";

// Two sheets — the switch tests need somewhere to switch *to*.
const SHEETS = [
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

// Per-test toggles. ``saveCellsShouldFail`` lets a single test inject
// a server failure on the next ``saveCells`` call without having to
// re-mock the whole module.
let saveCellsShouldFail = false;

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listSheets: vi.fn(async () => SHEETS),
    getSheet: vi.fn(async (_d: string, _w: string, id: string) => ({
      sheet: SHEETS.find((s) => s.id === id)!,
      columns: [],
      cells: [],
    })),
    createSheet: vi.fn(
      async (_d: string, _w: string, name: string, color?: string) => ({
        sheet: {
          id: `sheet-new-${name}`,
          name,
          color: color ?? "#000",
          created_at: "t",
          updated_at: "t",
          sort_order: SHEETS.length,
        },
        columns: [],
      }),
    ),
    deleteSheet: vi.fn(async () => undefined),
    saveCells: vi.fn(async () => {
      if (saveCellsShouldFail) throw new Error("boom");
      return { cells: [] };
    }),
    saveColumns: vi.fn(async () => ({ columns: [] })),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
  };
});

async function load() {
  const persistence = await import("../persistence");
  persistence.setDatabase("testdb");
  persistence.setWorkbookId("wb1");
  await persistence.initWorkbook();
  return persistence;
}

beforeEach(async () => {
  vi.clearAllMocks();
  saveCellsShouldFail = false;
  const { cells } = await import("../spreadsheet");
  const persistence = await import("../persistence");
  const engine = await import("../../engine");
  cells.clear();
  persistence._resetDirtyCellIdsForTest();
  engine.clearAllPins();
  engine.setEngineNames({});
});

describe("switchSheet — save failure", () => {
  test("a failing pre-switch save throws and leaves the active sheet untouched", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    // Mark A1 dirty so ``saveCellsToWorkbook`` actually attempts a
    // network call. With no dirty cells the early-return would mask
    // the failure case entirely.
    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "first");

    saveCellsShouldFail = true;

    await expect(persistence.switchSheet("sheet-2")).rejects.toThrow(
      persistence.SaveBeforeSwitchError,
    );

    // Active sheet did not advance to sheet-2.
    expect(get(persistence.activeSheetId)).toBe("sheet-1");
    // Dirty marker for A1 is preserved so the next flush still
    // targets the original sheet's cell.
    expect(persistence._getDirtyCellIdsForTest().has("A1" as CellId)).toBe(
      true,
    );
  });
});

describe("addSheet — clears engine overlays", () => {
  test("a pin from the previous sheet does not survive into the new sheet", async () => {
    const persistence = await load();
    const engine = await import("../../engine");

    // Simulate a ``=SQL(...)`` pin landing on the outgoing sheet.
    engine.pinValue("D1", [["pinned"]]);
    expect(engine.pinnedCells()).toContain("D1");

    await persistence.addSheet("Three");

    // Fresh sheet — pin map should be empty so the next recalc
    // doesn't resurrect the previous sheet's spill.
    expect(engine.pinnedCells()).toEqual([]);
  });
});

describe("deleteSheet — clears scoped state", () => {
  test("deleting the active sheet clears undo, pins, and named ranges", async () => {
    const persistence = await load();
    const { cells, pushUndo, canUndo } = await import("../spreadsheet");
    const engine = await import("../../engine");

    // Build up sheet-scoped state on sheet-1: an undo frame, a host
    // pin, and a named range registered with the engine.
    cells.setCellValue("A1" as CellId, "before");
    pushUndo();
    cells.setCellValue("A1" as CellId, "after");
    expect(canUndo()).toBe(true);

    engine.pinValue("E1", [["pin"]]);
    engine.setEngineName("Total", "A1:A10");

    await persistence.deleteSheet("sheet-1");

    // Active sheet swapped to the remaining one.
    expect(get(persistence.activeSheetId)).toBe("sheet-2");
    // Undo stack reset — undoing now must not resurrect cells from
    // the deleted sheet.
    expect(canUndo()).toBe(false);
    // Pins cleared.
    expect(engine.pinnedCells()).toEqual([]);
    // Named-range store reset — ``loadNamedRanges`` runs inside
    // ``transitionToSheet`` against the empty server fixture, which
    // proves the previous sheet's names were dropped from both the
    // store mirror and the engine table.
    const { namedRanges } = await import("../namedRanges");
    expect(get(namedRanges)).toEqual([]);
  });
});
