/**
 * Local row/column delete + insert with formula-ref rewriting and
 * column-width co-mutation. Each op folds shift + recalc + width
 * shift into one writable update so ``diffAndNotify`` fires once per
 * structural op (see ticket stores-07).
 *
 * [STORES-05] Split out of the monolithic ``createCellStore``. The
 * three former methods (``deleteRowsLocally`` / ``deleteColsLocally``
 * / ``insertColsLocally``) each open-coded the cell-walk loop; they
 * now share ``shiftCells`` below and the column-width co-mutation
 * lives in its own ``shiftColumnWidthsForDelete`` /
 * ``…ForInsertion`` helper rather than being inlined.
 */
import type { CellData, CellId } from "../../spreadsheet/types";
import { cellId as engineCellId, parseCellIdRaw } from "../../engine";
import { COLUMNS, DEFAULT_COL_WIDTH, columnWidths } from "../columnWidths";
import {
  cellsWritable,
  maybeAdjustFormula,
  maybeAdjustFormulaForInsertion,
  maybeAdjustFormulaForMove,
  maybeAdjustFormulaForRowMove,
  reloadIntoEngineAndMerge,
} from "./store";

/** Result of a per-cell shift decision: keep at-current-id, move to
 *  a new id, or drop. */
type ShiftDecision =
  | { kind: "keep" }
  | { kind: "move"; row: number; col: number }
  | { kind: "drop" };

interface ShiftPlan {
  /** Decide what to do with one cell given its parsed (row, col). */
  decide: (parsed: { row: number; col: number }) => ShiftDecision;
  /** Adjust a cell's formula text (immutable when no change). */
  adjustFormula: (cell: CellData) => CellData;
}

/** Walk every cell, apply the per-cell shift plan, then reload the
 *  engine and merge computed values back. The whole shift + recalc
 *  fires under a single ``cellsWritable.update`` so subscribers see
 *  exactly one notification per structural op.
 *
 *  [perf] Single ``update`` does shift + recalc + merge so
 *  ``diffAndNotify`` fires once for the structural op. The old code
 *  did ``cells.update(...)`` then ``this.recalculate()`` — every
 *  per-cell subscriber woke up twice per delete. See ticket
 *  stores-07. */
function shiftCells(plan: ShiftPlan): void {
  cellsWritable.update((cellsMap) => {
    const next = new Map<CellId, CellData>();
    for (const [id, cell] of cellsMap) {
      const parsed = parseCellIdRaw(id);
      if (!parsed) {
        // Garbage id (shouldn't happen; the engine produces these).
        // Pass through untouched rather than dropping silently.
        next.set(id, cell);
        continue;
      }
      if (parsed.col >= COLUMNS.length) {
        // Cell sits off the visible band — let it ride. The grid
        // doesn't render it; the server still owns it.
        next.set(id, cell);
        continue;
      }
      const decision = plan.decide(parsed);
      if (decision.kind === "drop") continue;
      const shiftedCell = plan.adjustFormula(cell);
      if (decision.kind === "keep") {
        next.set(id, shiftedCell);
        continue;
      }
      // ``move`` — verify the destination is on the visible band;
      // matches the prior open-coded checks in
      // ``deleteColsLocally`` / ``insertColsLocally``.
      const { row: destRow, col: destCol } = decision;
      if (destCol < 0 || destCol >= COLUMNS.length) continue;
      next.set(engineCellId(destRow, destCol) as CellId, shiftedCell);
    }
    reloadIntoEngineAndMerge(next);
    return next;
  });
}

// ─── Column-width co-mutation ────────────────────────────────────

/** Pack column widths leftward, dropping any column whose index is
 *  in ``deletedSet``. Tail columns the packer doesn't reach fall back
 *  to the default width — matches the server's
 *  ``datasette_sheets_column`` table behaviour. */
function shiftColumnWidthsForDelete(deletedSet: Set<number>): void {
  columnWidths.update((current) => {
    const nextWidths: Record<string, number> = Object.fromEntries(
      COLUMNS.map((c) => [c, DEFAULT_COL_WIDTH]),
    );
    let dest = 0;
    for (let src = 0; src < COLUMNS.length; src++) {
      if (deletedSet.has(src)) continue;
      const destCol = COLUMNS[dest];
      if (destCol === undefined) break;
      nextWidths[destCol] = current[COLUMNS[src]] ?? DEFAULT_COL_WIDTH;
      dest++;
    }
    return nextWidths;
  });
}

/** Shift column widths rightward by ``count`` for every source column
 *  whose index is ``>= at``. Columns that would shift off the right
 *  edge of the visible band are dropped (matches the cell-shift rule). */
