/**
 * Cell.svelte filter overlay tests — Phase B.
 *
 * Verifies the bordered rectangle + bold header rendering kicks in
 * when ``sheetFilter`` is populated. Phase C will add the chevron
 * icon test; Phase D will add the row-hide tests.
 */
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import { sheetFilter, type FilterMeta } from "../../stores/filter";
import type { CellId } from "../../spreadsheet/types";

afterEach(() => {
  sheetFilter.set(null);
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

function cellDiv(cellId: CellId): HTMLElement {
  return page.getByTestId(cellId).element() as HTMLElement;
}

// [sheet.filter.header-bold]
test("header-row cell gets the .filter-header class", () => {
  cells.setCellValue("B2" as CellId, "Name");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B2" as CellId } });
  expect(cellDiv("B2" as CellId).classList.contains("filter-header")).toBe(
    true,
  );
});

// [sheet.filter.header-bold]
test("non-header cell inside the filter does NOT get .filter-header", () => {
  cells.setCellValue("B3" as CellId, "row1");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B3" as CellId } });
  expect(cellDiv("B3" as CellId).classList.contains("filter-header")).toBe(
    false,
  );
});

// [sheet.filter.border]
test("top-left corner cell carries top + left edge classes", () => {
  cells.setCellValue("B2" as CellId, "Name");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B2" as CellId } });
  const el = cellDiv("B2" as CellId);
  expect(el.classList.contains("filter-edge-top")).toBe(true);
  expect(el.classList.contains("filter-edge-left")).toBe(true);
  expect(el.classList.contains("filter-edge-right")).toBe(false);
  expect(el.classList.contains("filter-edge-bottom")).toBe(false);
});

// [sheet.filter.border]
test("bottom-right corner cell carries bottom + right edge classes", () => {
  cells.setCellValue("D5" as CellId, "");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "D5" as CellId } });
  const el = cellDiv("D5" as CellId);
  expect(el.classList.contains("filter-edge-top")).toBe(false);
  expect(el.classList.contains("filter-edge-left")).toBe(false);
  expect(el.classList.contains("filter-edge-right")).toBe(true);
  expect(el.classList.contains("filter-edge-bottom")).toBe(true);
});

// [sheet.filter.border]
test("interior cell carries no filter-edge-* classes", () => {
  cells.setCellValue("C3" as CellId, "");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "C3" as CellId } });
  const el = cellDiv("C3" as CellId);
  expect(el.classList.contains("filter-edge-top")).toBe(false);
  expect(el.classList.contains("filter-edge-right")).toBe(false);
  expect(el.classList.contains("filter-edge-bottom")).toBe(false);
  expect(el.classList.contains("filter-edge-left")).toBe(false);
});

// [sheet.filter.border]
test("cell outside the filter rectangle gets no filter classes", () => {
  cells.setCellValue("F1" as CellId, "");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "F1" as CellId } });
  const el = cellDiv("F1" as CellId);
  expect(el.classList.contains("filter-header")).toBe(false);
  expect(el.classList.contains("filter-edge-top")).toBe(false);
  expect(el.classList.contains("filter-edge-right")).toBe(false);
});

test("filter classes clear when sheetFilter goes back to null", async () => {
  cells.setCellValue("B2" as CellId, "");
  sheetFilter.set(FILTER);
  render(Cell, { props: { cellId: "B2" as CellId } });
  expect(cellDiv("B2" as CellId).classList.contains("filter-header")).toBe(
    true,
  );
  sheetFilter.set(null);
  // Wait one microtask for Svelte to flush the reactive update.
  await Promise.resolve();
  expect(cellDiv("B2" as CellId).classList.contains("filter-header")).toBe(
    false,
  );
});
