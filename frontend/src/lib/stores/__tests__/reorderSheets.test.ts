import { beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";

// Seed sheet list — server-shaped records the persistence store will
// transform via apiSheetToLocal.
const SHEETS = [
  {
    id: 1,
    name: "One",
    color: "#111",
    created_at: "t",
    updated_at: "t",
    sort_order: 0,
  },
  {
    id: 2,
    name: "Two",
    color: "#222",
    created_at: "t",
    updated_at: "t",
    sort_order: 1,
  },
  {
    id: 3,
    name: "Three",
    color: "#333",
    created_at: "t",
    updated_at: "t",
    sort_order: 2,
  },
];

// Mock only the network-facing functions persistence.ts uses during
// initWorkbook + reorderSheets. Everything else is re-exported from
// the real module so unrelated store code (views, named ranges) still
// type-checks against the full API surface.
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
    reorderSheets: vi.fn(async (_d: string, _w: number, ids: number[]) =>
      ids.map((id, idx) => ({
        ...SHEETS.find((s) => s.id === id)!,
        sort_order: idx,
      })),
    ),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
  };
});

async function load() {
  const api = await import("../../api");
  const persistence = await import("../persistence");
  persistence.setDatabase("testdb");
  persistence.setWorkbookId(1);
  await persistence.initWorkbook();
  return { api, persistence };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moveSheet", () => {
  test("moves a middle sheet left", async () => {
    const { api, persistence } = await load();
    await persistence.moveSheet(2, -1);
    expect(api.reorderSheets).toHaveBeenCalledWith("testdb", 1, [2, 1, 3]);
    expect(get(persistence.sheets).map((s) => s.id)).toEqual([2, 1, 3]);
  });

  test("moves a middle sheet right", async () => {
    const { api, persistence } = await load();
    await persistence.moveSheet(2, 1);
    expect(api.reorderSheets).toHaveBeenCalledWith("testdb", 1, [1, 3, 2]);
  });

  test("left at the first tab is a no-op", async () => {
    const { api, persistence } = await load();
    await persistence.moveSheet(1, -1);
    expect(api.reorderSheets).not.toHaveBeenCalled();
    expect(get(persistence.sheets).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  test("right at the last tab is a no-op", async () => {
    const { api, persistence } = await load();
    await persistence.moveSheet(3, 1);
    expect(api.reorderSheets).not.toHaveBeenCalled();
  });
});

describe("reorderSheets", () => {
  test("applies optimistic ordering then POSTs the full permutation", async () => {
    const { api, persistence } = await load();
    await persistence.reorderSheets([3, 1, 2]);
    expect(get(persistence.sheets).map((s) => s.id)).toEqual([3, 1, 2]);
    expect(api.reorderSheets).toHaveBeenCalledWith("testdb", 1, [3, 1, 2]);
  });

  test("reverts local state on API failure", async () => {
    const { api, persistence } = await load();
    vi.mocked(api.reorderSheets).mockRejectedValueOnce(new Error("boom"));
    await expect(persistence.reorderSheets([3, 1, 2])).rejects.toThrow("boom");
    // Original order restored.
    expect(get(persistence.sheets).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  test("rejects a mismatched id list without touching state", async () => {
    const { api, persistence } = await load();
    await persistence.reorderSheets([1, 999]);
    expect(api.reorderSheets).not.toHaveBeenCalled();
    expect(get(persistence.sheets).map((s) => s.id)).toEqual([1, 2, 3]);
  });
});
