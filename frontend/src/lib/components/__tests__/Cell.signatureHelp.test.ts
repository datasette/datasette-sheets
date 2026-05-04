import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  editingCell,
  editValue,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import { setEngineNames } from "../../engine";
import type { CellId } from "../../spreadsheet/types";

// Signature-help tooltip — shown whenever the cursor sits inside a
// function call's parens. Drives from the real WASM engine; the
// component just renders the shape.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
  editValue.set("");
  setEngineNames({});
});

async function startEditing(cellId: CellId) {
  cells.setCellValue(cellId, "");
  selectedCell.set(cellId);
  selectionAnchor.set(cellId);
  selectedCells.set(new Set([cellId]));
  editingCell.set(cellId);
  editValue.set("");
  render(Cell, { props: { cellId } });
  await new Promise((r) => setTimeout(r, 0));
}

function tooltip(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".signature-popup");
}

test("typing `(` opens the signature tooltip with the function name", async () => {
  await startEditing("A1" as CellId);
  // Accept SUM completion — this types the `(` as part of the insert.
  await userEvent.keyboard("=SU{Enter}");

  const el = tooltip();
  expect(el).not.toBeNull();
  expect(el!.textContent).toContain("SUM");
});

test("tooltip highlights the active parameter after `,`", async () => {
  await startEditing("A1" as CellId);
  await userEvent.keyboard("=ROUND(3.14,");

  const el = tooltip();
  expect(el).not.toBeNull();
  // ROUND has params value, decimals. After the comma, the cursor is
  // in decimals (index 1) — that span should carry the .active class.
  const active = el!.querySelector(".active");
  expect(active?.textContent).toContain("decimals");
});

test("closing the call dismisses the tooltip", async () => {
  await startEditing("A1" as CellId);
  await userEvent.keyboard("=ROUND(3.14, 2)");

  expect(tooltip()).toBeNull();
});

test("no tooltip when not inside a call", async () => {
  await startEditing("A1" as CellId);
  await userEvent.keyboard("=1+2");

  expect(tooltip()).toBeNull();
});

test("aliased calls resolve to the primary name", async () => {
  await startEditing("A1" as CellId);
  // AVG is an alias for AVERAGE — engine should return AVERAGE as the
  // displayed name.
  await userEvent.keyboard("=AVG(");

  const el = tooltip();
  expect(el).not.toBeNull();
  expect(el!.textContent).toContain("AVERAGE");
});
