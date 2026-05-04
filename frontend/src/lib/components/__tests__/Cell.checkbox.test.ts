import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells, selectSingle } from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// [TESTS-10] Store reset lives in ``src/test-setup.ts``.

function checkboxButton(cellId: CellId): HTMLButtonElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLButtonElement>(".cell-checkbox");
  if (!el) throw new Error(`No .cell-checkbox inside cell ${cellId}`);
  return el;
}

// [sheet.format.checkbox]
test("checkbox format renders a glyph instead of text", () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, { controlType: "checkbox" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(checkboxButton("A1" as CellId)).toBeTruthy();
  // No .cell-value when checkbox is rendered.
  const valueSpan = page
    .getByTestId("A1")
    .element()
    .querySelector(".cell-value");
  expect(valueSpan).toBeNull();
});

// [sheet.format.checkbox]
test("clicking an unchecked checkbox writes TRUE and flips to checked", async () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, { controlType: "checkbox" });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const btn = checkboxButton("A1" as CellId);
  expect(btn.classList.contains("checked")).toBe(false);

  await userEvent.click(btn);

  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("TRUE");
  expect(cells.getCell("A1" as CellId)?.computedValue).toBe(true);
  expect(checkboxButton("A1" as CellId).classList.contains("checked")).toBe(
    true,
  );
});

// [sheet.format.checkbox]
test("clicking a checked checkbox writes FALSE and flips to unchecked", async () => {
  cells.setCellValue("A1" as CellId, "TRUE");
  cells.setCellFormat("A1" as CellId, { controlType: "checkbox" });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const btn = checkboxButton("A1" as CellId);
  expect(btn.classList.contains("checked")).toBe(true);

  await userEvent.click(btn);

  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("FALSE");
  expect(cells.getCell("A1" as CellId)?.computedValue).toBe(false);
  expect(checkboxButton("A1" as CellId).classList.contains("checked")).toBe(
    false,
  );
});

// [sheet.format.checkbox]
test("Space on a focused checkbox cell toggles it", async () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, { controlType: "checkbox" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  selectSingle("A1" as CellId);
  (page.getByTestId("A1").element() as HTMLElement).focus();

  await userEvent.keyboard(" ");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("TRUE");

  await userEvent.keyboard(" ");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("FALSE");
});

// [sheet.format.checkbox]
test("checkbox tracks truthy non-bool computedValue (preview state)", () => {
  // Apply checkbox to a cell with arbitrary truthy text — the glyph
  // shows checked but raw_value is untouched until the user clicks.
  cells.setCellValue("A1" as CellId, "hello");
  cells.setCellFormat("A1" as CellId, { controlType: "checkbox" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(checkboxButton("A1" as CellId).classList.contains("checked")).toBe(
    true,
  );
  // raw_value preserved — clicking would *then* overwrite to FALSE.
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("hello");
});
