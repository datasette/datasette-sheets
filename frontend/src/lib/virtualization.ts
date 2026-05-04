/**
 * Row-axis grid virtualization state + helpers.
 *
 * Before virtualization every one of ROWS.length × COLUMNS.length
 * cells (100 × 15 = 1,500 on stock config) was a mounted Svelte
 * component with ~15 reactive subscriptions, even though only ~20
 * rows are ever visible at once. That was the single biggest chunk
 * of the "800 MB heap" complaint — ~50-80 MB of Svelte component
 * instance state + DOM + closures that nobody ever sees.
 *
 * This module is intentionally small and frame-agnostic. Grid.svelte
 * tracks scroll position, derives which rows are visible (plus a
 * buffer), and renders only those. Cells outside the window aren't
 * mounted — they don't exist as components or DOM nodes.
 *
 * Row heights are non-uniform: a cell with ``format.wrap === "wrap"``
 * grows vertically and stretches the entire row past the default
 * ``ROW_HEIGHT_PX``. Grid measures each rendered row via
 * ``ResizeObserver`` and pushes overrides into a ``RowHeights``
 * instance; the visible-range / scroll-into-view math here uses a
 * lazily-rebuilt prefix-sum + binary search so the scrollbar extent
 * and ``scrollRowIntoView`` targets stay accurate even when wrapped
 * rows precede the viewport.
 *
 * [sheet.grid.virtualization]
 */

/**
 * Default row height used when no per-row override exists. Matches
 * ``--sheet-row-height`` in the SheetsPage stylesheet. Wrapped cells
 * (``format.wrap === "wrap"``) report their measured height back via
 * ``RowHeights.setHeight`` and override this default for that row.
 */
export const ROW_HEIGHT_PX = 22;

/**
 * How far off-screen (in rows) to pre-render. Keeps a handful of
 * rows mounted just above and below the viewport so a scroll nudge
 * doesn't flash through blank space before the new rows hydrate.
 * 10 rows × 22 px = 220 px of buffer each side — about half a
 * viewport at typical desktop sizes.
 */
export const GRID_BUFFER_ROWS = 10;

/** Sticky header row height; keep in sync with ``--sheet-header-height``. */
export const GRID_HEADER_HEIGHT_PX = 22;

/**
 * Per-row height bookkeeping with prefix-sum + binary-search lookups.
 *
 * Each row defaults to ``ROW_HEIGHT_PX``; ``setHeight`` records an
 * override (e.g. measured height of a wrapped row). The prefix sum
 * is rebuilt lazily on the next read after any mutation — at the
 * 100-row default config a full rebuild is essentially free, and
 * the lazy invalidation keeps writes O(1).
 *
 * For much larger sheets (10k+ rows) swap the flat array for a
 * Fenwick tree; the public surface (``offsetOf`` / ``rowAtOffset`` /
 * ``totalHeight``) is shaped so callers don't need to change.
 */
export class RowHeights {
  private heights: Float64Array;
  private prefix: Float64Array;
  /** Lowest row index whose prefix-sum entry is stale. */
  private dirtyFrom: number;

  constructor(public readonly count: number) {
    this.heights = new Float64Array(count);
    this.heights.fill(ROW_HEIGHT_PX);
    // ``prefix[i]`` = sum of heights[0..i-1] = y-offset of row i's top.
    // ``prefix[count]`` = total content height.
    this.prefix = new Float64Array(count + 1);
    this.dirtyFrom = 0;
  }

  /** Height of the row at 0-based index ``row``. */
  getHeight(row: number): number {
    if (row < 0 || row >= this.count) return ROW_HEIGHT_PX;
    return this.heights[row];
  }

  /**
   * Set the measured height of a row. Defaults to ``ROW_HEIGHT_PX``
   * if ``height`` is non-finite or non-positive — keeps a misbehaving
   * ResizeObserver report from poisoning the prefix sum.
   */
  setHeight(row: number, height: number): void {
    if (row < 0 || row >= this.count) return;
    const next = Number.isFinite(height) && height > 0 ? height : ROW_HEIGHT_PX;
    if (this.heights[row] === next) return;
    this.heights[row] = next;
    if (row < this.dirtyFrom) this.dirtyFrom = row;
  }

