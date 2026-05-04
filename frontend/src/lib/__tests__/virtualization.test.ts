import { describe, expect, test } from "vitest";
import { RowHeights, nextVisibleRow, visibleRowRange } from "../virtualization";

// Pure unit tests for the row-range arithmetic that drives Grid's
// virtualized rendering. Cheap — no Svelte mount, no DOM. The
// integration test (offscreen rows aren't in the DOM, scroll
// reveals them) lives in Grid.virtualization.test.ts.
//
// Constants the math relies on (kept in sync with virtualization.ts):
//   ROW_HEIGHT_PX = 22
//   GRID_BUFFER_ROWS = 10

describe("visibleRowRange", () => {
  test("at scroll 0 with full viewport, renders the buffer-extended top slice", () => {
    // 660 px viewport / 22 px row = 30 rows visible + 10 buffer below.
    // No rows above, so start=0.
    const { start, end } = visibleRowRange(0, 660, 100);
    expect(start).toBe(0);
    expect(end).toBe(40); // 30 visible + 10 buffer
  });

  test("scrolling down shifts the window", () => {
    // scrollTop 220px → first visible row idx = 10 → start = 0 (buffer)
    // viewport 660px → end visible = (220+660)/22 = 40 → +10 buffer = 50
    const { start, end } = visibleRowRange(220, 660, 100);
    expect(start).toBe(0);
    expect(end).toBe(50);
  });

  test("scrolled past the buffer, start advances", () => {
    // scrollTop 1100px → first visible = 50 → start = 40 after buffer
    // end visible = (1100+660)/22 = 80 → end = 90 with buffer
    const { start, end } = visibleRowRange(1100, 660, 100);
    expect(start).toBe(40);
    expect(end).toBe(90);
  });

  test("clamps end at totalRows", () => {
    // Scrolled to bottom: end shouldn't exceed totalRows even with buffer.
    const { start: _start, end } = visibleRowRange(2200, 660, 100);
    expect(end).toBe(100);
  });

  test("zero viewport falls back to a buffer-sized window", () => {
    // First render before onMount measures the container — viewport
    // is 0. Without the fallback the visible range would be empty.
    const { start, end } = visibleRowRange(0, 0, 100);
    expect(start).toBe(0);
    expect(end).toBe(10); // GRID_BUFFER_ROWS
  });

  test("never returns negative or out-of-range bounds", () => {
    // Scroll values can be momentarily negative (overscroll) or
    // larger than the content extent (resize while scrolled). Math
    // should clamp.
    const r1 = visibleRowRange(-100, 660, 100);
    expect(r1.start).toBe(0);
    const r2 = visibleRowRange(99999, 660, 100);
    expect(r2.end).toBe(100);
  });
});

// ---------------------------------------------------------------
// Variable row height — RowHeights data structure + visibleRowRange
// integration. Wrapped cells (format.wrap === "wrap") grow vertically;
// the prefix-sum data structure is what keeps scroll-extent and
// scroll-into-view math honest when that happens.
// ---------------------------------------------------------------

describe("RowHeights", () => {
  test("defaults all rows to ROW_HEIGHT_PX", () => {
    const rh = new RowHeights(5);
    expect(rh.getHeight(0)).toBe(22);
    expect(rh.getHeight(4)).toBe(22);
    expect(rh.totalHeight()).toBe(110); // 5 × 22
    expect(rh.offsetOf(0)).toBe(0);
    expect(rh.offsetOf(3)).toBe(66); // 3 × 22
    expect(rh.offsetOf(5)).toBe(110); // = totalHeight
  });

  test("setHeight updates prefix sums on next read", () => {
    const rh = new RowHeights(4);
    rh.setHeight(1, 80); // wrapped cell on row 1
    expect(rh.getHeight(1)).toBe(80);
    expect(rh.totalHeight()).toBe(22 + 80 + 22 + 22); // 146
    // Offsets after the override should advance by the excess.
    expect(rh.offsetOf(0)).toBe(0);
    expect(rh.offsetOf(1)).toBe(22);
    expect(rh.offsetOf(2)).toBe(102); // 22 + 80
    expect(rh.offsetOf(3)).toBe(124); // 22 + 80 + 22
    expect(rh.offsetOf(4)).toBe(146);
  });

  test("setHeight to the same value is a no-op", () => {
    const rh = new RowHeights(3);
    rh.setHeight(0, 22); // already default
    rh.setHeight(1, 50);
    expect(rh.totalHeight()).toBe(22 + 50 + 22);
    rh.setHeight(1, 50); // no change
    expect(rh.totalHeight()).toBe(22 + 50 + 22);
  });

  test("setHeight rejects bad values, falls back to default", () => {
    const rh = new RowHeights(3);
    rh.setHeight(0, NaN);
    rh.setHeight(1, -10);
    rh.setHeight(2, 0);
    expect(rh.totalHeight()).toBe(66); // 3 × 22 — all reverted
  });

  test("setHeight with out-of-range row is ignored", () => {
    const rh = new RowHeights(3);
    rh.setHeight(-1, 100);
    rh.setHeight(99, 100);
    expect(rh.totalHeight()).toBe(66); // unchanged
  });

  test("rowAtOffset binary-searches the prefix sum", () => {
    const rh = new RowHeights(5);
    // Rows 0-4 default to 22 px each; total height 110.
    expect(rh.rowAtOffset(0)).toBe(0);
    expect(rh.rowAtOffset(21)).toBe(0);
    expect(rh.rowAtOffset(22)).toBe(1); // top of row 1
    expect(rh.rowAtOffset(43)).toBe(1);
    expect(rh.rowAtOffset(44)).toBe(2);
    expect(rh.rowAtOffset(110)).toBe(4); // clamps to last row
    expect(rh.rowAtOffset(99999)).toBe(4);
    expect(rh.rowAtOffset(-50)).toBe(0);
  });

  test("rowAtOffset accounts for wrapped rows above target", () => {
    const rh = new RowHeights(10);
    // Rows 0-4 wrapped to 80 px each (5 × 80 = 400).
    for (let i = 0; i < 5; i++) rh.setHeight(i, 80);
    // Rows 5-9 default 22. Total = 400 + 110 = 510.
    expect(rh.totalHeight()).toBe(510);
    // y = 410 lands inside row 5 (top of row 5 = 400, height 22).
    expect(rh.rowAtOffset(410)).toBe(5);
    // y = 399 still in row 4 (top of row 4 = 320, height 80).
    expect(rh.rowAtOffset(399)).toBe(4);
    // y = 400 is the top of row 5.
    expect(rh.rowAtOffset(400)).toBe(5);
  });

  test("reset clears all overrides", () => {
    const rh = new RowHeights(4);
    rh.setHeight(1, 100);
    rh.setHeight(2, 200);
    rh.reset();
    expect(rh.totalHeight()).toBe(88); // 4 × 22
    expect(rh.getHeight(1)).toBe(22);
  });

  test("getHeight clamps out-of-range to default", () => {
    const rh = new RowHeights(2);
    expect(rh.getHeight(-1)).toBe(22);
    expect(rh.getHeight(5)).toBe(22);
  });
});

