import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PopoverWrapper from "./PopoverWrapper.svelte";
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

  // Toolbar disables every button when nothing is selected — pre-seed
  // a real selection so the picker buttons are clickable.
  cells.setCellValue("A1", "hi");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
});

// Core mutual-exclusion scenario from the ticket: open the toolbar's
// text-color picker, then click the header Format button. The Format
// menu should open AND the text-color popover should close —
// previously the two components tracked open state independently and
// both popovers stayed mounted. [page-toolbar-04]
test("opening the Format menu closes a toolbar picker", async () => {
  render(PopoverWrapper);

  await userEvent.click(
    page.getByRole("button", { name: "Text color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:textColor");
  // ColorPicker renders a dialog with the same aria-label as its
  // trigger button — query the dialog role specifically so we don't
  // strict-match the button.
  await expect
    .element(page.getByRole("dialog", { name: "Text color" }))
    .toBeVisible();

  await userEvent.click(
    page.getByRole("button", { name: "Format", exact: true }),
  );
  expect(get(openOverlay)).toBe("format-menu");
  // Format-menu submenu host rows are visible.
  await expect
    .element(page.getByRole("menuitem", { name: /Number/ }))
    .toBeVisible();
  // Toolbar's color picker dialog is gone.
  expect(
    page.getByRole("dialog", { name: "Text color" }).elements().length,
  ).toBe(0);
});

// Inverse direction: opening any toolbar picker while the Format
// menu is open should drop the menu. [page-toolbar-04]
test("opening a toolbar picker closes the Format menu", async () => {
  render(PopoverWrapper);

  await userEvent.click(
    page.getByRole("button", { name: "Format", exact: true }),
  );
  expect(get(openOverlay)).toBe("format-menu");
  await expect
    .element(page.getByRole("menuitem", { name: /Number/ }))
    .toBeVisible();

  await userEvent.click(
    page.getByRole("button", { name: "Fill color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:fillColor");
  // Format menu's submenu rows are unmounted.
  expect(page.getByRole("menuitem", { name: /Number/ }).elements().length).toBe(
    0,
  );
});

// Two toolbar pickers: opening the second should close the first.
// This already worked before the refactor (toolbar tracked a single
// ``openPicker``) — locking it down so the store-backed implementation
// preserves that behaviour. [page-toolbar-04]
test("toolbar picker → toolbar picker swaps cleanly", async () => {
  render(PopoverWrapper);

  await userEvent.click(
    page.getByRole("button", { name: "Text color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:textColor");

  await userEvent.click(
    page.getByRole("button", { name: "Fill color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:fillColor");
});

// Esc policy: closes whichever popover is open. Mirrors the
// pre-refactor behaviour where both Toolbar and FormatMenu had their
// own Esc handlers; now there's a single global handler in
// SheetsPage *plus* a belt-and-braces local handler in FormatMenu.
// We exercise the local handler here since SheetsPage isn't mounted
// in this test.
test("Esc closes the open Format menu", async () => {
  render(PopoverWrapper);

  await userEvent.click(
    page.getByRole("button", { name: "Format", exact: true }),
  );
  expect(get(openOverlay)).toBe("format-menu");

  await userEvent.keyboard("{Escape}");
  expect(get(openOverlay)).toBe(null);
});
