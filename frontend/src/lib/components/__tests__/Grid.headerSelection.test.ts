import { beforeEach, expect, test } from "vitest";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import Grid from "../Grid.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import { _resetHeaderSelectionForTests } from "../../stores/headerSelection";

// Integration test for the header drag-select gestures wired into
// Grid.svelte after CELL-GRID-02. The store-level invariants live in
// stores/__tests__/headerSelection.test.ts; this file pins down the
// DOM contract — that `.column-header.header-selected` ends up on the
// right elements after a click + shift-click + drag sequence, since
// the surface had zero browser-level tests before.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  _resetHeaderSelectionForTests();
});

async function flushFrames() {
  // Two rAFs + ticks instead of a 50 ms sleep — deterministic across
  // CI variance. See ``Grid.virtualization.test.ts`` for the
  // reasoning.
  await Promise.resolve();
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
}

function getColHeader(col: string): HTMLElement {
  const headers = document.querySelectorAll<HTMLElement>(".column-header");
  for (const h of headers) {
    const label = h.querySelector(".column-label");
    if (label?.textContent?.trim() === col) return h;
  }
  throw new Error(`No column header for ${col}`);
}

function getRowHeader(row: number): HTMLElement {
  const headers = document.querySelectorAll<HTMLElement>(".row-header");
  for (const h of headers) {
    if (h.textContent?.trim() === String(row)) return h;
  }
  throw new Error(`No row header for ${row}`);
}

function mouse(
  el: HTMLElement,
  type: "mousedown" | "mouseenter" | "mouseup",
  init: MouseEventInit = {},
) {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}

test("clicking a column header marks .header-selected on that column only", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const colC = getColHeader("C");
  mouse(colC, "mousedown");
  mouse(document.body, "mouseup");
  await tick();

  expect(getColHeader("C").classList.contains("header-selected")).toBe(true);
  expect(getColHeader("B").classList.contains("header-selected")).toBe(false);
  expect(getColHeader("D").classList.contains("header-selected")).toBe(false);
});

test("shift+click extends the column selection from the anchor", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  mouse(getColHeader("B"), "mousedown");
  mouse(document.body, "mouseup");
  await tick();

  mouse(getColHeader("E"), "mousedown", { shiftKey: true });
  mouse(document.body, "mouseup");
  await tick();

  for (const c of ["B", "C", "D", "E"]) {
    expect(getColHeader(c).classList.contains("header-selected")).toBe(true);
  }
  expect(getColHeader("A").classList.contains("header-selected")).toBe(false);
  expect(getColHeader("F").classList.contains("header-selected")).toBe(false);
});

test("drag across column headers tints every header in the range", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Press on A, drag through B, C, D — releasing on D leaves A..D
  // .header-selected.
  mouse(getColHeader("A"), "mousedown");
  mouse(getColHeader("B"), "mouseenter");
  mouse(getColHeader("C"), "mouseenter");
  mouse(getColHeader("D"), "mouseenter");
  mouse(document.body, "mouseup");
  await tick();

  for (const c of ["A", "B", "C", "D"]) {
    expect(getColHeader(c).classList.contains("header-selected")).toBe(true);
  }
  expect(getColHeader("E").classList.contains("header-selected")).toBe(false);
});

test("drag across row headers tints every header in the range", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  mouse(getRowHeader(2), "mousedown");
  mouse(getRowHeader(3), "mouseenter");
  mouse(getRowHeader(4), "mouseenter");
  mouse(document.body, "mouseup");
  await tick();

  for (const r of [2, 3, 4]) {
    expect(getRowHeader(r).classList.contains("header-selected")).toBe(true);
  }
  expect(getRowHeader(1).classList.contains("header-selected")).toBe(false);
  expect(getRowHeader(5).classList.contains("header-selected")).toBe(false);
});

test("clicking a single cell drops the row-header highlight via reconcileWith", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  mouse(getRowHeader(2), "mousedown");
  mouse(document.body, "mouseup");
  await tick();
  expect(getRowHeader(2).classList.contains("header-selected")).toBe(true);

  // User clicks a cell elsewhere — selectedCells shrinks. Mimic that
  // by directly setting selectedCells; the Grid's onMount-bound
  // subscription invokes reconcileWith and drops the row tint.
  selectedCells.set(new Set(["B2"]));
  await tick();

  expect(getRowHeader(2).classList.contains("header-selected")).toBe(false);
});
