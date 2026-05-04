// End-to-end tests for the formula-edit surface: auto-widening input,
// signature-help tooltip, merged autocomplete (functions + named
// ranges), and arrow-key ref pointing.
//
// Unit-level coverage for the pure logic lives in
// ``frontend/src/lib/components/__tests__/Cell.signatureHelp.test.ts``.
// These tests stay here because they exercise the full rendered
// DOM — layout, outline, popup placement — which vitest-browser
// can mount but doesn't reliably lay out the way a real viewport
// does.

import { test, expect, type Page } from "@playwright/test";
import { gotoSheets, getCell, selectCell, typeInCell } from "./helpers";

async function openEdit(page: Page, cellId: string) {
  await selectCell(page, cellId);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cell-input")).toBeVisible();
}

async function typeChars(page: Page, value: string) {
  // One press per character so every ``input``/``keyup`` event
  // fires the way a real user types — Playwright's ``type()`` can
  // batch in a way that skips intermediate caret updates.
  for (const ch of value) await page.keyboard.press(ch);
}

test.describe("focus ring", () => {
  test("outlines all four sides of a short edit", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=1+2");

    const outline = await page
      .locator(".formula-edit-wrapper")
      .evaluate((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          style: cs.outlineStyle,
          width: cs.outlineWidth,
          offset: cs.outlineOffset,
        };
      });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBe("2px");
    // Negative offset draws the outline inside the wrapper's box
    // so it doesn't get swallowed by the neighbour's border.
    expect(outline.offset).toBe("-2px");
  });
});

test.describe("auto-widen", () => {
  test("short formula in default column: wrapper hugs content", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=1+2");

    const wrapper = await page.locator(".formula-edit-wrapper").boundingBox();
    const cell = await getCell(page, "D4").boundingBox();
    expect(wrapper).not.toBeNull();
    expect(cell).not.toBeNull();
    // Wrapper sizes to content, not to the column — so for a short
    // formula in a 100px column the wrapper should be noticeably
    // narrower than the column, not pinned to it.
    expect(wrapper!.width).toBeLessThan(cell!.width);
  });

  // Regression: with ``min-width: 100%`` and a user-widened column,
  // the wrapper filled the full column even when the formula was
  // short, producing conspicuous trailing whitespace before the
  // caret. Dropping ``min-width`` lets the edit ring hug the text.
  test("short formula in wide column: no trailing whitespace", async ({
    page,
  }) => {
    await gotoSheets(page);

    // Widen column D by dragging its resize handle ~+150px. The
    // headers are ordered corner, A, B, C, D, ... so the D handle
    // is the 4th ``.resize-handle``.
    const handle = page.locator(".resize-handle").nth(3);
    const hbox = await handle.boundingBox();
    if (hbox) {
      await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
      await page.mouse.down();
      await page.mouse.move(hbox.x + 150, hbox.y + hbox.height / 2);
      await page.mouse.up();
    }
    await page.waitForTimeout(100);

    await openEdit(page, "D4");
    await typeChars(page, "=1+2");

    const wrapper = await page.locator(".formula-edit-wrapper").boundingBox();
    const cell = await getCell(page, "D4").boundingBox();
    // Wrapper should be much narrower than the widened column —
    // i.e. the focus ring hugs the formula rather than stretching
    // across empty space.
    expect(wrapper!.width).toBeLessThan(cell!.width * 0.5);
  });

  // Regression: with an 8px buffer and ``display: flex`` on the
  // overlay, the caret sat visibly far past the last character —
  // noticeable as empty space before the focus ring's right edge.
  // Buffer tightened to 3px; overlay now uses ``line-height``
  // centring, not flex, so inline span layout matches the mirror's
  // measurement.
  test("no visible trailing whitespace between last char and focus ring", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    for (const ch of "=sum(A1,A3,B:B)+") await page.keyboard.press(ch);

    const gap = await page.evaluate(() => {
      const wrap = document.querySelector(
        ".formula-edit-wrapper",
      ) as HTMLElement;
      const overlay = document.querySelector(".formula-overlay") as HTMLElement;
      const lastSpan = overlay.lastElementChild as HTMLElement;
      return (
        wrap.getBoundingClientRect().right -
        lastSpan.getBoundingClientRect().right
      );
    });
    // Accept a few px for outline-offset + slack, but no large gap.
    expect(gap).toBeLessThan(12);
  });

  test("long formula: wrapper grows beyond the column", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=sum(B:B, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)");

    const wrapper = await page.locator(".formula-edit-wrapper").boundingBox();
    const cell = await getCell(page, "D4").boundingBox();
    expect(wrapper!.width).toBeGreaterThan(cell!.width * 2);
  });

  test("very long formula: wrapper caps at 80vw", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    // ~220 chars, well past any viewport.
    await typeChars(page, "=" + "1234567890,".repeat(20));

    const wrapper = await page.locator(".formula-edit-wrapper").boundingBox();
    const viewport = await page.evaluate(() => window.innerWidth);
    expect(wrapper!.width).toBeLessThanOrEqual(viewport * 0.8 + 1);
  });
});

