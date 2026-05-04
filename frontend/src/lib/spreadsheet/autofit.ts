// [sheet.column.auto-fit-double-click]
//
// Pure column-width measurement for the double-click-to-fit gesture.
// Lives outside Grid.svelte so it can be unit-tested without mounting
// the component, and so the same code path is used whether one
// column is sized or a multi-selection — the helper has no
// component-private state.
//
// Three things matter for correctness, all of which the previous
// inline implementation missed (CELL-GRID-06):
//
// 1. Font / size / padding come from the live `--sheet-font`,
//    `--sheet-font-size`, `--sheet-cell-padding-x` CSS variables on
//    the grid container, NOT a hardcoded `13px Courier New`. A theme
//    swap that changes any of them otherwise produces silently-wrong
//    widths.
// 2. Per-cell format (bold, italic, fontSize) is folded into the
//    canvas font string before measuring. A bold cell genuinely
//    occupies more horizontal space than a non-bold one with the same
//    text; ignoring that is what makes auto-fit "almost fit but not
//    quite" for styled rows.
// 3. Padding constants come from the same CSS var the cells render
//    with, so a density change propagates without the helper drifting.
//
// We intentionally measure `wrap: wrap` cells as single-line — the
// "fit" gesture means "make every value visible on one line", and
// wrapped cells are explicitly the user opting out of that. A cell
// whose value happens to need wrapping in its current column will
// still be measured at its full single-line width, which is the
// behavior the user almost certainly wants when they double-click.

import type { CellData, CellFormat } from "./types";

/** Minimum column width — matches `MIN_COL_WIDTH` in stores/spreadsheet.ts.
 *  Duplicated here so this module stays free of store imports
 *  (keeps the unit test stack-trace tiny). The store still re-clamps
 *  through `setColumnWidth`, so this is a measurement floor only. */
export const AUTOFIT_MIN_WIDTH = 40;

/** Fraction of the viewport the auto-fit width is capped at. One
 *  pathological cell shouldn't shove the rest of the sheet off-screen.
 *  Match Google Sheets' behaviour. */
export const AUTOFIT_VIEWPORT_FRACTION = 0.8;

/** Extra header padding beyond the cell's `2 * padX` — visually the
 *  column header carries a tiny bit more breathing room than a data
 *  cell. Matches the pre-refactor magic `+24` minus the now-explicit
 *  cell padding. */
export const AUTOFIT_HEADER_EXTRA = 14;

/** Conversion factor: cells render explicit `fontSize` as `…pt`, the
 *  canvas API takes px. Matches `style="font-size: …pt"` at
 *  `Cell.svelte:1349`. */
const PT_TO_PX = 96 / 72;

/** Layout-relevant CSS custom properties read off the grid container
 *  at measurement time. Production reads from the actual element;
 *  tests inject a synthetic struct so they don't depend on a real
 *  computed style cascade. */
export interface AutoFitStyles {
  /** CSS font-size string (e.g. `"13px"`). */
  baseFontSize: string;
  /** CSS font-family string (e.g. `"Courier New, Courier, monospace"`). */
  fontFamily: string;
  /** Resolved horizontal padding in px (one side). */
  padX: number;
}

/** Default styles used when a CSS variable is missing or the helper is
 *  invoked without a host element. Mirrors the values declared on
 *  `:root` in `SheetsPage.svelte`. */
export const AUTOFIT_DEFAULT_STYLES: AutoFitStyles = {
  baseFontSize: "13px",
  fontFamily: '"Courier New", Courier, monospace',
  padX: 5,
};

/** Read the layout CSS variables off `root`, falling back to
 *  `AUTOFIT_DEFAULT_STYLES` for any value that's missing or unparsable.
 *  Pass `null` (or `undefined`) to bypass DOM access entirely — useful
 *  in unit tests. */
export function readAutoFitStyles(
  root: Element | null | undefined,
): AutoFitStyles {
  if (!root) return AUTOFIT_DEFAULT_STYLES;
  const cs = getComputedStyle(root);
  const baseFontSize =
    cs.getPropertyValue("--sheet-font-size").trim() ||
    AUTOFIT_DEFAULT_STYLES.baseFontSize;
  const fontFamily =
    cs.getPropertyValue("--sheet-font").trim() ||
    AUTOFIT_DEFAULT_STYLES.fontFamily;
  const padRaw = parseFloat(cs.getPropertyValue("--sheet-cell-padding-x"));
  const padX = Number.isFinite(padRaw) ? padRaw : AUTOFIT_DEFAULT_STYLES.padX;
  return { baseFontSize, fontFamily, padX };
}

