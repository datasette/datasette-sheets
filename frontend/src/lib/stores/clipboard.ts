import { writable, derived } from "svelte/store";
import type { CellId } from "../spreadsheet/types";
import { parseCellIdRaw } from "../engine";

/**
 * Clipboard state lives in its own module so ``persistence.ts`` can
 * subscribe to ``_activeSheetId`` and clear the clipboard mark on
 * sheet switch without forming a circular import with ``spreadsheet.ts``.
 *
 * Pre-refactor: ``persistence.ts`` imported ``clearClipboardMark`` from
 * ``./spreadsheet`` and called it inside a top-level subscriber. The
 * subscribe callback fires synchronously with the current value, which
 * during init meant the call landed *before* ``spreadsheet.ts`` had
 * finished evaluating the ``clipboardRange`` writable that
 * ``clearClipboardMark`` reads — a fragile cycle papered over with a
 * ``queueMicrotask``. Hoisting the writables here means both modules
 * depend on this leaf module and the cycle is gone.
 *
 * [STORES-08]
 */

/**
 * Cells currently tracked by the clipboard — both Cmd+C and Cmd+X
 * paint a dashed "marching ants" border around the range. The mode
 * (``"copy" | "cut"``) lives in a sibling store and drives the
 * paste-time behaviour: a cut removes the source cells on paste,
 * a copy leaves them so the user can paste again. Either mark is
 * cleared by Esc, a fresh copy/cut, or a sheet switch.
 */
export const clipboardRange = writable<Set<CellId>>(new Set());
export type ClipboardMode = "copy" | "cut" | null;
export const clipboardMode = writable<ClipboardMode>(null);

/**
 * Bounding box of the clipboard range, or ``null`` when nothing is
 * pending. Computed once per ``clipboardRange`` change so
 * ``Cell.svelte`` can cheaply decide whether it's on an outer edge
 * of the range (where the dashed border needs to be drawn).
 */
export const clipboardBounds = derived(clipboardRange, ($mark) => {
  if ($mark.size === 0) return null;
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const id of $mark) {
    const parsed = parseCellIdRaw(id);
    if (!parsed) continue;
    // ``parseCellId`` (in spreadsheet.ts) reports row 1-based; this
    // module's bounds compare against the same 1-based ``parsed.row``
    // values that ``Cell.svelte`` derives via ``parseCellId``, so we
    // shift the engine's 0-based row up by one to keep the contract
    // identical to the previous in-spreadsheet definition.
    const row = parsed.row + 1;
    const colIndex = parsed.col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (colIndex < minCol) minCol = colIndex;
    if (colIndex > maxCol) maxCol = colIndex;
  }
  if (minRow === Infinity) return null;
  return { minRow, maxRow, minCol, maxCol };
});

// [sheet.clipboard.mark-visual]
export function markCopyRange(ids: Iterable<CellId>) {
  clipboardRange.set(new Set(ids));
  clipboardMode.set("copy");
}

export function markCutRange(ids: Iterable<CellId>) {
  clipboardRange.set(new Set(ids));
  clipboardMode.set("cut");
}

export function clearClipboardMark() {
  clipboardRange.set(new Set());
  clipboardMode.set(null);
}
