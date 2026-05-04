/**
 * Filter store.
 *
 * Mirrors the server's per-sheet ``datasette_sheets_filter`` row.
 * One filter per sheet (UNIQUE(sheet_id) at the SQL level), so the
 * store value is ``FilterMeta | null``. On sheet open the row (if
 * any) is fetched and pushed into ``sheetFilter``; SSE events
 * (``filter-create`` / ``filter-update`` / ``filter-delete``) keep
 * the store in sync with concurrent collaborators.
 *
 * Phase B (this file) ships the data model + create / delete only.
 * Phase C adds the chevron icon overlay; Phase D adds the
 * predicate writes that drive ``hiddenRowIndices``; Phase E adds
 * sort.
 */
import { writable, derived } from "svelte/store";
import type { CellData, CellId } from "../spreadsheet/types";
import {
  getFilter,
  createFilter as apiCreateFilter,
  deleteFilter as apiDeleteFilter,
  setFilterPredicate as apiSetFilterPredicate,
  setFilterSort as apiSetFilterSort,
  type FilterMeta,
} from "../api";
import { COLUMNS } from "./columnWidths";
import { cellsWritable } from "./cells/store";
import { formatValue } from "../spreadsheet/formatter";

export type { FilterMeta };

/** The sheet's filter, or ``null`` when none is configured. */
export const sheetFilter = writable<FilterMeta | null>(null);

/**
 * Filter chevron popover open-state. ``null`` = closed; otherwise
 * carries the column the user clicked on plus the anchor element's
 * bounding rect at the time of click. Computed in the click handler
 * (rather than passing the element through) so the popover doesn't
 * have to re-measure if the cell scrolls slightly between open and
 * the next reactive frame.
 */
export type FilterPopoverState = {
  colIdx: number;
  anchorRect: DOMRect;
} | null;

export const filterPopover = writable<FilterPopoverState>(null);

export function openFilterPopover(colIdx: number, anchor: HTMLElement): void {
  filterPopover.set({
    colIdx,
    anchorRect: anchor.getBoundingClientRect(),
  });
}

export function closeFilterPopover(): void {
  filterPopover.set(null);
}

/**
 * Cells in the filter rectangle's header row (``min_row``). Drives
 * the bold-header rendering in Phase B and (Phase C) the chevron
 * icon overlay. Each entry carries ``{colIdx}`` so the chevron's
 * click handler knows which column popover to open.
 */
export const filterHeaderCells = derived(sheetFilter, ($f) => {
  const map = new Map<CellId, { colIdx: number }>();
  if (!$f) return map;
  for (let c = $f.min_col; c <= $f.max_col; c++) {
    const col = COLUMNS[c];
    if (!col) continue;
    map.set(`${col}${$f.min_row + 1}` as CellId, { colIdx: c });
  }
  return map;
});

/**
 * Compute the set of row indices that the active filter hides.
 *
 * A row is hidden iff at least one column with a predicate
 * excludes that row's *display string*. Display string =
 * ``formatValue(cell.computedValue, cell.format)`` — same string
 * the user reads in the picker, so toggling a checkbox actually
 * matches what they think they're hiding.
 *
 * Header row (``min_row``) and rows outside ``[min_row+1, max_row]``
 * are never hidden — only the data body of the filter is
 * filterable.
 *
 * Pure / exported so the unit tests can drive it directly without
 * mounting any component.
 */
export function computeHiddenRows(
  filter: FilterMeta | null,
  cells: Map<CellId, CellData>,
): Set<number> {
  const hidden = new Set<number>();
  if (!filter || !filter.predicates) return hidden;
  const predicateEntries = Object.entries(filter.predicates);
  if (predicateEntries.length === 0) return hidden;

  for (let r = filter.min_row + 1; r <= filter.max_row; r++) {
    for (const [colKey, predicate] of predicateEntries) {
      if (!predicate || !predicate.hidden) continue;
      const colIdx = Number(colKey);
      if (!Number.isFinite(colIdx)) continue;
      if (colIdx < filter.min_col || colIdx > filter.max_col) continue;
      const col = COLUMNS[colIdx];
      if (!col) continue;
      const cell = cells.get(`${col}${r + 1}` as CellId);
      const display = cellDisplayString(cell);
      if (predicate.hidden.includes(display)) {
        hidden.add(r);
        break; // any matching predicate is enough to hide the row
      }
    }
  }
  return hidden;
}

