import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  fillCells,
  waitForAutoSave,
  getCell,
  selectCell,
} from "./helpers";

test("data persists across page reload", async ({ page }) => {
  await gotoSheets(page);

  // Enter some data
  await typeInCell(page, "A1", "Persistent");
  await typeInCell(page, "B1", "42");
  await typeInCell(page, "C1", "=B1*2");

  await expectCellValue(page, "C1", "84");

  // Wait for auto-save
  await waitForAutoSave(page);

  // Reload the page
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

  // Data should still be there
  await expectCellValue(page, "A1", "Persistent");
  await expectCellValue(page, "B1", "42");
  await expectCellValue(page, "C1", "84");
});

test("cell formatting persists across reload", async ({ page }) => {
  await gotoSheets(page);

  await typeInCell(page, "A1", "100");
  await selectCell(page, "A1");
  await page.click('button[title="Format as Currency"]');
  await expectCellValue(page, "A1", "$100.00");

  await waitForAutoSave(page);
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

  await expectCellValue(page, "A1", "$100.00");
});

test("multiple sheets persist", async ({ page }) => {
  await gotoSheets(page);

  // Enter data on first sheet
  await typeInCell(page, "A1", "Sheet1Data");
  await waitForAutoSave(page);

  // Add a second sheet — wait for the second tab to mount + become
  // active before typing.
  await page.click(".add-tab", { force: true });
  const tabs = page.locator(".tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveClass(/active/);

  // Enter data on second sheet
  await typeInCell(page, "A1", "Sheet2Data");
  await waitForAutoSave(page);

  // Switch back to first sheet — wait for the active class to flip,
  // then ``expectCellValue`` proves the sheet's cell store has loaded.
  await tabs.first().click({ force: true });
  await expect(tabs.first()).toHaveClass(/active/);

  await expectCellValue(page, "A1", "Sheet1Data");

  // Switch to second sheet
  await tabs.last().click({ force: true });
  await expect(tabs.last()).toHaveClass(/active/);

  await expectCellValue(page, "A1", "Sheet2Data");
});
