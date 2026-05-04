import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
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

async function pressModifier(chord: string) {
  await userEvent.keyboard(chord);
}

// [sheet.format.italic-toggle]
test("Cmd+I on a range italicizes every cell in the selection", async () => {
  const range: CellId[] = ["A1", "A2", "A3"];
  cells.setCellValue("A1", "one");
  cells.setCellValue("A2", "two");
  cells.setCellValue("A3", "three");

  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(range));

  for (const id of range) render(Cell, { props: { cellId: id } });
  (page.getByTestId("A1").element() as HTMLElement).focus();
  await pressModifier("{Control>}i{/Control}");

  for (const id of range) {
    await expect.element(valueSpan(id)).toHaveClass(/\bitalic\b/);
  }
});

test("Cmd+I toggles italic off when pressed again", async () => {
  cells.setCellValue("A1", "hello");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(Cell, { props: { cellId: "A1" as CellId } });

  (page.getByTestId("A1").element() as HTMLElement).focus();
  await pressModifier("{Control>}i{/Control}");
  await expect.element(valueSpan("A1")).toHaveClass(/\bitalic\b/);
  await pressModifier("{Control>}i{/Control}");
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bitalic\b/);
});

// [sheet.format.underline-toggle]
test("Cmd+U toggles underline on selected cells", async () => {
  cells.setCellValue("A1", "hello");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(Cell, { props: { cellId: "A1" as CellId } });

  (page.getByTestId("A1").element() as HTMLElement).focus();
  await pressModifier("{Control>}u{/Control}");
  await expect.element(valueSpan("A1")).toHaveClass(/\bunderline\b/);
  await pressModifier("{Control>}u{/Control}");
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bunderline\b/);
});

// [sheet.format.strikethrough-toggle]
test("Cmd+Shift+X toggles strikethrough on selected cells", async () => {
  cells.setCellValue("A1", "hello");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(Cell, { props: { cellId: "A1" as CellId } });

  (page.getByTestId("A1").element() as HTMLElement).focus();
  await pressModifier("{Control>}{Shift>}x{/Shift}{/Control}");
  await expect.element(valueSpan("A1")).toHaveClass(/\bstrikethrough\b/);
  await pressModifier("{Control>}{Shift>}x{/Shift}{/Control}");
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bstrikethrough\b/);
});

test("Cmd+B and Cmd+I are independent — bold doesn't disturb italic", async () => {
  cells.setCellValue("A1", "hello");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(Cell, { props: { cellId: "A1" as CellId } });

  (page.getByTestId("A1").element() as HTMLElement).focus();
  await pressModifier("{Control>}i{/Control}");
  await pressModifier("{Control>}b{/Control}");

  await expect.element(valueSpan("A1")).toHaveClass(/\bbold\b/);
  await expect.element(valueSpan("A1")).toHaveClass(/\bitalic\b/);
});

// [sheet.format.clear]
test("Cmd+\\ clears every format flag on the selection", async () => {
  cells.setCellValue("A1", "hello");
  cells.setCellFormat("A1", {
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
  });
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(Cell, { props: { cellId: "A1" as CellId } });

  (page.getByTestId("A1").element() as HTMLElement).focus();
  // Precondition.
  await expect.element(valueSpan("A1")).toHaveClass(/\bbold\b/);
  await expect.element(valueSpan("A1")).toHaveClass(/\bitalic\b/);
  await expect.element(valueSpan("A1")).toHaveClass(/\bunderline\b/);
  await expect.element(valueSpan("A1")).toHaveClass(/\bstrikethrough\b/);

  await pressModifier("{Control>}\\{/Control}");

  await expect.element(valueSpan("A1")).not.toHaveClass(/\bbold\b/);
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bitalic\b/);
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bunderline\b/);
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bstrikethrough\b/);
});

test("mixed-selection italic toggle uses active cell as authoritative", async () => {
  cells.setCellValue("A1", "one");
  cells.setCellValue("A2", "two");
  // A1 already italic; A2 plain. Active = A1 → expect both to go
  // non-italic (because !A1.italic === false).
  cells.setCellFormat("A1", { italic: true });

  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1", "A2"]));

  render(Cell, { props: { cellId: "A1" as CellId } });
  render(Cell, { props: { cellId: "A2" as CellId } });
  (page.getByTestId("A1").element() as HTMLElement).focus();

  await pressModifier("{Control>}i{/Control}");

  await expect.element(valueSpan("A1")).not.toHaveClass(/\bitalic\b/);
  await expect.element(valueSpan("A2")).not.toHaveClass(/\bitalic\b/);
});
