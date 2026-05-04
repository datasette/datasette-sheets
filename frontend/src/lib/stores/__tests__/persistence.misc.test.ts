/**
 * [tests-02 backfill] Persistence-store coverage gaps not addressed by
 * the existing persistence.dirtyRace / persistence.suppress /
 * persistence.switchSheet / persistence.save tests.
 *
 * Specifically:
 *   - apiCellsToMap silent fallback on malformed format_json (the
 *     "// ignore bad format" branch).
 *   - insertCols re-keys dirty markers across the column shift.
 *   - removeRows / removeCols drop dirty markers in doomed
 *     rows/columns.
 *   - saveStatus indicator lifecycle: idle → saving → saved → idle
 *     after SAVED_INDICATOR_MS.
 *   - URL-hash sync: a sheet switch writes #sheet=<id> through
 *     replaceState.
 *   - initWorkbook with an empty sheet list creates "Sheet 1" via
 *     createSheet.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
  {
    id: "sheet-2",
    name: "Two",
    color: "#222",
    created_at: "t",
    updated_at: "t",
    sort_order: 1,
  },
];

// Per-test toggle: when set, ``listSheets`` returns ``[]`` so we can
// exercise the "no sheets yet — bootstrap a Sheet 1" branch without
// rebuilding the whole mock.
let listSheetsReturnsEmpty = false;
// Records of mocked side-effecting calls so tests can assert what
// reached the wire.
const createSheetCalls: { name: string; color?: string }[] = [];
const cellCalls: { changes: { row_idx: number; col_idx: number }[] }[] = [];
// Server-side ``getSheet`` stub: tests can inject custom rows by
// poking the array before triggering the load path.
type GetSheetCellShape = {
  row_idx: number;
  col_idx: number;
  raw_value: string;
  format_json: string | null;
};
let getSheetCells: GetSheetCellShape[] = [];

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listSheets: vi.fn(async () => (listSheetsReturnsEmpty ? [] : SHEETS)),
    getSheet: vi.fn(async (_d: string, _w: string, id: string) => ({
      sheet: SHEETS.find((s) => s.id === id) ?? SHEETS[0],
      columns: [],
      cells: getSheetCells,
    })),
    createSheet: vi.fn(
      async (_d: string, _w: string, name: string, color?: string) => {
        createSheetCalls.push({ name, color });
        return {
          sheet: {
            id: `sheet-new-${name}`,
            name,
            color: color ?? "#000",
            created_at: "t",
            updated_at: "t",
            sort_order: 0,
          },
          columns: [],
        };
      },
    ),
    deleteRows: vi.fn(async () => [] as number[]),
    deleteColumns: vi.fn(async () => [] as number[]),
    insertColumns: vi.fn(async () => [] as number[]),
    saveCells: vi.fn(
      async (
        _d: string,
        _w: string,
        _s: string,
        changes: { row_idx: number; col_idx: number }[],
      ): Promise<{ cells: [] }> => {
        cellCalls.push({ changes });
        return { cells: [] };
      },
    ),
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
  listSheetsReturnsEmpty = false;
  createSheetCalls.length = 0;
  cellCalls.length = 0;
  getSheetCells = [];
  const { cells } = await import("../spreadsheet");
  const persistence = await import("../persistence");
  cells.clear();
  persistence.resetPersistenceStateForTests();
});

describe("apiCellsToMap — malformed format_json", () => {
  // The ``apiCellsToMap`` function isn't exported, so we exercise it
  // indirectly through ``initWorkbook → loadSheetCells``. The contract
  // we care about: a malformed ``format_json`` payload must NOT throw
  // and must fall through to the default format. Without this guard
  // the whole sheet load would crash on a single bad row.
  test("a malformed format_json blob falls back to the default format", async () => {
    getSheetCells = [
      {
        row_idx: 0,
        col_idx: 0,
        raw_value: "still-loads",
        format_json: "{not valid json",
      },
    ];

    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    const cell = cells.getCell("A1" as CellId);
    expect(cell).toBeTruthy();
    // The raw value loads — the bad JSON didn't blow up the row.
    expect(cell?.rawValue).toBe("still-loads");
    // Format defaults to the createDefaultFormat shape (no bold,
    // ``general`` type, etc.) — the bad JSON was discarded silently.
    expect(cell?.format.bold).toBeFalsy();
    expect(cell?.format.type).toBe("general");

    // Sanity: the active sheet is still ``sheet-1`` and the load
    // completed without rejection.
    expect(get(persistence.activeSheetId)).toBe("sheet-1");
  });
});

describe("removeRows / removeCols — dirty marker cleanup", () => {
  test("removeRows clears dirty markers in dropped rows but leaves others", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.markCellDirty("A2" as CellId);
    persistence.markCellDirty("B5" as CellId);
    cells.setCellValue("A2" as CellId, "row-2");
    cells.setCellValue("B5" as CellId, "row-5");

    // Drop row index 1 (the 0-based parsed.row for "A2") — should
    // strip A2 from the dirty set, keep B5.
    await persistence.removeRows([1]);

    const dirty = persistence._getDirtyCellIdsForTest();
    expect(dirty.has("A2" as CellId)).toBe(false);
    // B5 remains in the dirty set after the row shift. The cell store
    // shifts it to B4 internally, but the dirty marker key isn't
    // re-keyed for row deletes — it stays with its original id, which
    // matches the ``removeRows`` source's "drop marker only if the
    // row is being deleted" branch.
    expect(dirty.has("B5" as CellId)).toBe(true);
  });

  test("removeCols clears dirty markers in dropped columns", async () => {
    const persistence = await load();
    const { cells } = await import("../spreadsheet");

    persistence.markCellDirty("B1" as CellId);
    persistence.markCellDirty("D1" as CellId);
    cells.setCellValue("B1" as CellId, "col-B");
    cells.setCellValue("D1" as CellId, "col-D");

    // Drop column index 1 (B). D1 should survive.
    await persistence.removeCols([1]);

    const dirty = persistence._getDirtyCellIdsForTest();
    expect(dirty.has("B1" as CellId)).toBe(false);
    expect(dirty.has("D1" as CellId)).toBe(true);
  });
});

describe("insertCols — dirty marker re-keying", () => {
  test("insertCols(at=2, count=2) re-keys a D5 dirty marker to F5", async () => {
    const persistence = await load();

    // D5 is column index 3 — past the insertion point at column 2 —
    // so the column-2 insert of count 2 must shift the dirty marker
    // by 2 columns to F5 (col index 5).
    persistence.markCellDirty("D5" as CellId);
    // Also mark a marker BEFORE the insertion point: it must stay put.
    persistence.markCellDirty("A5" as CellId);

    await persistence.insertCols(2, 2);

    const dirty = persistence._getDirtyCellIdsForTest();
    expect(dirty.has("F5" as CellId)).toBe(true);
    expect(dirty.has("D5" as CellId)).toBe(false);
    // A5 is at col 0, before the insertion point — unchanged.
    expect(dirty.has("A5" as CellId)).toBe(true);
  });
});

describe("saveStatus indicator lifecycle", () => {
  // The fake-timer transitions: write triggers ``markSaving`` →
  // ``markSaved`` (after the await) → 1500ms later ``idle``.
  test("idle → saving → saved → idle after SAVED_INDICATOR_MS", async () => {
    vi.useFakeTimers();
    try {
      const persistence = await load();
      const { cells } = await import("../spreadsheet");

      // Baseline: idle.
      expect(get(persistence.saveStatus)).toBe("idle");

      persistence.markCellDirty("A1" as CellId);
      cells.setCellValue("A1" as CellId, "x");

      // Drive a flush. ``saveCellsToWorkbook`` is async — we kick it
      // off without awaiting so we can observe the "saving" state
      // before the network mock resolves.
      const inFlight = persistence.saveCellsToWorkbook();
      expect(get(persistence.saveStatus)).toBe("saving");

      await inFlight;
      expect(get(persistence.saveStatus)).toBe("saved");

      // Advance the saved-indicator timer (1500ms) and verify the
      // status transitions back to idle.
      vi.advanceTimersByTime(1500);
      expect(get(persistence.saveStatus)).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("URL-hash sync", () => {
  let originalHash: string;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalHash = window.location.hash;
    // Real ``replaceState`` would also rewrite the URL, which the
    // browser-mode harness shares across tests. Spy + no-op so we can
    // assert what gets called without polluting other test files.
    replaceStateSpy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
    if (window.location.hash !== originalHash) {
      window.location.hash = originalHash;
    }
  });

  test("switching the active sheet writes #sheet=<id> via replaceState", async () => {
    const persistence = await load();

    // initWorkbook installs the hash sync and immediately writes the
    // initial active sheet through ``replaceState``. Reset the spy so
    // the post-init assertion only sees the switch we drive ourselves.
    replaceStateSpy.mockClear();

    await persistence.switchSheet("sheet-2");

    // ``writeSheetToHash`` calls ``replaceState(null, "", "#sheet=...")``.
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCall = replaceStateSpy.mock.calls.at(-1)!;
    const writtenHash = lastCall[2] as string;
    expect(writtenHash).toBe("#sheet=sheet-2");
  });
});

describe("initWorkbook bootstrap", () => {
  test("an empty sheet list creates 'Sheet 1' via createSheet", async () => {
    listSheetsReturnsEmpty = true;

    const persistence = await load();

    // The bootstrap branch fires exactly one createSheet call with
    // the canonical "Sheet 1" name.
    expect(createSheetCalls.length).toBe(1);
    expect(createSheetCalls[0].name).toBe("Sheet 1");

    // Active sheet is the freshly-created one — the mock returns
    // id ``sheet-new-Sheet 1``.
    expect(get(persistence.activeSheetId)).toBe("sheet-new-Sheet 1");
  });
});
