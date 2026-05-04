import { beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";

// [page-toolbar-01] Snapshot-level smoke test: after the
// SheetsPage extraction (clipboard / keyboard / lifecycle modules
// pulled out of the script block), the component still mounts
// cleanly, the layout subtree renders, and the document-level
// listeners install + tear down without throwing. The deeper
// behaviours each module owns are covered in their own files.

const SHEETS = [
  {
    id: "sheet-1",
    name: "Alpha",
    color: "#111",
    created_at: "t",
    updated_at: "t",
    sort_order: 0,
  },
];

vi.mock("../../../lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/api")>(
      "../../../lib/api",
    );
  return {
    ...actual,
    listSheets: vi.fn(async () => SHEETS),
    getSheet: vi.fn(async () => ({
      sheet: SHEETS[0],
      columns: [],
      cells: [],
    })),
    listViews: vi.fn(async () => []),
    listNamedRanges: vi.fn(async () => []),
    listDropdownRules: vi.fn(async () => []),
  };
});

// EventSource isn't part of the testing browser's polyfill set in
// every config — provide a minimal stub so SheetSSEClient.connect()
// doesn't throw during mount.
class FakeEventSource {
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}
// @ts-expect-error -- fake EventSource for the mount test
globalThis.EventSource = FakeEventSource;

beforeEach(() => {
  vi.clearAllMocks();
});

test("SheetsPage mounts the layout subtree without throwing", async () => {
  const SheetsPage = (await import("../SheetsPage.svelte")).default;
  render(SheetsPage, {
    database: "db",
    workbookId: "wb",
    workbookName: "My Workbook",
  });

  // Header rendered.
  await expect.element(page.getByText("My Workbook")).toBeVisible();
  // Loading text is gone (init resolved).
  // ``Loading spreadsheet...`` is the pre-init placeholder; once
  // initWorkbook resolves the layout (Toolbar / Grid / SheetTabs)
  // takes its place. Format menu (header) is a unique landmark.
  const formatMenu = page.getByRole("button", { name: "Format", exact: true });
  await expect.element(formatMenu).toBeVisible();
});
