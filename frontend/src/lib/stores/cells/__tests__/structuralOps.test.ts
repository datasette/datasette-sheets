/**
 * [STORES-05] Structural-op tests. ``insertColsLocally`` had no
 * frontend coverage at all (server-side e2e only); ``deleteRowsLocally``
 * lived behind e2e too. Pull both into the fast vitest-browser
 * suite so the formula-rewrite + cell-shift + width-shift contracts
 * are locked down without spinning up Datasette.
 */
import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../../spreadsheet/types";
import { COLUMNS, columnWidths, setColumnWidth } from "../../columnWidths";
import { cellsWritable } from "../store";
import { clearCells, setCellValue } from "../mutations";
import { deleteRowsLocally, insertColsLocally } from "../structuralOps";

const DEFAULT_WIDTH = 100;

beforeEach(() => {
  clearCells();
  columnWidths.set(Object.fromEntries(COLUMNS.map((c) => [c, DEFAULT_WIDTH])));
});

// ─── insertColsLocally ─────────────────────────────────────────

test("insertColsLocally shifts cells right and rewrites formula refs", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("B1" as CellId, "2");
  setCellValue("C1" as CellId, "=A1+B1");

  // Insert one column at index 1 (between A and old-B). The
  // optimistic path mirrors the server's
  // ``adjustRefsForInsertion`` rewrite: refs at-or-past ``at``
  // shift outward.
  insertColsLocally(1, 1);

  const map = get(cellsWritable);

  // Old A1 stays at A1 (col 0 < at).
  expect(map.get("A1" as CellId)!.rawValue).toBe("1");

  // Old B1 → C1 (col 1 → 2).
  expect(map.get("C1" as CellId)!.rawValue).toBe("2");

  // Old C1 → D1 — and its formula MUST shift A1+B1 → A1+C1.
  // The first ref (A1) sits before the insertion so it stays put;
  // the second (B1) sits at the insertion so it shifts to C1.
  const formulaCell = map.get("D1" as CellId)!;
  expect(formulaCell.rawValue).toBe("=A1+C1");
  expect(formulaCell.formula).toBe("=A1+C1");
  // And the recalc against the rewritten formula resolves.
  expect(formulaCell.computedValue).toBe(3);
});

test("insertColsLocally shifts column widths right with the cells", () => {
  setColumnWidth("A", 80);
  setColumnWidth("B", 200);
  setColumnWidth("C", 120);

  insertColsLocally(1, 1);

  const widths = get(columnWidths);
  expect(widths["A"]).toBe(80); // before ``at`` — untouched
  expect(widths["B"]).toBe(DEFAULT_WIDTH); // newly-inserted column
  expect(widths["C"]).toBe(200); // was B
  expect(widths["D"]).toBe(120); // was C
});

test("insertColsLocally drops cells that would shift past the visible band", () => {
  // Seed a cell in the rightmost visible column.
  const lastCol = COLUMNS[COLUMNS.length - 1];
  setCellValue(`${lastCol}1` as CellId, "rightmost");

  insertColsLocally(0, 1);

  // The cell would land at column index = ``COLUMNS.length`` — off
  // the visible band — so it drops from the local view.
  const map = get(cellsWritable);
  expect(map.has(`${lastCol}1` as CellId)).toBe(false);
});

test("insertColsLocally is a no-op for invalid args", () => {
  setCellValue("A1" as CellId, "1");

  insertColsLocally(0, 0);
  insertColsLocally(-1, 1);

  expect(get(cellsWritable).get("A1" as CellId)!.rawValue).toBe("1");
});

