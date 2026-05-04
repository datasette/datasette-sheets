import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  selectCell,
  getCell,
  waitForAutoSave,
} from "./helpers";

test("delete cell persists across reload", async ({ page }) => {
  await gotoSheets(page);

  await typeInCell(page, "A1", "keep");
  await typeInCell(page, "B1", "delete me");
  await waitForAutoSave(page);

  // Verify both exist
  await expectCellValue(page, "A1", "keep");
  await expectCellValue(page, "B1", "delete me");

  // Select B1 and delete
  await selectCell(page, "B1");
  await page.keyboard.press("Delete");
  await waitForAutoSave(page, 3000);

  // B1 should be empty
  await expectCellValue(page, "B1", "");

  // Reload
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

  // A1 should persist, B1 should still be empty
  await expectCellValue(page, "A1", "keep");
  await expectCellValue(page, "B1", "");
});

test("delete range persists across reload", async ({ page }) => {
  await gotoSheets(page);

  await typeInCell(page, "A1", "one");
  await typeInCell(page, "A2", "two");
  await typeInCell(page, "A3", "three");
  await waitForAutoSave(page);

  // Select range A1:A3 via shift-click
  await selectCell(page, "A1");
  await page.keyboard.down("Shift");
  await selectCell(page, "A3");
  await page.keyboard.up("Shift");

  // Delete the range
  await page.keyboard.press("Delete");
  await waitForAutoSave(page);

  // All should be empty
  await expectCellValue(page, "A1", "");
  await expectCellValue(page, "A2", "");
  await expectCellValue(page, "A3", "");

  // Reload
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

  await expectCellValue(page, "A1", "");
  await expectCellValue(page, "A2", "");
  await expectCellValue(page, "A3", "");
});
