import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CellId } from "../../spreadsheet/types";

// One sheet only — the dirty-set race lives entirely within
// ``saveCellsToWorkbook`` for the active sheet.
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

// Controllable in-flight promise: the test calls ``release`` to let
// the network round-trip resolve, simulating a slow server. Each
// outbound call records its ``changes`` payload so we can assert
// what made it onto the wire.
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const cellCalls: { changes: unknown[]; release: () => void }[] = [];
const columnCalls: { columns: unknown[]; release: () => void }[] = [];

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
        changes: unknown[],
      ): Promise<{ cells: [] }> => {
        const d = deferred<{ cells: [] }>();
        cellCalls.push({ changes, release: () => d.resolve({ cells: [] }) });
        return d.promise;
      },
    ),
    saveColumns: vi.fn(
      async (
        _d: string,
        _w: number,
        _s: number,
        columns: unknown[],
      ): Promise<{ columns: [] }> => {
        const d = deferred<{ columns: [] }>();
        columnCalls.push({
          columns,
          release: () => d.resolve({ columns: [] }),
        });
        return d.promise;
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
  // Reset the cell store between tests so dirty-set state doesn't
  // leak across cases. ``cells`` is a module-level singleton.
  const { cells } = await import("../spreadsheet");
  cells.clear();
});

describe("saveCellsToWorkbook dirty-set race", () => {
  test("a markCellDirty during the in-flight save survives to the next flush", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    // Edit A1. Mark dirty BEFORE setCellValue per the data-flow
    // contract, then trigger a save without awaiting it.
    persistence.markCellDirty("A1" as CellId);
    cells.setCellValue("A1" as CellId, "first");
    const firstSave = persistence.saveCellsToWorkbook();

    // saveCells should have been called with A1.
    expect(cellCalls.length).toBe(1);
    expect(
      (cellCalls[0].changes as { row_idx: number; col_idx: number }[]).map(
        (c) => `${c.col_idx}:${c.row_idx}`,
      ),
    ).toEqual(["0:0"]);

    // While the network is still in flight, the user types into A2.
    persistence.markCellDirty("A2" as CellId);
    cells.setCellValue("A2" as CellId, "second");

    // Release the in-flight save.
    cellCalls[0].release();
    await firstSave;

    // The next flush should still include A2 — pre-fix it would be
    // wiped by an unconditional ``_dirtyCellIds.clear()``.
    const secondSave = persistence.saveCellsToWorkbook();
    expect(cellCalls.length).toBe(2);
    const sent = (
      cellCalls[1].changes as {
        row_idx: number;
        col_idx: number;
        raw_value: string;
      }[]
    ).map((c) => `${c.col_idx}:${c.row_idx}=${c.raw_value}`);
    expect(sent).toEqual(["0:1=second"]);
    cellCalls[1].release();
    await secondSave;
  });
});

describe("saveCellsToWorkbook column-width race", () => {
  test("a column-width change during the in-flight save survives to the next flush", async () => {
    const persistence = await load();
    const { columnWidths } = await import("../spreadsheet");

    // ``enableAutoSave`` wires the columnWidths subscription that
    // bumps ``_columnWidthsDirty`` + the generation counter. Without
    // it nothing is dirty and ``saveCellsToWorkbook`` early-returns.
    persistence.enableAutoSave();

    // First mutation: trigger a column save.
    columnWidths.update((w) => ({ ...w, A: 200 }));
    const firstSave = persistence.saveCellsToWorkbook();
    expect(columnCalls.length).toBe(1);

    // Second mutation arrives while the first save is in flight.
    columnWidths.update((w) => ({ ...w, B: 150 }));

    columnCalls[0].release();
    await firstSave;

    // The dirty flag should still be set — saveCells should issue
    // another POST when invoked again.
    const secondSave = persistence.saveCellsToWorkbook();
    expect(columnCalls.length).toBe(2);
    columnCalls[1].release();
    await secondSave;
  });
});
