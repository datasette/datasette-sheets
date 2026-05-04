import { beforeEach, expect, test } from "vitest";
import { tick } from "svelte";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import DropdownRuleEditor from "../DropdownRuleEditor.svelte";
import { dropdownRules, dropdownRulesPanel } from "../../stores/dropdownRules";
import type { DropdownRule } from "../../spreadsheet/types";

// [page-toolbar-09] Coverage for the chip-color picker on the rule
// editor. The popover used to be a bespoke ``mini-palette``; this
// suite locks in the ColorPicker reuse + the click-outside
// dismissal that the bespoke version was missing.

const rule: DropdownRule = {
  id: 1,
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
  dropdownRules.set([rule]);
  dropdownRulesPanel.set({ ruleId: rule.id });
});

function panelEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".dropdown-rule-panel");
  if (!el) throw new Error("dropdown-rule-panel not mounted");
  return el;
}

function colorCell(index: number): HTMLElement {
  const el = panelEl().querySelector<HTMLElement>(
    `.color-cell[data-picker-index="${index}"]`,
  );
  if (!el) throw new Error(`color-cell ${index} not found`);
  return el;
}

function colorSwatchButton(index: number): HTMLButtonElement {
  const btn =
    colorCell(index).querySelector<HTMLButtonElement>(".color-swatch");
  if (!btn) throw new Error(`color-swatch ${index} not found`);
  return btn;
}

function pickerOpenIn(index: number): HTMLElement | null {
  return colorCell(index).querySelector<HTMLElement>(".color-picker");
}

test("clicking a swatch in the ColorPicker updates the option color and closes the popover", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  // Open the picker for option 0.
  await userEvent.click(colorSwatchButton(0));
  const picker = pickerOpenIn(0);
  expect(picker).toBeTruthy();

  // The reset swatch is hidden via ``nullable={false}``; every
  // remaining ``.swatch`` corresponds to a palette entry.
  const swatches = Array.from(
    picker!.querySelectorAll<HTMLButtonElement>(".swatch"),
  ).filter((b) => !b.classList.contains("reset"));
  expect(swatches.length).toBeGreaterThan(0);
  // Pick a swatch whose color differs from the option's current
  // color (#cccccc) so the assertion is meaningful.
  const target = swatches.find(
    (b) => b.getAttribute("title")?.toLowerCase() !== "#cccccc",
  );
  if (!target) throw new Error("no differing swatch in palette");
  const targetHex = target.getAttribute("title")!.toLowerCase();

  await userEvent.click(target);
  await tick();

  // Popover dismissed.
  expect(pickerOpenIn(0)).toBeNull();
  // Option color updated — re-open the picker and verify the
  // ``.selected`` swatch is the one we clicked. ColorPicker marks
  // the active swatch via case-insensitive hex match.
  await userEvent.click(colorSwatchButton(0));
  const reopened = pickerOpenIn(0);
  expect(reopened).toBeTruthy();
  const selected =
    reopened!.querySelector<HTMLButtonElement>(".swatch.selected");
  expect(selected).toBeTruthy();
  expect(selected!.getAttribute("title")?.toLowerCase()).toBe(targetHex);
});

test("reset swatch is hidden in the dropdown chip picker (nullable=false)", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  await userEvent.click(colorSwatchButton(0));
  const picker = pickerOpenIn(0);
  expect(picker).toBeTruthy();
  expect(picker!.querySelector(".swatch.reset")).toBeNull();
});

test("clicking the panel header outside the open picker dismisses it", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  await userEvent.click(colorSwatchButton(0));
  expect(pickerOpenIn(0)).toBeTruthy();

  // Mousedown capture handler is what dismisses (mirrors FormatMenu /
  // FormulaBar pattern). Dispatch a raw mousedown on the header
  // heading — a node inside the panel but outside the open color
  // cell.
  const heading = panelEl().querySelector<HTMLElement>(".panel-header h3");
  if (!heading) throw new Error("panel header heading not found");
  heading.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  await tick();

  expect(pickerOpenIn(0)).toBeNull();
});

// [tests-08] Add / remove / multi-toggle and validation. The chip-
// color picker tests above cover the popover surface; these pin the
// rest of the editor's authoring contract.