/**
 * Hidden row indices derived from the active filter + cells map.
 * Recomputes whenever either changes — predicate toggles AND
 * value edits inside the filter both affect visibility, so both
 * dependencies need to feed the derivation.
 */
export const hiddenRowIndices = derived(
  [sheetFilter, cellsWritable],
  ([$f, $cells]) => computeHiddenRows($f, $cells),
);

/**
 * Per-cell border-edge flags for the bordered rectangle. Cell.svelte
 * applies one CSS class per edge present so the outer perimeter
 * renders as a single solid outline. Cells inside the rectangle
 * but not on the perimeter end up with all four flags ``false`` —
 * still keyed in the map so consumers can quickly check membership.
 *
 * The bottom edge is anchored to the last *visible* row in the
 * rectangle, not ``max_row``, so an active predicate that hides the
 * bottom rows still leaves a green underline on the lowest visible
 * data row instead of disappearing into a hidden cell. If every
 * data row is hidden, the header row carries the bottom edge.
 */
export const filterEdgeMap = derived(
  [sheetFilter, hiddenRowIndices],
  ([$f, $hidden]) => {
    const map = new Map<
      CellId,
      { top: boolean; right: boolean; bottom: boolean; left: boolean }
    >();
    if (!$f) return map;
    let bottomVisibleRow = $f.min_row;
    for (let r = $f.max_row; r > $f.min_row; r--) {
      if (!$hidden.has(r)) {
        bottomVisibleRow = r;
        break;
      }
    }
    for (let r = $f.min_row; r <= $f.max_row; r++) {
      for (let c = $f.min_col; c <= $f.max_col; c++) {
        const col = COLUMNS[c];
        if (!col) continue;
        map.set(`${col}${r + 1}` as CellId, {
          top: r === $f.min_row,
          bottom: r === bottomVisibleRow,
          left: c === $f.min_col,
          right: c === $f.max_col,
        });
      }
    }
    return map;
  },
);

/**
 * Distinct display strings observed in the filter's data range
 * for one column, paired with the number of rows that contribute
 * each string. Drives the value-list checkbox UI in the filter
 * popover. Sorted case-insensitively by ``value``; ``""`` (blanks)
 * renders as a special "(Blanks)" row by the consumer.
 *
 * Cross-column filtering: rows excluded by *other* columns'
 * predicates are skipped, so opening Name's popover after
 * filtering Department=Marketing only lists names in Marketing
 * rows. The current column's own predicate is intentionally NOT
 * applied — otherwise values the user previously hid would
 * disappear and they'd have no way to re-check them.
 *
 * Counts are total rows in the data range that produced the
 * display string (after cross-column filtering) — they don't
 * change with the popover's local search filter (search is a UI
 * affordance, not a data filter).
 */
export type DistinctValueCount = { value: string; count: number };

export function distinctValuesForColumn(
  filter: FilterMeta | null,
  cells: Map<CellId, CellData>,
  colIdx: number,
): DistinctValueCount[] {
  if (!filter) return [];
  if (colIdx < filter.min_col || colIdx > filter.max_col) return [];
  const col = COLUMNS[colIdx];
  if (!col) return [];

  const otherPredicates = Object.entries(filter.predicates ?? {})
    .filter(
      ([k, p]) =>
        Number(k) !== colIdx && p != null && (p.hidden?.length ?? 0) > 0,
    )
    .map(([k, p]) => ({ colIdx: Number(k), hidden: p!.hidden! }));

  const counts = new Map<string, number>();
  rowLoop: for (let r = filter.min_row + 1; r <= filter.max_row; r++) {
    for (const op of otherPredicates) {
      if (op.colIdx < filter.min_col || op.colIdx > filter.max_col) continue;
      const otherCol = COLUMNS[op.colIdx];
      if (!otherCol) continue;
      const otherCell = cells.get(`${otherCol}${r + 1}` as CellId);
      if (op.hidden.includes(cellDisplayString(otherCell))) continue rowLoop;
    }
    const cell = cells.get(`${col}${r + 1}` as CellId);
    counts.set(
      cellDisplayString(cell),
      (counts.get(cellDisplayString(cell)) ?? 0) + 1,
    );
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) =>
      a.value.localeCompare(b.value, "en", { sensitivity: "base" }),
    );
}

function cellDisplayString(cell: CellData | undefined): string {
  if (!cell) return "";
  if (cell.error) return cell.error;
  return formatValue(cell.computedValue, cell.format);
}

