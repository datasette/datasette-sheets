/**
 * Grid bounds + per-column widths. Lives in its own module so the
 * cells subsystem (``./cells/structuralOps``) can co-mutate widths
 * during column delete/insert without forming an import cycle with
 * ``./spreadsheet`` (which re-exports the cells facade).
 *
 * [STORES-05] Extracted from ``spreadsheet.ts`` as part of the cell
 * store split.
 */
import { writable } from "svelte/store";

// Grid configuration
export const COLUMNS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
];
export const ROWS = Array.from({ length: 100 }, (_, i) => i + 1);

// Column widths (resizable)
export const DEFAULT_COL_WIDTH = 100;
export const MIN_COL_WIDTH = 40;
export const columnWidths = writable<Record<string, number>>(
  Object.fromEntries(COLUMNS.map((c) => [c, DEFAULT_COL_WIDTH])),
);

export function setColumnWidth(col: string, width: number) {
  columnWidths.update((w) => ({ ...w, [col]: Math.max(MIN_COL_WIDTH, width) }));
}

export function getMinColWidth() {
  return MIN_COL_WIDTH;
}
