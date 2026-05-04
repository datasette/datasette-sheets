import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import { COLUMNS, columnWidths, setColumnWidth } from "../../columnWidths";
import { clearCells } from "../mutations";
import { deleteColsLocally } from "../structuralOps";

const DEFAULT_WIDTH = 100;

beforeEach(() => {
  clearCells();
  // Reset every column back to the default width so one test can't
  // leak state into the next.
  columnWidths.set(Object.fromEntries(COLUMNS.map((c) => [c, DEFAULT_WIDTH])));
});

test("deleteColsLocally shifts column widths left, like the server's column table", () => {
  setColumnWidth("A", 80);
  setColumnWidth("B", 200);
  setColumnWidth("C", 120);
  setColumnWidth("D", 140);

  // Delete column B (index 1).
  deleteColsLocally([1]);

  const widths = get(columnWidths);
  // Surviving columns shift left: old C→B, old D→C.
  expect(widths["A"]).toBe(80);
  expect(widths["B"]).toBe(120);
  expect(widths["C"]).toBe(140);
  // Column D was the last explicit width — after the shift the tail
  // end has no backing data so it should fall back to the default.
  expect(widths["D"]).toBe(DEFAULT_WIDTH);
});

test("deleteColsLocally drops widths for multiple deleted columns", () => {
  setColumnWidth("A", 80);
  setColumnWidth("B", 200);
  setColumnWidth("C", 120);
  setColumnWidth("D", 140);
  setColumnWidth("E", 160);

  // Delete B and D (indices 1 and 3).
  deleteColsLocally([1, 3]);

  const widths = get(columnWidths);
  expect(widths["A"]).toBe(80); // untouched
  expect(widths["B"]).toBe(120); // was C
  expect(widths["C"]).toBe(160); // was E (D was also deleted)
  expect(widths["D"]).toBe(DEFAULT_WIDTH);
  expect(widths["E"]).toBe(DEFAULT_WIDTH);
});
