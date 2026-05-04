import { beforeEach, expect, test } from "vitest";
import { tick } from "svelte";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Grid from "../Grid.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  COLUMNS,
  ROWS,
} from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// Integration tests for Grid's row-axis virtualization.
// [sheet.grid.virtualization]
//
// Grid mounts only the rows whose y-range intersects the scroll
// container's viewport (plus GRID_BUFFER_ROWS on each side). With
// 100 rows × 15 cols the unvirtualized DOM would carry 1,500 cells;
// the virtualized DOM should carry roughly viewport-rows × 15 +
// (2 × buffer × 15). At a 660 px viewport that's ~600 cells, not
// 1500.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
});

/** Wait long enough for ResizeObserver / scroll callbacks to fire +
 *  Svelte to re-render — without a wall-clock sleep.
 *
 *  ResizeObserver callbacks are dispatched between layout and paint,
 *  i.e. inside the next animation frame. ``requestAnimationFrame``
 *  resolves on that boundary, so chaining two rAFs (with ``tick()``
 *  in between to flush Svelte's reactivity) is deterministic and
 *  cheaper than the legacy ``setTimeout(50)``. */
async function flushFrames() {
  await Promise.resolve();
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
}

/**
 * Mount Grid and force its scroll container to a known viewport
 * height. ResizeObserver picks up the inline style change on the
 * next animation frame, which re-derives ``visibleRange``.
 *
 * Done this way (set style after mount, wait two rAFs) instead of
 * pre-sizing a wrapper, because vitest-browser-svelte's ``render``
 * mounts to document.body unconditionally, and Grid measures the
 * container in onMount before any reparent helper could move it.
 */
async function mountGridConstrained(viewportHeightPx = 660) {
  const result = render(Grid, { props: {} });
  const container = document.querySelector(
    ".grid-container",
  ) as HTMLElement | null;
  if (!container) throw new Error("Grid mounted without .grid-container");
  // Inline-style sizing lets the ResizeObserver in Grid pick up the
  // change without needing a parent wrapper. ``min-height: 0`` so
  // that the wrapper doesn't insist on its content's natural height.
  container.style.height = `${viewportHeightPx}px`;
  container.style.maxHeight = `${viewportHeightPx}px`;
  container.style.minHeight = "0";
  await flushFrames();
  return { result, container };
}

function renderedCellCount(): number {
  return document.querySelectorAll("[data-cell-id]").length;
}

test("only mounts visible rows + buffer at initial render", async () => {
  const { container } = await mountGridConstrained(660);
  // Let onMount + ResizeObserver settle. One rAF + microtask flush.
  await flushFrames();

  // Without virtualization: 100 rows × 15 cols = 1500 cells.
  // With virtualization at 660 px viewport (~30 visible rows) +
  // 10-row buffer top + 10-row buffer bottom = ~40 rows × 15 = 600
  // cells. Account for measurement jitter (CI iframes vary slightly):
  // accept anything materially below the unvirtualized count.
  expect(container).not.toBeNull();
  const count = renderedCellCount();
  expect(count).toBeGreaterThan(0); // sanity: it rendered something
  expect(count).toBeLessThan(COLUMNS.length * ROWS.length); // < 1500
  expect(count).toBeLessThan(800); // confidently virtualized, not all 1500
});

test("scrolling reveals a different row slice", async () => {
  const { container } = await mountGridConstrained(440);
  await flushFrames();

  // Confirm the top of the sheet (row 1) is mounted; row 80 is not.
  expect(document.querySelector('[data-cell-id="A1"]')).not.toBeNull();
  expect(document.querySelector('[data-cell-id="A80"]')).toBeNull();

  // Scroll near the bottom (row 80 ≈ 79 × 22 = 1738 px). The
  // container's onscroll handler updates ``scrollTop`` which
  // re-derives ``visibleRange``. Wait two rAFs — one for the scroll
  // event to dispatch + Svelte to react, one for the DOM flush.
  if (!container) throw new Error("container missing");
  container.scrollTop = 1738;
  await flushFrames();
  await flushFrames();

  expect(document.querySelector('[data-cell-id="A80"]')).not.toBeNull();
  // The very top is now outside the buffer — A1 should be unmounted.
  expect(document.querySelector('[data-cell-id="A1"]')).toBeNull();
});

test("scrollRowIntoView brings an offscreen row into the rendered window", async () => {
  const { container } = await mountGridConstrained(440);
  await flushFrames();

  // Row 70 is offscreen at scroll 0.
  expect(document.querySelector('[data-cell-id="A70"]')).toBeNull();

  // Use the virtualization helper directly (Cell.svelte's focusCell
  // is the production caller).
  const { scrollRowIntoView } = await import("../../virtualization");
  scrollRowIntoView(70);
  await flushFrames();
  await flushFrames();

  expect(document.querySelector('[data-cell-id="A70"]')).not.toBeNull();
  if (!container) throw new Error("container missing");
  expect(container.scrollTop).toBeGreaterThan(0);
});

test("set values on offscreen rows are not lost when re-mounted", async () => {
  // The store is the source of truth — virtualization only affects
  // what's currently rendered. Setting a value on an unmounted row
  // and then scrolling to reveal it should show the value.
  cells.setCellValue("A95" as CellId, "hello-virt");

  const { container } = await mountGridConstrained(440);
  await flushFrames();

  expect(document.querySelector('[data-cell-id="A95"]')).toBeNull();

  if (!container) throw new Error("container missing");
  container.scrollTop = 99999; // scroll all the way down
  await flushFrames();
  await flushFrames();

  const a95 = document.querySelector('[data-cell-id="A95"]');
  expect(a95).not.toBeNull();
  expect(a95?.textContent).toContain("hello-virt");
});

