/**
 * [STORES-09] Save-flow happy paths + the indicator/error transitions
 * that the existing race / suppress / switch tests don't cover:
 *
 *   - markCellDirty + flushSave produces a saveCells POST with the
 *     expected payload, and the dirty set drains.
 *   - saveCells rejection routes the indicator back to ``idle`` and
 *     preserves the dirty marker so a retry still has work to do.
 *   - column-width-only flush calls saveColumns, never saveCells.
 *   - flushSave is a no-op when nothing is dirty (nothing reaches the
 *     wire, indicator stays idle).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../spreadsheet/types";

const SHEETS = [
  {
    id: 1,
    name: "One",
    color: "#111",
    created_at: "t",
    updated_at: "t",
    sort_order: 0,
  },
];

const cellCalls: { changes: { row_idx: number; col_idx: number }[] }[] = [];
const columnCalls: { columns: unknown[] }[] = [];
let saveCellsShouldFail = false;

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listSheets: vi.fn(async () => SHEETS),
    getSheet: vi.fn(async (_d: string, _w: number, id: number) => ({
      sheet: SHEETS.find((s) => s.id === id)!,
      columns: [],
      cells: [],
    })),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
    saveCells: vi.fn(
      async (
        _d: string,
        _w: number,
        _s: number,
        changes: { row_idx: number; col_idx: number }[],
      ): Promise<{ cells: [] }> => {
        cellCalls.push({ changes });
        if (saveCellsShouldFail) throw new Error("server-down");
        return { cells: [] };
      },
    ),
    saveColumns: vi.fn(
      async (
        _d: string,
        _w: number,
        _s: number,
        columns: unknown[],
      ): Promise<{ columns: [] }> => {
        columnCalls.push({ columns });
        return { columns: [] };
      },
    ),
  };
});

async function load() {
  const persistence = await import("../persistence");
  persistence.setDatabase("testdb");
  persistence.setWorkbookId(1);
  await persistence.initWorkbook();
  return persistence;
}

beforeEach(async () => {
  vi.clearAllMocks();
  cellCalls.length = 0;
  columnCalls.length = 0;
  saveCellsShouldFail = false;
  const { cells, columnWidths, COLUMNS } = await import("../spreadsheet");
  const persistence = await import("../persistence");
  cells.clear();
  // Full reset so module-level singletons (``_dirtyCellIds``,
  // ``_columnWidthsDirty``, ``_saveStatus``, etc.) don't leak across
  // cases. Column widths are *also* reset to defaults *after* the
  // persistence reset so the columnWidths.subscribe wired by a prior
  // test's ``enableAutoSave`` doesn't immediately re-flag the widths
  // as dirty.
  persistence.resetPersistenceStateForTests();
  columnWidths.set(Object.fromEntries(COLUMNS.map((c) => [c, 100])));
  persistence.resetPersistenceStateForTests();
});

describe("saveCellsToWorkbook happy path", () => {
  test("markCellDirty + saveCellsToWorkbook posts the cell and drains the dirty set", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "hello");
    expect(persistence._getDirtyCellIdsForTest().has("A1" as CellId)).toBe(
      true,
    );

    await persistence.saveCellsToWorkbook();

    expect(cellCalls.length).toBe(1);
    const sent = cellCalls[0].changes;
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ row_idx: 0, col_idx: 0 });

    // Dirty set drained: the next call short-circuits.
    expect(persistence._getDirtyCellIdsForTest().size).toBe(0);
    await persistence.saveCellsToWorkbook();
    expect(cellCalls.length).toBe(1);
  });
});

describe("saveCellsToWorkbook failure path", () => {
  test("a saveCells rejection bubbles, leaves _saveStatus at idle, and keeps the dirty marker", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "doomed");

    saveCellsShouldFail = true;

    await expect(persistence.saveCellsToWorkbook()).rejects.toThrow(
      "server-down",
    );

    // The indicator must roll back from "saving" to "idle" — leaving it
    // on "saving" would pin the header status forever.
    expect(get(persistence.saveStatus)).toBe("idle");
    // The dirty marker must survive — pre-failure we delete from the
    // in-flight snapshot only after the await resolves successfully,
    // so a thrown error skips the drain and the next flush still sees
    // A1.
    expect(persistence._getDirtyCellIdsForTest().has("A1" as CellId)).toBe(
      true,
    );
  });
});

describe("saveCellsToWorkbook column-width-only flush", () => {
  test("column-width dirty + no cell dirty → saveColumns called, saveCells not", async () => {
    const persistence = await load();

    persistence.enableAutoSave();
    const { columnWidths } = await import("../spreadsheet");
    columnWidths.update((w) => ({ ...w, A: 250 }));

    await persistence.saveCellsToWorkbook();

    // Column save fired, cell save did not — the cell branch is
    // gated on ``_dirtyCellIds.size > 0`` and stays untouched.
    expect(columnCalls.length).toBe(1);
    expect(cellCalls.length).toBe(0);
  });
});

describe("saveCellsToWorkbook empty-flush short-circuit", () => {
  test("with nothing dirty, neither saveCells nor saveColumns is called", async () => {
    const persistence = await load();

    // ``initWorkbook`` flips column widths into the writable, which a
    // prior test's leftover ``enableAutoSave`` subscriber may have
    // observed and flagged as dirty. The empty-flush contract is
    // about the *short-circuit branch* in ``saveCellsToWorkbook``, so
    // re-zero every dirty flag (cells + columns) before we drive the
    // assertion. The active sheet id stays set because we re-call
    // ``setDatabase`` / ``setWorkbookId`` — but ``initWorkbook`` is
    // not re-run, so no fetch fires.
    persistence._resetDirtyCellIdsForTest();
    // Bounce a column-width set through a fresh save to drain any
    // pending dirty state. This is gross but local to the empty-flush
    // edge case: the better fix is the class-refactor in stores-08.
    await persistence.saveCellsToWorkbook();
    cellCalls.length = 0;
    columnCalls.length = 0;

    expect(persistence._getDirtyCellIdsForTest().size).toBe(0);

    await persistence.saveCellsToWorkbook();

    expect(cellCalls.length).toBe(0);
    expect(columnCalls.length).toBe(0);
  });
});
