/**
 * [sheet.row.drag-reorder] End-to-end coverage for row drag-
 * reorder. The vitest-browser suite pins the gesture's visual
 * state machine (Grid.rowDrag.test.ts); this spec verifies the
 * full-stack behaviour: persistence round-trip, cross-client
 * SSE, and end-to-end formula rewrite through the WASM engine
 * + Python recalc.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  waitForAutoSave,
} from "./helpers";

/** Get the row header at the given 0-based row index (display
 *  row 1 = .row-header.nth(0)). */
function rowHeader(page: Page, rowIdx: number): Locator {
  return page.locator(".row-header").nth(rowIdx);
}

/** Drag a row header by its body to the gap above/below another
 *  row. ``topHalf`` controls which side of the destination header
 *  the drop lands on — top half drops above the destination row,
 *  bottom half drops after.
 */
async function dragRow(
  page: Page,
  fromRowIdx: number,
  destRowIdx: number,
  topHalf = true,
) {
  const src = await rowHeader(page, fromRowIdx).boundingBox();
  const dest = await rowHeader(page, destRowIdx).boundingBox();
  if (!src || !dest) throw new Error("row header not found");
  const srcX = src.x + src.width / 2;
  const srcY = src.y + 5;
  const destX = dest.x + dest.width / 2;
  const destY = topHalf
    ? dest.y + dest.height * 0.25
    : dest.y + dest.height * 0.75;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  // Two intermediate moves: cross threshold then settle at target.
  await page.mouse.move(srcX, srcY + 8);
  await page.mouse.move(destX, destY, { steps: 5 });
  await page.mouse.up();
}

async function seedFiveRows(page: Page) {
  await typeInCell(page, "A1", "a");
  await typeInCell(page, "A2", "b");
  await typeInCell(page, "A3", "c");
  await typeInCell(page, "A4", "d");
  await typeInCell(page, "A5", "e");
  await waitForAutoSave(page);
}

// ---------------------------------------------------------------------------

test("drag row 4 above row 3; layout persists across reload", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFiveRows(page);

  // Drag row 4 (idx 3) onto the top half of row 3 (idx 2) → drop
  // between row 2 and row 3.
  await dragRow(page, 3, 2, true);
  await waitForAutoSave(page);

  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "A2", "b");
  await expectCellValue(page, "A3", "d");
  await expectCellValue(page, "A4", "c");
  await expectCellValue(page, "A5", "e");

  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "A2", "b");
  await expectCellValue(page, "A3", "d");
  await expectCellValue(page, "A4", "c");
  await expectCellValue(page, "A5", "e");
});

test("formula referencing the moved row rewrites end-to-end", async ({
  page,
}) => {
  await gotoSheets(page);
  await typeInCell(page, "B1", "=A4");
  await typeInCell(page, "A2", "1");
  await typeInCell(page, "A3", "2");
  await typeInCell(page, "A4", "42");
  await waitForAutoSave(page);

  await expectCellValue(page, "B1", "42");

  await dragRow(page, 3, 2, true);
  await waitForAutoSave(page);

  // forward(3) = 2 → B1's formula becomes =A3.
  // The data 42 (was at A4) lives at A3 now.
  await expectCellValue(page, "B1", "42");
  await expectCellValue(page, "A3", "42");
  await expectCellValue(page, "A4", "2"); // old A3
});

test("drop in place is a no-op (layout unchanged)", async ({ page }) => {
  await gotoSheets(page);
  await seedFiveRows(page);

  const src = await rowHeader(page, 3).boundingBox();
  if (!src) throw new Error("row 4 header missing");
  const x = src.x + 10;
  const y = src.y + src.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8); // crosses threshold
  await page.mouse.move(x, y); // back to source
  await page.mouse.up();

  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "A2", "b");
  await expectCellValue(page, "A3", "c");
  await expectCellValue(page, "A4", "d");
  await expectCellValue(page, "A5", "e");
});

test("multi-row drag moves the whole contiguous block (att 2h4a51db)", async ({
  page,
}) => {
  await gotoSheets(page);
  // 6 rows in column A.
  await typeInCell(page, "A1", "r1");
  await typeInCell(page, "A2", "r2");
  await typeInCell(page, "A3", "r3");
  await typeInCell(page, "A4", "r4");
  await typeInCell(page, "A5", "r5");
  await typeInCell(page, "A6", "r6");
  await waitForAutoSave(page);

  // Select rows 2..4 (idx 1..3) via header click + shift-click.
  await rowHeader(page, 1).click();
  await rowHeader(page, 3).click({ modifiers: ["Shift"] });

  // Drag row 3 (middle of selection) past row 6 — drop on the
  // bottom half of row 6 → drop after the last row.
  const src = await rowHeader(page, 2).boundingBox();
  const dest = await rowHeader(page, 5).boundingBox();
  if (!src || !dest) throw new Error("missing row header");
  await page.mouse.move(src.x + src.width / 2, src.y + 5);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2, src.y + 13);
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height * 0.75, {
    steps: 5,
  });
  await page.mouse.up();
  await waitForAutoSave(page);

  // Block r2:r4 lands at rows 4..6; old r5,r6 shift up to 2..3.
  await expectCellValue(page, "A1", "r1");
  await expectCellValue(page, "A2", "r5");
  await expectCellValue(page, "A3", "r6");
  await expectCellValue(page, "A4", "r2");
  await expectCellValue(page, "A5", "r3");
  await expectCellValue(page, "A6", "r4");
});

test("row move propagates to a second client via SSE", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    const url = await gotoSheets(pageA);
    await pageB.goto(url);
    await expect(pageB.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

    await typeInCell(pageA, "A1", "a");
    await typeInCell(pageA, "A2", "b");
    await typeInCell(pageA, "A3", "c");
    await typeInCell(pageA, "A4", "d");
    await waitForAutoSave(pageA);

    await expectCellValue(pageB, "A1", "a");
    await expectCellValue(pageB, "A2", "b");
    await expectCellValue(pageB, "A3", "c");
    await expectCellValue(pageB, "A4", "d");

    // Move row 4 above row 3 on client A.
    await dragRow(pageA, 3, 2, true);
    await waitForAutoSave(pageA);

    // Client B mirrors via the rows-moved SSE event.
    await expectCellValue(pageB, "A3", "d");
    await expectCellValue(pageB, "A4", "c");
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
