import { type Page, type Locator, expect } from "@playwright/test";

const DB_NAME = "datasette-sheets-e2e-test";
const BASE = `/${DB_NAME}/-/sheets`;

/**
 * Create a workbook via API and navigate to it. Returns the workbook URL.
 *
 * [TESTS-10] Each call produces a unique workbook name so tests stay
 * independent of each other — pre-fix every test in a run pollutes the
 * shared in-memory DB with one workbook called ``"E2E Test"``, which
 * would make any future "list workbooks" assertion order-dependent.
 * Override ``name`` only when a test specifically asserts on the
 * workbook's name.
 */
export async function gotoSheets(page: Page, name?: string): Promise<string> {
  const wbName =
    name ?? `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const resp = await page.request.post(
    `http://localhost:8484${BASE}/api/workbooks/create`,
    { data: { name: wbName } },
  );
  const data = await resp.json();
  const wbId = data.workbook.id;
  const url = `${BASE}/workbook/${wbId}`;

  await page.goto(url);
  await expect(page.locator(".sheets-loading")).toHaveCount(0, {
    timeout: 5000,
  });
  await expect(page.locator(".sheets-root")).toBeVisible();
  return url;
}

/** Navigate to an existing workbook URL. */
export async function gotoWorkbook(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator(".sheets-loading")).toHaveCount(0, {
    timeout: 5000,
  });
  await expect(page.locator(".sheets-root")).toBeVisible();
}

/** Get a cell element by its ID (e.g. "A1", "B3") */
export function getCell(page: Page, cellId: string): Locator {
  return page.locator(`[data-cell-id="${cellId}"]`);
}

/** Click a cell to select it */
export async function selectCell(page: Page, cellId: string) {
  await getCell(page, cellId).click();
}

/** Double-click a cell to start editing with existing value */
export async function doubleClickCell(page: Page, cellId: string) {
  await getCell(page, cellId).dblclick();
}

async function editCell(page: Page, cellId: string, text: string) {
  const cell = getCell(page, cellId);
  await cell.click();
  await page.keyboard.press(text[0]);
  const input = cell.locator("input");
  await expect(input).toBeVisible();
  if (text.length > 1) {
    await input.type(text.slice(1));
  }
  return input;
}

/** Type a value into a cell and press Enter to commit */
export async function typeInCell(page: Page, cellId: string, text: string) {
  if (!text) return;
  const input = await editCell(page, cellId, text);
  await input.press("Enter");
}

/** Type a value into a cell and press Tab to commit */
export async function typeInCellTab(page: Page, cellId: string, text: string) {
  if (!text) return;
  const input = await editCell(page, cellId, text);
  await input.press("Tab");
}

/** Assert that a cell displays the expected value */
export async function expectCellValue(
  page: Page,
  cellId: string,
  expected: string,
) {
  const cell = getCell(page, cellId);
  await expect(cell.locator(".cell-value")).toHaveText(expected, {
    timeout: 5000,
  });
}

/** Fill multiple cells with data */
export async function fillCells(page: Page, data: Record<string, string>) {
  for (const [cellId, value] of Object.entries(data)) {
    await typeInCell(page, cellId, value);
  }
}

/**
 * Dispatch a synthetic ``paste`` event with HTML clipboard content (and
 * optionally a ``text/plain`` fallback) on the document's active
 * element. Mirrors what the browser fires when the user hits Cmd+V
 * after copying a table from Google Sheets / Excel / Obsidian — the
 * Cell.svelte / SheetsPage.svelte handlers read straight off
 * ``clipboardData``, so the event-shape match is what matters.
 *
 * Centralised here because every paste e2e was rolling its own copy
 * of this snippet inline; one accidentally-different copy quietly
 * diverges (notably whether ``text/plain`` is also set).
 */
export async function pasteHtml(
  page: Page,
  html: string,
  opts?: { plain?: string },
) {
  await page.evaluate(
    ({ html, plain }) => {
      const dt = new DataTransfer();
      dt.setData("text/html", html);
      if (plain !== undefined) dt.setData("text/plain", plain);
      const event = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
      });
      document.activeElement?.dispatchEvent(event);
    },
    { html, plain: opts?.plain },
  );
}

/**
 * Dispatch a synthetic ``paste`` event with only a ``text/plain``
 * payload — the TSV / Markdown-table fallback path. See
 * ``pasteHtml`` for the rationale on centralising this helper.
 */
export async function pasteTsv(page: Page, tsv: string) {
  await page.evaluate((tsv) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", tsv);
    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
    });
    document.activeElement?.dispatchEvent(event);
  }, tsv);
}

/**
 * Wait for any pending auto-save to complete.
 *
 * Polls the ``[data-save-status]`` attribute on the save indicator slot
 * (always present in the DOM, see ``SheetsPage.svelte``) until it
 * settles back to ``"idle"`` and stays there for a brief stable window
 * (so a save scheduled just after one finishes — column auto-fit,
 * post-recalc cascade — doesn't slip through).
 *
 * ``Enter`` commits flush synchronously, so callers that immediately
 * follow a typed-and-Enter sequence usually don't need this helper.
 * It's required for paths that schedule the debounced save without an
 * immediate commit (paste, format mutation, column-width drag, sheet
 * switch, post-load auto-fit) and before recording network traffic or
 * reloading.
 *
 * Prefer awaiting an explicit ``expectCellValue`` / SSE-driven locator
 * assertion when the test cares about a specific server effect; this
 * helper is for "make sure no save is in flight or about to schedule".
 *
 * @param timeout Max time to wait for sustained idle.
 *   Defaults to 5s, which comfortably covers the 1s debounce + slow
 *   CI network. The legacy ``ms`` callers passed sleep durations and
 *   that intent maps cleanly onto a timeout.
 */
export async function waitForAutoSave(page: Page, timeout = 5000) {
  const slot = page.locator(".save-indicator-slot");
  // We treat *both* ``idle`` and ``saved`` as quiescent: ``saved`` is
  // the post-flush "✓ Saved" indicator that lingers ~1.5 s after a
  // successful POST. The on-the-wire request has already completed by
  // the time the indicator reads ``saved``, so blocking on ``idle``
  // would unnecessarily add the indicator's reset timer to every
  // helper call.
  //
  // ``STABLE_QUIESCENT_MS`` covers the 150 ms debounce slack plus
  // scheduler jitter — a save scheduled immediately after a previous
  // one finishes (column auto-fit, post-recalc cascade) flips the
  // indicator back to ``saving`` within this window and we loop.
  const STABLE_QUIESCENT_MS = 300;
  const deadline = Date.now() + timeout;
  const isQuiescent = (s: string | null) => s === "idle" || s === "saved";
  while (Date.now() < deadline) {
    // Poll until the indicator reads a quiescent state.
    while (Date.now() < deadline) {
      const status = await slot.getAttribute("data-save-status");
      if (isQuiescent(status)) break;
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(STABLE_QUIESCENT_MS);
    const status = await slot.getAttribute("data-save-status");
    if (isQuiescent(status)) return;
    // Flipped back to ``saving`` — loop and re-await quiescence.
  }
  // Timeout — final check so the failure surfaces with a clear locator
  // assertion in the trace.
  const finalStatus = await slot.getAttribute("data-save-status");
  if (!isQuiescent(finalStatus)) {
    throw new Error(
      `waitForAutoSave: indicator did not reach quiescence within ${timeout}ms (last value: ${finalStatus})`,
    );
  }
}
