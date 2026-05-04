import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  getCell,
  typeInCell,
  expectCellValue,
  waitForAutoSave,
} from "./helpers";

// [sheet.cell.force-text] End-to-end: type '<text>, the engine treats
// it as a literal String instead of auto-classifying. The override
// must survive reload — that's the load-bearing test for task 10.

test("typing leading ' forces literal text and survives reload", async ({
  page,
}) => {
  await gotoSheets(page);

  // Without the prefix, ISO date auto-classifies as Custom(jdate).
  await typeInCell(page, "A1", "2026-04-01");
  await expectCellValue(page, "A1", "Apr 1, 2026");
  await expect(getCell(page, "A1").locator(".cell-value")).toHaveClass(
    /custom/,
  );

  // With the prefix, same input stays as literal '2026-04-01'.
  await typeInCell(page, "B1", "'2026-04-01");
  await expectCellValue(page, "B1", "2026-04-01");
  await expect(getCell(page, "B1").locator(".cell-value")).not.toHaveClass(
    /custom/,
  );

  await waitForAutoSave(page);

  await page.reload();

  // After reload, A1 still classifies as a date, B1 still literal.
  await expectCellValue(page, "A1", "Apr 1, 2026");
  await expect(getCell(page, "A1").locator(".cell-value")).toHaveClass(
    /custom/,
  );
  await expectCellValue(page, "B1", "2026-04-01");
  await expect(getCell(page, "B1").locator(".cell-value")).not.toHaveClass(
    /custom/,
  );
});
