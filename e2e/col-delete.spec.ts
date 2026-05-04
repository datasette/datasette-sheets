import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  selectCell,
  waitForAutoSave,
} from "./helpers";

/** Nth (0-based) column header — nth(0) is "A", nth(1) is "B", etc. */
function colHeader(page: Page, colIdx: number): Locator {
  return page.locator(".column-header").nth(colIdx);
}

async function openColMenu(page: Page, colIdx: number) {
  await colHeader(page, colIdx).click({ button: "right" });
  await expect(page.locator(".row-menu")).toBeVisible();
}

async function dragSelectCols(page: Page, startCol: number, endCol: number) {
  const start = await colHeader(page, startCol).boundingBox();
  const end = await colHeader(page, endCol).boundingBox();
  if (!start || !end) throw new Error("column header not found");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
}

/** Seed columns A..D with distinct values in row 1. */
async function seedFourCols(page: Page) {
  await typeInCell(page, "A1", "a");
  await typeInCell(page, "B1", "b");
  await typeInCell(page, "C1", "c");
  await typeInCell(page, "D1", "d");
  await waitForAutoSave(page);
}

// ---------------------------------------------------------------------------

test("right-click a column header and delete the single column", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourCols(page);

  page.once("dialog", (d) => d.accept());

  // Column B is index 1.
  await openColMenu(page, 1);

  const menuItem = page.locator(".row-menu-item.danger");
  await expect(menuItem).toHaveText("Delete column B");
  await menuItem.click();

  // B removed; C/D shift left to B/C; D is now empty.
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "c");
  await expectCellValue(page, "C1", "d");
  await expect(page.locator('[data-cell-id="D1"] .cell-value')).toHaveText("");

  // Reload — the shift must have persisted.
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "c");
  await expectCellValue(page, "C1", "d");
});

test("cancelling the confirm leaves the sheet untouched", async ({ page }) => {
  await gotoSheets(page);
  await seedFourCols(page);

  page.once("dialog", (d) => d.dismiss());

  await openColMenu(page, 1);
  await page.locator(".row-menu-item.danger").click();

  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "b");
  await expectCellValue(page, "C1", "c");
  await expectCellValue(page, "D1", "d");
});

test("drag-select multiple column headers, then delete the range", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourCols(page);

  // Drag from B to C.
  await dragSelectCols(page, 1, 2);

  await expect(colHeader(page, 1)).toHaveClass(/header-selected/);
  await expect(colHeader(page, 2)).toHaveClass(/header-selected/);

  page.once("dialog", (d) => d.accept());
  await openColMenu(page, 1);
  const menuItem = page.locator(".row-menu-item.danger");
  await expect(menuItem).toHaveText("Delete 2 columns");
  await menuItem.click();

  // Only a + d survive. d shifts to B.
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "d");
  await expect(page.locator('[data-cell-id="C1"] .cell-value')).toHaveText("");
});

test("shift-click extends the column selection before delete", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourCols(page);

  // Click B, then shift-click D → B, C, D all selected.
  await colHeader(page, 1).click();
  await colHeader(page, 3).click({ modifiers: ["Shift"] });

  for (const c of [1, 2, 3]) {
    await expect(colHeader(page, c)).toHaveClass(/header-selected/);
  }

  page.once("dialog", (d) => d.accept());
  await openColMenu(page, 2);
  await expect(page.locator(".row-menu-item.danger")).toHaveText(
    "Delete 3 columns",
  );
  await page.locator(".row-menu-item.danger").click();

  // Only a survives.
  await expectCellValue(page, "A1", "a");
  await expect(page.locator('[data-cell-id="B1"] .cell-value')).toHaveText("");
});

test("right-click on a column outside the current selection targets just that column", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFourCols(page);

  // Select A+B, then right-click C — menu should narrow to C.
  await colHeader(page, 0).click();
  await colHeader(page, 1).click({ modifiers: ["Shift"] });

  page.once("dialog", (d) => d.accept());
  await openColMenu(page, 2);
  await expect(page.locator(".row-menu-item.danger")).toHaveText(
    "Delete column C",
  );
  await page.locator(".row-menu-item.danger").click();

  // C removed; D shifts left to C.
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "b");
  await expectCellValue(page, "C1", "d");
});

test("column delete propagates to a second client via SSE", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    const url = await gotoSheets(pageA);
    await pageB.goto(url);
    await expect(pageB.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

    await typeInCell(pageA, "A1", "a");
    await typeInCell(pageA, "B1", "b");
    await typeInCell(pageA, "C1", "c");
    await waitForAutoSave(pageA);

    await expectCellValue(pageB, "A1", "a");
    await expectCellValue(pageB, "B1", "b");
    await expectCellValue(pageB, "C1", "c");

    pageA.once("dialog", (d) => d.accept());
    await openColMenu(pageA, 1);
    await pageA.locator(".row-menu-item.danger").click();

    // Client B sees the shift via `columns-deleted` SSE.
    await expectCellValue(pageB, "A1", "a");
    await expectCellValue(pageB, "B1", "c");
    await expect(pageB.locator('[data-cell-id="C1"] .cell-value')).toHaveText(
      "",
    );
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("outside-click dismisses the column menu", async ({ page }) => {
  await gotoSheets(page);
  await seedFourCols(page);

  await openColMenu(page, 1);
  await expect(page.locator(".row-menu")).toBeVisible();

  await selectCell(page, "C5");
  await expect(page.locator(".row-menu")).toHaveCount(0);
});
