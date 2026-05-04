import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  gotoWorkbook,
  typeInCell,
  selectCell,
  getCell,
  waitForAutoSave,
} from "./helpers";

// Note: Cmd+B local toggle + range-bold are covered by the vitest
// browser suite at frontend/src/lib/components/__tests__/Cell.bold.test.ts.
// Only the multi-tab SSE-broadcast flow lives here, because it needs
// the Datasette backend to replay the bold as a cell-update event.

test("Cmd+B survives a reload", async ({ page }) => {
  await gotoSheets(page);
  await typeInCell(page, "A1", "hello");
  await selectCell(page, "A1");
  await page.keyboard.press("Meta+b");
  await expect(getCell(page, "A1").locator(".cell-value")).toHaveClass(/bold/);

  await waitForAutoSave(page);

  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });
  await expect(getCell(page, "A1").locator(".cell-value")).toHaveClass(/bold/);
});

test("bold broadcasts to other user", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    const wbUrl = await gotoSheets(pageA);
    await typeInCell(pageA, "A1", "shared");
    await waitForAutoSave(pageA);

    await gotoWorkbook(pageB, wbUrl);
    // Wait for both SSE connections to come up before A mutates,
    // otherwise B can miss the broadcast.
    await expect(pageA.locator(".connection-dot.connected")).toBeVisible();
    await expect(pageB.locator(".connection-dot.connected")).toBeVisible();

    // User A bolds A1
    await selectCell(pageA, "A1");
    await pageA.keyboard.press("Meta+b");
    await waitForAutoSave(pageA);

    // User B should see it bold
    await expect(getCell(pageB, "A1").locator(".cell-value")).toHaveClass(
      /bold/,
      {
        timeout: 5000,
      },
    );
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