function shiftColumnWidthsForInsertion(at: number, count: number): void {
  columnWidths.update((current) => {
    const nextWidths: Record<string, number> = Object.fromEntries(
      COLUMNS.map((c) => [c, DEFAULT_COL_WIDTH]),
    );
    for (let src = 0; src < COLUMNS.length; src++) {
      const destIdx = src < at ? src : src + count;
      const destCol = COLUMNS[destIdx];
      if (destCol === undefined) continue;
      nextWidths[destCol] = current[COLUMNS[src]] ?? DEFAULT_COL_WIDTH;
    }
    return nextWidths;
  });
}

// ─── Public ops ──────────────────────────────────────────────────

/**
 * Apply a column-delete + shift locally. Same idea as
 * ``deleteRowsLocally`` but along the column axis:
 *
 *   - Cells whose column is in ``deletedCols`` are dropped.
 *   - Cells to the right get their col index reduced by the number
 *     of deletions left of them.
 *   - ``columnWidths`` gets the same shift so the grid doesn't
 *     visually split between the (already-shifted) cells and
 *     stale width metadata. The server's ``delete_columns`` does
 *     this on the ``datasette_sheets_column`` table; this matches.
 */
export function deleteColsLocally(deletedCols: number[]): void {
  const deletedSet = new Set(deletedCols);
  if (deletedSet.size === 0) return;
  const sortedDeleted = [...deletedSet].sort((a, b) => a - b);
  const deletedList = [...deletedSet];

  shiftCells({
    decide: ({ row, col }) => {
      if (deletedSet.has(col)) return { kind: "drop" };
      const shift = sortedDeleted.reduce((n, d) => (d < col ? n + 1 : n), 0);
      if (shift === 0) return { kind: "keep" };
      return { kind: "move", row, col: col - shift };
    },
    // Rewrite the formula text to match the Google-Sheets-style
    // adjust the server runs on every formula cell. Without this,
    // optimistic UI would show `=SUM(A1:C1)` after deleting B,
    // even though the server stores `=SUM(A1:B1)`.
    adjustFormula: (cell) => maybeAdjustFormula(cell, deletedList, []),
  });

  shiftColumnWidthsForDelete(deletedSet);
}

/**
 * Apply a column block-move locally. Mirror of
 * ``deleteColsLocally`` / ``insertColsLocally`` for the move
 * direction:
 *
 *   - Cells whose col is in ``[srcStart, srcEnd]`` map to
 *     ``col - srcStart + finalStart`` (the source block lands at
 *     its new starting position).
 *   - Cells outside the source range but inside the affected band
 *     ``[min(srcStart, finalStart), max(srcEnd, finalStart + width - 1)]``
 *     shift by +width (band-edge cols pushed right when the block
 *     moves left) or −width (band-edge cols pulled left when the
 *     block moves right).
 *   - Cells outside the band stay put.
 *   - Formula refs are rewritten via
 *     ``adjustRefsForColumnBlockMove``: single-cell + whole-col
 *     refs follow the data, bounded ranges stay positional.
 *   - ``columnWidths`` gets the same forward-mapped shift so the
 *     grid doesn't show stale widths on the wrong columns.
 *
 * Single-column drag passes ``srcStart === srcEnd``; multi-column
 * drag (att ``ortkjljr``) sets the contiguous selection range.
 *
 * Used by the originator immediately after firing the API call,
 * and by remote clients when the ``columns-moved`` SSE event
 * arrives.
 */
// [sheet.column.drag-reorder]
export function moveColsLocally(
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): void {
  if (srcStart < 0 || srcEnd < srcStart || finalStart < 0) return;
  const width = srcEnd - srcStart + 1;
  if (finalStart === srcStart) return;

  function forward(c: number): number {
    if (c >= srcStart && c <= srcEnd) {
      return c - srcStart + finalStart;
    }
    if (finalStart < srcStart) {
      if (c >= finalStart && c < srcStart) return c + width;
      return c;
    }
    // finalStart > srcEnd
    if (c > srcEnd && c < finalStart + width) return c - width;
    return c;
  }

  shiftCells({
    decide: ({ row, col }) => {
      const next = forward(col);
      if (next === col) return { kind: "keep" };
      return { kind: "move", row, col: next };
    },
    adjustFormula: (cell) =>
      maybeAdjustFormulaForMove(cell, srcStart, srcEnd, finalStart),
  });

  shiftColumnWidthsForMove(srcStart, srcEnd, finalStart);
}

/** Pack column widths via the same forward map ``moveColsLocally``
 *  uses on cells. Cells off the visible band are dropped (matches
 *  the cell-shift rule); the tail falls back to the default width.
 */
