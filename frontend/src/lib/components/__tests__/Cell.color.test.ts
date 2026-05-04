import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// [TESTS-10] Store reset lives in ``src/test-setup.ts``.

function valueSpan(cellId: CellId): HTMLElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLElement>(".cell-value");
  if (!el) throw new Error(`No .cell-value inside cell ${cellId}`);
  return el;
}

function cellDiv(cellId: CellId): HTMLElement {
  return page.getByTestId(cellId).element() as HTMLElement;
}

// [sheet.format.text-color]
test("textColor is applied as inline style on .cell-value", () => {
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", { textColor: "#ff0000" });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const span = valueSpan("A1");
  // getPropertyValue returns "rgb(255, 0, 0)" for applied inline color.
  expect(span.style.color).toBe("rgb(255, 0, 0)");
});

test("textColor unset leaves inline style blank", () => {
  cells.setCellValue("A1", "hi");
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1").style.color).toBe("");
});

// [sheet.format.fill-color]
// fillColor lands as the ``--cell-fill`` custom property; the
// stylesheet resolves it into ``background`` via ``var(--cell-fill,
// <state-default>)`` so state-based backgrounds remain in the cascade.
test("fillColor is applied as --cell-fill and resolves to background", () => {
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", { fillColor: "#00ff00" });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const cell = cellDiv("A1");
  expect(cell.style.getPropertyValue("--cell-fill").trim()).toBe("#00ff00");
  // Computed style picks up the resolved variable.
  expect(getComputedStyle(cell).backgroundColor).toMatch(
    /rgb\(0,\s*255,\s*0\)/,
  );
});

test("fillColor unset leaves no background override", () => {
  cells.setCellValue("A1", "hi");
  render(Cell, { props: { cellId: "A1" as CellId } });
  const cell = cellDiv("A1");
  expect(cell.style.getPropertyValue("--cell-fill")).toBe("");
  // No raw ``background:`` shorthand should leak onto the inline style.
  const style = cell.getAttribute("style") ?? "";
  expect(style).not.toMatch(/(^|;\s*)background:/);
});

// [sheet.format.font-size]
test("fontSize renders as inline font-size in points", () => {
  cells.setCellValue("A1", "big");
  cells.setCellFormat("A1", { fontSize: 18 });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1").style.fontSize).toBe("18pt");
});

test("fontSize unset leaves no inline font-size", () => {
  cells.setCellValue("A1", "x");
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1").style.fontSize).toBe("");
});

test("textColor + fillColor compose (both render)", () => {
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", {
    textColor: "#ff0000",
    fillColor: "#00ff00",
  });
  render(Cell, { props: { cellId: "A1" as CellId } });

  expect(valueSpan("A1").style.color).toBe("rgb(255, 0, 0)");
  const cell = cellDiv("A1");
  expect(cell.style.getPropertyValue("--cell-fill").trim()).toBe("#00ff00");
  expect(getComputedStyle(cell).backgroundColor).toMatch(
    /rgb\(0,\s*255,\s*0\)/,
  );
});