describe("visibleRowRange with RowHeights", () => {
  test("uniform heights matches the no-arg fallback", () => {
    const rh = new RowHeights(100);
    const a = visibleRowRange(220, 660, 100);
    const b = visibleRowRange(220, 660, 100, rh);
    expect(b).toEqual(a);
  });

  test("scrollbar extent stays correct when leading rows are wrapped", () => {
    // 5 wrapped rows at 80 px each, then 95 default rows.
    // Total content = 5 × 80 + 95 × 22 = 400 + 2090 = 2490 px.
    const rh = new RowHeights(100);
    for (let i = 0; i < 5; i++) rh.setHeight(i, 80);
    expect(rh.totalHeight()).toBe(2490);

    // At scrollTop 0, viewport 660: visible covers y ∈ [0, 660].
    // Within that range: rows 0-4 (y ∈ [0, 400]) plus rows 5-16
    // (y ∈ [400, 664]) → end ~17 + 10 buffer = 27.
    const { start, end } = visibleRowRange(0, 660, 100, rh);
    expect(start).toBe(0);
    // First visible at y = 0 → row 0; last visible at y = 660 →
    // row 16 (since 400 + 12 × 22 = 664). +10 buffer.
    expect(end).toBe(27);
  });

  test("scrollRowIntoView target is computed from the prefix sum", () => {
    // Equivalent to "scrollRowIntoView(50) when rows 0-29 are
    // wrapped to 80 px each" — but using the pure helper directly
    // since scrollRowIntoView itself needs a real DOM.
    const rh = new RowHeights(100);
    for (let i = 0; i < 30; i++) rh.setHeight(i, 80);
    // Top of row 49 (display row 50) = 30 × 80 + 19 × 22 = 2400 + 418 = 2818.
    expect(rh.offsetOf(49)).toBe(2818);
    // Uniform-height naive math would have placed it at 49 × 22 = 1078,
    // 1740 px above the true position — that's the bug this ticket
    // is fixing.
    expect(49 * 22).toBe(1078);
    expect(rh.offsetOf(49) - 49 * 22).toBe(1740);
  });

  test("works when rowHeights count mismatches totalRows", () => {
    // Defensive: if the caller passes the wrong RowHeights (stale
    // after row insert/delete), the helper falls back to uniform
    // arithmetic instead of returning garbage.
    const rh = new RowHeights(50);
    const range = visibleRowRange(0, 660, 100, rh);
    expect(range.start).toBe(0);
    expect(range.end).toBe(40); // same as the uniform 100-row case
  });
});

// [sheet.filter.row-hide]
describe("nextVisibleRow", () => {
  test("returns the next index when nothing is hidden", () => {
    const hidden = new Set<number>();
    expect(nextVisibleRow(0, 1, hidden, 100)).toBe(1);
    expect(nextVisibleRow(5, -1, hidden, 100)).toBe(4);
  });

  test("skips a single hidden row", () => {
    const hidden = new Set([3]);
    expect(nextVisibleRow(2, 1, hidden, 100)).toBe(4);
    expect(nextVisibleRow(4, -1, hidden, 100)).toBe(2);
  });

  test("skips a contiguous block of hidden rows", () => {
    const hidden = new Set([3, 4, 5]);
    expect(nextVisibleRow(2, 1, hidden, 100)).toBe(6);
    expect(nextVisibleRow(6, -1, hidden, 100)).toBe(2);
  });

  test("clamps at the grid edge when every row in the direction is hidden", () => {
    const hidden = new Set([1, 2, 3]);
    // From row 0 going down, all neighbours hidden until row 4 — works.
    expect(nextVisibleRow(0, 1, hidden, 4)).toBe(0); // row 4 is out of bounds; clamp
    // From row 0 going up, immediately at top — clamp to current.
    expect(nextVisibleRow(0, -1, new Set(), 100)).toBe(0);
  });

  test("returns current index when starting row is the last visible one", () => {
    const hidden = new Set([10]);
    // total=11 ⇒ valid indices 0..10. Row 9 going down: row 10 hidden,
    // no row 11 ⇒ clamp to 9.
    expect(nextVisibleRow(9, 1, hidden, 11)).toBe(9);
  });
});
