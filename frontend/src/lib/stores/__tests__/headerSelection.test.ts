import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import {
  headerSelection,
  selectedCols,
  selectedRows,
  _resetHeaderSelectionForTests,
} from "../headerSelection";
import {
  COLUMNS,
  ROWS,
  selectedCell,
  selectedCells,
  selectionAnchor,
  cellIdFromCoords,
} from "../spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// Unit tests for the header drag-select state machine extracted from
// Grid.svelte in CELL-GRID-02. Both axes share one generic switch, so
// each behaviour gets a column-axis test + a row-axis mirror.

beforeEach(() => {
  _resetHeaderSelectionForTests();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
});

// ── Column axis ─────────────────────────────────────────────────────

test("startDrag('col', n, false) selects exactly that column", () => {
  headerSelection.startDrag("col", 3, false);

  expect(get(selectedCols)).toEqual(new Set([3]));
  const state = get(headerSelection.col);
  expect(state.anchor).toBe(3);
  expect(state.farEdge).toBe(3);
  expect(state.dragActive).toBe(true);

  // selectedCells covers the full column.
  const ids = get(selectedCells);
  expect(ids.size).toBe(ROWS.length);
  for (const r of ROWS) expect(ids.has(cellIdFromCoords(3, r))).toBe(true);
});

test("startDrag then extendDragTo(idx+5) extends without moving anchor", () => {
  headerSelection.startDrag("col", 2, false);
  headerSelection.extendDragTo("col", 7);

  expect(get(selectedCols)).toEqual(new Set([2, 3, 4, 5, 6, 7]));
  const state = get(headerSelection.col);
  expect(state.anchor).toBe(2);
  expect(state.farEdge).toBe(7);
});

test("shift-click extends from the existing anchor", () => {
  headerSelection.startDrag("col", 2, false);
  headerSelection.endDrag("col");
  headerSelection.startDrag("col", 5, true); // shift-click

  expect(get(selectedCols)).toEqual(new Set([2, 3, 4, 5]));
  const state = get(headerSelection.col);
  expect(state.anchor).toBe(2);
  expect(state.farEdge).toBe(5);
});

test("extend('col', +1) walks farEdge; extend('col', -1) shrinks back", () => {
  headerSelection.startDrag("col", 2, false);
  headerSelection.endDrag("col");

  headerSelection.extend("col", 1);
  expect(get(selectedCols)).toEqual(new Set([2, 3]));
  expect(get(headerSelection.col).farEdge).toBe(3);

  headerSelection.extend("col", 1);
  expect(get(selectedCols)).toEqual(new Set([2, 3, 4]));
  expect(get(headerSelection.col).farEdge).toBe(4);

  headerSelection.extend("col", -1);
  expect(get(selectedCols)).toEqual(new Set([2, 3]));
  expect(get(headerSelection.col).farEdge).toBe(3);

  headerSelection.extend("col", -1);
  expect(get(selectedCols)).toEqual(new Set([2]));
  expect(get(headerSelection.col).farEdge).toBe(2);
});

test("extend clamps at axis bounds", () => {
  // Column 0 — extending left is a no-op.
  headerSelection.startDrag("col", 0, false);
  headerSelection.endDrag("col");
  headerSelection.extend("col", -1);
  expect(get(selectedCols)).toEqual(new Set([0]));
  expect(get(headerSelection.col).farEdge).toBe(0);

  // Last column — extending right is a no-op.
  _resetHeaderSelectionForTests();
  const last = COLUMNS.length - 1;
  headerSelection.startDrag("col", last, false);
  headerSelection.endDrag("col");
  headerSelection.extend("col", 1);
  expect(get(selectedCols)).toEqual(new Set([last]));
  expect(get(headerSelection.col).farEdge).toBe(last);
});

test("switching axes clears the other axis", () => {
  headerSelection.startDrag("col", 1, false);
  expect(get(selectedCols).size).toBe(1);

  headerSelection.startDrag("row", 4, false);

  expect(get(selectedRows)).toEqual(new Set([4]));
  expect(get(selectedCols)).toEqual(new Set());
});

