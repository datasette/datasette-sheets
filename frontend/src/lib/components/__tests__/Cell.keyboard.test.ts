// Component-level keyboard coverage for the cell nav-mode
// dispatcher. [CELL-GRID-08]
//
// These tests run against the real Svelte mount and the real Rust
// WASM engine — same setup as Cell.bold.test.ts — so any regression
// in keymap.ts -> handleCellKeydown wiring shows up as a failure
// here. Coverage matrix:
//
//   - Cmd+B / Cmd+I / Cmd+U / Cmd+Shift+X / Cmd+\\ format toggles
//   - Space on dropdown vs checkbox vs mixed selection
//   - Backspace two-step on dropdown cells
//   - Printable-character starts edit (only for the allowlisted
//     ``[a-zA-Z0-9=]`` chars — this test also pins the punctuation
//     gap from CELL-GRID-08 secondary issue #5).
//   - Cmd+Z / Cmd+Y undo / redo wiring.
//
// Coverage outside this file:
//   - ``keymap.test.ts`` covers the pure ``matches`` /
//     ``dispatchKeydown`` / inventory checks.
//   - ``Cell.bold.test.ts``, ``Cell.checkbox.test.ts``,
//     ``Cell.dropdown.test.ts`` carry the original per-feature
//     coverage that exercises the same wiring for those formats —
//     left in place; this file is additive.

import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  editingCell,
  selectSingle,
} from "../../stores/spreadsheet";
import { dropdownRules, dropdownPopoverFor } from "../../stores/dropdownRules";
import type { CellId, DropdownRule } from "../../spreadsheet/types";

const ruleSingle: DropdownRule = {
  id: "rule-single",
  name: "Status",
  multi: false,
  source: {
    kind: "list",
    options: [
      { value: "Todo", color: "#cccccc" },
      { value: "Doing", color: "#fff2cc" },
    ],
  },
};

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
  dropdownRules.set([ruleSingle]);
  dropdownPopoverFor.set(null);
});

function valueSpan(cellId: CellId): HTMLElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLElement>(".cell-value");
  if (!el) throw new Error(`No .cell-value inside cell ${cellId}`);
  return el;
}

function focusCell(cellId: CellId) {
  (page.getByTestId(cellId).element() as HTMLElement).focus();
}

function selectOnly(cellId: CellId) {
  selectedCell.set(cellId);
  selectionAnchor.set(cellId);
  selectedCells.set(new Set([cellId]));
}

// ---------------------------------------------------------------------------
// Format toggles
// ---------------------------------------------------------------------------

test("Cmd+I toggles italic on the active cell", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Control>}i{/Control}");
  await expect.element(valueSpan("A1" as CellId)).toHaveClass(/\bitalic\b/);

  await userEvent.keyboard("{Control>}i{/Control}");
  await expect.element(valueSpan("A1" as CellId)).not.toHaveClass(/\bitalic\b/);
});

test("Cmd+U toggles underline on the active cell", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Control>}u{/Control}");
  await expect.element(valueSpan("A1" as CellId)).toHaveClass(/\bunderline\b/);
});

test("Cmd+Shift+X toggles strikethrough on the active cell", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Control>}{Shift>}x{/Shift}{/Control}");
  await expect
    .element(valueSpan("A1" as CellId))
    .toHaveClass(/\bstrikethrough\b/);

  await userEvent.keyboard("{Control>}{Shift>}x{/Shift}{/Control}");
  await expect
    .element(valueSpan("A1" as CellId))
    .not.toHaveClass(/\bstrikethrough\b/);
});

test("Cmd+\\ clears all formatting on the selection", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  cells.setCellFormat("A1" as CellId, {
    bold: true,
    italic: true,
    underline: true,
  });
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Control>}\\{/Control}");

  const fmt = cells.getCell("A1" as CellId)?.format;
  expect(fmt?.bold).toBeFalsy();
  expect(fmt?.italic).toBeFalsy();
  expect(fmt?.underline).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Space — dropdown / checkbox / mixed selection
// ---------------------------------------------------------------------------

test("Space on a focused dropdown cell (no checkboxes anywhere) opens popover", async () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  selectSingle("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  let popover: CellId | null = null;
  const unsub = dropdownPopoverFor.subscribe((v) => {
    popover = v;
  });

  await userEvent.keyboard(" ");
  expect(popover).toBe("A1");

  unsub();
});

test("Space on a checkbox cell toggles the checkbox", async () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, { controlType: "checkbox" });
  selectSingle("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard(" ");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("TRUE");

  await userEvent.keyboard(" ");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("FALSE");
});

test("Space on a dropdown active cell with a checkbox in selection toggles checkbox (mixed)", async () => {
  // A1 is dropdown (focused / active), B1 is checkbox. Mixed
  // selection: per the original handler's nested-if, the checkbox
  // path WINS over dropdown-open when the selection contains any
  // checkbox cell. Locks in the precedence the comment at the old
  // line :1037 was learned-the-hard-way for.
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  cells.setCellValue("B1" as CellId, "");
  cells.setCellFormat("B1" as CellId, { controlType: "checkbox" });

  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId, "B1" as CellId]));

  render(Cell, { props: { cellId: "A1" as CellId } });
  render(Cell, { props: { cellId: "B1" as CellId } });
  focusCell("A1" as CellId);

  let popover: CellId | null = null;
  const unsub = dropdownPopoverFor.subscribe((v) => {
    popover = v;
  });

  await userEvent.keyboard(" ");

  // Popover did NOT open — checkbox path won.
  expect(popover).toBeNull();
  // Checkbox in B1 was toggled to TRUE.
  expect(cells.getCell("B1" as CellId)?.rawValue).toBe("TRUE");
  // A1 (dropdown) was NOT disturbed by the batch toggle — only
  // checkbox-formatted cells respond.
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("");

  unsub();
});

