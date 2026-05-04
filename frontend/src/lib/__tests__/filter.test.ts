/**
 * Filter store unit tests — Phase B coverage.
 *
 * - ``sheetFilter`` writable round-trip
 * - ``filterCellMap`` membership over the rectangle
 * - ``filterHeaderCells`` keyed by header-row CellIds
 * - ``filterEdgeMap`` flags every cell on the perimeter
 * - SSE handlers (``handleFilterCreated`` / Updated / Deleted)
 *   splice the store as expected
 */
import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import {
  sheetFilter,
  filterCellMap,
  filterHeaderCells,
  filterEdgeMap,
  handleFilterCreated,
  handleFilterUpdated,
  handleFilterDeleted,
  type FilterMeta,
} from "../stores/filter";
import type { CellId } from "../spreadsheet/types";

beforeEach(() => {
  sheetFilter.set(null);
});

const SAMPLE: FilterMeta = {
  id: "01HZ-test",
  min_row: 1,
  min_col: 1,
  max_row: 4,
  max_col: 3,
  sort_col_idx: null,
  sort_direction: null,
  predicates: {},
};

test("filterCellMap is empty when no filter is set", () => {
  expect(get(filterCellMap).size).toBe(0);
  expect(get(filterHeaderCells).size).toBe(0);
  expect(get(filterEdgeMap).size).toBe(0);
});

test("filterCellMap covers every cell in the rectangle", () => {
  sheetFilter.set(SAMPLE);
  const map = get(filterCellMap);
  // Rows 2..5 (min_row=1 → row 2 in 1-based) × cols B..D ⇒ 16 cells.
  expect(map.size).toBe(4 * 3);
  expect(map.has("B2" as CellId)).toBe(true);
  expect(map.has("D5" as CellId)).toBe(true);
  expect(map.has("E2" as CellId)).toBe(false); // outside max_col
  expect(map.has("B6" as CellId)).toBe(false); // outside max_row
});

test("filterHeaderCells contains exactly the min_row cells", () => {
  sheetFilter.set(SAMPLE);
  const map = get(filterHeaderCells);
  expect(map.size).toBe(3); // B2, C2, D2
  expect(map.get("B2" as CellId)).toEqual({ colIdx: 1 });
  expect(map.get("C2" as CellId)).toEqual({ colIdx: 2 });
  expect(map.get("D2" as CellId)).toEqual({ colIdx: 3 });
  // Cells in subsequent rows aren't header cells.
  expect(map.has("B3" as CellId)).toBe(false);
});

test("filterEdgeMap flags top/right/bottom/left correctly", () => {
  sheetFilter.set(SAMPLE);
  const map = get(filterEdgeMap);
  // Top-left corner: top + left, no right or bottom.
  expect(map.get("B2" as CellId)).toEqual({
    top: true,
    right: false,
    bottom: false,
    left: true,
  });
  // Top-right corner.
  expect(map.get("D2" as CellId)).toEqual({
    top: true,
    right: true,
    bottom: false,
    left: false,
  });
  // Bottom-left corner.
  expect(map.get("B5" as CellId)).toEqual({
    top: false,
    right: false,
    bottom: true,
    left: true,
  });
  // Bottom-right corner.
  expect(map.get("D5" as CellId)).toEqual({
    top: false,
    right: true,
    bottom: true,
    left: false,
  });
  // Interior cell — no edges.
  expect(map.get("C3" as CellId)).toEqual({
    top: false,
    right: false,
    bottom: false,
    left: false,
  });
});

test("handleFilterCreated splices the store", () => {
  expect(get(sheetFilter)).toBeNull();
  handleFilterCreated(SAMPLE);
  expect(get(sheetFilter)).toEqual(SAMPLE);
});

test("handleFilterUpdated replaces the store value", () => {
  sheetFilter.set(SAMPLE);
  const next: FilterMeta = { ...SAMPLE, max_row: 6 };
  handleFilterUpdated(next);
  expect(get(sheetFilter)?.max_row).toBe(6);
});

test("handleFilterDeleted clears the store", () => {
  sheetFilter.set(SAMPLE);
  handleFilterDeleted();
  expect(get(sheetFilter)).toBeNull();
});

test("derived stores update reactively when sheetFilter changes", () => {
  sheetFilter.set(SAMPLE);
  expect(get(filterCellMap).size).toBeGreaterThan(0);
  sheetFilter.set(null);
  expect(get(filterCellMap).size).toBe(0);
  expect(get(filterHeaderCells).size).toBe(0);
});

