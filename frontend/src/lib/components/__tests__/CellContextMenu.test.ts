import { beforeEach, expect, test, vi } from "vitest";
import { writable } from "svelte/store";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";

// Mock persistence so ``activeSheetId`` is a plain writable we can
// preset — the real module exposes it as a derived store, and the
// CellContextMenu's API-URL helper early-returns when it's empty.
vi.mock("../../stores/persistence", () => ({
  activeSheetId: writable(7),
}));

// Format command spies: the Bold/Italic/Underline/Clear-formatting
// menu items dispatch through these. Replacing them with vi.fn() lets
// the test assert dispatch without actually mutating the cell store.
vi.mock("../../formatCommands", () => ({
  toggleFormatFlag: vi.fn(),
  clearAllFormat: vi.fn(),
}));

// Refresh-data is a side-effect-heavy helper (cache invalidation,
// fetch, pin); the test only needs to confirm the menu wires through.
vi.mock("../../sql", async () => {
  const actual = await vi.importActual<typeof import("../../sql")>("../../sql");
  return {
    ...actual,
    refreshSqlCell: vi.fn(),
  };
});

// Named-range / dropdown panel helpers — assert dispatch only.
vi.mock("../../stores/namedRanges", async () => {
  const actual = await vi.importActual<
    typeof import("../../stores/namedRanges")
  >("../../stores/namedRanges");
  return { ...actual, openNamedRangesPanel: vi.fn() };
});
vi.mock("../../stores/dropdownRules", async () => {
  const actual = await vi.importActual<
    typeof import("../../stores/dropdownRules")
  >("../../stores/dropdownRules");
  return { ...actual, openDropdownRulesPanel: vi.fn() };
});

// Lazy-import after mocks are registered so each module reads the
// mocked references rather than the real implementations.
const { default: CellContextMenu } = await import("../CellContextMenu.svelte");
const { cells, selectedCell, selectedCells, selectionAnchor } =
  await import("../../stores/spreadsheet");
const { dropdownRules } = await import("../../stores/dropdownRules");
const { toggleFormatFlag, clearAllFormat } =
  await import("../../formatCommands");
const { refreshSqlCell } = await import("../../sql");
const { openNamedRangesPanel } = await import("../../stores/namedRanges");
const { openDropdownRulesPanel } = await import("../../stores/dropdownRules");

type CellId = import("../../spreadsheet/types").CellId;
type DropdownRule = import("../../spreadsheet/types").DropdownRule;

const baseProps = {
  x: 100,
  y: 100,
  range: "A1",
  cellId: "A1" as CellId,
  database: "db",
  workbookId: 5,
  onCut: async () => {},
  onCopy: async () => {},
  onPaste: async () => {},
  onClose: () => {},
};

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  dropdownRules.set([]);
  vi.mocked(toggleFormatFlag).mockClear();
  vi.mocked(clearAllFormat).mockClear();
  vi.mocked(refreshSqlCell).mockClear();
  vi.mocked(openNamedRangesPanel).mockClear();
  vi.mocked(openDropdownRulesPanel).mockClear();
});

// [sheet.cell.context-menu]
test("plain text cell shows the standard menu items, no SQL or dropdown", async () => {
  cells.setCellValue("A1" as CellId, "hello");
  render(CellContextMenu, { props: baseProps });

  // Standard items are always present.
  await expect.element(page.getByTestId("cut")).toBeInTheDocument();
  await expect.element(page.getByTestId("copy")).toBeInTheDocument();
  await expect.element(page.getByTestId("paste")).toBeInTheDocument();
  await expect.element(page.getByTestId("format-bold")).toBeInTheDocument();
  await expect.element(page.getByTestId("format-italic")).toBeInTheDocument();
  await expect
    .element(page.getByTestId("format-underline"))
    .toBeInTheDocument();
  await expect.element(page.getByTestId("format-clear")).toBeInTheDocument();
  await expect.element(page.getByTestId("copy-reference")).toBeInTheDocument();
  await expect
    .element(page.getByTestId("define-named-range"))
    .toBeInTheDocument();
  await expect.element(page.getByTestId("copy-api-url")).toBeInTheDocument();
  await expect.element(page.getByTestId("open-api-url")).toBeInTheDocument();

  // SQL refresh + edit dropdown are conditional and should be absent.
  expect(page.getByTestId("refresh-sql").elements()).toHaveLength(0);
  expect(page.getByTestId("edit-dropdown").elements()).toHaveLength(0);
});

