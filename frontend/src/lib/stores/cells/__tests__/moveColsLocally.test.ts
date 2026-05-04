/**
 * [sheet.column.drag-reorder] Local optimistic-shift coverage for
 * moveColsLocally — mirrors the structuralOps.test.ts pattern used
 * for insertColsLocally / deleteRowsLocally. Exercises the cell
 * shift, formula rewrite, column-width co-mutation, and the no-op
 * branches in one fast vitest-browser pass.
 */
import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../../spreadsheet/types";
import { COLUMNS, columnWidths, setColumnWidth } from "../../columnWidths";
import { cellsWritable } from "../store";
import { clearCells, setCellValue } from "../mutations";
import { moveColsLocally } from "../structuralOps";

const DEFAULT_WIDTH = 100;

beforeEach(() => {
  clearCells();
  columnWidths.set(Object.fromEntries(COLUMNS.map((c) => [c, DEFAULT_WIDTH])));
});

// ─── Single-column move ───────────────────────────────────────────

test("single-col move: D between B and C swaps cell positions", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("B1" as CellId, "2");
  setCellValue("C1" as CellId, "3");
  setCellValue("D1" as CellId, "4");
  setCellValue("E1" as CellId, "5");

  // src=3 (D), final_start=2 → D's data lands at C, old C lands at D.
  moveColsLocally(3, 3, 2);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("1");
  expect(map.get("B1" as CellId)!.rawValue).toBe("2");
  expect(map.get("C1" as CellId)!.rawValue).toBe("4"); // old D
  expect(map.get("D1" as CellId)!.rawValue).toBe("3"); // old C
  expect(map.get("E1" as CellId)!.rawValue).toBe("5");
});

test("single-col move rewrites formula refs and recalcs", () => {
  setCellValue("A1" as CellId, "=D1");
  setCellValue("D1" as CellId, "42");

  moveColsLocally(3, 3, 2);

  const map = get(cellsWritable);
  // A1 ref to D1 follows the data → C1.
  expect(map.get("A1" as CellId)!.rawValue).toBe("=C1");
  // D's data is now at C1.
  expect(map.get("C1" as CellId)!.rawValue).toBe("42");
  // Engine re-evaluates after the rewrite — A1 still computes to 42.
  expect(map.get("A1" as CellId)!.computedValue).toBe(42);
});

test("single-col move shifts column widths in lockstep", () => {
  setColumnWidth("A", 80);
  setColumnWidth("B", 90);
  setColumnWidth("C", 100);
  setColumnWidth("D", 200);
  setColumnWidth("E", 120);

  moveColsLocally(3, 3, 2);

  const widths = get(columnWidths);
  expect(widths["A"]).toBe(80);
  expect(widths["B"]).toBe(90);
  expect(widths["C"]).toBe(200); // was D
  expect(widths["D"]).toBe(100); // was C
  expect(widths["E"]).toBe(120);
});

// ─── Multi-column block move ───────────────────────────────────────

test("block move B:D → end shifts the entire block atomically", () => {
  for (let c = 0; c < 7; c++) {
    setCellValue(`${COLUMNS[c]}1` as CellId, `c${c}`);
  }

  // src_start=1, src_end=3, final_start=4 → A E F G B C D.
  moveColsLocally(1, 3, 4);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("c0");
  expect(map.get("B1" as CellId)!.rawValue).toBe("c4");
  expect(map.get("C1" as CellId)!.rawValue).toBe("c5");
  expect(map.get("D1" as CellId)!.rawValue).toBe("c6");
  expect(map.get("E1" as CellId)!.rawValue).toBe("c1");
  expect(map.get("F1" as CellId)!.rawValue).toBe("c2");
  expect(map.get("G1" as CellId)!.rawValue).toBe("c3");
});

// ─── No-op branches ───────────────────────────────────────────────

test("no-op when finalStart == srcStart leaves the store untouched", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("D1" as CellId, "4");

  moveColsLocally(3, 3, 3);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("1");
  expect(map.get("D1" as CellId)!.rawValue).toBe("4");
});

test("invalid args (negative, end < start) are no-ops", () => {
  setCellValue("A1" as CellId, "1");
  moveColsLocally(-1, 3, 2);
  moveColsLocally(3, 1, 2);
  moveColsLocally(3, 3, -1);
  expect(get(cellsWritable).get("A1" as CellId)!.rawValue).toBe("1");
});

// ─── Inverse round-trip ───────────────────────────────────────────

test("inverse move restores the original layout", () => {
  setCellValue("A1" as CellId, "a");
  setCellValue("B1" as CellId, "b");
  setCellValue("C1" as CellId, "c");
  setCellValue("D1" as CellId, "d");
  setCellValue("E1" as CellId, "e");

  // Forward: D between B/C (src=3, final=2).
  moveColsLocally(3, 3, 2);
  // Inverse: source is now [final=2, final=2], destination original
  // src=3.
  moveColsLocally(2, 2, 3);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("a");
  expect(map.get("B1" as CellId)!.rawValue).toBe("b");
  expect(map.get("C1" as CellId)!.rawValue).toBe("c");
  expect(map.get("D1" as CellId)!.rawValue).toBe("d");
  expect(map.get("E1" as CellId)!.rawValue).toBe("e");
});
