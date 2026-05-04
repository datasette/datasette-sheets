import { beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { get } from "svelte/store";

const SHEETS = [
  {
    id: "sheet-1",
    name: "Alpha",
    color: "#111",
    created_at: "t",
    updated_at: "t",
    sort_order: 0,
  },
  {
    id: "sheet-2",
    name: "Beta",
    color: "#222",
    created_at: "t",
    updated_at: "t",
    sort_order: 1,
  },
];

// Mock the network-facing API methods persistence.ts uses; everything
// else stays real so the store code executes untouched.
vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listSheets: vi.fn(async () => SHEETS),
    getSheet: vi.fn(async (_d: string, _w: string, id: string) => ({
      sheet: SHEETS.find((s) => s.id === id)!,
      columns: [],
      cells: [],
    })),
    updateSheet: vi.fn(async (_d, _w, id, updates) => ({
      sheet: {
        ...SHEETS.find((s) => s.id === id)!,
        ...(updates.name ? { name: updates.name } : {}),
      },
    })),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function setup() {
  const api = await import("../../api");
  const persistence = await import("../../stores/persistence");
  persistence.setDatabase("db");
  persistence.setWorkbookId("wb");
  await persistence.initWorkbook();
  const SheetTabs = (await import("../SheetTabs.svelte")).default;
  render(SheetTabs);
  return { api, persistence };
}

// [sheet.tabs.rename-commit]
test("Escape cancels a tab rename — server is not hit, label stays", async () => {
  const { api, persistence } = await setup();

  const tab = page.getByRole("tab", { name: "Alpha" });
  await tab.dblClick();

  const input = page.getByRole("textbox");
  await expect.element(input).toBeVisible();

  // Explicitly focus the input — autofocus isn't reliable under the
  // headless browser and userEvent.keyboard routes to whichever
  // element currently has focus.
  const inputEl = input.element() as HTMLInputElement;
  inputEl.focus();
  // Select-all + overwrite so the typed value replaces the prefilled
  // current name instead of being appended to it.
  inputEl.select();
  await userEvent.keyboard("Zeta");
  await userEvent.keyboard("{Escape}");

  // Input disappears; the original label is back.
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(page.getByRole("tab", { name: "Alpha" })).toBeVisible();

  // updateSheet must never have been called — cancel is local-only.
  expect(api.updateSheet).not.toHaveBeenCalled();
  // Store still has the original name.
  expect(get(persistence.sheets)[0].name).toBe("Alpha");
});

// [sheet.tabs.rename-commit]
test("Enter commits the edited name", async () => {
  const { api, persistence } = await setup();

  await page.getByRole("tab", { name: "Beta" }).dblClick();
  const inputEl = page.getByRole("textbox").element() as HTMLInputElement;
  inputEl.focus();
  inputEl.select();
  await userEvent.keyboard("Gamma");
  await userEvent.keyboard("{Enter}");

  expect(api.updateSheet).toHaveBeenCalledWith("db", "wb", "sheet-2", {
    name: "Gamma",
  });
  expect(get(persistence.sheets)[1].name).toBe("Gamma");
});
