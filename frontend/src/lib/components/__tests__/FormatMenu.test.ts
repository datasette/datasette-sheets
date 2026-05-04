import { beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import FormatMenu from "../FormatMenu.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import {
  openOverlay,
  _resetOverlayTriggerForTests,
} from "../../stores/openOverlay";

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  openOverlay.set(null);
  _resetOverlayTriggerForTests();
});

// [sheet.format.menu]
test("Format menu opens and exposes the top-level sections", async () => {
  render(FormatMenu);
  await userEvent.click(page.getByRole("button", { name: "Format" }));
  await expect.element(page.getByText("Number")).toBeVisible();
  await expect.element(page.getByText("Text")).toBeVisible();
  await expect.element(page.getByText("Alignment")).toBeVisible();
  await expect.element(page.getByText("Wrapping")).toBeVisible();
  await expect.element(page.getByText("Borders")).toBeVisible();
  await expect.element(page.getByText("Clear formatting")).toBeVisible();
});

test("Format menu Text > Bold sets bold on the active selection", async () => {
  cells.setCellValue("A1", "hi");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(FormatMenu);

  await userEvent.click(page.getByRole("button", { name: "Format" }));
  await userEvent.click(page.getByRole("menuitem", { name: /Text/ }));
  // Bold is the first menu-row inside the submenu (role=menuitem).
  await userEvent.click(page.getByRole("menuitem", { name: "Bold" }));

  const cell = cells.getCell("A1");
  expect(cell?.format.bold).toBe(true);
});

test("Format menu Clear formatting resets every field", async () => {
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", {
    bold: true,
    italic: true,
    textColor: "#ff0000",
    hAlign: "center",
  });
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(FormatMenu);

  await userEvent.click(page.getByRole("button", { name: "Format" }));
  await userEvent.click(
    page.getByRole("menuitem", { name: "Clear formatting" }),
  );

  const cell = cells.getCell("A1")!;
  expect(cell.format.bold).toBe(false);
  expect(cell.format.italic).toBe(false);
  expect(cell.format.textColor).toBeUndefined();
  expect(cell.format.hAlign).toBeUndefined();
});

// [perf] Mirrors the comment in Toolbar.svelte / FormatMenu.svelte:
// applying a format from the menu must NOT trigger a full WASM
// recalculate. ``setCellFormat`` already wakes per-cell subscribers
// — the old extra ``cells.recalculate()`` was a measurable hitch on
// large sheets for no behavioural gain.
test("Format menu Number > Currency does not trigger a recalculate", async () => {
  cells.setCellValue("A1", "42");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
  render(FormatMenu);

  const recalcSpy = vi.spyOn(cells, "recalculate");

  await userEvent.click(page.getByRole("button", { name: "Format" }));
  await userEvent.click(page.getByRole("menuitem", { name: /Number/ }));
  await userEvent.click(page.getByRole("menuitem", { name: "Currency" }));

  expect(cells.getCell("A1")?.format.type).toBe("currency");
  expect(recalcSpy).not.toHaveBeenCalled();
  recalcSpy.mockRestore();
});

