import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  fillCells,
  selectCell,
  getCell,
} from "./helpers";

test("page loads and renders spreadsheet inside datasette", async ({
  page,
}) => {
  await gotoSheets(page);
  // Should have the datasette chrome (header, footer)
  await expect(page.locator("header.hd")).toBeVisible();
  // [sheet.grid.virtualization] Grid renders only the visible row
  // window + a buffer (was 1500 cells unvirtualized; now ~600 at a
  // typical playwright viewport). Assert a sane range rather than
  // an exact count — viewport height varies across CI / local.
  const cellCount = await page.locator(".cell").count();
  expect(cellCount).toBeGreaterThan(0);
  expect(cellCount).toBeLessThan(15 * 100); // less than 1500 (full grid)
  // 15-column header strip is always rendered (not virtualized).
  await expect(page.locator(".column-header")).toHaveCount(15);
  await expect(page.locator(".formula-input")).toBeVisible();
  // Connection indicator should appear
  await expect(page.locator(".connection-dot")).toBeVisible();
});

test("data entry, formulas, and formatting work", async ({ page }) => {
  await gotoSheets(page);

  await typeInCell(page, "A1", "Price");
  await typeInCell(page, "B1", "Qty");
  await typeInCell(page, "A2", "25");
  await typeInCell(page, "B2", "4");
  await typeInCell(page, "C2", "=A2*B2");

  await expectCellValue(page, "C2", "100");

  // Formatting
  await selectCell(page, "C2");
  await page.click('button[title="Format as Currency"]');
  await expectCellValue(page, "C2", "$100.00");
});

test("keyboard navigation works", async ({ page }) => {
  await gotoSheets(page);

  await selectCell(page, "B2");
  await page.keyboard.press("ArrowDown");
  await expect(getCell(page, "B3")).toHaveClass(/selected/);

  await page.keyboard.press("ArrowRight");
  await expect(getCell(page, "C3")).toHaveClass(/selected/);
});
