/**
 * [sheet.column.drag-reorder] End-to-end coverage for column drag-
 * reorder. The vitest-browser suite pins the gesture's visual state
 * machine (Grid.colDrag.test.ts); this spec verifies the
 * full-stack behaviour that vitest can't reach: persistence
 * round-trip, cross-client SSE, and end-to-end formula rewrite
 * through the WASM engine + Python recalc.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  gotoSheets,
  typeInCell,
  expectCellValue,
  waitForAutoSave,
} from "./helpers";

function colHeader(page: Page, colIdx: number): Locator {
  return page.locator(".column-header").nth(colIdx);
}

/** Drag a column header by its body (not the resize handle) to the
 *  gap between two target columns. ``leftHalf`` controls which side
 *  of the destination header the drop lands on — left half drops
 *  before the destination col, right half drops after.
 */
async function dragColumn(
  page: Page,
  fromColIdx: number,
  destColIdx: number,
  leftHalf = true,
) {
  const src = await colHeader(page, fromColIdx).boundingBox();
  const dest = await colHeader(page, destColIdx).boundingBox();
  if (!src || !dest) throw new Error("column header not found");
  const srcX = src.x + 10; // away from the right-edge resize handle
  const srcY = src.y + src.height / 2;
  const destX = leftHalf
    ? dest.x + dest.width * 0.25
    : dest.x + dest.width * 0.75;
  const destY = dest.y + dest.height / 2;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  // Two intermediate moves: first to cross the 4px threshold, second
  // to settle at the target gap. Some browsers compress synthetic
  // mouse events without intermediate steps.
  await page.mouse.move(srcX + 8, srcY);
  await page.mouse.move(destX, destY, { steps: 5 });
  await page.mouse.up();
}

async function seedFiveCols(page: Page) {
  await typeInCell(page, "A1", "a");
  await typeInCell(page, "B1", "b");
  await typeInCell(page, "C1", "c");
  await typeInCell(page, "D1", "d");
  await typeInCell(page, "E1", "e");
  await waitForAutoSave(page);
}

// ---------------------------------------------------------------------------

test("drag column D between B and C; layout persists across reload", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFiveCols(page);

  // Drag D (idx 3) onto the left half of C (idx 2) → drop between
  // B and C.
  await dragColumn(page, 3, 2, true);
  await waitForAutoSave(page);

  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "b");
  await expectCellValue(page, "C1", "d");
  await expectCellValue(page, "D1", "c");
  await expectCellValue(page, "E1", "e");

  // Reload — the move must have persisted.
  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "b");
  await expectCellValue(page, "C1", "d");
  await expectCellValue(page, "D1", "c");
  await expectCellValue(page, "E1", "e");
});

test("formula referencing the moved column rewrites end-to-end", async ({
  page,
}) => {
  await gotoSheets(page);
  await typeInCell(page, "A1", "=D1");
  await typeInCell(page, "B1", "1");
  await typeInCell(page, "C1", "2");
  await typeInCell(page, "D1", "42");
  await waitForAutoSave(page);

  // Sanity check the pre-move computed value.
  await expectCellValue(page, "A1", "42");

  await dragColumn(page, 3, 2, true);
  await waitForAutoSave(page);

  // Formula text should follow the data: =D1 → =C1.
  // The cell value at A1 should still be 42 (the cell that was at
  // D1 is now at C1, and A1's formula now references C1).
  await expectCellValue(page, "A1", "42");
  await expectCellValue(page, "C1", "42"); // old D's data
  await expectCellValue(page, "D1", "2"); // old C's data
});

test("drop in place is a no-op (no API roundtrip, layout unchanged)", async ({
  page,
}) => {
  await gotoSheets(page);
  await seedFiveCols(page);

  // mousedown on D, move past threshold then back to source, mouseup
  // on D itself. dest_gap == src_start (3) is server-side no-op AND
  // also caught by the persistence pre-check — no network call fires.
  const src = await colHeader(page, 3).boundingBox();
  if (!src) throw new Error("D header missing");
  const x = src.x + 10;
  const y = src.y + src.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y); // crosses threshold
  await page.mouse.move(x, y); // back to source
  await page.mouse.up();

  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "b");
  await expectCellValue(page, "C1", "c");
  await expectCellValue(page, "D1", "d");
  await expectCellValue(page, "E1", "e");
});

test("multi-column drag moves the whole contiguous block (att ortkjljr)", async ({
  page,
}) => {
  await gotoSheets(page);
  // Seed 6 cols; we'll drag B:D as a block.
  await typeInCell(page, "A1", "a");
  await typeInCell(page, "B1", "b");
  await typeInCell(page, "C1", "c");
  await typeInCell(page, "D1", "d");
  await typeInCell(page, "E1", "e");
  await typeInCell(page, "F1", "f");
  await waitForAutoSave(page);

  // Select B:D via header click + shift-click.
  await colHeader(page, 1).click();
  await colHeader(page, 3).click({ modifiers: ["Shift"] });

  // Drag the C header (idx 2 — middle of the selection) past F to
  // the end of the row. Drop on the right half of F → drop after F.
  const headerC = await colHeader(page, 2).boundingBox();
  const headerF = await colHeader(page, 5).boundingBox();
  if (!headerC || !headerF) throw new Error("missing header");
  await page.mouse.move(headerC.x + 10, headerC.y + headerC.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerC.x + 18, headerC.y + headerC.height / 2);
  await page.mouse.move(
    headerF.x + headerF.width * 0.75,
    headerF.y + headerF.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await waitForAutoSave(page);

  // Block B:D (b, c, d) lands at D:F; old E:F shift left to B:C.
  await expectCellValue(page, "A1", "a");
  await expectCellValue(page, "B1", "e");
  await expectCellValue(page, "C1", "f");
  await expectCellValue(page, "D1", "b");
  await expectCellValue(page, "E1", "c");
  await expectCellValue(page, "F1", "d");
});

test("column move propagates to a second client via SSE", async ({
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
    await typeInCell(pageA, "D1", "d");
    await waitForAutoSave(pageA);

    // Wait for B to see the seeded data via SSE before driving the
    // move from A.
    await expectCellValue(pageB, "A1", "a");
    await expectCellValue(pageB, "B1", "b");
    await expectCellValue(pageB, "C1", "c");
    await expectCellValue(pageB, "D1", "d");

    // Move D between B and C on client A.
    await dragColumn(pageA, 3, 2, true);
    await waitForAutoSave(pageA);

    // Client B mirrors via the columns-moved SSE event.
    await expectCellValue(pageB, "C1", "d");
    await expectCellValue(pageB, "D1", "c");
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