/**
 * Membership check: does the cell sit anywhere inside the filter
 * rectangle? Used by the cell context menu to decide whether
 * "Create filter" or "Remove filter" applies.
 */
export const filterCellMap = derived(sheetFilter, ($f) => {
  const set = new Set<CellId>();
  if (!$f) return set;
  for (let r = $f.min_row; r <= $f.max_row; r++) {
    for (let c = $f.min_col; c <= $f.max_col; c++) {
      const col = COLUMNS[c];
      if (!col) continue;
      set.add(`${col}${r + 1}` as CellId);
    }
  }
  return set;
});

/** Fetch the sheet's filter and push it into ``sheetFilter``. */
export async function loadFilter(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<void> {
  const f = await getFilter(database, workbookId, sheetId);
  sheetFilter.set(f);
}

/**
 * Create a filter on the given A1 range. Server enforces "at most
 * one filter per sheet" — concurrent creates will return 409 for
 * the loser, which surfaces as a thrown ``ApiError`` here.
 */
export async function createFilter(
  database: string,
  workbookId: string,
  sheetId: string,
  range: string,
  clientId?: string,
): Promise<FilterMeta> {
  const f = await apiCreateFilter(
    database,
    workbookId,
    sheetId,
    range,
    clientId,
  );
  sheetFilter.set(f);
  return f;
}

/**
 * Set / replace / remove the predicate for one column. Pass
 * ``hidden = null`` to remove the predicate entirely. Server
 * validates that ``colIdx`` falls inside the rectangle.
 */
export async function setFilterPredicate(
  database: string,
  workbookId: string,
  sheetId: string,
  colIdx: number,
  hidden: string[] | null,
  clientId?: string,
): Promise<FilterMeta> {
  const f = await apiSetFilterPredicate(
    database,
    workbookId,
    sheetId,
    colIdx,
    hidden,
    clientId,
  );
  sheetFilter.set(f);
  return f;
}

/**
 * Apply (or clear) the sort on the filter. Pass ``colIdx = null``
 * (and ``direction = null``) to clear the active sort without
 * physically reordering the rows. Otherwise the server physically
 * reorders rows in the data range and broadcasts ``filter-update``
 * + ``rows-moved`` SSE events.
 */
export async function setFilterSort(
  database: string,
  workbookId: string,
  sheetId: string,
  colIdx: number | null,
  direction: "asc" | "desc" | null,
  clientId?: string,
): Promise<FilterMeta> {
  const f = await apiSetFilterSort(
    database,
    workbookId,
    sheetId,
    colIdx,
    direction,
    clientId,
  );
  sheetFilter.set(f);
  return f;
}

/** Remove the sheet's filter. No-op (404) if none exists. */
export async function removeFilter(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<void> {
  await apiDeleteFilter(database, workbookId, sheetId);
  sheetFilter.set(null);
}

/**
 * Optimistic auto-expand mirror.
 *
 * When the user commits a non-empty value into the cell directly
 * below the filter's ``max_row`` (within ``[min_col, max_col]``),
 * bump ``max_row`` locally so the bordered rectangle visually
 * grows in the same frame as the cell write.
 *
 * The server runs the same check inside ``set_cells`` and
 * broadcasts the authoritative ``filter-update`` SSE event. For
 * the originating client that event is a no-op (max_row already
 * matches); for collaborators it's the only signal that the
 * filter grew. Mirror logic is "best effort" — no rollback if
 * the server rejects the cell write, since the server's
 * filter-update payload is the consensus authority.
 *
 * [sheet.filter.auto-expand]
 */
export function maybeAutoExpandLocally(
  rowIdx: number,
  colIdx: number,
  rawValue: string,
): void {
  if (!rawValue) return;
  let current: FilterMeta | null = null;
  sheetFilter.subscribe((f) => (current = f))();
  if (!current) return;
  const f: FilterMeta = current;
  if (rowIdx !== f.max_row + 1) return;
  if (colIdx < f.min_col || colIdx > f.max_col) return;
  sheetFilter.set({ ...f, max_row: rowIdx });
}

/**
 * SSE handlers — invoked from ``sheetLifecycle.ts`` on every
 * ``filter-*`` event. Splice the payload into the store rather
 * than refetching; the server's payload is authoritative.
 */
export function handleFilterCreated(filter: FilterMeta): void {
  sheetFilter.set(filter);
}
export function handleFilterUpdated(filter: FilterMeta): void {
  sheetFilter.set(filter);
}
export function handleFilterDeleted(): void {
  sheetFilter.set(null);
}