  /** Reset every row to the default ``ROW_HEIGHT_PX``. */
  reset(): void {
    this.heights.fill(ROW_HEIGHT_PX);
    this.dirtyFrom = 0;
  }

  /** Rebuild prefix sums from ``dirtyFrom`` to ``count``. */
  private rebuild(): void {
    if (this.dirtyFrom >= this.count) return;
    let acc = this.dirtyFrom === 0 ? 0 : this.prefix[this.dirtyFrom];
    for (let i = this.dirtyFrom; i < this.count; i++) {
      this.prefix[i] = acc;
      acc += this.heights[i];
    }
    this.prefix[this.count] = acc;
    this.dirtyFrom = this.count;
  }

  /** Y-offset (in px) of the top edge of row at 0-based index ``row``. */
  offsetOf(row: number): number {
    if (row <= 0) return 0;
    if (row >= this.count) return this.totalHeight();
    this.rebuild();
    return this.prefix[row];
  }

  /** Total content height in px (sum of all row heights). */
  totalHeight(): number {
    if (this.count === 0) return 0;
    this.rebuild();
    return this.prefix[this.count];
  }

  /**
   * Return the 0-based row index whose vertical span contains ``y``.
   * Clamps to ``[0, count - 1]``. ``y`` is measured from the top of
   * the data area (header excluded — Grid offsets ``scrollTop`` by
   * the header before calling).
   */
  rowAtOffset(y: number): number {
    if (this.count === 0) return 0;
    if (y <= 0) return 0;
    this.rebuild();
    if (y >= this.prefix[this.count]) return this.count - 1;
    // Binary search for the largest ``i`` with ``prefix[i] <= y``.
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.prefix[mid] <= y) lo = mid + 1;
      else hi = mid;
    }
    // ``lo`` is the first index with prefix > y → the row containing
    // y starts at ``lo - 1``.
    return Math.max(0, lo - 1);
  }
}

// Module-level reference to the scroll container (``<div class="grid-container">``
// inside Grid.svelte). Grid registers itself on mount and unregisters
// on destroy. Consumers (``scrollRowIntoView`` below) read through this
// ref instead of querying the DOM because querying by class name
// across a component tree is brittle if the class ever changes.
let gridContainerRef: HTMLElement | null = null;
// The active ``RowHeights`` instance, registered alongside the
// container. ``scrollRowIntoView`` reads this so its target-top math
// stays in sync with whatever per-row heights Grid has measured.
// Null in isolated unit tests (Cell.svelte mounted without Grid) —
// callers fall back to uniform-height arithmetic.
let rowHeightsRef: RowHeights | null = null;

export function setGridContainer(
  el: HTMLElement | null,
  rowHeights: RowHeights | null = null,
): void {
  gridContainerRef = el;
  rowHeightsRef = el ? rowHeights : null;
}

export function getGridContainer(): HTMLElement | null {
  return gridContainerRef;
}

export function getRowHeights(): RowHeights | null {
  return rowHeightsRef;
}

/**
 * Adjust the scroll container so row ``row`` (1-based — matches the
 * display row number the rest of the app uses) is fully visible.
 * No-op if the row is already on screen, or if Grid hasn't registered
 * its container (e.g. isolated Cell.svelte tests).
 *
 * Called from Cell.svelte's ``focusCell`` on arrow-nav. Without this
 * the DOM query for the target cell would return null whenever nav
 * jumped into a virtualized-out row.
 *
 * Uses the registered ``RowHeights`` (if any) for the per-row offset
 * lookup so wrapped rows above the target don't make the math land
 * a few pixels short.
 */
