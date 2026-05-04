import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  selectSingle,
} from "../../stores/spreadsheet";
import { dropdownRules, dropdownPopoverFor } from "../../stores/dropdownRules";
import { clearDropdownStep } from "../../formatCommands";
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
      { value: "Done", color: "#b6d7a8" },
    ],
  },
};

const ruleMulti: DropdownRule = {
  id: "rule-multi",
  name: "Tags",
  multi: true,
  source: {
    kind: "list",
    options: [
      { value: "frontend", color: "#cfe2f3" },
      { value: "backend", color: "#d9ead3" },
      { value: "design", color: "#ead1dc" },
    ],
  },
};

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  dropdownRules.set([ruleSingle, ruleMulti]);
  dropdownPopoverFor.set(null);
});

function dropdownButton(cellId: CellId): HTMLButtonElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLButtonElement>(".cell-dropdown");
  if (!el) throw new Error(`No .cell-dropdown inside cell ${cellId}`);
  return el;
}

function chipLabels(cellId: CellId): string[] {
  return Array.from(
    page
      .getByTestId(cellId)
      .element()
      .querySelectorAll<HTMLElement>(".dropdown-chip"),
  ).map((el) => el.textContent?.trim() ?? "");
}

// [sheet.data.dropdown]
test("dropdown format renders a chip button instead of text", () => {
  cells.setCellValue("A1" as CellId, "Doing");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(dropdownButton("A1" as CellId)).toBeTruthy();
  expect(chipLabels("A1" as CellId)).toEqual(["Doing"]);
  // The plain text branch is suppressed when the chip renders.
  const valueSpan = page
    .getByTestId("A1")
    .element()
    .querySelector(".cell-value");
  expect(valueSpan).toBeNull();
});

// [sheet.data.dropdown]
test("invalid value renders as an 'invalid' chip", () => {
  cells.setCellValue("A1" as CellId, "Cancelled");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(chipLabels("A1" as CellId)).toEqual(["Cancelled"]);
  const chip = page.getByTestId("A1").element().querySelector(".dropdown-chip");
  expect(chip?.classList.contains("invalid")).toBe(true);
});

// [sheet.data.dropdown]
test("multi-select renders all selected values as chips in DOM + overflow badge", () => {
  cells.setCellValue("A1" as CellId, "frontend,design");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleMulti.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  // Every selected value lands in the DOM as a chip; the
  // ``fitChips`` action toggles visibility based on cell width
  // (asserted at the layout level — not deterministic in the test
  // viewport, so we only assert presence here).
  expect(chipLabels("A1" as CellId)).toEqual(["frontend", "design"]);
  const overflow = page
    .getByTestId("A1")
    .element()
    .querySelector(".dropdown-chip-overflow");
  expect(overflow).toBeTruthy();
});

// [sheet.data.dropdown]
test("multi-select with one selected value still has the overflow slot in DOM", () => {
  cells.setCellValue("A1" as CellId, "frontend");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleMulti.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(chipLabels("A1" as CellId)).toEqual(["frontend"]);
  // Badge always present in DOM; ``fitChips`` sets display:none
  // when no overflow is needed.
  const overflow = page
    .getByTestId("A1")
    .element()
    .querySelector<HTMLElement>(".dropdown-chip-overflow");
  expect(overflow).toBeTruthy();
});

// [sheet.data.dropdown]
test("clicking the chip opens the popover", async () => {
  cells.setCellValue("A1" as CellId, "Todo");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  expect(getPopoverCell()).toBeNull();
  await userEvent.click(dropdownButton("A1" as CellId));
  expect(getPopoverCell()).toBe("A1");
});

