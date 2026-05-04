import { beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../spreadsheet/types";

// One-sheet fixture is enough — these tests assert the shape of the
// reset, not the network round-trip.
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
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
    saveCells: vi.fn(async () => ({ cells: [] })),
    saveColumns: vi.fn(async () => ({ columns: [] })),
  };
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { cells } = await import("../spreadsheet");
  const persistence = await import("../persistence");
  cells.clear();
  persistence.resetPersistenceStateForTests();
});

describe("resetPersistenceStateForTests", () => {
  // [STORES-08] Drive the documented baseline: every module-level
  // singleton ``persistence.ts`` owns must be at its empty value
  // after the reset. Tests that only cleared a subset of the state
  // were the source of order-dependent flakes.
  test("clears dirty markers, suppression, and sheet stores", async () => {
    const persistence = await import("../persistence");

    // Set up the full surface of mutable state.
    persistence.setDatabase("db");
    persistence.setWorkbookId("wb");
    persistence.setClientId("client");
    persistence.markCellDirty("A1" as CellId);
    persistence.markCellDirty("B2" as CellId);
    expect(persistence._getDirtyCellIdsForTest().size).toBe(2);
    expect(persistence.getClientId()).toBe("client");

    persistence.resetPersistenceStateForTests();

    expect(persistence._getDirtyCellIdsForTest().size).toBe(0);
    expect(persistence.getClientId()).toBe("");
    expect(get(persistence.sheets)).toEqual([]);
    expect(get(persistence.activeSheetId)).toBe("");
    expect(get(persistence.saveStatus)).toBe("idle");
  });

  test("re-running initWorkbook after reset hits the network exactly once per call", async () => {
    const api = await import("../../api");
    const listSheetsMock = vi.mocked(api.listSheets);

    const persistence = await import("../persistence");
    persistence.setDatabase("db");
    persistence.setWorkbookId("wb");
    await persistence.initWorkbook();
    expect(listSheetsMock).toHaveBeenCalledTimes(1);
    expect(get(persistence.activeSheetId)).toBe("sheet-1");

    // Reset and re-init from a clean slate. Pre-fix, the
    // ``_hashSyncInstalled`` flag never reset, so a second
    // ``initWorkbook`` would short-circuit the install path; tests
    // that exercise the URL-hash reader could see stale wiring
    // depending on which test ran first.
    persistence.resetPersistenceStateForTests();
    expect(get(persistence.activeSheetId)).toBe("");

    persistence.setDatabase("db");
    persistence.setWorkbookId("wb");
    await persistence.initWorkbook();
    expect(listSheetsMock).toHaveBeenCalledTimes(2);
    expect(get(persistence.activeSheetId)).toBe("sheet-1");
  });

  test("clipboard mark survives module init without microtask deferral", async () => {
    // Pre-fix: ``persistence.ts`` wrapped its
    // ``_activeSheetId.subscribe(clearClipboardMark)`` call in a
    // ``queueMicrotask`` because the synchronous fire would land
    // before ``spreadsheet.ts`` had finished evaluating
    // ``clipboardRange``. With clipboard hoisted to its own module
    // the cycle is gone — importing both modules in either order
    // and subscribing must just work.
    const clipboard = await import("../clipboard");
    // Force the persistence module to evaluate (it installs the
    // subscriber at the top level).
    await import("../persistence");

    clipboard.markCopyRange(["A1", "B2"] as CellId[]);
    expect(get(clipboard.clipboardRange).size).toBe(2);
    expect(get(clipboard.clipboardMode)).toBe("copy");

    clipboard.clearClipboardMark();
    expect(get(clipboard.clipboardRange).size).toBe(0);
    expect(get(clipboard.clipboardMode)).toBeNull();
  });
});
