import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Toolbar from "../Toolbar.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  pushUndo,
  clearUndoHistory,
} from "../../stores/spreadsheet";
import {
  openOverlay,
  toggleOverlay,
  closeAnyOverlay,
  _resetOverlayTriggerForTests,
} from "../../stores/openOverlay";

// Component-level coverage of the Toolbar after the IconButton /
// PickerButton extraction. [page-toolbar-02] Mirrors FormatMenu.test.ts:
// real Svelte mount, drive via userEvent, assert against store
// mutations + DOM. The cross-component mutual-exclusion suite
// (popoverMutualExclusion.test.ts) covers Format menu ↔ Toolbar
// interplay; this file focuses on Toolbar-internal behaviour.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  openOverlay.set(null);
  clearUndoHistory();
  _resetOverlayTriggerForTests();
});

function selectA1() {
  cells.setCellValue("A1", "hi");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
}

test("Toolbar renders all groups when a cell is selected", async () => {
  selectA1();
  render(Toolbar);

  // Spot-check one button per group: undo (history), Bold (text styling),
  // Text color (picker), Align left, Borders (picker), Wrapping (picker),
  // Clear formatting (eraser).
  await expect
    .element(page.getByRole("button", { name: "Undo" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Bold" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Text color", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Align left" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Borders" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Wrapping" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Clear formatting" }))
    .toBeVisible();
});

test("Toolbar paints disabled-look when nothing is selected", async () => {
  // No selection — the ``.toolbar.no-selection`` CSS rule fades buttons.
  // We assert the class as a proxy for the visual — the rule is locked
  // down in the stylesheet itself.
  const { container } = render(Toolbar);
  const root = container.querySelector(".toolbar") as HTMLElement;
  expect(root.classList.contains("no-selection")).toBe(true);

  // Selecting a cell drops the fade. Use the locator-based wait to
  // give Svelte a tick to react before asserting.
  selectA1();
  await expect.poll(() => root.classList.contains("no-selection")).toBe(false);
});

test("Clicking Bold toggles the bold flag on the selection", async () => {
  selectA1();
  render(Toolbar);

  await userEvent.click(page.getByRole("button", { name: "Bold" }));
  expect(cells.getCell("A1")?.format.bold).toBe(true);

  await userEvent.click(page.getByRole("button", { name: "Bold" }));
  expect(cells.getCell("A1")?.format.bold).toBe(false);
});

test("Bold button reflects the active cell's bold state via aria-pressed", async () => {
  selectA1();
  cells.setCellFormat("A1", { bold: true });
  render(Toolbar);

  const bold = page.getByRole("button", { name: "Bold" });
  // aria-pressed surfaces the depressed visual state to AT.
  expect(bold.element().getAttribute("aria-pressed")).toBe("true");

  await userEvent.click(bold);
  expect(cells.getCell("A1")?.format.bold).toBe(false);
  expect(bold.element().getAttribute("aria-pressed")).toBe("false");
});

test("Clicking a number-format entry applies the partial and closes the picker", async () => {
  selectA1();
  render(Toolbar);

  await userEvent.click(
    page.getByRole("button", { name: "More number formats" }),
  );
  expect(get(openOverlay)).toBe("toolbar:numberFormat");

  await userEvent.click(
    page.getByRole("menuitem", { name: "Currency ($1,234.00)" }),
  );

  expect(cells.getCell("A1")?.format.type).toBe("currency");
  expect(cells.getCell("A1")?.format.decimals).toBe(2);
  expect(cells.getCell("A1")?.format.currencySymbol).toBe("$");
  // Picker closed on selection.
  expect(get(openOverlay)).toBe(null);
});