export function scrollRowIntoView(row: number): void {
  const el = gridContainerRef;
  if (!el) return;
  const rh = rowHeightsRef;
  const targetTop = rh ? rh.offsetOf(row - 1) : (row - 1) * ROW_HEIGHT_PX;
  const targetHeight = rh ? rh.getHeight(row - 1) : ROW_HEIGHT_PX;
  const targetBottom = targetTop + targetHeight;
  const scrollTop = el.scrollTop;
  const viewH = el.clientHeight;
  // The sticky header covers the top ``GRID_HEADER_HEIGHT_PX`` of the
  // viewport, so treat that as the effective top edge.
  if (targetTop < scrollTop + GRID_HEADER_HEIGHT_PX) {
    el.scrollTop = Math.max(0, targetTop - GRID_HEADER_HEIGHT_PX);
  } else if (targetBottom > scrollTop + viewH) {
    el.scrollTop = targetBottom - viewH;
  }
}

/**
 * Step from ``current`` (0-based row index) by ``dir`` (-1 or +1),
 * skipping any row indices in ``hidden``. Used by the arrow-nav
 * path so the user doesn't get stuck on / step through a hidden
 * row when the active filter has predicates applied.
 *
 * Clamps at the grid bounds — returns ``current`` if every row in
 * the requested direction is hidden (matches the existing arrow
 * clamp semantics from sheet.navigation.arrow).
 *
 * Pure / exported so unit tests can drive it directly.
 *
 * [sheet.filter.row-hide]
 */
export function nextVisibleRow(
  current: number,
  dir: -1 | 1,
  hidden: Set<number>,
  total: number,
): number {
  let r = current + dir;
  while (r >= 0 && r < total && hidden.has(r)) r += dir;
  if (r < 0 || r >= total) return current;
  return r;
}

/**
 * Given current scroll state and the total row count, return the
 * inclusive-start / exclusive-end row indices (0-based) to render,
 * with ``GRID_BUFFER_ROWS`` of buffer on each side.
 *
 * When ``rowHeights`` is supplied, the visible window is computed by
 * binary-searching the prefix-sum for the rows at ``scrollTop`` and
 * ``scrollTop + viewportHeight``. With no override, falls back to
 * uniform-height arithmetic against ``ROW_HEIGHT_PX`` — keeps the
 * function pure-and-trivial for callers that don't track variable
 * heights (e.g. unit tests).
 *
 * Exported + pure so it can be unit-tested without mounting Grid.
 */
export function visibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  totalRows: number,
  rowHeights?: RowHeights | null,
): { start: number; end: number } {
  let start: number;
  let end: number;
  if (rowHeights && rowHeights.count === totalRows) {
    const top = Math.max(0, scrollTop);
    const firstVisible = rowHeights.rowAtOffset(top);
    // The viewport spans ``[top, bottom)`` — exclusive bottom edge.
    // Probing ``bottom - 1`` lines up with the uniform fallback's
    // ``ceil((top + viewport) / ROW_HEIGHT_PX)``: if a row's top
    // sits exactly on ``bottom`` it isn't actually visible.
    const bottom = top + Math.max(0, viewportHeight);
    const lastVisible = rowHeights.rowAtOffset(Math.max(top, bottom - 1));
    start = Math.max(0, firstVisible - GRID_BUFFER_ROWS);
    end = Math.min(totalRows, lastVisible + 1 + GRID_BUFFER_ROWS);
  } else {
    start = Math.max(
      0,
      Math.floor(scrollTop / ROW_HEIGHT_PX) - GRID_BUFFER_ROWS,
    );
    end = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT_PX) +
        GRID_BUFFER_ROWS,
    );
  }
  // end defaults to start when the viewport hasn't measured yet
  // (``viewportHeight`` is 0 on first render before onMount) — render
  // at least the first buffer so tests / SSR-less mounts see
  // content.
  if (end <= start) {
    return { start, end: Math.min(totalRows, start + GRID_BUFFER_ROWS) };
  }
  return { start, end };
}
