import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  editingCell,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// Array-formula spill: ``=SEQUENCE(3)`` in A1 fills A2 and A3 with
// computed values the user didn't author. The store must surface
// those as rendered cells and mark anchor + members so the UI can
// visually distinguish them.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
});

test("SEQUENCE spill populates downstream cells", async () => {
  cells.setCellValue("A1" as CellId, "=SEQUENCE(3)");

  // Anchor holds 1, spill members A2/A3 hold 2, 3.
  expect(cells.getCell("A1" as CellId)?.computedValue).toBe(1);
  expect(cells.getCell("A2" as CellId)?.computedValue).toBe(2);
  expect(cells.getCell("A3" as CellId)?.computedValue).toBe(3);

  // Classification flags are set by the recalc pass.
  expect(cells.getCell("A1" as CellId)?.isSpillAnchor).toBe(true);
  expect(cells.getCell("A1" as CellId)?.isSpillMember).toBe(false);
  expect(cells.getCell("A2" as CellId)?.isSpillMember).toBe(true);
  expect(cells.getCell("A3" as CellId)?.isSpillMember).toBe(true);
});

test("spill-anchor and spill-member classes render on corresponding cells", async () => {
  cells.setCellValue("A1" as CellId, "=SEQUENCE(2)");

  render(Cell, { props: { cellId: "A1" as CellId } });
  const anchor = document.querySelector<HTMLElement>('[data-cell-id="A1"]');
  expect(anchor?.classList.contains("spill-anchor")).toBe(true);
  expect(anchor?.classList.contains("spill-member")).toBe(false);

  render(Cell, { props: { cellId: "A2" as CellId } });
  const member = document.querySelector<HTMLElement>('[data-cell-id="A2"]');
  expect(member?.classList.contains("spill-member")).toBe(true);
  expect(member?.classList.contains("spill-anchor")).toBe(false);
});

test("#SPILL! error surfaces on a blocked anchor", async () => {
  // A2 is user-authored, so =SEQUENCE(3) in A1 can't spill into it.
  cells.setCellValue("A2" as CellId, "99");
  cells.setCellValue("A1" as CellId, "=SEQUENCE(3)");

  const anchor = cells.getCell("A1" as CellId);
  expect(anchor?.error).toBe("#SPILL!");
  expect(anchor?.isSpillAnchor).toBe(false);
  // A2 keeps the user-authored value.
  expect(cells.getCell("A2" as CellId)?.computedValue).toBe(99);
});

test("spill shrinks when the anchor formula changes", async () => {
  cells.setCellValue("A1" as CellId, "=SEQUENCE(5)");
  expect(cells.getCell("A5" as CellId)?.computedValue).toBe(5);

  cells.setCellValue("A1" as CellId, "=SEQUENCE(3)");

  // A5 either drops out of the store or reads as empty — either way
  // it doesn't display a stale value.
  const a5 = cells.getCell("A5" as CellId);
  expect(a5?.computedValue ?? null).toBeNull();
  expect(a5?.isSpillMember ?? false).toBe(false);
  expect(cells.getCell("A3" as CellId)?.computedValue).toBe(3);
});
