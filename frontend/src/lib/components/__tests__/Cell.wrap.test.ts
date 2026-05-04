import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// [TESTS-10] Store reset lives in ``src/test-setup.ts``.

function cellDiv(cellId: CellId): HTMLElement {
  return page.getByTestId(cellId).element() as HTMLElement;
}

// [sheet.format.wrap]
test("wrap=wrap adds wrap-wrap class to the cell", () => {
  cells.setCellValue("A1", "long text");
  cells.setCellFormat("A1", { wrap: "wrap" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(cellDiv("A1").classList.contains("wrap-wrap")).toBe(true);
});

test("wrap=clip adds wrap-clip class to the cell", () => {
  cells.setCellValue("A1", "long text");
  cells.setCellFormat("A1", { wrap: "clip" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(cellDiv("A1").classList.contains("wrap-clip")).toBe(true);
});

test("wrap unset (overflow default) applies no wrap-* class", () => {
  cells.setCellValue("A1", "long text");
  render(Cell, { props: { cellId: "A1" as CellId } });
  const cls = cellDiv("A1").className;
  expect(cls).not.toMatch(/\bwrap-wrap\b/);
  expect(cls).not.toMatch(/\bwrap-clip\b/);
});

test("wrap=wrap makes the cell's white-space normal", () => {
  cells.setCellValue("A1", "a long string of text that would overflow");
  cells.setCellFormat("A1", { wrap: "wrap" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const valueEl = cellDiv("A1").querySelector<HTMLElement>(".cell-value")!;
  const style = getComputedStyle(valueEl);
  expect(style.whiteSpace).toBe("normal");
});