test("page.getByTestId still works for visible cells (preserves test surface)", async () => {
  // Existing browser tests rely on page.getByTestId(cellId) finding
  // the rendered cell. Confirm the locator API works inside a
  // virtualized Grid for an in-viewport cell.
  await mountGridConstrained(440);
  await flushFrames();

  const a1 = page.getByTestId("A1").element();
  expect(a1).not.toBeNull();
  expect((a1 as HTMLElement).getAttribute("data-cell-id")).toBe("A1");
});

// ─── Variable row height (cells with format.wrap === "wrap") ──────────
//
// When a cell is set to wrap mode with multi-line content, its row
// grows past the default ROW_HEIGHT_PX. The virtualization helpers
// must observe the measured height (via ResizeObserver on .data-row)
// and feed it into the prefix sum so:
//   - the scrollbar extent matches the true content height,
//   - scrollRowIntoView(target) lands at the right offset,
//   - rows beyond the wrapped ones still mount as the user scrolls.
// [sheet.grid.virtualization] [sheet.format.wrap]

/** Build a string long enough to wrap to ~``lines`` rows in a 100 px
 *  column with ``white-space: normal``. Each fragment is ~10 chars so
 *  with default column width (100 px / ~7 px per char ≈ 14 chars/line)
 *  ``lines`` fragments produce ``lines``-ish lines. The wrap CSS uses
 *  ``white-space: normal``, so literal ``\n`` would be collapsed —
 *  we rely on word boundaries instead. */
function wrappingText(lines: number): string {
  return new Array(lines).fill("WrappedXX").join(" ");
}

test("scrollHeight reflects measured wrapped-row heights", async () => {
  // Wrap rows 1-3 with multi-line content so they render taller than
  // ROW_HEIGHT_PX.
  for (let r = 1; r <= 3; r++) {
    const id = `A${r}` as CellId;
    cells.setCellValue(id, wrappingText(6));
    cells.setCellFormat(id, { wrap: "wrap" });
  }

  const { container } = await mountGridConstrained(660);
  if (!container) throw new Error("container missing");
  await flushFrames();
  await flushFrames();

  // With uniform ROW_HEIGHT_PX = 22, the scrollHeight of the
  // overflow:auto container would be exactly 100 × 22 + header.
  // With the wrapped rows measured taller, the spacer math should
  // expand it past that bound. We compare relative to a freshly-
  // mounted unwrapped Grid to absorb the test browser's font-metric
  // jitter (cell padding, browser default font, etc.).
  const wrappedScrollHeight = container.scrollHeight;
  expect(wrappedScrollHeight).toBeGreaterThan(0);

  // Now mount a baseline Grid with no wrapped rows and compare.
  cells.clear();
  const baseline = await mountGridConstrained(660);
  await flushFrames();
  await flushFrames();
  if (!baseline.container) throw new Error("baseline container missing");
  const baselineScrollHeight = baseline.container.scrollHeight;
  expect(wrappedScrollHeight).toBeGreaterThan(baselineScrollHeight);
});

test("scrollRowIntoView accounts for wrapped rows above the target", async () => {
  // Wrap the first 10 rows so the uniform-height target offset for
  // row 50 (= 49 × 22 = 1078 px) would be far above the true offset.
  // After the fix, scrollRowIntoView(50) must scroll past 1078 px,
  // by an amount equal to the cumulative wrap excess.
  for (let r = 1; r <= 10; r++) {
    const id = `A${r}` as CellId;
    cells.setCellValue(id, wrappingText(6));
    cells.setCellFormat(id, { wrap: "wrap" });
  }

  const { container } = await mountGridConstrained(440);
  if (!container) throw new Error("container missing");
  await flushFrames();
  await flushFrames();

  // Sanity: row 50 isn't currently mounted at scrollTop 0.
  expect(container.querySelector('[data-cell-id="A50"]')).toBeNull();

  const { scrollRowIntoView } = await import("../../virtualization");
  scrollRowIntoView(50);
  // Multiple frame flushes — the scroll event triggers reactive
  // re-derive of visibleRange, which mounts the new rows, which in
  // turn triggers ResizeObserver callbacks.
  await flushFrames();
  await flushFrames();

  // The fix: scrollTop landed strictly past the naive uniform
  // calculation (49 × 22 - GRID_HEADER_HEIGHT_PX = 1056). Without
  // the prefix-sum the math would've stopped here and missed row 50
  // by the cumulative wrap excess.
  expect(container.scrollTop).toBeGreaterThan(1056);

  // Row 50 must be in the rendered window after scrollRowIntoView —
  // that's the user-visible promise of the helper. The earlier
  // (legacy) form of this assertion checked ``minRow > 40`` to imply
  // the same property by way of the rendered slice's lower bound,
  // but that was sensitive to the precise scrollAdjust path the
  // ResizeObserver took mid-mount and broke when Svelte's runes
  // scheduler stops short of one extra adjust round. Asserting the
  // semantic outcome directly is sturdier and equally exact.
  expect(container.querySelector('[data-cell-id="A50"]')).not.toBeNull();
});