// [sheet.cell.sql-array-formula]
test("SQL cell exposes 'Refresh data' and clicking calls refreshSqlCell", async () => {
  cells.setCellValue("A1" as CellId, '=SQL("select 1")');
  render(CellContextMenu, { props: baseProps });

  await expect.element(page.getByTestId("refresh-sql")).toBeInTheDocument();
  await userEvent.click(page.getByTestId("refresh-sql"));

  expect(vi.mocked(refreshSqlCell)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(refreshSqlCell).mock.calls[0][0]).toBe("A1");
  expect(vi.mocked(refreshSqlCell).mock.calls[0][1]).toBe('=SQL("select 1")');
});

// [sheet.data.dropdown]
test("dropdown cell exposes 'Edit dropdown…' and clicking calls openDropdownRulesPanel", async () => {
  const rule: DropdownRule = {
    id: 13,
    name: "Status",
    multi: false,
    source: { kind: "list", options: [{ value: "Todo", color: "#cccccc" }] },
  };
  dropdownRules.set([rule]);
  cells.setCellValue("A1" as CellId, "Todo");
  cells.setCellFormat("A1" as CellId, {
    controlType: "dropdown",
    dropdownRuleId: rule.id,
  });

  render(CellContextMenu, { props: baseProps });

  await expect.element(page.getByTestId("edit-dropdown")).toBeInTheDocument();
  await userEvent.click(page.getByTestId("edit-dropdown"));

  expect(vi.mocked(openDropdownRulesPanel)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(openDropdownRulesPanel).mock.calls[0][0]).toBe(rule.id);
});

// [sheet.cell.copy-reference]
test("Copy reference writes the range to navigator.clipboard", async () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  cells.setCellValue("A1" as CellId, "hi");
  render(CellContextMenu, { props: { ...baseProps, range: "A1:B5" } });

  await userEvent.click(page.getByTestId("copy-reference"));

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toBe("A1:B5");
});

// [sheet.cell.format-submenu]
test("Bold menu item calls toggleFormatFlag('bold')", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  render(CellContextMenu, { props: baseProps });

  await userEvent.click(page.getByTestId("format-bold"));

  expect(vi.mocked(toggleFormatFlag)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(toggleFormatFlag).mock.calls[0][0]).toBe("bold");
});

// [sheet.named-range.define-from-context]
test("'Define named range…' opens the panel pre-populated with =range", async () => {
  cells.setCellValue("A1" as CellId, "hi");
  render(CellContextMenu, { props: { ...baseProps, range: "A1:B5" } });

  await userEvent.click(page.getByTestId("define-named-range"));

  expect(vi.mocked(openNamedRangesPanel)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(openNamedRangesPanel).mock.calls[0][0]).toEqual({
    initialDefinition: "=A1:B5",
  });
});

// [sheet.cell.copy-api-url]
test("Copy API URL builds the data-API URL and writes it to the clipboard", async () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  cells.setCellValue("A1" as CellId, "hi");
  render(CellContextMenu, { props: baseProps });

  await userEvent.click(page.getByTestId("copy-api-url"));

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toContain(
    "/db/-/sheets/api/workbooks/5/sheets/7/data/A1",
  );
});

test("clicking any item invokes the onClose handler", async () => {
  const onClose = vi.fn();
  cells.setCellValue("A1" as CellId, "hi");
  render(CellContextMenu, { props: { ...baseProps, onClose } });

  await userEvent.click(page.getByTestId("copy-reference"));

  expect(onClose).toHaveBeenCalled();
});
