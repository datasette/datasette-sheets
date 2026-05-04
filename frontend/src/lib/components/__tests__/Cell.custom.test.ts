import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells } from "../../stores/spreadsheet";
import { createDefaultFormat } from "../../spreadsheet/formatter";
import type {
  CellData,
  CellId,
  CustomCellValue,
} from "../../spreadsheet/types";

// [TESTS-10] Store reset lives in ``src/test-setup.ts``.

function valueSpan(cellId: CellId): HTMLElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLElement>(".cell-value");
  if (!el) throw new Error(`No .cell-value inside cell ${cellId}`);
  return el;
}

/** Seed the store with a Custom computed value as if a recalc had
 *  returned ``Custom(type_tag, data)`` from the engine. */
function seedCustom(cellId: CellId, value: CustomCellValue) {
  const data: CellData = {
    rawValue: "",
    computedValue: value,
    formula: null,
    format: createDefaultFormat(),
    error: null,
  };
  cells.set(new Map([[cellId, data]]));
}

// [sheet.cell.custom]
test("jdate renders via toLocaleDateString and gets .custom class", () => {
  seedCustom("A1" as CellId, { type_tag: "jdate", data: "2026-04-01" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1" as CellId);
  // toLocaleDateString("en-US", {month:"short",...}) → "Apr 1, 2026"
  expect(span.textContent).toBe("Apr 1, 2026");
  expect(span.classList.contains("custom")).toBe(true);
});

// [sheet.cell.custom]
test("jspan ISO duration renders day-only as compact units with sign", () => {
  // The end-goal demo: A1 - B1 where A1=1990-01-01, B1=2026-04-01
  seedCustom("A1" as CellId, { type_tag: "jspan", data: "-P13239D" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1" as CellId);
  // Negative sign uses U+2212 (typographic minus), not "-".
  expect(span.textContent).toBe("−13239d");
  expect(span.classList.contains("custom")).toBe(true);
});

// [sheet.cell.custom]
test("jspan multi-component renders space-separated units", () => {
  seedCustom("A1" as CellId, { type_tag: "jspan", data: "P1Y2M3DT4H5M" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1" as CellId).textContent).toBe("1y 2mo 3d 4h 5m");
});

// [sheet.cell.custom]
test("unknown type_tag falls back to data verbatim", () => {
  seedCustom("A1" as CellId, { type_tag: "polygon", data: "[[0,0],[1,1]]" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(valueSpan("A1" as CellId).textContent).toBe("[[0,0],[1,1]]");
  expect(valueSpan("A1" as CellId).classList.contains("custom")).toBe(true);
});

// [sheet.cell.custom]
test("custom values do not also get the numeric or boolean class", () => {
  seedCustom("A1" as CellId, { type_tag: "jdate", data: "2026-04-01" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1" as CellId);
  expect(span.classList.contains("numeric")).toBe(false);
  expect(span.classList.contains("boolean")).toBe(false);
});
