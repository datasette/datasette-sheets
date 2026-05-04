/**
 * Filter chevron icon tests on Cell.svelte (Phase C).
 *
 * Verifies the chevron renders for header cells, calls
 * ``openFilterPopover`` on click with the right colIdx, and
 * gets the active-state class when the column has a predicate
 * or sort.
 */
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import {
  sheetFilter,
  filterPopover,
  type FilterMeta,
} from "../../stores/filter";
import type { CellId } from "../../spreadsheet/types";

afterEach(() => {
  sheetFilter.set(null);
  filterPopover.set(null);
});

const FILTER: FilterMeta = {
  id: 1,
  min_row: 1,
  min_col: 1,
  max_row: 4,
  max_col: 3,
  sort_col_idx: null,
  sort_direction: null,
  predicates: {},
};

function chevron(cellId: CellId): HTMLButtonElement | null {
  return page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLButtonElement>(".filter-chevron");
}

// [sheet.filter.column-icon]
test("header cell renders a chevron button", () => {
  cells.setCellValue("B2" as CellId, "Name");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B2" as CellId } });
  expect(chevron("B2" as CellId)).not.toBeNull();
});

// [sheet.filter.column-icon]
test("non-header cell inside the filter does NOT render a chevron", () => {
  cells.setCellValue("B3" as CellId, "row1");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B3" as CellId } });
  expect(chevron("B3" as CellId)).toBeNull();
});

// [sheet.filter.column-icon]
test("cell outside the filter does NOT render a chevron", () => {
  cells.setCellValue("F1" as CellId, "");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "F1" as CellId } });
  expect(chevron("F1" as CellId)).toBeNull();
});

// [sheet.filter.column-popover]
test("clicking the chevron sets filterPopover with the right colIdx", () => {
  cells.setCellValue("C2" as CellId, "Age");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "C2" as CellId } });
  const btn = chevron("C2" as CellId);
  expect(btn).not.toBeNull();
  btn!.click();
  let snapshot: { colIdx: number } | null = null;
  filterPopover.subscribe((v) => {
    snapshot = v ? { colIdx: v.colIdx } : null;
  })();
  expect(snapshot).not.toBeNull();
  // C is col 2 (0-based: A=0, B=1, C=2).
  expect(snapshot!.colIdx).toBe(2);
});

// [sheet.filter.column-icon]
test("chevron gets .has-predicate when the column has a predicate", () => {
  cells.setCellValue("B2" as CellId, "");
  sheetFilter.set({
    ...FILTER,
    predicates: { "1": { hidden: ["closed"] } },
  });
  render(Cell, { props: { cellId: "B2" as CellId } });
  const btn = chevron("B2" as CellId);
  expect(btn).not.toBeNull();
  expect(btn!.classList.contains("has-predicate")).toBe(true);
});

// [sheet.filter.column-icon]
test("chevron gets .is-sort when the column is the active sort", () => {
  cells.setCellValue("B2" as CellId, "");
  sheetFilter.set({ ...FILTER, sort_col_idx: 1, sort_direction: "asc" });
  render(Cell, { props: { cellId: "B2" as CellId } });
  const btn = chevron("B2" as CellId);
  expect(btn).not.toBeNull();
  expect(btn!.classList.contains("is-sort")).toBe(true);
});

// [sheet.filter.column-icon]
test("chevron has neither active class when nothing applies", () => {
  cells.setCellValue("B2" as CellId, "");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B2" as CellId } });
  const btn = chevron("B2" as CellId);
  expect(btn).not.toBeNull();
  expect(btn!.classList.contains("has-predicate")).toBe(false);
  expect(btn!.classList.contains("is-sort")).toBe(false);
});
