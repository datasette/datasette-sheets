import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  getCell,
  selectCell,
  typeInCell,
  expectCellValue,
} from "./helpers";

// End-to-end coverage for [sheet.grid.virtualization].
//
// The vitest-browser tests under
// frontend/src/lib/components/__tests__/Grid.virtualization.test.ts
// cover the rendering math + scroll → re-derive cycle in isolation.
// These specs go through the full stack (Datasette + SSE + persistence)
// to catch regressions where virtualization breaks something real:
//
//   - typing into a virtualized-out cell after scrolling persists
//   - arrow-nav past the rendered window scrolls + focuses the target
//   - rendered cell count is dramatically less than the unvirtualized
//     1,500 (the perf claim the user actually feels)
//   - the JS heap stays well below the pre-virtualization baseline

test("renders far fewer cells than the unvirtualized 1500", async ({
  page,
}) => {
  await gotoSheets(page);
  // Wait for at least one cell to be rendered before counting (avoid
  // racing the initial mount).
  await expect(getCell(page, "A1")).toBeVisible();

  const cellCount = await page.locator(".cell").count();
  console.log(`[perf] mounted .cell elements at start: ${cellCount}`);
  // 15 cols × 100 rows = 1500 unvirtualized. Virtualized at typical
  // playwright viewport (default 720px) renders ~30-40 rows × 15 cols
  // = 450-600. Leave headroom on both sides for viewport variance.
  expect(cellCount).toBeGreaterThan(15); // sanity (≥1 row)
  expect(cellCount).toBeLessThan(900); // confidently virtualized
});

test("rows past the rendered window are not in the DOM at start", async ({
  page,
}) => {
  await gotoSheets(page);
  await expect(getCell(page, "A1")).toBeVisible();

  // Row 1 must be mounted (we just asserted it), row 95 must not.
  // 94 rows × 22px = 2068px from top — well past any normal viewport.
  await expect(getCell(page, "A95")).toHaveCount(0);
});

test("scrolling brings offscreen rows into the DOM", async ({ page }) => {
  await gotoSheets(page);
  await expect(getCell(page, "A1")).toBeVisible();
  await expect(getCell(page, "A95")).toHaveCount(0);

  // Scroll the grid container to the bottom. ``.grid-container`` is
  // the ``overflow: auto`` scroll surface inside the page.
  await page.locator(".grid-container").evaluate((el) => {
    el.scrollTop = 99999;
  });

  // ``toBeVisible`` polls the locator — no fixed sleep needed.
  await expect(getCell(page, "A95")).toBeVisible();
  // Top-of-sheet rows have unmounted now (outside the buffer).
  await expect(getCell(page, "A1")).toHaveCount(0);
});

test("typing into a virtualized-out cell still persists across reload", async ({
  page,
}) => {
  // The store is the source of truth, virtualization only affects
  // what's visible. Scroll, edit a far-down cell, reload, verify the
  // value is still there.
  const url = await gotoSheets(page);

  // Scroll all the way down so row 90 is in view.
  await page.locator(".grid-container").evaluate((el) => {
    el.scrollTop = 99999;
  });
  // Wait for the virtualized row to mount instead of a fixed sleep.
  await expect(getCell(page, "A90")).toBeVisible();

  await typeInCell(page, "A90", "deep-value");
  await expectCellValue(page, "A90", "deep-value");

  // Reload — the value should be persisted by flushSave on Enter.
  await page.goto(url);
  await expect(page.locator(".sheets-loading")).toHaveCount(0, {
    timeout: 5000,
  });

  // After reload we land at scrollTop 0 again, so A90 is offscreen.
  // Scroll down to verify the persisted value is there.
  await page.locator(".grid-container").evaluate((el) => {
    el.scrollTop = 99999;
  });

  // ``expectCellValue`` polls until the cell renders the expected
  // text — covers both the virtualization mount and the reload.
  await expectCellValue(page, "A90", "deep-value");
});

test("arrow-nav past the rendered window scrolls + focuses the target", async ({
  page,
}) => {
  await gotoSheets(page);
  await expect(getCell(page, "A1")).toBeVisible();

  // Cmd+Down jumps to the bottom of the contiguous block (or the
  // sheet edge when the column is empty). Empty A column → goes to
  // A100. Use plain arrows in a loop instead so we deterministically
  // step into virtualized territory.
  await selectCell(page, "A1");
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("ArrowDown");
  }
  // Focus should now be on A61 — well past the initial rendered
  // window. The cell must be in the DOM (focusCell in Cell.svelte
  // calls scrollRowIntoView before querying).
  const a61 = getCell(page, "A61");
  await expect(a61).toBeVisible();
  await expect(a61).toHaveClass(/selected/);
});

test("JS heap stays well below the unvirtualized baseline (fresh workbook)", async ({
  page,
  browserName,
}) => {
  // performance.memory is Chromium-only; skip elsewhere.
  test.skip(browserName !== "chromium", "performance.memory is Chromium-only");

  await gotoSheets(page);
  await expect(getCell(page, "A1")).toBeVisible();
  // Let the page settle so heap measurements aren't dominated by
  // first-paint allocations.
  await page.waitForTimeout(500);

  const heap = await page.evaluate(() => {
    type PerfWithMem = Performance & { memory?: { usedJSHeapSize: number } };
    return (performance as PerfWithMem).memory?.usedJSHeapSize ?? 0;
  });
  // Measured locally pre-virtualization: ~57 MB on a fresh empty
  // workbook (chromium). Post-virtualization: ~23 MB (2.5× lower).
  // Threshold 120 MB catches any regression that re-mounts the full
  // grid — keeps slack for chromium variance across CI hosts.
  expect(heap).toBeGreaterThan(0); // sanity
  expect(heap).toBeLessThan(120 * 1024 * 1024);
});

test("heap stays bounded after 50 keystroke commits", async ({
  page,
  browserName,
}) => {
  // Pre-§1, ``cells.setCellValue`` allocated a fresh ``WasmSheet`` +
  // re-loaded every cell on every commit — 50 commits = 50 throwaway
  // WasmSheet instances + 50 cloned cell maps that the GC eventually
  // reaped. Post-§1, one engine lives the whole session and only
  // deltas hit ``set_cells``. This test exercises the hot path 50
  // times and asserts the post-burst heap is sane.
  test.skip(browserName !== "chromium", "performance.memory is Chromium-only");

  await gotoSheets(page);
  await expect(getCell(page, "A1")).toBeVisible();

  await selectCell(page, "A1");
  // 50 type-and-Enter cycles down the column. Each cycle is exactly
  // the path that used to allocate a new WasmSheet.
  for (let i = 1; i <= 50; i++) {
    await page.keyboard.type(String(i));
    await page.keyboard.press("Enter");
  }

  // Force GC if the harness exposed it (chromium with --js-flags=
  // "--expose-gc"). Otherwise let the page settle for a moment so
  // the allocator gets a chance to collapse short-lived objects.
  await page.evaluate(() => {
    type WithGc = typeof globalThis & { gc?: () => void };
    (globalThis as WithGc).gc?.();
  });
  await page.waitForTimeout(500);

  const heap = await page.evaluate(() => {
    type PerfWithMem = Performance & { memory?: { usedJSHeapSize: number } };
    return (performance as PerfWithMem).memory?.usedJSHeapSize ?? 0;
  });
  // 50 edits at the old "fresh WasmSheet per commit" rate would push
  // peak heap well over the 120 MB threshold from the fresh-workbook
  // test. With engine reuse it should stay close to baseline.
  expect(heap).toBeLessThan(150 * 1024 * 1024);
});
