/**
 * [tests-05 backfill] FormulaBar coverage gaps not addressed by the
 * existing FormulaBar.test.ts (which focuses on the cell-ref dropdown
 * focus-return + dismiss flow).
 *
 * Specs covered:
 *   - [sheet.formula-bar.label] — single-cell vs multi-selection label.
 *   - [sheet.formula-bar.live-sync] — typing in the bar updates the
 *     edit value, Enter writes it through to the cell store.
 *   - [sheet.editing.formula-bar] — focus on the input opens edit mode.
 *   - [sheet.formula-bar.dropdown] — range selection toggles the
 *     "Create view…" item; activeView swaps to the view-mode menu.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { get, writable } from "svelte/store";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";

vi.mock("../../stores/persistence", () => ({
  activeSheetId: writable("sheet-1"),
}));

const { default: FormulaBar } = await import("../FormulaBar.svelte");
const {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  editingCell,
  editValue,
} = await import("../../stores/spreadsheet");
const { openOverlay, _resetOverlayTriggerForTests } =
  await import("../../stores/openOverlay");
const { activeView } = await import("../../stores/views");
type CellId = import("../../spreadsheet/types").CellId;

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
  editValue.set("");
  openOverlay.set(null);
  _resetOverlayTriggerForTests();
  activeView.set(null);
});

// (1) [sheet.formula-bar.label] Single-cell selection: the label is
// the bare cell id; the input renders the cell's raw value.
test("single-cell selection renders the bare cell id and raw value", async () => {
  cells.setCellValue("A1" as CellId, "hello");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  // Label trigger — A1, NOT A1:A1.
  await expect
    .element(page.getByRole("button", { name: /^A1\s*▾$/ }))
    .toBeVisible();
  // The input value mirrors the cell's raw value.
  const input = page.getByPlaceholder("Enter value or formula").element() as
    | HTMLInputElement
    | undefined;
  expect(input?.value).toBe("hello");
});

// (2) [sheet.formula-bar.label] A multi-cell rectangle renders as
// ``topLeft:bottomRight``.
test("multi-cell selection renders the bounding-box range label", async () => {
  cells.setCellValue("A1" as CellId, "x");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1", "B1", "A2", "B2"] as CellId[]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  await expect
    .element(page.getByRole("button", { name: /^A1:B2\s*▾$/ }))
    .toBeVisible();
});

// (4) [sheet.formula-bar.live-sync] Focus + type updates editValue;
// Enter routes the new text into the cell store and clears editingCell.
test("typing into the input syncs editValue; Enter commits via cells.setCellValue", async () => {
  cells.setCellValue("A1" as CellId, "");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  const input = page.getByPlaceholder("Enter value or formula");

  // Focus opens edit mode (covered separately below) — focusing here
  // also lets us drive userEvent typing into the input.
  await input.click();
  await userEvent.keyboard("from-bar");

  // editValue mirrors what's in the input as we type.
  expect(get(editValue)).toBe("from-bar");
  // Cell hasn't been written yet — only edit-mode buffer changes.
  expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");

  await userEvent.keyboard("{Enter}");

  // Enter pushes the edit value into the cell store and exits edit mode.
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("from-bar");
  expect(get(editingCell)).toBeNull();
});

// (5) [sheet.editing.formula-bar] Focusing the input enters edit mode
// for the active cell so subsequent keystrokes commit through the
// formula-bar's Enter handler.
test("focusing the input flips editingCell to the active cell", async () => {
  cells.setCellValue("A1" as CellId, "seed");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  await page.getByPlaceholder("Enter value or formula").click();

  expect(get(editingCell)).toBe("A1");
  // editValue is seeded with the existing raw value so the user's
  // first keystroke replaces or extends the existing content.
  expect(get(editValue)).toBe("seed");
});

// (7) [sheet.formula-bar.dropdown] When the selection covers a range,
// the dropdown carries a "Create view..." item. Single-cell selection
// only has the "Copy cell API URL" item.
test("range selection adds 'Create view...' to the dropdown menu", async () => {
  cells.setCellValue("A1" as CellId, "x");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1", "B1", "A2", "B2"] as CellId[]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  await userEvent.click(page.getByRole("button", { name: /^A1:B2\s*▾$/ }));

  await expect
    .element(
      page.getByRole("button", { name: "Copy range API URL", exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /^Create view/ }))
    .toBeVisible();
});

test("single-cell selection does NOT show 'Create view...'", async () => {
  cells.setCellValue("A1" as CellId, "x");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  await userEvent.click(page.getByRole("button", { name: /^A1\s*▾$/ }));

  await expect
    .element(
      page.getByRole("button", { name: "Copy cell API URL", exact: true }),
    )
    .toBeVisible();
  // No "Create view..." button rendered — explicit assertion on
  // absence so a regression that flips the conditional surfaces.
  const createView = page.getByRole("button", { name: /^Create view/ });
  await expect.element(createView).not.toBeInTheDocument();
});

// (8) [sheet.formula-bar.dropdown] When ``activeView`` is set, the
// label swaps to the view name and the menu carries view-mode items
// instead of the cell/range URL items.
test("activeView shows view name and view-mode menu items", async () => {
  cells.setCellValue("A1" as CellId, "x");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
  activeView.set({
    id: "v1",
    view_name: "my_view",
    range_str: "A1:B2",
    min_row: 0,
    min_col: 0,
    max_row: 1,
    max_col: 1,
    use_headers: true,
    color: "#ff8800",
    enable_insert: false,
    enable_update: false,
    enable_delete: false,
    delete_mode: "soft",
  } as unknown as Parameters<typeof activeView.set>[0]);

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  // Label is the view name, not the cell ref.
  await expect
    .element(page.getByRole("button", { name: /my_view/ }))
    .toBeVisible();

  await userEvent.click(page.getByRole("button", { name: /my_view/ }));

  await expect
    .element(
      page.getByRole("button", { name: "View in Datasette", exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Delete view", exact: true }))
    .toBeVisible();
  // Cell-mode items are absent in view mode.
  await expect
    .element(
      page.getByRole("button", { name: "Copy cell API URL", exact: true }),
    )
    .not.toBeInTheDocument();
});

// (10) Pressing Enter in the bar with the selection on a different
// cell from the original active cell still commits to the active cell
// — the formula-bar's Enter handler always uses ``$selectedCell``,
// not whatever was active when the input was focused.
test("Enter in the formula bar writes a formula to the active cell", async () => {
  cells.setCellValue("A1" as CellId, "1");
  cells.setCellValue("B1" as CellId, "2");
  selectedCell.set("C1" as CellId);
  selectionAnchor.set("C1" as CellId);
  selectedCells.set(new Set(["C1" as CellId]));

  render(FormulaBar, { props: { database: "db", workbookId: "wb" } });

  const input = page.getByPlaceholder("Enter value or formula");
  await input.click();
  await userEvent.keyboard("=A1+B1{Enter}");

  expect(cells.getCell("C1" as CellId)?.rawValue).toBe("=A1+B1");
});
