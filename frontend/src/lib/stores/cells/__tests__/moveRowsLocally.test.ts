/**
 * [sheet.row.drag-reorder] Local optimistic-shift coverage for
 * moveRowsLocally — mirror of moveColsLocally.test.ts on the
 * row axis. No width-co-mutation cases (RowHeights is
 * runtime-measured, not persisted).
 */
import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../../spreadsheet/types";
import { cellsWritable } from "../store";
import { clearCells, setCellValue } from "../mutations";
import { moveRowsLocally } from "../structuralOps";

beforeEach(() => {
  clearCells();
});

// ─── Single-row move ───────────────────────────────────────────

test("single-row move: row 4 above row 3 swaps cell positions", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("A2" as CellId, "2");
  setCellValue("A3" as CellId, "3");
  setCellValue("A4" as CellId, "4");
  setCellValue("A5" as CellId, "5");

  // src=3 (row 4 in 1-based), final_start=2 → row 4's data lands
  // at A3, old A3 pushed down to A4.
  moveRowsLocally(3, 3, 2);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("1");
  expect(map.get("A2" as CellId)!.rawValue).toBe("2");
  expect(map.get("A3" as CellId)!.rawValue).toBe("4"); // old A4
  expect(map.get("A4" as CellId)!.rawValue).toBe("3"); // old A3
  expect(map.get("A5" as CellId)!.rawValue).toBe("5");
});

test("single-row move rewrites formula refs and recalcs", () => {
  setCellValue("B1" as CellId, "=A4");
  setCellValue("A4" as CellId, "42");

  moveRowsLocally(3, 3, 1);

  const map = get(cellsWritable);
  // forward(3) = 1 → B1's ref to A4 becomes A2.
  expect(map.get("B1" as CellId)!.rawValue).toBe("=A2");
  expect(map.get("A2" as CellId)!.rawValue).toBe("42");
  expect(map.get("B1" as CellId)!.computedValue).toBe(42);
});

// ─── Multi-row block move ──────────────────────────────────────

test("block move 2:4 → end shifts the entire block atomically", () => {
  for (let r = 0; r < 7; r++) {
    setCellValue(`A${r + 1}` as CellId, `r${r}`);
  }

  // src_start=1, src_end=3, final_start=4 → forward {1,2,3} → {4,5,6}.
  moveRowsLocally(1, 3, 4);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("r0");
  expect(map.get("A2" as CellId)!.rawValue).toBe("r4");
  expect(map.get("A3" as CellId)!.rawValue).toBe("r5");
  expect(map.get("A4" as CellId)!.rawValue).toBe("r6");
  expect(map.get("A5" as CellId)!.rawValue).toBe("r1");
  expect(map.get("A6" as CellId)!.rawValue).toBe("r2");
  expect(map.get("A7" as CellId)!.rawValue).toBe("r3");
});

// ─── No-op branches ───────────────────────────────────────────

test("no-op when finalStart == srcStart leaves the store untouched", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("A4" as CellId, "4");

  moveRowsLocally(3, 3, 3);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("1");
  expect(map.get("A4" as CellId)!.rawValue).toBe("4");
});

test("invalid args (negative, end < start) are no-ops", () => {
  setCellValue("A1" as CellId, "1");
  moveRowsLocally(-1, 3, 2);
  moveRowsLocally(3, 1, 2);
  moveRowsLocally(3, 3, -1);
  expect(get(cellsWritable).get("A1" as CellId)!.rawValue).toBe("1");
});

// ─── Inverse round-trip ───────────────────────────────────────

test("inverse move restores the original layout", () => {
  setCellValue("A1" as CellId, "a");
  setCellValue("A2" as CellId, "b");
  setCellValue("A3" as CellId, "c");
  setCellValue("A4" as CellId, "d");
  setCellValue("A5" as CellId, "e");

  // Forward: row 3 to row 1.
  moveRowsLocally(3, 3, 1);
  // Inverse: source is now [final=1, final=1], destination original src=3.
  moveRowsLocally(1, 1, 3);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("a");
  expect(map.get("A2" as CellId)!.rawValue).toBe("b");
  expect(map.get("A3" as CellId)!.rawValue).toBe("c");
  expect(map.get("A4" as CellId)!.rawValue).toBe("d");
  expect(map.get("A5" as CellId)!.rawValue).toBe("e");
});
