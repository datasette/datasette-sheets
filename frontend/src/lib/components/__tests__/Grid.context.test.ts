import { beforeEach, expect, test, vi } from "vitest";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";

// [tests-12] Grid.svelte's column header right-click menu had only
// e2e coverage (col-delete.spec.ts). Bring the component-internal
// behaviours — single vs. multi-column wording, the
// "right-click outside selection narrows to that column" rule, and
// click-outside dismissal — down to vitest so we don't need a full
// Datasette spawn to catch a regression in the Grid menu wiring.

// Mock the persistence column-mutation calls — they hit the API in
// real life. The menu just needs them to resolve / reject so we can
// assert dispatch. ``activeSheetId`` is a derived store in the real
// module; provide a plain writable so menu-side callers don't blow
// up on subscribe.
vi.mock("../../stores/persistence", async () => {
  const actual = await vi.importActual<
    typeof import("../../stores/persistence")
  >("../../stores/persistence");
  return {
    ...actual,
    removeCols: vi.fn(async (_indices: number[]) => []),
    insertCols: vi.fn(async (_at: number, _count: number) => []),
    removeRows: vi.fn(async (_indices: number[]) => []),
  };
});

vi.mock("../../formatCommands", async () => {
  const actual = await vi.importActual<typeof import("../../formatCommands")>(
    "../../formatCommands",
  );
  return {
    ...actual,
    toggleFormatFlag: vi.fn(),
    clearAllFormat: vi.fn(),
  };
});

const { default: Grid } = await import("../Grid.svelte");
const { cells, selectedCell, selectedCells, selectionAnchor } =
  await import("../../stores/spreadsheet");
const { _resetHeaderSelectionForTests, headerSelection } =
  await import("../../stores/headerSelection");
const { removeCols } = await import("../../stores/persistence");
const { clearAllFormat } = await import("../../formatCommands");

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  _resetHeaderSelectionForTests();
  vi.mocked(removeCols).mockClear();
  vi.mocked(clearAllFormat).mockClear();
  // Stub confirm so deleteSelectedCols proceeds — the real prompt
  // would block headlessly. Each test that wants to assert the
  // menu *dismissed* without a delete should reset this.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

async function flushFrames() {
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

function mouse(
  el: HTMLElement,
  type: "mousedown" | "mouseenter" | "mouseup" | "contextmenu",
  init: MouseEventInit = {},
) {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}

// [sheet.column.context-menu]
test("right-click on a single column header opens menu with 'Delete column N' singular", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const colC = getColHeader("C");
  mouse(colC, "contextmenu", { clientX: 50, clientY: 50 });
  await tick();

  const deleteBtn = page.getByText("Delete column C");
  await expect.element(deleteBtn).toBeVisible();
});

// [sheet.column.context-menu]
test("right-click on a multi-column drag-selection shows plural 'Delete N columns'", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Build a B..D drag-selection first so the right-click should
  // keep that selection rather than narrow to one column.
  mouse(getColHeader("B"), "mousedown");
  mouse(getColHeader("C"), "mouseenter");
  mouse(getColHeader("D"), "mouseenter");
  mouse(document.body, "mouseup");
  await tick();

  mouse(getColHeader("C"), "contextmenu", { clientX: 50, clientY: 50 });
  await tick();

  const deleteBtn = page.getByText("Delete 3 columns");
  await expect.element(deleteBtn).toBeVisible();
});

// [sheet.column.context-menu]
test("right-click on a column outside the current selection narrows to that column", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Start with B..D selected.
  mouse(getColHeader("B"), "mousedown");
  mouse(getColHeader("C"), "mouseenter");
  mouse(getColHeader("D"), "mouseenter");
  mouse(document.body, "mouseup");
  await tick();

  // Right-click on F — outside the selection. Menu should target
  // just column F, mirroring the row test in row-delete.spec.ts.
  mouse(getColHeader("F"), "contextmenu", { clientX: 50, clientY: 50 });
  await tick();

  const deleteBtn = page.getByText("Delete column F");
  await expect.element(deleteBtn).toBeVisible();
  // The plural "Delete 3 columns" button should be gone.
  expect(page.getByText("Delete 3 columns").elements()).toHaveLength(0);
});

// [sheet.column.context-menu]
test("clicking the Delete button dispatches removeCols with the selected column indices", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Drag-select B..C (indices 1, 2).
  mouse(getColHeader("B"), "mousedown");
  mouse(getColHeader("C"), "mouseenter");
  mouse(document.body, "mouseup");
  await tick();

  mouse(getColHeader("B"), "contextmenu", { clientX: 50, clientY: 50 });
  await tick();

  await userEvent.click(page.getByText("Delete 2 columns"));

  expect(vi.mocked(removeCols)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(removeCols).mock.calls[0][0]).toEqual([1, 2]);
});

// [sheet.delete.context-menu-dismiss]
test("clicking outside the column menu dismisses it", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  mouse(getColHeader("C"), "contextmenu", { clientX: 50, clientY: 50 });
  await tick();
  await expect.element(page.getByText("Delete column C")).toBeVisible();

  // svelte:window on:click={closeHeaderMenus} catches clicks on
  // ``document`` — fire one outside the menu popover.
  document.body.click();
  await tick();

  expect(page.getByText("Delete column C").elements()).toHaveLength(0);
});

// [sheet.cell.format-submenu]
test("cell context menu's 'Clear formatting' button dispatches clearAllFormat", async () => {
  cells.setCellValue("B2", "hello");
  cells.setCellFormat("B2", { bold: true, italic: true });
  // Seed selection so the right-click doesn't have to narrow.
  selectedCell.set("B2");
  selectedCells.set(new Set(["B2"]));
  // Mute the headerSelection so the cell context menu mounts cleanly.
  headerSelection.clear("col");
  headerSelection.clear("row");

  render(Grid, { props: { database: "db", workbookId: 1 } });
  await flushFrames();

  // Right-click the cell — the per-cell on:contextmenu lives on the
  // wrapper div in Grid.svelte; the [data-cell-id] is the inner Cell.
  const cellWrapper = document.querySelector<HTMLElement>(
    '[data-cell-id="B2"]',
  )?.parentElement;
  if (!cellWrapper) throw new Error("No B2 wrapper found");
  mouse(cellWrapper, "contextmenu", { clientX: 100, clientY: 100 });
  await tick();

  await userEvent.click(page.getByTestId("format-clear"));

  expect(vi.mocked(clearAllFormat)).toHaveBeenCalledTimes(1);
});