test("Space on a non-checkbox / non-dropdown cell is a no-op (does not start edit)", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard(" ");

  // Did NOT enter edit mode (Space is not in the printable-key
  // allowlist; original handler explicitly excluded it).
  let editing: CellId | null = null;
  const unsub = editingCell.subscribe((v) => {
    editing = v;
  });
  expect(editing).toBeNull();
  unsub();
  // Value untouched.
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("hi");
});

// ---------------------------------------------------------------------------
// Backspace two-step on dropdown cells
// ---------------------------------------------------------------------------

test("Backspace on a filled dropdown clears value but keeps format", async () => {
  cells.setCellValue("A1" as CellId, "Doing");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  selectSingle("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Backspace}");

  const c = cells.getCell("A1" as CellId);
  expect(c?.rawValue).toBe("");
  expect(c?.format.controlType).toBe("dropdown");
  expect(c?.format.dropdownRuleId).toBe(ruleSingle.id);
});

test("Backspace on an already-empty dropdown drops the format (two-step)", async () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  selectSingle("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Backspace}");

  const c = cells.getCell("A1" as CellId);
  expect(c?.format.controlType).toBeUndefined();
  expect(c?.format.dropdownRuleId).toBeUndefined();
});

test("Delete behaves identically to Backspace (clears value)", async () => {
  cells.setCellValue("A1" as CellId, "hello");
  selectSingle("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("{Delete}");

  expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");
});

// ---------------------------------------------------------------------------
// Printable-character → start edit
// ---------------------------------------------------------------------------

test("typing a letter starts editing seeded with that letter", async () => {
  cells.setCellValue("A1" as CellId, "");
  selectSingle("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("h");

  let editing: CellId | null = null;
  const unsubE = editingCell.subscribe((v) => {
    editing = v;
  });
  expect(editing).toBe("A1");
  unsubE();
});

test("typing '=' starts editing (formula entry)", async () => {
  cells.setCellValue("A1" as CellId, "");
  selectSingle("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("=");

  let editing: CellId | null = null;
  const unsubE = editingCell.subscribe((v) => {
    editing = v;
  });
  expect(editing).toBe("A1");
  unsubE();
});

test("typing a digit starts editing", async () => {
  cells.setCellValue("A1" as CellId, "");
  selectSingle("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  await userEvent.keyboard("7");

  let editing: CellId | null = null;
  const unsubE = editingCell.subscribe((v) => {
    editing = v;
  });
  expect(editing).toBe("A1");
  unsubE();
});

test("' starts edit (force-text producer); '-' and '.' do not", async () => {
  // [sheet.cell.force-text] joined ' to the allowlist so leading-'
  // force-text is reachable from nav mode without F2 first. The
  // broader "every printable triggers edit" change (CELL-GRID-08
  // secondary issue #5) is still a separate follow-up — '-' and '.'
  // continue to require F2.
  cells.setCellValue("A1" as CellId, "");
  selectSingle("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  // Apostrophe DOES start edit now.
  await userEvent.keyboard("'");
  let editing: CellId | null = null;
  let unsubE = editingCell.subscribe((v) => {
    editing = v;
  });
  expect(editing, "'\\'' should start edit (force-text trigger)").toBe("A1");
  unsubE();
  // Reset for the negative cases below.
  editingCell.set(null);
  focusCell("A1" as CellId);

  for (const punct of ["-", "."]) {
    await userEvent.keyboard(punct);
    editing = null;
    unsubE = editingCell.subscribe((v) => {
      editing = v;
    });
    expect(
      editing,
      `"${punct}" should not start edit (current behaviour)`,
    ).toBeNull();
    unsubE();
  }
});

// ---------------------------------------------------------------------------
// Cmd+Z / Cmd+Y / Cmd+Shift+Z wiring
// ---------------------------------------------------------------------------

test("Cmd+Z undoes the last value change", async () => {
  cells.setCellValue("A1" as CellId, "before");
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  // Push the "before" state, then mutate, then Cmd+Z back.
  const { pushUndo } = await import("../../stores/spreadsheet");
  pushUndo();
  cells.setCellValue("A1" as CellId, "after");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("after");

  await userEvent.keyboard("{Control>}z{/Control}");

  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("before");
});

test("Cmd+Shift+Z redoes after an undo", async () => {
  cells.setCellValue("A1" as CellId, "before");
  selectOnly("A1" as CellId);
  render(Cell, { props: { cellId: "A1" as CellId } });
  focusCell("A1" as CellId);

  const { pushUndo } = await import("../../stores/spreadsheet");
  pushUndo();
  cells.setCellValue("A1" as CellId, "after");

  await userEvent.keyboard("{Control>}z{/Control}");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("before");

  await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("after");
});
