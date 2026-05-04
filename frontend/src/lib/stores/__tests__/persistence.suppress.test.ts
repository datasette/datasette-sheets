import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CellId } from "../../spreadsheet/types";

// One sheet is enough — suppression is a per-process flag, not
// per-sheet. We just need a real workbook init so ``saveCells`` is
// reachable.
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

// Each saveCells call records its payload so we can assert precisely
// which cell IDs reached the wire.
const cellCalls: { changes: { row_idx: number; col_idx: number }[] }[] = [];

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
        return { cells: [] };
      },
    ),
    saveColumns: vi.fn(async () => ({ columns: [] })),
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
  const { cells } = await import("../spreadsheet");
  const persistence = await import("../persistence");
  cells.clear();
  persistence._resetDirtyCellIdsForTest();
});

describe("suppressAutoSave gates markCellDirty", () => {
  // [STORES-02] The contract is "anything written under
  // ``suppressAutoSave`` is remote-origin and must not echo back."
  // Gating ``markCellDirty`` itself enforces that contract structurally
  // instead of relying on every SSE-handler caller remembering not to
  // call ``markCellDirty``.
  test("markCellDirty inside suppression is a no-op; outside dirty markers survive", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    // A1: a real local edit before the suppressed block.
    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "local");

    // B2: written *under* suppression and (intentionally, mimicking a
    // future buggy SSE handler) marked dirty. The gate must drop the
    // marker on the floor.
    persistence.suppressAutoSave(() => {
      persistence.markCellDirty("B2" as CellId);
      cells.setCellValue("B2" as CellId, "remote");
    });

    // A1 stays dirty, B2 does not.
    const dirty = persistence._getDirtyCellIdsForTest();
    expect(dirty.has("A1" as CellId)).toBe(true);
    expect(dirty.has("B2" as CellId)).toBe(false);

    // Flush — only A1 reaches the server.
    await persistence.saveCellsToWorkbook();
    expect(cellCalls.length).toBe(1);
    const sent = cellCalls[0].changes.map((c) => `${c.col_idx}:${c.row_idx}`);
    expect(sent).toEqual(["0:0"]);
  });

  // Mirrors what ``SheetsPage.svelte::onCellUpdate`` actually does —
  // ``setCellValueBatch`` inside a ``suppressAutoSave`` block, no
  // explicit ``markCellDirty``. Even after the suppression count drops
  // to zero, no save should fire because nothing is dirty.
  test("an SSE-style batch under suppression leaves the dirty set empty and triggers no save", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.enableAutoSave();

    persistence.suppressAutoSave(() => {
      cells.setCellValueBatch([
        ["A1" as CellId, "remote-1"],
        ["B2" as CellId, "remote-2"],
      ]);
    });

    // Suppression has unwound — the cells.subscribe(debouncedSave)
    // path will have run its callback by now, but with an empty dirty
    // set it should not have scheduled a save.
    expect(persistence._getDirtyCellIdsForTest().size).toBe(0);

    // Wait long enough that any scheduled debounce timer (DEBOUNCE_MS
    // = 150ms) would have fired.
    await new Promise((r) => setTimeout(r, 200));

    expect(cellCalls.length).toBe(0);
  });
});