test.describe("signature help", () => {
  test("appears after `=NAME(`", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SUM(");

    const popup = page.locator(".signature-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("SUM");
    await expect(popup).toContainText("value1");
  });

  test("bolds the active arg after `,`", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=ROUND(3.14,");

    const active = page.locator(".signature-popup .active");
    await expect(active).toContainText("decimals");
  });

  test("closes when cursor leaves the call", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=ROUND(3.14, 2)");

    await expect(page.locator(".signature-popup")).toHaveCount(0);
  });

  test("unknown function name shows nothing", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=NOTAFN(");

    await expect(page.locator(".signature-popup")).toHaveCount(0);
  });

  test("alias resolves to canonical name", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=AVG(");

    await expect(page.locator(".signature-popup")).toContainText("AVERAGE");
  });

  test("anchors above the input at its left edge", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=ROUND(3.14,");

    const popup = await page.locator(".signature-popup").boundingBox();
    const input = await page.locator(".cell-input").boundingBox();
    expect(popup!.y + popup!.height).toBeLessThanOrEqual(input!.y + 1);
    expect(Math.abs(popup!.x - input!.x)).toBeLessThan(10);
  });
});

test.describe("autocomplete", () => {
  test("function prefix shows matching functions", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SU");

    const items = page.locator(".autocomplete-item");
    await expect(items.first()).toContainText("SUM");
  });

  test("Enter inserts NAME( and opens sig help", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SU");
    await page.keyboard.press("Enter");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=SUM(");
    await expect(page.locator(".signature-popup")).toBeVisible();
  });
});

test.describe("arrow-key ref pointing", () => {
  test("ArrowLeft after `=` inserts a cell reference", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=");
    await page.keyboard.press("ArrowLeft");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    // From D4, ArrowLeft points at C4.
    expect(value).toBe("=C4");
  });

  test("second ArrowUp after `+` adds another ref", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=");
    await page.keyboard.press("ArrowLeft");
    await typeChars(page, "+");
    await page.keyboard.press("ArrowUp");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=C4+D3");
  });

  test("ArrowLeft inside a function name does NOT insert a ref", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SUM");
    await page.keyboard.press("ArrowLeft");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=SUM");
  });

  // Regression: caret in the middle of a number literal moved
  // through text normally; an earlier version of ``canInsertCellRef``
  // didn't look at the char after the caret and would insert refs
  // here.
  test("Arrow in the middle of a number just moves the caret", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=12345");
    // Caret at position 3 (between '2' and '3').
    await page.locator(".cell-input").evaluate((el) => {
      (el as HTMLInputElement).setSelectionRange(3, 3);
    });
    await page.keyboard.press("ArrowLeft");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=12345");
  });

  // Regression: Cmd+ArrowLeft (caret to start of line) followed by
  // Cmd+ArrowRight (caret to end) used to prepend a ref, turning
  // ``=ROUND(3.14)`` into ``E4=ROUND(3.14)``. canInsertCellRef
  // now rejects cursor=0 — the caret there sits *before* the
  // leading `=`.
  test("Cmd+ArrowRight from start-of-line does NOT prepend a ref", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=ROUND(3.14,2)");

    await page.keyboard.press("Meta+ArrowLeft");
    await page.keyboard.press("Meta+ArrowRight");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=ROUND(3.14,2)");
  });

  // Regression: pointing mode moves the caret programmatically via
  // setSelectionRange, which doesn't fire keyup/click. Signature
  // help used to go stale after an arrow-inserted ref. The pointing
  // handler now calls updateFunctionHelp in the tick callback.
  test("pointing-mode insertion refreshes signature help", async ({ page }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SUM(");
    await expect(page.locator(".signature-popup")).toBeVisible();

    await page.keyboard.press("ArrowLeft");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=SUM(C4");
    // Caret is at 7, still inside SUM's arg list — help must stay
    // visible (not dismiss).
    await expect(page.locator(".signature-popup")).toBeVisible();
    await expect(page.locator(".signature-popup")).toContainText("SUM");
  });

  // Regression: ``=SUM(1, 2)`` with caret right after the comma used
  // to insert a ref in the whitespace between args, breaking the
  // formula into ``=SUM(1,C4 2)``. The heuristic now skips whitespace
  // when checking the next meaningful char.
  test("Arrow between `,` and ` value` does NOT shatter the formula", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SUM(1, 2)");
    // Caret at position 7: between ',' and the space.
    await page.locator(".cell-input").evaluate((el) => {
      (el as HTMLInputElement).setSelectionRange(7, 7);
    });
    await page.keyboard.press("ArrowLeft");

    const value = await page
      .locator(".cell-input")
      .evaluate((el) => (el as HTMLInputElement).value);
    expect(value).toBe("=SUM(1, 2)");
  });
});

test.describe("escape", () => {
  test("single Escape with sig-help open exits edit + discards", async ({
    page,
  }) => {
    await gotoSheets(page);
    await typeInCell(page, "D4", "hello");

    await openEdit(page, "D4");
    // Select-all so typing replaces the pre-existing value instead
    // of appending.
    await page.keyboard.press("Meta+a");
    await typeChars(page, "=SUM(1,2");
    await expect(page.locator(".signature-popup")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator(".cell-input")).toHaveCount(0);
    await expect(page.locator(".signature-popup")).toHaveCount(0);
    await expect(page.locator('[data-cell-id="D4"] .cell-value')).toHaveText(
      "hello",
    );
  });

  test("Escape with autocomplete open closes popup, stays in edit", async ({
    page,
  }) => {
    await gotoSheets(page);
    await openEdit(page, "D4");
    await typeChars(page, "=SU");
    await expect(page.locator(".autocomplete-popup")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator(".autocomplete-popup")).toHaveCount(0);
    await expect(page.locator(".cell-input")).toBeVisible();
  });
});