/** Compose a CSS `font` shorthand from per-cell format + the base
 *  styles. The order matches the canvas spec: `style weight size
 *  family`. `bold`/`italic` flags map to the same weight/style the
 *  cell's CSS uses; `fontSize` (in pt) overrides the base when set. */
export function composeCellFont(
  format: CellFormat,
  styles: AutoFitStyles,
): string {
  const px = format.fontSize
    ? `${format.fontSize * PT_TO_PX}px`
    : styles.baseFontSize;
  const weight = format.bold ? "700" : "400";
  const style = format.italic ? "italic" : "normal";
  return `${style} ${weight} ${px} ${styles.fontFamily}`;
}

/** A 2D-context-like object — narrowed to the API we actually call. The
 *  unit test passes a tiny stub so it doesn't need the real canvas. */
export interface MeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

export interface AutoFitOptions {
  /** Rows to scan. Production passes `ROWS` from the spreadsheet store. */
  rows: readonly number[];
  /** Look up a cell by id; returns `null`/`undefined` for empty cells. */
  getCell(cellId: string): CellData | null | undefined;
  /** Build the displayed string for a cell. Production passes
   *  `formatter.formatValue` so format-driven changes (currency mask,
   *  percentage, etc.) are measured at their rendered width. */
  formatValue(cell: CellData): string;
  /** Live CSS variables from the grid container. Defaults to
   *  `AUTOFIT_DEFAULT_STYLES` — pass real ones in production via
   *  `readAutoFitStyles(gridContainer)`. */
  styles?: AutoFitStyles;
  /** Viewport width in px — caller injects so the helper stays pure
   *  (no `window` dependency, easy to test). Defaults to
   *  `window.innerWidth` when available, else `Infinity` (no cap). */
  viewportWidth?: number;
  /** Override the canvas measurement context. Production lets the
   *  helper construct a real `<canvas>`; tests pass a stub. */
  ctx?: MeasureContext;
}

/** Build a real canvas measurement context. Lives behind a function so
 *  unit tests can swap it out by passing `opts.ctx` directly. */
function defaultCanvasContext(): MeasureContext {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Surface an obviously-broken width if the browser refuses 2d
    // context — the caller will still clamp to MIN, the user will see
    // a no-op double-click, no exception bubbles up.
    return { font: "", measureText: () => ({ width: 0 }) };
  }
  return ctx;
}

/** Measure the smallest column width that fits the header label and
 *  every non-empty cell's rendered display value, capped at
 *  `viewportWidth * AUTOFIT_VIEWPORT_FRACTION` and floored at
 *  `AUTOFIT_MIN_WIDTH`. Per-cell format (bold / italic / fontSize) is
 *  folded into each measurement. */
export function measureColumnAutoFit(
  col: string,
  opts: AutoFitOptions,
): number {
  const styles = opts.styles ?? AUTOFIT_DEFAULT_STYLES;
  const ctx = opts.ctx ?? defaultCanvasContext();
  const viewportWidth =
    opts.viewportWidth ??
    (typeof window !== "undefined" ? window.innerWidth : Infinity);

  // Header — always measured at the base style; the column letter
  // doesn't carry a `CellFormat`. `2 * padX + headerExtra` so a
  // density change (smaller `--sheet-cell-padding-x`) tightens the
  // header in step with the cells.
  ctx.font = composeCellFont({} as CellFormat, styles);
  const headerWidth =
    ctx.measureText(col).width + 2 * styles.padX + AUTOFIT_HEADER_EXTRA;

  let maxWidth = Math.max(AUTOFIT_MIN_WIDTH, headerWidth);

  for (const row of opts.rows) {
    const cellId = `${col}${row}`;
    const cell = opts.getCell(cellId);
    if (!cell) continue;
    const display = opts.formatValue(cell);
    if (!display) continue;
    ctx.font = composeCellFont(cell.format, styles);
    const textWidth = ctx.measureText(display).width + 2 * styles.padX;
    if (textWidth > maxWidth) maxWidth = textWidth;
  }

  return Math.min(maxWidth, viewportWidth * AUTOFIT_VIEWPORT_FRACTION);
}