// ── Row axis (mirror of the column tests) ───────────────────────────

test("startDrag('row', n, false) selects exactly that row", () => {
  headerSelection.startDrag("row", 5, false);

  expect(get(selectedRows)).toEqual(new Set([5]));
  const state = get(headerSelection.row);
  expect(state.anchor).toBe(5);
  expect(state.farEdge).toBe(5);
  expect(state.dragActive).toBe(true);

  const ids = get(selectedCells);
  expect(ids.size).toBe(COLUMNS.length);
  COLUMNS.forEach((_, c) => {
    expect(ids.has(cellIdFromCoords(c, 5))).toBe(true);
  });
});

test("row drag-extend to row+5 builds the inclusive range", () => {
  headerSelection.startDrag("row", 3, false);
  headerSelection.extendDragTo("row", 8);

  expect(get(selectedRows)).toEqual(new Set([3, 4, 5, 6, 7, 8]));
  expect(get(headerSelection.row).farEdge).toBe(8);
  expect(get(headerSelection.row).anchor).toBe(3);
});

test("row extend(+1) / extend(-1) walks farEdge", () => {
  headerSelection.startDrag("row", 4, false);
  headerSelection.endDrag("row");

  headerSelection.extend("row", 1);
  expect(get(selectedRows)).toEqual(new Set([4, 5]));

  headerSelection.extend("row", -1);
  expect(get(selectedRows)).toEqual(new Set([4]));
});

// ── reconcileWith ───────────────────────────────────────────────────

test("reconcileWith drops row-axis highlight when the cell selection no longer covers a full row", () => {
  // Select row 2 — every cell in row 2 is highlighted.
  headerSelection.startDrag("row", 2, false);
  expect(get(selectedRows)).toEqual(new Set([2]));

  // Simulate the user clicking a single cell elsewhere — selectedCells
  // shrinks to just B2, which no longer covers all of row 2.
  const collapsed = new Set<CellId>([cellIdFromCoords(1, 2) as CellId]);

  headerSelection.reconcileWith(collapsed);
  expect(get(selectedRows)).toEqual(new Set());
});

test("reconcileWith drops col-axis highlight when the cell selection no longer covers a full column", () => {
  headerSelection.startDrag("col", 1, false);
  expect(get(selectedCols)).toEqual(new Set([1]));

  // Drop everything but a single cell in column B.
  const collapsed = new Set<CellId>([cellIdFromCoords(1, 5) as CellId]);

  headerSelection.reconcileWith(collapsed);
  expect(get(selectedCols)).toEqual(new Set());
});

test("reconcileWith leaves the highlight in place when the cell selection still covers the row", () => {
  headerSelection.startDrag("row", 2, false);
  // Build the full-row id set the way the store itself does.
  const fullRow = new Set<CellId>();
  COLUMNS.forEach((_, c) => fullRow.add(cellIdFromCoords(c, 2) as CellId));

  headerSelection.reconcileWith(fullRow);
  expect(get(selectedRows)).toEqual(new Set([2]));
});

// ── clear / setAxis ─────────────────────────────────────────────────

test("clear('col') resets the column axis", () => {
  headerSelection.startDrag("col", 2, false);
  headerSelection.clear("col");

  expect(get(selectedCols)).toEqual(new Set());
  const state = get(headerSelection.col);
  expect(state.anchor).toBeNull();
  expect(state.farEdge).toBeNull();
  expect(state.dragActive).toBe(false);
});

test("setAxis('col', …) — used by the column-insert path — moves the highlight", () => {
  headerSelection.startDrag("col", 2, false);
  headerSelection.setAxis("col", {
    selected: new Set([4]),
    anchor: 4,
    farEdge: 4,
  });

  expect(get(selectedCols)).toEqual(new Set([4]));
  expect(get(headerSelection.col).anchor).toBe(4);
});