// [sheet.filter.row-hide]
test("filterEdgeMap bottom edge tracks the last VISIBLE row", async () => {
  // Filter B2:D5 (rows 1..4). Predicate hides rows 3 and 4 ⇒ last
  // visible data row is r=2 (B3..D3).
  const { cells } = await import("../stores/spreadsheet");
  cells.setCellValue("D3" as CellId, "open");
  cells.setCellValue("D4" as CellId, "closed");
  cells.setCellValue("D5" as CellId, "closed");
  sheetFilter.set({
    ...SAMPLE,
    predicates: { "3": { hidden: ["closed"] } },
  });
  const map = get(filterEdgeMap);
  expect(map.get("B3" as CellId)?.bottom).toBe(true);
  expect(map.get("D3" as CellId)?.bottom).toBe(true);
  // Hidden rows still keyed in the map but don't carry the bottom edge.
  expect(map.get("B5" as CellId)?.bottom).toBe(false);
});

// ---- computeHiddenRows / distinctValuesForColumn -----------------------

import { computeHiddenRows, distinctValuesForColumn } from "../stores/filter";
import { createDefaultFormat } from "../spreadsheet/formatter";
import type { CellData } from "../spreadsheet/types";

function makeCell(
  rawValue: string,
  computedValue: unknown = rawValue,
): CellData {
  return {
    rawValue,
    computedValue: computedValue as CellData["computedValue"],
    formula: null,
    format: createDefaultFormat(),
    error: null,
  };
}

// [sheet.filter.row-hide]
test("computeHiddenRows is empty when filter has no predicates", () => {
  const cells = new Map<CellId, CellData>([
    ["B3" as CellId, makeCell("a")],
    ["B4" as CellId, makeCell("b")],
  ]);
  expect(computeHiddenRows(SAMPLE, cells)).toEqual(new Set());
});

// [sheet.filter.row-hide]
test("computeHiddenRows hides rows whose predicate value matches", () => {
  // Predicate hides "closed" on col D (col_idx=3). Filter is
  // B2:D5 — data rows are 2..4 (0-based).
  const f = {
    ...SAMPLE,
    predicates: { "3": { hidden: ["closed"] } },
  };
  const cells = new Map<CellId, CellData>([
    ["D3" as CellId, makeCell("open")],
    ["D4" as CellId, makeCell("closed")], // hidden
    ["D5" as CellId, makeCell("open")],
  ]);
  expect(computeHiddenRows(f, cells)).toEqual(new Set([3]));
});

// [sheet.filter.row-hide]
test("computeHiddenRows treats missing cells as empty string", () => {
  const f = {
    ...SAMPLE,
    predicates: { "1": { hidden: [""] } },
  };
  const cells = new Map<CellId, CellData>([
    ["B3" as CellId, makeCell("x")], // visible
    // B4 missing ⇒ empty ⇒ hidden
    ["B5" as CellId, makeCell("y")],
  ]);
  expect(computeHiddenRows(f, cells)).toEqual(new Set([3]));
});

// [sheet.filter.row-hide]
test("computeHiddenRows never hides the header row", () => {
  const f = {
    ...SAMPLE,
    predicates: { "1": { hidden: ["Name"] } },
  };
  const cells = new Map<CellId, CellData>([
    ["B2" as CellId, makeCell("Name")], // header — never hidden
    ["B3" as CellId, makeCell("alex")],
  ]);
  expect(computeHiddenRows(f, cells)).toEqual(new Set());
});

// [sheet.filter.row-hide]
test("computeHiddenRows ignores predicates on out-of-range columns", () => {
  // Predicate on col 9 (way outside the rectangle) shouldn't affect
  // anything — defensive against stale predicate keys.
  const f = {
    ...SAMPLE,
    predicates: { "9": { hidden: ["x"] } },
  };
  const cells = new Map<CellId, CellData>([["B3" as CellId, makeCell("x")]]);
  expect(computeHiddenRows(f, cells)).toEqual(new Set());
});

// [sheet.filter.row-hide]
test("computeHiddenRows hides any row matching at least one predicate", () => {
  // Two predicates: any matching one is enough to hide a row.
  const f = {
    ...SAMPLE,
    predicates: {
      "1": { hidden: ["alex"] },
      "3": { hidden: ["closed"] },
    },
  };
  const cells = new Map<CellId, CellData>([
    ["B3" as CellId, makeCell("alex")], // hidden by col 1
    ["D3" as CellId, makeCell("open")],
    ["B4" as CellId, makeCell("brian")],
    ["D4" as CellId, makeCell("closed")], // hidden by col 3
    ["B5" as CellId, makeCell("craig")], // visible
    ["D5" as CellId, makeCell("open")],
  ]);
  expect(computeHiddenRows(f, cells)).toEqual(new Set([2, 3]));
});

