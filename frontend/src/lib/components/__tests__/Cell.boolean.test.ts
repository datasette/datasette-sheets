import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import { createDefaultFormat } from "../../spreadsheet/formatter";
import type { CellData, CellId } from "../../spreadsheet/types";

// [TESTS-10] Store reset lives in ``src/test-setup.ts``.

function valueSpan(cellId: CellId): HTMLElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLElement>(".cell-value");
  if (!el) throw new Error(`No .cell-value inside cell ${cellId}`);
  return el;
}

/** Inject a boolean computed value directly. The engine's boolean
 *  producers (comparisons / =TRUE / =AND / etc.) are still landing,
 *  so seed the store as if a recalc had returned ``Boolean(true)``. */
function seedBoolean(cellId: CellId, value: boolean) {
  const data: CellData = {
    rawValue: "",
    computedValue: value,
    formula: null,
    format: createDefaultFormat(),
    error: null,
  };
  cells.set(new Map([[cellId, data]]));
}

// [sheet.cell.boolean]
test("true renders as TRUE in the .boolean class", () => {
  seedBoolean("A1" as CellId, true);
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1" as CellId);
  expect(span.textContent).toBe("TRUE");
  expect(span.classList.contains("boolean")).toBe(true);
});

// [sheet.cell.boolean]
test("false renders as FALSE in the .boolean class", () => {
  seedBoolean("A1" as CellId, false);
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1" as CellId);
  expect(span.textContent).toBe("FALSE");
  expect(span.classList.contains("boolean")).toBe(true);
});

// [sheet.cell.boolean]
test("boolean does NOT also get the numeric class", () => {
  seedBoolean("A1" as CellId, true);
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1" as CellId).classList.contains("numeric")).toBe(false);
});

// [sheet.cell.boolean]
test("non-boolean cells do not get the boolean class", () => {
  cells.setCellValue("A1" as CellId, "42");
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1" as CellId).classList.contains("boolean")).toBe(false);
});
