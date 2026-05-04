import { beforeEach, expect, test, vi } from "vitest";
import { get, writable } from "svelte/store";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";

// Mock persistence so ``activeSheetId`` is a plain writable we can
// preset — the real module exposes it as a derived store. The
// FormulaBar's ``copyApiUrl`` early-returns when it's empty, so the
// menu-item test needs a value here.
vi.mock("../../stores/persistence", () => ({
  activeSheetId: writable(7),
}));

// Lazy-import after the mock is registered.
const { default: FormulaBar } = await import("../FormulaBar.svelte");
const { cells, selectedCell, selectedCells, selectionAnchor } =
  await import("../../stores/spreadsheet");
const { openOverlay, _resetOverlayTriggerForTests } =
  await import("../../stores/openOverlay");
type CellId = import("../../spreadsheet/types").CellId;

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  openOverlay.set(null);
  _resetOverlayTriggerForTests();

  cells.setCellValue("A1" as CellId, "hi");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
});

/** Wait one animation frame so the focus-return rAF callback runs. */
async function nextFrame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

// [page-toolbar-08] Outside-click + menu-item dismiss are both via
// the mousedown-capture handler, NOT a window click handler. Clicking
// a menu item should fire the action AND close the menu without
// relying on every item carrying ``stopPropagation``.
test("clicking 'Copy cell API URL' writes the URL and closes the menu", async () => {
  const writeText = vi.fn(async (_url: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(FormulaBar, { props: { database: "db", workbookId: 1 } });

  await userEvent.click(page.getByRole("button", { name: /^A1\s*▾$/ }));
  expect(get(openOverlay)).toBe("formula-bar:cell-ref");
  await expect
    .element(
      page.getByRole("button", { name: "Copy cell API URL", exact: true }),
    )
    .toBeVisible();

  await userEvent.click(
    page.getByRole("button", { name: "Copy cell API URL", exact: true }),
  );

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toContain(
    "/db/-/sheets/api/workbooks/1/sheets/7/data/A1",
  );
  // ``copyApiUrl`` is async (awaits ``writeText``), so the menu close
  // is queued one microtask behind the click handler. Use the
  // ``expect.element`` retry to bridge that gap.
  await expect
    .element(
      page.getByRole("button", { name: "Copy cell API URL", exact: true }),
    )
    .not.toBeInTheDocument();
  expect(get(openOverlay)).toBe(null);
});

// [page-toolbar-08] Outside-click closes the menu via the document
// mousedown-capture listener, not the old ``svelte:window on:click``
// approach. Dispatch a real ``mousedown`` event on a node outside the
// FormulaBar's root and assert dismiss.
test("mousedown outside the formula bar closes the menu", async () => {
  // Place a sibling node outside the .formula-bar root to act as the
  // outside-click target. ``page.getByTestId`` is unreliable for nodes
  // outside the rendered component tree, so we dispatch the event
  // directly — that's what we actually want to verify anyway.
  const outside = document.createElement("div");
  outside.id = "fb-outside-target";
  document.body.appendChild(outside);

  try {
    render(FormulaBar, { props: { database: "db", workbookId: 1 } });

    await userEvent.click(page.getByRole("button", { name: /^A1\s*▾$/ }));
    expect(get(openOverlay)).toBe("formula-bar:cell-ref");

    outside.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(get(openOverlay)).toBe(null);
  } finally {
    outside.remove();
  }
});

// [page-toolbar-08] Belt-and-braces local Esc handler — SheetsPage's
// global Esc dismiss isn't mounted in this test, so we exercise the
// local one.
test("Escape closes the menu", async () => {
  render(FormulaBar, { props: { database: "db", workbookId: 1 } });

  await userEvent.click(page.getByRole("button", { name: /^A1\s*▾$/ }));
  expect(get(openOverlay)).toBe("formula-bar:cell-ref");

  await userEvent.keyboard("{Escape}");

  expect(get(openOverlay)).toBe(null);
});

// [page-toolbar-10] Focus return on close. The cell-reference div has
// ``tabindex="-1"`` so ``.focus()`` is valid; the rAF defer means we
// wait one frame past the close before asserting.
test("Esc returns focus to the cell-reference trigger", async () => {
  render(FormulaBar, { props: { database: "db", workbookId: 1 } });

  const trigger = page
    .getByRole("button", { name: /^A1\s*▾$/ })
    .element() as HTMLElement;
  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("formula-bar:cell-ref");

  await userEvent.keyboard("{Escape}");
  expect(get(openOverlay)).toBe(null);

  await nextFrame();
  expect(document.activeElement).toBe(trigger);
});

test("clicking 'Copy cell API URL' returns focus to the cell-reference trigger", async () => {
  const writeText = vi.fn(async (_url: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(FormulaBar, { props: { database: "db", workbookId: 1 } });

  const trigger = page
    .getByRole("button", { name: /^A1\s*▾$/ })
    .element() as HTMLElement;
  await userEvent.click(trigger);
  expect(get(openOverlay)).toBe("formula-bar:cell-ref");

  await userEvent.click(
    page.getByRole("button", { name: "Copy cell API URL", exact: true }),
  );

  // ``copyApiUrl`` awaits ``writeText`` before closing — wait for the
  // store to settle, then the rAF.
  await expect.poll(() => get(openOverlay)).toBe(null);
  await nextFrame();
  expect(document.activeElement).toBe(trigger);
});
