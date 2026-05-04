import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PopoverWrapper from "./PopoverWrapper.svelte";
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

// [page-toolbar-10] Focus return on popover close. Each close path
// (item select, Esc, outside-click, mutual-exclusion replacement)
// must restore DOM focus to the trigger element so keyboard / AT
// users keep their place. FormulaBar's focus-return cases live in
// FormulaBar.test.ts because that file mocks ``persistence``.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  openOverlay.set(null);
  _resetOverlayTriggerForTests();

  cells.setCellValue("A1", "hi");
  selectedCell.set("A1");
  selectionAnchor.set("A1");
  selectedCells.set(new Set(["A1"]));
});

/** Wait for the next animation frame so the focus-return rAF callback
 *  has had a chance to run. The store defers ``focus()`` via rAF
 *  precisely because synchronous focus during close races the popover
 *  unmount in some browsers (see ``openOverlay.ts`` header). */
async function nextFrame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

test("Toolbar picker: outside-click returns focus to its trigger", async () => {
  // Toolbar itself has no local Esc handler — that's owned by
  // SheetsPage's global handler, which isn't mounted in this isolated
  // test. We exercise the outside-click path instead, which covers
  // the same store-level focus-return code path. (The store unit test
  // already locks down Esc / closeOverlay specifically.)
  render(PopoverWrapper);

  const trigger = page
    .getByRole("button", { name: "Text color", exact: true })
    .element() as HTMLElement;
  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("toolbar:textColor");

  // Toolbar's outside-click is a ``mousedown`` capture handler. Fire
  // a mousedown on a node outside the toolbar root.
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  try {
    outside.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(get(openOverlay)).toBe(null);

    await nextFrame();
    expect(document.activeElement).toBe(trigger);
  } finally {
    outside.remove();
  }
});

test("Toolbar picker: picking an item returns focus to its trigger", async () => {
  render(PopoverWrapper);

  const trigger = page
    .getByRole("button", { name: "More number formats", exact: true })
    .element() as HTMLElement;
  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("toolbar:numberFormat");

  // Pick a number-format item — handler calls ``closePickers``.
  await userEvent.click(
    page.getByRole("menuitem", { name: "Currency ($1,234.00)" }),
  );
  expect(get(openOverlay)).toBe(null);

  await nextFrame();
  expect(document.activeElement).toBe(trigger);
});

test("Format menu: picking an item returns focus to the Format trigger", async () => {
  // Render FormatMenu alone — the cross-component PopoverWrapper has
  // Toolbar's currency / etc. buttons sitting under the Format menu's
  // submenu drop area, which intercept pointer events. The store-level
  // mutual-exclusion test below covers the cross-component case.
  render(FormatMenu);

  const trigger = page
    .getByRole("button", { name: "Format", exact: true })
    .element() as HTMLElement;
  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("format-menu");

  // Open Number submenu, then click Currency — that calls ``run()``
  // which closes the menu. Submenu items now carry role=menuitem too.
  await userEvent.click(page.getByRole("menuitem", { name: /Number/ }));
  await userEvent.click(page.getByRole("menuitem", { name: "Currency" }));
  expect(get(openOverlay)).toBe(null);

  await nextFrame();
  expect(document.activeElement).toBe(trigger);
});

test("Format menu: Esc returns focus to the Format trigger", async () => {
  render(FormatMenu);

  const trigger = page
    .getByRole("button", { name: "Format", exact: true })
    .element() as HTMLElement;
  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("format-menu");

  await userEvent.keyboard("{Escape}");
  expect(get(openOverlay)).toBe(null);

  await nextFrame();
  expect(document.activeElement).toBe(trigger);
});

test("Mutual exclusion: opening a new overlay refocuses the previous trigger", async () => {
  // Sanity check on the store-level swap behaviour: the previously-
  // recorded trigger gets focus restored when the slot is replaced,
  // not just on full close.
  render(PopoverWrapper);

  const formatBtn = page
    .getByRole("button", { name: "Format", exact: true })
    .element() as HTMLElement;
  await userEvent.click(formatBtn);
  expect(get(openOverlay)).toBe("format-menu");

  await userEvent.click(
    page.getByRole("button", { name: "Text color", exact: true }),
  );
  expect(get(openOverlay)).toBe("toolbar:textColor");

  await nextFrame();
  expect(document.activeElement).toBe(formatBtn);
});
