import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// [TESTS-10] Store reset (cells / selectedCell / selectionAnchor /
// selectedCells) lives in ``src/test-setup.ts`` and runs before
// every test. No spec-local boilerplate needed unless additional
// stores need a baseline.

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

// [sheet.format.h-align]
test("hAlign=left renders .h-left and drops accent (even when numeric)", () => {
  cells.setCellValue("A1", "42");
  cells.setCellFormat("A1", { hAlign: "left" });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const span = valueSpan("A1");
  expect(span.classList.contains("h-left")).toBe(true);
  expect(span.classList.contains("numeric")).toBe(true); // still "numeric"
  // h-left is present alongside numeric — the CSS cascade picks left
  // alignment + default color in the live app via class specificity.
});

test("hAlign unset → auto numeric-right still applies", () => {
  cells.setCellValue("A1", "42");
  render(Cell, { props: { cellId: "A1" as CellId } });

  const span = valueSpan("A1");
  expect(span.classList.contains("numeric")).toBe(true);
  expect(span.classList.contains("h-left")).toBe(false);
  expect(span.classList.contains("h-center")).toBe(false);
  expect(span.classList.contains("h-right")).toBe(false);
});

test("hAlign=center applies the center class", () => {
  cells.setCellValue("A1", "x");
  cells.setCellFormat("A1", { hAlign: "center" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1").classList.contains("h-center")).toBe(true);
});

test("hAlign=right applies the right class", () => {
  cells.setCellValue("A1", "x");
  cells.setCellFormat("A1", { hAlign: "right" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1").classList.contains("h-right")).toBe(true);
});

// CELL-GRID-07 — bold + h-right on a numeric cell. ``.cell-value.numeric``
// and ``.cell-value.h-right`` both set ``text-align``; the cascade is
// ordering-fragile. Document order in <style> places ``.h-*`` AFTER
// ``.numeric``, so explicit hAlign wins. Test the resolved style.
test("bold + h-right + numeric: explicit hAlign wins (right) over the auto rule", () => {
  cells.setCellValue("A1", "42");
  cells.setCellFormat("A1", { hAlign: "right", bold: true });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const span = valueSpan("A1");
  expect(span.classList.contains("numeric")).toBe(true);
  expect(span.classList.contains("h-right")).toBe(true);
  expect(span.classList.contains("bold")).toBe(true);
  // Both rules ask for ``text-align: right`` here so this passes
  // either way; the test exists to catch a future variant whose
  // ``.cell-value.<variant>`` rule asks for a *different* alignment
  // and accidentally lands AFTER ``.h-*`` in the stylesheet.
  expect(getComputedStyle(span).textAlign).toBe("right");
});

// [sheet.format.v-align]
test("vAlign=top applies v-top on the cell container", () => {
  cells.setCellValue("A1", "x");
  cells.setCellFormat("A1", { vAlign: "top" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(cellDiv("A1").classList.contains("v-top")).toBe(true);
});

test("vAlign=bottom applies v-bottom on the cell container", () => {
  cells.setCellValue("A1", "x");
  cells.setCellFormat("A1", { vAlign: "bottom" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(cellDiv("A1").classList.contains("v-bottom")).toBe(true);
});

test("vAlign unset → no v-* class applied", () => {
  cells.setCellValue("A1", "x");
  render(Cell, { props: { cellId: "A1" as CellId } });
  const cls = cellDiv("A1").className;
  expect(cls).not.toMatch(/\bv-top\b/);
  expect(cls).not.toMatch(/\bv-middle\b/);
  expect(cls).not.toMatch(/\bv-bottom\b/);
});