test("Opening the wrap picker closes the text-color picker", async () => {
  selectA1();
  render(Toolbar);

  await userEvent.click(
    page.getByRole("button", { name: "Text color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:textColor");

  await userEvent.click(page.getByRole("button", { name: "Wrapping" }));
  expect(get(openOverlay)).toBe("toolbar:wrap");
  // Text-color popover is gone; the wrap menu items are mounted.
  expect(
    page.getByRole("dialog", { name: "Text color" }).elements().length,
  ).toBe(0);
  await expect
    .element(page.getByRole("menuitem", { name: /Overflow/ }))
    .toBeVisible();
});

test("Clicking outside the toolbar closes an open picker", async () => {
  selectA1();
  render(Toolbar);

  await userEvent.click(
    page.getByRole("button", { name: "Text color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:textColor");

  // Toolbar's outside-click handler runs in mousedown-capture phase.
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  try {
    outside.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(get(openOverlay)).toBe(null);
  } finally {
    outside.remove();
  }
});

test("Esc-style closeAnyOverlay closes the picker but leaves the toolbar mounted", async () => {
  // Toolbar.svelte has no local Esc handler — Esc is owned by
  // SheetsPage's document-level handler, which calls
  // ``closeAnyOverlay``. We exercise that store entry point here so
  // the test doesn't depend on SheetsPage being mounted.
  selectA1();
  const { container } = render(Toolbar);

  await userEvent.click(
    page.getByRole("button", { name: "Text color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:textColor");

  closeAnyOverlay();
  expect(get(openOverlay)).toBe(null);

  // Toolbar still mounted, buttons still clickable.
  const root = container.querySelector(".toolbar") as HTMLElement;
  expect(root).not.toBeNull();
  await expect
    .element(page.getByRole("button", { name: "Bold" }))
    .toBeVisible();
});

// [page-toolbar-05] / [tests-01] coverage extensions — the cases the
// two follow-up tickets called out that weren't already pinned by the
// tests above. Grouped at the bottom so the original suite stays
// stable as a baseline.

test("Italic / Underline / Strikethrough each toggle the matching flag", async () => {
  // [page-toolbar-05 #1] / [tests-01 #4] — Bold has its own test; this
  // covers the rest of the format-flag quartet so a typo wiring the
  // wrong handler to one of them surfaces here.
  selectA1();
  render(Toolbar);

  await userEvent.click(page.getByRole("button", { name: "Italic" }));
  expect(cells.getCell("A1")?.format.italic).toBe(true);

  await userEvent.click(page.getByRole("button", { name: "Underline" }));
  expect(cells.getCell("A1")?.format.underline).toBe(true);

  await userEvent.click(page.getByRole("button", { name: "Strikethrough" }));
  expect(cells.getCell("A1")?.format.strikethrough).toBe(true);
});

test("Multi-cell selection: clicking Bold flips every selected cell", async () => {
  // [page-toolbar-05 #2] — toggleFormatFlag's "active cell decides,
  // every target follows" contract. With three cells selected and
  // none bold, one click sets all three.
  cells.setCellValue("A1", "a");
  cells.setCellValue("B1", "b");
  cells.setCellValue("C1", "c");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1", "B1", "C1"]));
  render(Toolbar);

  await userEvent.click(page.getByRole("button", { name: "Bold" }));
  expect(cells.getCell("A1")?.format.bold).toBe(true);
  expect(cells.getCell("B1")?.format.bold).toBe(true);
  expect(cells.getCell("C1")?.format.bold).toBe(true);
});

test("Currency / Percentage / Number toolbar buttons set format.type", async () => {
  // [tests-01 #2] — these are the toolbar's $/%/.0 glyph buttons,
  // distinct from the popover entries in the Currency-via-popover
  // test above. Each writes a different ``type`` partial; a typo
  // accidentally swapping handlers would surface here.
  selectA1();
  render(Toolbar);

  await userEvent.click(
    page.getByRole("button", { name: "Format as Currency" }),
  );
  expect(cells.getCell("A1")?.format.type).toBe("currency");

  await userEvent.click(
    page.getByRole("button", { name: "Format as Percentage" }),
  );
  expect(cells.getCell("A1")?.format.type).toBe("percentage");

  await userEvent.click(page.getByRole("button", { name: "Format as Number" }));
  expect(cells.getCell("A1")?.format.type).toBe("number");
});

test("Decimal increase / decrease clamp at 0..10", async () => {
  // [tests-01 #3] — bespoke arithmetic in increaseDecimal /
  // decreaseDecimal. Default decimals is 2, so we only need a few
  // clicks to hit each cap.
  selectA1();
  cells.setCellFormat("A1", { decimals: 9 });
  render(Toolbar);

  const inc = page.getByRole("button", { name: "Increase decimal places" });
  const dec = page.getByRole("button", { name: "Decrease decimal places" });

  await userEvent.click(inc);
  expect(cells.getCell("A1")?.format.decimals).toBe(10);
  // Already at 10 — clamp holds.
  await userEvent.click(inc);
  expect(cells.getCell("A1")?.format.decimals).toBe(10);

  cells.setCellFormat("A1", { decimals: 1 });
  await userEvent.click(dec);
  expect(cells.getCell("A1")?.format.decimals).toBe(0);
  // Already at 0 — clamp holds.
  await userEvent.click(dec);
  expect(cells.getCell("A1")?.format.decimals).toBe(0);
});

test("Font-size input clamps to MIN_FONT_SIZE (6) and MAX_FONT_SIZE (72)", async () => {
  // [page-toolbar-05 #8] / [tests-01 #8] — handleFontSizeInput sends
  // through clampSize. Drive it via the input's change event so the
  // browser's number-input min/max attrs don't pre-clamp.
  selectA1();
  const { container } = render(Toolbar);
  const input = container.querySelector(".font-size-input") as HTMLInputElement;

  // Too small.
  input.value = "2";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  expect(cells.getCell("A1")?.format.fontSize).toBe(6);

  // Too large.
  input.value = "999";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  expect(cells.getCell("A1")?.format.fontSize).toBe(72);

  // In-range value passes through (rounded).
  input.value = "14";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  expect(cells.getCell("A1")?.format.fontSize).toBe(14);
});

test("Border picker change writes a borders partial", async () => {
  // [tests-01 #7] — open the borders popover, click a preset, assert
  // the cell's format.borders carries the matching edges.
  selectA1();
  render(Toolbar);

  await userEvent.click(
    page.getByRole("button", { name: "Borders", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:borders");

  await userEvent.click(
    page.getByRole("menuitem", { name: "Top", exact: true }),
  );

  const borders = cells.getCell("A1")?.format.borders;
  expect(borders).toBeDefined();
  expect(borders?.top).toBeDefined();
  expect(borders?.top?.style).toBe("solid");
  // Only top — Top preset is single-edge.
  expect(borders?.bottom).toBeUndefined();
  expect(borders?.left).toBeUndefined();
  expect(borders?.right).toBeUndefined();
  // Picker closes after a preset is chosen.
  expect(get(openOverlay)).toBe(null);
});

test("Eraser button reverts the cell's format to defaults", async () => {
  // [page-toolbar-05 #9] — clearAllFormat resets every field. Seed a
  // cell with a sampler of format attrs, click Clear formatting,
  // assert the format object is back to baseline.
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", {
    bold: true,
    italic: true,
    textColor: "#ff0000",
    fillColor: "#00ff00",
    hAlign: "center",
    fontSize: 16,
    type: "currency",
    decimals: 4,
  });
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(Toolbar);

  await userEvent.click(page.getByRole("button", { name: "Clear formatting" }));

  const fmt = cells.getCell("A1")!.format;
  expect(fmt.bold).toBe(false);
  expect(fmt.italic).toBe(false);
  expect(fmt.textColor).toBeUndefined();
  expect(fmt.fillColor).toBeUndefined();
  expect(fmt.hAlign).toBeUndefined();
  expect(fmt.fontSize).toBeUndefined();
  // ``type`` resets to the "general" default.
  expect(fmt.type === undefined || fmt.type === "general").toBe(true);
});

test("H-align and V-align buttons write the correct axis", async () => {
  // [tests-01] anti-typo regression: the ticket called out a
  // hypothetical ``setHAlign("left")`` that accidentally invokes
  // ``setVAlign``. Click each axis, assert the right field landed.
  selectA1();
  render(Toolbar);

  await userEvent.click(page.getByRole("button", { name: "Align center" }));
  expect(cells.getCell("A1")?.format.hAlign).toBe("center");
  expect(cells.getCell("A1")?.format.vAlign).toBeUndefined();

  await userEvent.click(page.getByRole("button", { name: "Align middle" }));
  expect(cells.getCell("A1")?.format.vAlign).toBe("middle");
  // hAlign survived the v-align write.
  expect(cells.getCell("A1")?.format.hAlign).toBe("center");
});

test("Undo / Redo toolbar buttons drive the store's undo stack", async () => {
  // [tests-01 #9] — regression coverage for the toolbar buttons as
  // visible undo entry points alongside Cmd+Z. Detailed undo
  // semantics live in the dedicated tests-04 ticket; here we just
  // verify a click reaches the store.
  selectA1();
  pushUndo();
  cells.setCellFormat("A1", { bold: true });
  expect(cells.getCell("A1")?.format.bold).toBe(true);

  render(Toolbar);

  await userEvent.click(page.getByRole("button", { name: "Undo" }));
  // Bold cleared by undo.
  expect(cells.getCell("A1")?.format.bold).toBeFalsy();

  await userEvent.click(page.getByRole("button", { name: "Redo" }));
  expect(cells.getCell("A1")?.format.bold).toBe(true);
});

test("PickerButton trigger forwards itself to openOverlay for focus return", async () => {
  // Locks down [page-toolbar-10] integration: the PickerButton wrapper
  // must call ``toggleOverlay(id, trigger)`` so closing returns focus
  // to the button. We can't observe the private trigger directly, so
  // verify by closing via the same overlay id and checking
  // ``document.activeElement`` after the rAF defer.
  selectA1();
  render(Toolbar);

  const trigger = page
    .getByRole("button", { name: "Borders", exact: true })
    .element() as HTMLElement;

  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("toolbar:borders");

  // Toggle via the same id (mimics a second click on the trigger).
  toggleOverlay("toolbar:borders");

  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  expect(document.activeElement).toBe(trigger);
});
