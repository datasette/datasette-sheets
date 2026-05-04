/**
 * [tests-11] Failure-path coverage that the existing
 * persistence.save / persistence.misc / persistence.dirtyRace tests
 * leave on the table:
 *
 *   - Repeated saveCells rejection across several flush cycles must
 *     not lose the dirty set — every retry ships the full payload.
 *   - loadSheetCells (via initWorkbook) rejecting on the API surfaces
 *     the rejection to the caller (no swallowed promise).
 *
 * Happy paths and the single-rejection case are already covered:
 *   - persistence.save.test.ts pins one rejection cycle (status
 *     rolls back to idle, dirty set retained).
 *   - persistence.misc.test.ts pins the malformed format_json fallback
 *     and the empty-sheet bootstrap branch.
 *
 * The ticket also flagged ``apiCellsToMap`` silently dropping bad
 * format JSON without a console.warn — that's a behaviour-change
 * request, not a test gap, so we don't ship it here.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../spreadsheet/types";

const SHEETS = [
  {
    id: "sheet-1",
    name: "One",
    color: "#111",
    created_at: "t",
    updated_at: "t",
    sort_order: 0,
  },
];

let saveCellsRejectCount = 0;
let getSheetShouldFail = false;
const cellCalls: { changes: { row_idx: number; col_idx: number }[] }[] = [];

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listSheets: vi.fn(async () => SHEETS),
    getSheet: vi.fn(async (_d: string, _w: string, id: string) => {
      if (getSheetShouldFail) {
        throw new Error("getSheet-network-down");
      }
      return {
        sheet: SHEETS.find((s) => s.id === id)!,
        columns: [],
        cells: [],
      };
    }),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
    saveCells: vi.fn(
      async (
        _d: string,
        _w: string,
        _s: string,
        changes: { row_idx: number; col_idx: number }[],
      ): Promise<{ cells: [] }> => {
        cellCalls.push({ changes });
        if (saveCellsRejectCount > 0) {
          saveCellsRejectCount -= 1;
          throw new Error("server-still-down");
        }
        return { cells: [] };
      },
    ),
    saveColumns: vi.fn(async () => ({ columns: [] })),
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
  cellCalls.length = 0;
  saveCellsRejectCount = 0;
  getSheetShouldFail = false;
  const { cells, columnWidths, COLUMNS } = await import("../spreadsheet");
  const persistence = await import("../persistence");
  cells.clear();
  persistence.resetPersistenceStateForTests();
  columnWidths.set(Object.fromEntries(COLUMNS.map((c) => [c, 100])));
  persistence.resetPersistenceStateForTests();
});

describe("saveCellsToWorkbook — repeated rejection", () => {
  test("two rejections then a success: the dirty cell is in every payload", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "first-value");

    saveCellsRejectCount = 2;

    // Cycle 1 — rejected, dirty marker retained.
    await expect(persistence.saveCellsToWorkbook()).rejects.toThrow(
      "server-still-down",
    );
    expect(persistence._getDirtyCellIdsForTest().has("A1" as CellId)).toBe(
      true,
    );

    // Cycle 2 — also rejected. We did NOT lose the dirty marker — a
    // fresh attempt still has work to do.
    await expect(persistence.saveCellsToWorkbook()).rejects.toThrow(
      "server-still-down",
    );
    expect(persistence._getDirtyCellIdsForTest().has("A1" as CellId)).toBe(
      true,
    );

    // Cycle 3 — succeeds, dirty drained.
    await persistence.saveCellsToWorkbook();
    expect(persistence._getDirtyCellIdsForTest().size).toBe(0);

    // Every cycle hit the wire with the same single-cell payload.
    expect(cellCalls.length).toBe(3);
    for (const call of cellCalls) {
      expect(call.changes.length).toBe(1);
      expect(call.changes[0]).toMatchObject({ row_idx: 0, col_idx: 0 });
    }

    // Indicator settled at "saved" after the success — not stuck on
    // "saving" from the failed cycles.
    expect(get(persistence.saveStatus)).toBe("saved");
  });

  test("dirty markers added during the in-flight rejection are retained", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "value-A1");

    saveCellsRejectCount = 1;
    const inFlight = persistence.saveCellsToWorkbook();

    // Add a NEW dirty cell while the save is mid-flight. The dirty
    // marker should survive even after the rejection rolls the
    // indicator back to idle.
    persistence.markCellDirty("B2" as CellId);
    cells.setCellValue("B2" as CellId, "value-B2");

    await expect(inFlight).rejects.toThrow("server-still-down");

    const dirty = persistence._getDirtyCellIdsForTest();
    expect(dirty.has("A1" as CellId)).toBe(true);
    expect(dirty.has("B2" as CellId)).toBe(true);
  });
});

describe("loadSheetCells — getSheet rejection", () => {
  test("getSheet rejecting during initWorkbook surfaces the error to the caller", async () => {
    // initWorkbook → loadSheetCells → getSheet. A rejection here
    // means the sheet load failed; the contract is that the promise
    // rejects rather than silently leaving a half-loaded grid.
    const persistence = await import("../persistence");
    persistence.setDatabase("testdb");
    persistence.setWorkbookId("wb1");
    getSheetShouldFail = true;

    await expect(persistence.initWorkbook()).rejects.toThrow(
      "getSheet-network-down",
    );
  });
});
