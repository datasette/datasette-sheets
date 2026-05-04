import { test } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  waitForAutoSave,
} from "./helpers";

// [sheet.cell.custom] End-to-end demo: ISO dates auto-classify as
// jdate, date arithmetic produces a jspan, and reload preserves both.
// The frontend's WASM engine and the backend Python engine must agree
// — both have to be built with --features datetime and call
// register_datetime() on each fresh Sheet instance.

test("ISO dates classify and date arithmetic produces a span", async ({
  page,
}) => {
  await gotoSheets(page);

  await typeInCell(page, "A1", "2026-04-01");
  await typeInCell(page, "B1", "1990-01-01");
  await typeInCell(page, "C1", "=A1-B1");

  // Display strings come from formatter.ts::formatCustom: jdate via
  // toLocaleDateString("en-US", {month:"short",...}); jspan via the
  // ISO-duration → "13239d" rule.
  await expectCellValue(page, "A1", "Apr 1, 2026");
  await expectCellValue(page, "B1", "Jan 1, 1990");
  await expectCellValue(page, "C1", "13239d");
});

test("date and span values survive reload", async ({ page }) => {
  await gotoSheets(page);

  await typeInCell(page, "A1", "2026-04-01");
  await typeInCell(page, "B1", "1990-01-01");
  await typeInCell(page, "C1", "=A1-B1");
  await waitForAutoSave(page);

  await page.reload();

  await expectCellValue(page, "A1", "Apr 1, 2026");
  await expectCellValue(page, "B1", "Jan 1, 1990");
  await expectCellValue(page, "C1", "13239d");
});