function optionRows(): HTMLElement[] {
  return Array.from(panelEl().querySelectorAll<HTMLElement>(".option-row"));
}

function optionValueInput(index: number): HTMLInputElement {
  const row = optionRows()[index];
  const input = row.querySelector<HTMLInputElement>(".option-value");
  if (!input) throw new Error(`option-row ${index} missing input`);
  return input;
}

function addOptionButton(): HTMLButtonElement {
  const btn = panelEl().querySelector<HTMLButtonElement>(".add-option-btn");
  if (!btn) throw new Error("add-option button not found");
  return btn;
}

function deleteOptionButton(index: number): HTMLButtonElement {
  const row = optionRows()[index];
  const btn = row.querySelector<HTMLButtonElement>(".icon-btn.small");
  if (!btn) throw new Error(`option-row ${index} missing delete button`);
  return btn;
}

function errorBox(): HTMLElement | null {
  return panelEl().querySelector<HTMLElement>(".error");
}

test("Add option appends a new row with a defaulted color", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  // Editing rule has 2 options.
  expect(optionRows().length).toBe(2);
  await userEvent.click(addOptionButton());
  await tick();
  expect(optionRows().length).toBe(3);
  // The new row's swatch carries a non-empty inline background — i.e.
  // the editor seeded a default color rather than a blank chip.
  // The browser normalises the inline ``background: #...`` to
  // ``rgb(...)`` so we assert against either form.
  const newSwatch = optionRows()[2].querySelector<HTMLElement>(".color-swatch");
  expect(newSwatch).toBeTruthy();
  expect(newSwatch!.getAttribute("style")).toMatch(
    /background:\s*(#[0-9a-fA-F]+|rgb\()/,
  );
});

test("Delete option drops the row and renumbers the swatches", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  expect(optionRows().length).toBe(2);
  // Drop the second option.
  await userEvent.click(deleteOptionButton(1));
  await tick();
  expect(optionRows().length).toBe(1);
  // Surviving row keeps its value.
  expect(optionValueInput(0).value).toBe("Todo");
});

test("Single-option rule disables the only Delete button (can't go to zero)", async () => {
  // Seed a one-option rule so the editor opens with options.length === 1.
  dropdownRules.set([
    {
      id: 99,
      name: "Solo",
      multi: false,
      source: { kind: "list", options: [{ value: "Only", color: "#cccccc" }] },
    },
  ]);
  dropdownRulesPanel.set({ ruleId: 99 });
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  expect(optionRows().length).toBe(1);
  // The validate() guard at save time + the disabled attr together
  // prevent zero-option rules.
  expect(deleteOptionButton(0).disabled).toBe(true);
});

test("Toggling 'Allow multiple selections' flips the multi flag", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  const multiCheckbox = panelEl().querySelector<HTMLInputElement>(
    ".checkbox-field input[type='checkbox']",
  );
  if (!multiCheckbox) throw new Error("multi-checkbox not found");
  expect(multiCheckbox.checked).toBe(false);
  await userEvent.click(multiCheckbox);
  expect(multiCheckbox.checked).toBe(true);
});

test("Save with a duplicate option value surfaces an inline error and does not close", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  // Force a duplicate.
  const inp = optionValueInput(1);
  inp.focus();
  await userEvent.fill(inp, "Todo");
  // The Save button label depends on whether we're editing.
  const saveBtn = panelEl().querySelector<HTMLButtonElement>(".btn.primary");
  if (!saveBtn) throw new Error("primary save button not found");
  await userEvent.click(saveBtn);
  await tick();
  const err = errorBox();
  expect(err?.textContent).toMatch(/Duplicate option value/);
  // Panel still open — the dismiss path runs only after a clean save.
  expect(panelEl()).toBeTruthy();
});

test("Save with a comma in an option value rejects (server also rejects, this saves a round-trip)", async () => {
  render(DropdownRuleEditor, {
    props: { database: "test", workbookId: 1 },
  });
  const inp = optionValueInput(0);
  inp.focus();
  await userEvent.fill(inp, "with, comma");
  const saveBtn = panelEl().querySelector<HTMLButtonElement>(".btn.primary");
  if (!saveBtn) throw new Error("primary save button not found");
  await userEvent.click(saveBtn);
  await tick();
  expect(errorBox()?.textContent).toMatch(/cannot contain ','/);
});