// [STORES-09] Multi-column insertion shifts every cell at-or-past
// ``at`` by ``count``, not by 1. The rewrite has to track ``count``
// for both the cell-id shift and the formula-ref shift.
test("insertColsLocally(at=1, count=2) shifts cells two columns and rewrites refs", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("B1" as CellId, "2");
  setCellValue("C1" as CellId, "=A1+B1");

  insertColsLocally(1, 2);

  const map = get(cellsWritable);

  // A1 stays put (col 0 < at).
  expect(map.get("A1" as CellId)!.rawValue).toBe("1");
  // Old B (col 1) → D (col 3).
  expect(map.get("D1" as CellId)!.rawValue).toBe("2");
  // Old C (col 2) → E (col 4); formula refs B1 (which sat at col 1
  // = ``at``) shift by 2 to D1.
  const formula = map.get("E1" as CellId)!;
  expect(formula.rawValue).toBe("=A1+D1");
  expect(formula.formula).toBe("=A1+D1");
  expect(formula.computedValue).toBe(3);

  // The two newly-inserted columns (B and C) should have no cell
  // residue from the shift.
  expect(map.has("B1" as CellId)).toBe(false);
  expect(map.has("C1" as CellId)).toBe(false);
});

// ─── deleteRowsLocally — non-contiguous batch ─────────────────────

test("deleteRowsLocally with a non-contiguous list shifts surviving rows correctly", () => {
  // Seed five rows of A so the shift accounting (two non-adjacent
  // deletes) is observable.
  setCellValue("A1" as CellId, "row1");
  setCellValue("A2" as CellId, "row2");
  setCellValue("A3" as CellId, "row3");
  setCellValue("A4" as CellId, "row4");
  setCellValue("A5" as CellId, "row5");

  // Delete row indices 1 and 3 (cell rows 2 and 4) — non-contiguous.
  deleteRowsLocally([1, 3]);

  const map = get(cellsWritable);

  // Surviving rows should be row1, row3, row5 in that order, packed
  // up into A1..A3.
  expect(map.get("A1" as CellId)!.rawValue).toBe("row1");
  expect(map.get("A2" as CellId)!.rawValue).toBe("row3");
  expect(map.get("A3" as CellId)!.rawValue).toBe("row5");
  // The two trailing slots vacated by the shift must be empty.
  expect(map.has("A4" as CellId)).toBe(false);
  expect(map.has("A5" as CellId)).toBe(false);
});

// ─── deleteRowsLocally ─────────────────────────────────────────

test("deleteRowsLocally drops the deleted rows and shifts the rest up", () => {
  setCellValue("A1" as CellId, "row1");
  setCellValue("A2" as CellId, "row2");
  setCellValue("A3" as CellId, "row3");

  // Delete row index 1 (cell row 2, A2).
  deleteRowsLocally([1]);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("row1");
  // Row 3 shifted up to row 2.
  expect(map.get("A2" as CellId)!.rawValue).toBe("row3");
  expect(map.has("A3" as CellId)).toBe(false);
});

test("deleteRowsLocally rewrites formula refs in the optimistic shift", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("A2" as CellId, "2");
  setCellValue("A3" as CellId, "3");
  // Park the formula on row 5 (index 4) so it survives the
  // deletion below — the cell itself shifts up but its formula
  // text is what we're asserting on.
  setCellValue("B5" as CellId, "=A1+A2+A3");

  // Delete row 0 (cell row 1, A1). The remaining rows shift up:
  // old A2 → A1, old A3 → A2. The formula's A1 ref points into the
  // deletion — Google-Sheets semantics turn that into ``#REF!``.
  deleteRowsLocally([0]);

  const map = get(cellsWritable);
  // B5 → B4 (one deletion above it). Its formula shifts: A1 was
  // deleted → ``#REF!``; A2/A3 shift up to A1/A2.
  const formula = map.get("B4" as CellId)!;
  expect(formula.formula).toContain("#REF!");
  // A1 is now what was A2, A2 is what was A3.
  expect(map.get("A1" as CellId)!.rawValue).toBe("2");
  expect(map.get("A2" as CellId)!.rawValue).toBe("3");
});

test("deleteRowsLocally is a no-op for an empty deletion list", () => {
  setCellValue("A1" as CellId, "untouched");
  deleteRowsLocally([]);
  expect(get(cellsWritable).get("A1" as CellId)!.rawValue).toBe("untouched");
});