// [sheet.filter.value-toggle]
test("distinctValuesForColumn returns sorted distinct values with row counts", () => {
  const cells = new Map<CellId, CellData>([
    ["B3" as CellId, makeCell("alex")],
    ["B4" as CellId, makeCell("alex")], // dup
    ["B5" as CellId, makeCell("brian")],
  ]);
  expect(distinctValuesForColumn(SAMPLE, cells, 1)).toEqual([
    { value: "alex", count: 2 },
    { value: "brian", count: 1 },
  ]);
});

test("distinctValuesForColumn includes empty string for missing cells", () => {
  const cells = new Map<CellId, CellData>([["B3" as CellId, makeCell("x")]]);
  // Rows 4 and 5 are missing ⇒ contribute "" with count 2.
  const values = distinctValuesForColumn(SAMPLE, cells, 1);
  expect(values).toContainEqual({ value: "", count: 2 });
  expect(values).toContainEqual({ value: "x", count: 1 });
});

// [sheet.filter.value-toggle]
test("distinctValuesForColumn applies OTHER columns' predicates (cross-column)", () => {
  // SAMPLE rectangle: B2:D5 (header row=2, data rows 3..5).
  // Col 1 (B) = Name, col 3 (D) = Status. Filter Status=Active hides
  // Inactive rows ⇒ Name list narrows to Bob.
  const cells = new Map<CellId, CellData>([
    ["B3" as CellId, makeCell("alex")],
    ["D3" as CellId, makeCell("Inactive")],
    ["B4" as CellId, makeCell("bob")],
    ["D4" as CellId, makeCell("Active")],
    ["B5" as CellId, makeCell("carol")],
    ["D5" as CellId, makeCell("Inactive")],
  ]);
  const filter = { ...SAMPLE, predicates: { "3": { hidden: ["Inactive"] } } };
  expect(distinctValuesForColumn(filter, cells, 1)).toEqual([
    { value: "bob", count: 1 },
  ]);
});

// [sheet.filter.value-toggle]
test("distinctValuesForColumn does NOT apply the column's own predicate", () => {
  // Hiding "alex" via column B's own predicate should not remove
  // "alex" from B's value list — otherwise the user can't re-check it.
  const cells = new Map<CellId, CellData>([
    ["B3" as CellId, makeCell("alex")],
    ["B4" as CellId, makeCell("bob")],
    ["B5" as CellId, makeCell("carol")],
  ]);
  const filter = { ...SAMPLE, predicates: { "1": { hidden: ["alex"] } } };
  const values = distinctValuesForColumn(filter, cells, 1);
  expect(values.map((v) => v.value)).toEqual(["alex", "bob", "carol"]);
});

// ---- maybeAutoExpandLocally ---------------------------------------

import { maybeAutoExpandLocally } from "../stores/filter";

// [sheet.filter.auto-expand]
test("maybeAutoExpandLocally bumps max_row on a write at the boundary", () => {
  // Filter B2:D5 ⇒ max_row=4; boundary is row idx 5, col idx 1..3.
  sheetFilter.set(SAMPLE);
  maybeAutoExpandLocally(5, 1, "alex");
  expect(get(sheetFilter)?.max_row).toBe(5);
});

// [sheet.filter.auto-expand]
test("maybeAutoExpandLocally does nothing for an empty value", () => {
  sheetFilter.set(SAMPLE);
  maybeAutoExpandLocally(5, 1, "");
  expect(get(sheetFilter)?.max_row).toBe(4);
});

// [sheet.filter.auto-expand]
test("maybeAutoExpandLocally does nothing for a write outside the column range", () => {
  sheetFilter.set(SAMPLE);
  maybeAutoExpandLocally(5, 5, "x");
  expect(get(sheetFilter)?.max_row).toBe(4);
});

// [sheet.filter.auto-expand]
test("maybeAutoExpandLocally does nothing for a row > max_row+1", () => {
  sheetFilter.set(SAMPLE);
  maybeAutoExpandLocally(7, 1, "x");
  expect(get(sheetFilter)?.max_row).toBe(4);
});

// [sheet.filter.auto-expand]
test("maybeAutoExpandLocally is a no-op when no filter is set", () => {
  sheetFilter.set(null);
  maybeAutoExpandLocally(5, 1, "x");
  expect(get(sheetFilter)).toBeNull();
});

// ---- regen + run frontend types ----------------------------------
