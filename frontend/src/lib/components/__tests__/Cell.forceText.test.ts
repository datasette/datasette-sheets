import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import { cells, selectedCell } from "../../stores/spreadsheet";
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

async function typeAndCommit(cellId: CellId, value: string): Promise<void> {
  const cellEl = page.getByTestId(cellId).element() as HTMLElement;
  cellEl.focus();
  selectedCell.set(cellId);
  await userEvent.keyboard("{Enter}");
  // Edit input is the cell's text input. Type the value and commit.
  const input = cellEl.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error("edit input not found");
  await userEvent.click(input);
  await userEvent.fill(input, value);
  await userEvent.keyboard("{Enter}");
}

// [sheet.cell.force-text]
test("typing leading ' forces literal text — '2/4 stays as '2/4' not a date", async () => {
  render(Cell, { props: { cellId: "A1" as CellId } });
  await typeAndCommit("A1" as CellId, "'2/4");

  const stored = cells.getCell("A1" as CellId);
  expect(stored?.rawValue).toBe("2/4");
  expect(stored?.typedKind).toBe("string");
  expect(stored?.computedValue).toBe("2/4");
  // Cell-value span renders the raw text, not the .custom date class.
  expect(valueSpan("A1" as CellId).textContent).toBe("2/4");
  expect(valueSpan("A1" as CellId).classList.contains("custom")).toBe(false);
});

// [sheet.cell.force-text]
test("ISO date without ' prefix still auto-classifies as jdate", async () => {
  render(Cell, { props: { cellId: "A1" as CellId } });
  await typeAndCommit("A1" as CellId, "2026-04-01");

  const stored = cells.getCell("A1" as CellId);
  expect(stored?.typedKind).toBeUndefined();
  // computedValue is the engine's Custom(jdate) shape.
  expect(stored?.computedValue).toEqual({
    type_tag: "jdate",
    data: "2026-04-01",
  });
  expect(valueSpan("A1" as CellId).classList.contains("custom")).toBe(true);
});

// [sheet.cell.force-text]
test("re-editing a force-text cell preserves the override", async () => {
  render(Cell, { props: { cellId: "A1" as CellId } });
  await typeAndCommit("A1" as CellId, "'2/4");
  expect(cells.getCell("A1" as CellId)?.typedKind).toBe("string");

  // Re-edit without retyping the prefix — force-text should stick.
  await typeAndCommit("A1" as CellId, "5/6");
  const stored = cells.getCell("A1" as CellId);
  expect(stored?.rawValue).toBe("5/6");
  expect(stored?.typedKind).toBe("string");
  expect(stored?.computedValue).toBe("5/6");
});

// [sheet.cell.force-text]
test("typing a formula clears a prior force-text override", async () => {
  render(Cell, { props: { cellId: "A1" as CellId } });
  await typeAndCommit("A1" as CellId, "'2/4");
  expect(cells.getCell("A1" as CellId)?.typedKind).toBe("string");

  // A formula must be parsed by the engine, not stored as text.
  await typeAndCommit("A1" as CellId, "=1+1");
  const stored = cells.getCell("A1" as CellId);
  expect(stored?.typedKind).toBeUndefined();
  expect(stored?.computedValue).toBe(2);
});
