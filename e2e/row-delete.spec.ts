import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  selectCell,
  waitForAutoSave,
} from "./helpers";

/** Nth (1-based display) row header. */
function rowHeader(page: Page, row: number): Locator {
  return page.locator(".row-header").nth(row - 1);
}

async function openRowMenu(page: Page, row: number) {
  await rowHeader(page, row).click({ button: "right" });
  await expect(page.locator(".row-menu")).toBeVisible();
}

async function dragSelectRows(page: Page, startRow: number, endRow: number) {
  const start = await rowHeader(page, startRow).boundingBox();
  const end = await rowHeader(page, endRow).boundingBox();
  if (!start || !end) throw new Error("row header not found");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
}

/** Seed rows 1..4 with distinct values in column A so we can tell them apart. */
async function seedFourRows(page: Page) {
  await typeInCell(page, "A1", "r1");
  await typeInCell(page, "A2", "r2");
  await typeInCell(page, "A3", "r3");
  await typeInCell(page, "A4", "r4");
  await waitForAutoSave(page);
}

// ---------------------------------------------------------------------------

test("right-click a row header and delete the single row", async ({ page }) => {
  await gotoSheets(page);
  await seedFourRows(page);

  // Accept the confirm dialog when it appears.
  page.once("dialog", (d) => d.accept());

  await openRowMenu(page, 2);

  // Menu should read "Delete row 2" for a single-row selection.
  const menuItem = page.locator(".row-menu-item.danger");
  await expect(menuItem).toHaveText("Delete row 2");
  await menuItem.click();

  // Row 2 removed; rows 3/4 shift up to 2/3; row 4 is now empty.
  await expectCellValue(page, "A1", "r1");
  await expectCellValue(page, "A2", "r3");
  await expectCellValue(page, "A3", "r4");
  await expect(page.locator('[data-cell-id="A4"] .cell-value')).toHaveText("");

  // Reload — the shift must have persisted server-side.
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });
  await expectCellValue(page, "A1", "r1");
  await expectCellValue(page, "A2", "r3");
  await expectCellValue(page, "A3", "r4");
});

test("cancelling the confirm leaves the sheet untouched", async ({ page }) => {
  await gotoSheets(page);
  await seedFourRows(page);

  page.once("dialog", (d) => d.dismiss());

  await openRowMenu(page, 2);
  await page.locator(".row-menu-item.danger").click();

  // Nothing changed.
  await expectCellValue(page, "A1", "r1");
  await expectCellValue(page, "A2", "r2");
  await expectCellValue(page, "A3", "r3");
  await expectCellValue(page, "A4", "r4");
});

test("drag-select multiple row headers, then delete the range", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourRows(page);

  // Drag from row 2 down to row 3 to select both.
  await dragSelectRows(page, 2, 3);

  // Both headers should show as selected.
  await expect(rowHeader(page, 2)).toHaveClass(/header-selected/);
  await expect(rowHeader(page, 3)).toHaveClass(/header-selected/);

  page.once("dialog", (d) => d.accept());
  await openRowMenu(page, 2);
  const menuItem = page.locator(".row-menu-item.danger");
  await expect(menuItem).toHaveText("Delete 2 rows");
  await menuItem.click();

  // Only r1 and r4 survive; r4 is now at row 2.
  await expectCellValue(page, "A1", "r1");
  await expectCellValue(page, "A2", "r4");
  await expect(page.locator('[data-cell-id="A3"] .cell-value')).toHaveText("");
});

test("shift-click extends the row selection before delete", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourRows(page);

  // Click row 2 to anchor, then shift-click row 4 to extend to [2, 3, 4].
  await rowHeader(page, 2).click();
  await rowHeader(page, 4).click({ modifiers: ["Shift"] });

  for (const r of [2, 3, 4]) {
    await expect(rowHeader(page, r)).toHaveClass(/header-selected/);
  }

  page.once("dialog", (d) => d.accept());
  await openRowMenu(page, 3);
  await expect(page.locator(".row-menu-item.danger")).toHaveText(
    "Delete 3 rows",
  );
  await page.locator(".row-menu-item.danger").click();

  // Only r1 survives.
  await expectCellValue(page, "A1", "r1");
  await expect(page.locator('[data-cell-id="A2"] .cell-value')).toHaveText("");
});

test("right-click on a row outside the current selection targets just that row", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourRows(page);

  // Set up a multi-row selection on rows 1-2, then right-click row 3 — the
  // menu should narrow to row 3 (not act on rows 1+2).
  await rowHeader(page, 1).click();
  await rowHeader(page, 2).click({ modifiers: ["Shift"] });

  page.once("dialog", (d) => d.accept());
  await openRowMenu(page, 3);
  await expect(page.locator(".row-menu-item.danger")).toHaveText(
    "Delete row 3",
  );
  await page.locator(".row-menu-item.danger").click();

  // r3 gone; r4 shifts up to row 3.
  await expectCellValue(page, "A1", "r1");
  await expectCellValue(page, "A2", "r2");
  await expectCellValue(page, "A3", "r4");
  await expect(page.locator('[data-cell-id="A4"] .cell-value')).toHaveText("");
});

test("row delete propagates to a second client via SSE", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // One workbook, both browsers open it.
    const url = await gotoSheets(pageA);
    await pageB.goto(url);
    await expect(pageB.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

    // Seed from client A.
    await typeInCell(pageA, "A1", "r1");
    await typeInCell(pageA, "A2", "r2");
    await typeInCell(pageA, "A3", "r3");
    await waitForAutoSave(pageA);

    // Client B should see the seed propagate (via SSE cell-update).
    await expectCellValue(pageB, "A1", "r1");
    await expectCellValue(pageB, "A2", "r2");
    await expectCellValue(pageB, "A3", "r3");

    // Delete row 2 from A.
    pageA.once("dialog", (d) => d.accept());
    await openRowMenu(pageA, 2);
    await pageA.locator(".row-menu-item.danger").click();

    // B receives `rows-deleted` over SSE and applies the same shift locally.
    await expectCellValue(pageB, "A1", "r1");
    await expectCellValue(pageB, "A2", "r3");
    await expect(pageB.locator('[data-cell-id="A3"] .cell-value')).toHaveText(
      "",
    );
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("a right-click outside the row menu dismisses it", async ({ page }) => {
  await gotoSheets(page);
  await seedFourRows(page);

  await openRowMenu(page, 2);
  await expect(page.locator(".row-menu")).toBeVisible();

  // Click somewhere else — the svelte:window click handler should close it.
  await selectCell(page, "C5");
  await expect(page.locator(".row-menu")).toHaveCount(0);
});