function shiftColumnWidthsForMove(
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): void {
  const width = srcEnd - srcStart + 1;
  function forward(c: number): number {
    if (c >= srcStart && c <= srcEnd) return c - srcStart + finalStart;
    if (finalStart < srcStart) {
      if (c >= finalStart && c < srcStart) return c + width;
      return c;
    }
    if (c > srcEnd && c < finalStart + width) return c - width;
    return c;
  }
  columnWidths.update((current) => {
    const next: Record<string, number> = Object.fromEntries(
      COLUMNS.map((c) => [c, DEFAULT_COL_WIDTH]),
    );
    for (let src = 0; src < COLUMNS.length; src++) {
      const dest = forward(src);
      const destCol = COLUMNS[dest];
      if (destCol === undefined) continue;
      next[destCol] = current[COLUMNS[src]] ?? DEFAULT_COL_WIDTH;
    }
    return next;
  });
}

/**
 * Apply a row block-move locally. Mirror of ``moveColsLocally``
 * on the row axis. Used by the originator immediately after
 * firing the API call, and by remote clients on the
 * ``rows-moved`` SSE event.
 *
 * No row-height co-mutation: ``RowHeights`` is runtime-measured
 * via ResizeObserver, not persisted, so heights re-measure on
 * the next layout pass when cells render at their new row
 * indices.
 */
// [sheet.row.drag-reorder]
export function moveRowsLocally(
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): void {
  if (srcStart < 0 || srcEnd < srcStart || finalStart < 0) return;
  const width = srcEnd - srcStart + 1;
  if (finalStart === srcStart) return;

  function forward(r: number): number {
    if (r >= srcStart && r <= srcEnd) {
      return r - srcStart + finalStart;
    }
    if (finalStart < srcStart) {
      if (r >= finalStart && r < srcStart) return r + width;
      return r;
    }
    // finalStart > srcEnd
    if (r > srcEnd && r < finalStart + width) return r - width;
    return r;
  }

  shiftCells({
    decide: ({ row, col }) => {
      const next = forward(row);
      if (next === row) return { kind: "keep" };
      return { kind: "move", row: next, col };
    },
    adjustFormula: (cell) =>
      maybeAdjustFormulaForRowMove(cell, srcStart, srcEnd, finalStart),
  });
}

/**
 * Apply a column-insert + shift locally. Mirror of
 * ``deleteColsLocally`` for the insertion direction:
 *
 *   - Cells at ``col_idx >= at`` shift right by ``count``.
 *   - ``columnWidths`` gets the same shift so the grid doesn't
 *     show stale widths on the wrong columns.
 *   - Formula refs are rewritten via ``adjustRefsForInsertion``
 *     so the optimistic UI matches the server's post-insert
 *     formula text.
 *
 * Used by the local originator for instant feedback and by
 * remote clients when the ``columns-inserted`` SSE event arrives.
 */
export function insertColsLocally(at: number, count: number): void {
  if (count <= 0 || at < 0) return;
  const insertedCols = Array(count).fill(at);

  shiftCells({
    decide: ({ row, col }) => {
      if (col < at) return { kind: "keep" };
      // Cells that would shift past the visible column band drop
      // out of the local view. The server still holds them and
      // will re-surface on reload if the band ever grows.
      return { kind: "move", row, col: col + count };
    },
    adjustFormula: (cell) =>
      maybeAdjustFormulaForInsertion(cell, insertedCols, []),
  });

  shiftColumnWidthsForInsertion(at, count);
}

/**
 * Apply a row-delete + shift locally. Mirrors the server's single
 * ``UPDATE row_idx = row_idx - (#deleted below it)``:
 *
 *   - Cells whose row is in ``deletedRows`` are dropped.
 *   - Cells below get their row number reduced by the number of
 *     deletions above them, so there's no gap.
 *
 * Used by the local originator immediately after firing the API call
 * (for instant feedback) and by remote clients when the
 * ``rows-deleted`` SSE event arrives.
 */
export function deleteRowsLocally(deletedRows: number[]): void {
  const deletedSet = new Set(deletedRows);
  if (deletedSet.size === 0) return;
  const sortedDeleted = [...deletedSet].sort((a, b) => a - b);
  const deletedList = [...deletedSet];

  shiftCells({
    decide: ({ row, col }) => {
      if (deletedSet.has(row)) return { kind: "drop" };
      const shift = sortedDeleted.reduce((n, d) => (d < row ? n + 1 : n), 0);
      if (shift === 0) return { kind: "keep" };
      return { kind: "move", row: row - shift, col };
    },
    // Rewrite the formula text so optimistic UI shows the same
    // thing the server persists (see deleteColsLocally comment).
    adjustFormula: (cell) => maybeAdjustFormula(cell, [], deletedList),
  });
}
