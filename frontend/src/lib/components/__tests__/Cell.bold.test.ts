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

// Each of these tests runs against the real Rust WASM engine and the
// real Svelte component — only the Datasette backend is swapped out
// (we never call `enableAutoSave`, so `markCellDirty` just flips an
// in-memory flag and nothing hits the network).
//
// [TESTS-10] Store reset (cells / selectedCell / selectionAnchor /
// selectedCells) lives in ``src/test-setup.ts`` and runs before
// every test.

/** Get the `.cell-value` <span> inside a rendered cell, for class assertions. */
function valueSpan(cellId: CellId): HTMLElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLElement>(".cell-value");
  if (!el) throw new Error(`No .cell-value inside cell ${cellId}`);
  return el;
}

test("Cmd+B on a range bolds every cell in the selection", async () => {
  const range: CellId[] = ["A1", "A2", "A3"];

  cells.setCellValue("A1", "one");
  cells.setCellValue("A2", "two");
  cells.setCellValue("A3", "three");

  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(range));

  for (const id of range) render(Cell, { props: { cellId: id } });

  // The handler fires on whichever cell has focus — simulate the user
  // having A1 active when they hit the shortcut.
  (page.getByTestId("A1").element() as HTMLElement).focus();
  await userEvent.keyboard("{Control>}b{/Control}");

  for (const id of range) {
    await expect.element(valueSpan(id)).toHaveClass(/\bbold\b/);
  }
});

test("Cmd+B toggles off when pressed again", async () => {
  cells.setCellValue("A1", "hello");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));

  render(Cell, { props: { cellId: "A1" as CellId } });

  (page.getByTestId("A1").element() as HTMLElement).focus();

  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(valueSpan("A1")).toHaveClass(/\bbold\b/);

  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(valueSpan("A1")).not.toHaveClass(/\bbold\b/);
});