// [sheet.data.dropdown]
test("clearDropdownStep on a filled dropdown cell clears the value but keeps the format", () => {
  cells.setCellValue("A1" as CellId, "Doing");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  selectSingle("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));

  clearDropdownStep();
  const cell = cells.getCell("A1" as CellId);
  expect(cell?.rawValue).toBe("");
  // Format preserved — chip stays in its empty state.
  expect(cell?.format.controlType).toBe("dropdown");
  expect(cell?.format.dropdownRuleId).toBe(ruleSingle.id);
});

// [sheet.data.dropdown]
test("clearDropdownStep on an already-empty dropdown cell drops the format", () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  selectSingle("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));

  clearDropdownStep();
  const cell = cells.getCell("A1" as CellId);
  expect(cell?.format.controlType).toBeUndefined();
  expect(cell?.format.dropdownRuleId).toBeUndefined();
});

// [sheet.data.dropdown]
test("clearDropdownStep falls back to the active cell when multi-selection is empty", () => {
  // Regression: the old inline Backspace handler walked $selectedCells
  // directly, so an empty multi-selection silently no-op'd even though
  // the active cell was clearly the user's intent. clearDropdownStep
  // shares the targets() helper with the rest of formatCommands and
  // covers this case.
  cells.setCellValue("A1" as CellId, "Doing");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  selectSingle("A1" as CellId);
  selectedCells.set(new Set());

  clearDropdownStep();
  const cell = cells.getCell("A1" as CellId);
  expect(cell?.rawValue).toBe("");
  expect(cell?.format.controlType).toBe("dropdown");
});

// [sheet.data.dropdown]
test("Backspace keypress on a focused dropdown cell invokes clearDropdownStep", async () => {
  // Integration test: confirms the keyboard surface still reaches the
  // helper. The unit-level behaviour lives in the clearDropdownStep
  // tests above; this case only asserts the wiring.
  cells.setCellValue("A1" as CellId, "Doing");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  selectSingle("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
  (page.getByTestId("A1").element() as HTMLElement).focus();

  await userEvent.keyboard("{Backspace}");
  const cell = cells.getCell("A1" as CellId);
  expect(cell?.rawValue).toBe("");
  expect(cell?.format.controlType).toBe("dropdown");
});

// [sheet.data.dropdown] Chip overflow precision.
//
// Regression coverage for fitChips: when the chip container is too
// narrow to fit every chip plus the +N badge, only the first chip and
// the badge stay visible — the rest get ``display: none``.
//
// The fitChips action measures inside a ``requestAnimationFrame``, so
// the test waits two frames after constraining the container: one for
// the ResizeObserver to fire ``schedule()`` and one for the rAF to
// run ``measure()``.
test("fitChips hides overflow chips and updates the +N badge", async () => {
  const ruleManyTags: DropdownRule = {
    id: "rule-many",
    name: "Many",
    multi: true,
    source: {
      kind: "list",
      options: [
        { value: "alpha", color: "#cccccc" },
        { value: "beta", color: "#cccccc" },
        { value: "gamma", color: "#cccccc" },
        { value: "delta", color: "#cccccc" },
        { value: "epsilon", color: "#cccccc" },
      ],
    },
  };
  dropdownRules.set([ruleManyTags]);
  cells.setCellValue("A1" as CellId, "alpha,beta,gamma,delta,epsilon");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleManyTags.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const cellEl = page.getByTestId("A1").element() as HTMLElement;
  const chipsContainer = cellEl.querySelector<HTMLElement>(".dropdown-chips");
  if (!chipsContainer) throw new Error("missing .dropdown-chips");

  // Force the container narrow enough that only the first chip plus
  // the badge can fit. The chips have padding 1px 8px + ~11px font,
  // so 50px barely admits "alpha" + "+N".
  chipsContainer.style.width = "50px";
  chipsContainer.style.maxWidth = "50px";
  chipsContainer.style.flex = "none";

  // Wait two frames — RO fires on next tick, rAF runs the frame after.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  const chips = Array.from(
    cellEl.querySelectorAll<HTMLElement>(".dropdown-chip"),
  );
  expect(chips).toHaveLength(5);
  // First chip stays visible.
  expect(chips[0].style.display).not.toBe("none");
  // Every other chip is hidden.
  for (let i = 1; i < chips.length; i++) {
    expect(chips[i].style.display).toBe("none");
  }
  const badge = cellEl.querySelector<HTMLElement>(".dropdown-chip-overflow");
  expect(badge).toBeTruthy();
  expect(badge!.style.display).not.toBe("none");
  // 5 total - 1 visible = 4 hidden.
  expect(badge!.textContent).toBe("+4");
});

// [sheet.data.dropdown]
test("Enter on a focused dropdown cell opens the popover (not edit mode)", async () => {
  cells.setCellValue("A1" as CellId, "");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: ruleSingle.id,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  selectSingle("A1" as CellId);
  (page.getByTestId("A1").element() as HTMLElement).focus();

  await userEvent.keyboard("{Enter}");
  expect(getPopoverCell()).toBe("A1");
});

function getPopoverCell(): string | null {
  let value: string | null = null;
  const unsub = dropdownPopoverFor.subscribe((v) => {
    value = v;
  });
  unsub();
  return value;
}