test("Escape closes the Format menu", async () => {
  render(FormatMenu);
  await userEvent.click(page.getByRole("button", { name: "Format" }));
  await expect.element(page.getByText("Number")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  // After close the "Number" submenu-host row is unmounted.
  const el = page.getByText("Number").elements();
  expect(el.length).toBe(0);
});

// [page-toolbar-07] Hover state machine — hovering Number opens the
// Number submenu, then hovering Text replaces it with the Text
// submenu (the on:mouseenter on each submenu-host swaps openSub).
test("Format menu: hovering siblings swaps the open submenu", async () => {
  render(FormatMenu);
  await userEvent.click(page.getByRole("button", { name: "Format" }));

  const numberRow = page
    .getByRole("menuitem", { name: /Number/ })
    .element() as HTMLElement;
  const textRow = page
    .getByRole("menuitem", { name: /^Text/ })
    .element() as HTMLElement;

  // Submenu-host divs are the parents of the top-level row buttons.
  numberRow.parentElement!.dispatchEvent(
    new MouseEvent("mouseenter", { bubbles: true }),
  );
  await expect
    .element(page.getByRole("menuitem", { name: "Currency" }))
    .toBeVisible();

  textRow.parentElement!.dispatchEvent(
    new MouseEvent("mouseenter", { bubbles: true }),
  );
  // Number submenu rows gone, Text submenu rows visible.
  await expect
    .element(page.getByRole("menuitem", { name: "Bold" }))
    .toBeVisible();
  expect(
    page.getByRole("menuitem", { name: "Currency" }).elements().length,
  ).toBe(0);
});

// [page-toolbar-07] When the cursor leaves the entire popover the
// hoverIntent action collapses the open submenu after its delay.
// Real timers (~300ms) — fake timers fight vitest-browser's userEvent.
test("Format menu: mouseleave on popover collapses the open submenu", async () => {
  render(FormatMenu);
  await userEvent.click(page.getByRole("button", { name: "Format" }));

  const numberRow = page
    .getByRole("menuitem", { name: /Number/ })
    .element() as HTMLElement;
  numberRow.parentElement!.dispatchEvent(
    new MouseEvent("mouseenter", { bubbles: true }),
  );
  await expect
    .element(page.getByRole("menuitem", { name: "Currency" }))
    .toBeVisible();

  const popover = numberRow.closest(".menu-popover") as HTMLElement;
  popover.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

  // Submenu still up immediately after mouseleave (intent delay).
  expect(
    page.getByRole("menuitem", { name: "Currency" }).elements().length,
  ).toBe(1);

  // Wait for the 300ms intent delay to elapse.
  await new Promise<void>((r) => setTimeout(r, 350));

  expect(
    page.getByRole("menuitem", { name: "Currency" }).elements().length,
  ).toBe(0);
});

// [page-toolbar-07] Arrow-key + two-stage Esc keyboard model. The
// menu opens via click, ↓ steps to the first row, → opens the
// submenu and focuses its first item, ← collapses the submenu, Esc
// closes the menu.
test("Format menu: arrow keys navigate rows and open submenus", async () => {
  render(FormatMenu);
  await userEvent.click(page.getByRole("button", { name: "Format" }));

  // ↓ from the Format trigger lands on the first top-level row (Number).
  await userEvent.keyboard("{ArrowDown}");
  const numberRow = page
    .getByRole("menuitem", { name: /Number/ })
    .element() as HTMLElement;
  expect(document.activeElement).toBe(numberRow);

  // → opens the Number submenu and focuses its first item (Automatic).
  await userEvent.keyboard("{ArrowRight}");
  const automatic = page
    .getByRole("menuitem", { name: "Automatic" })
    .element() as HTMLElement;
  expect(document.activeElement).toBe(automatic);

  // ↓ steps to the next submenu row.
  await userEvent.keyboard("{ArrowDown}");
  const numberFmt = page
    .getByRole("menuitem", { name: "Number", exact: true })
    .element() as HTMLElement;
  expect(document.activeElement).toBe(numberFmt);

  // ← collapses the submenu and refocuses its parent row.
  await userEvent.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(numberRow);
  expect(
    page.getByRole("menuitem", { name: "Automatic" }).elements().length,
  ).toBe(0);
});

test("Format menu: Esc collapses an open submenu before closing the menu", async () => {
  render(FormatMenu);
  await userEvent.click(page.getByRole("button", { name: "Format" }));

  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{ArrowRight}");
  await expect
    .element(page.getByRole("menuitem", { name: "Automatic" }))
    .toBeVisible();

  // First Esc: submenu collapses, menu stays open, parent row refocused.
  await userEvent.keyboard("{Escape}");
  expect(
    page.getByRole("menuitem", { name: "Automatic" }).elements().length,
  ).toBe(0);
  const numberRow = page
    .getByRole("menuitem", { name: /Number/ })
    .element() as HTMLElement;
  expect(document.activeElement).toBe(numberRow);

  // Second Esc: menu closes entirely.
  await userEvent.keyboard("{Escape}");
  expect(page.getByText("Number").elements().length).toBe(0);
});

test("Format menu: closing returns DOM focus to the Format trigger", async () => {
  render(FormatMenu);
  const trigger = page
    .getByRole("button", { name: "Format", exact: true })
    .element() as HTMLElement;

  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");

  // openOverlay's focus return is rAF-deferred.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  expect(document.activeElement).toBe(trigger);
});
