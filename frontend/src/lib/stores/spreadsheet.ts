import { writable, derived, get } from "svelte/store";
import type { CellData, CellFormat, CellId } from "../spreadsheet/types";
import {
  cellId,
  getPinsSnapshot,
  indexToCol,
  parseCellIdRaw,
  replacePins,
} from "../engine";

// Grid bounds + column widths live in their own module — see
// ``./columnWidths``. Re-exported here for the ~dozen consumers
// that still import them through ``stores/spreadsheet``. New
// callers should import directly. [STORES-05]
export {
  COLUMNS,
  ROWS,
  columnWidths,
  setColumnWidth,
  getMinColWidth,
} from "./columnWidths";

// Cell store internals live in ``./cells/*``. ``spreadsheet.ts``
// stitches them together as the legacy ``cells`` facade so the
// ~60 callers that destructure ``cells.foo()`` still resolve. New
// code should import the free functions directly from
// ``./cells/mutations`` / ``./cells/structuralOps``. [STORES-05]
import {
  cellsWritable,
  cellStore as _cellStore,
  resetPerCellListeners,
  getCell as _getCell,
} from "./cells/store";
import {
  setCellValue as _setCellValue,
  setCellValueAsString as _setCellValueAsString,
  setCellValueBatch as _setCellValueBatch,
  setCellFormat as _setCellFormat,
  resetCellFormat as _resetCellFormat,
  recalculate as _recalculate,
  replaceAndRecalculate as _replaceAndRecalculate,
  refreshFromEngine as _refreshFromEngine,
  clearCells as _clearCells,
} from "./cells/mutations";
import {
  deleteColsLocally as _deleteColsLocally,
  insertColsLocally as _insertColsLocally,
  deleteRowsLocally as _deleteRowsLocally,
  moveColsLocally as _moveColsLocally,
  moveRowsLocally as _moveRowsLocally,
} from "./cells/structuralOps";

import { COLUMNS, ROWS } from "./columnWidths";
// [sheet.filter.row-hide] Lazy-style import — used inside ``navigate``
// so arrow-up/down skip filter-hidden rows rather than walking onto
// them. Lives in stores/filter, which already imports cells/store +
// columnWidths and not spreadsheet — so this import direction is
// clean (no cycle).
import { hiddenRowIndices } from "./filter";
import { nextVisibleRow } from "../virtualization";

/**
 * Legacy facade over the cell store split. Exposes the writable's
 * Svelte-store surface (``subscribe`` / ``set`` / ``update``) plus
 * thin wrappers over the free functions in ``./cells/*``. New code
 * should call those free functions directly — they're free of
 * ``this`` so destructuring ``const { setCellValue } = cells`` won't
 * silently break a binding the way it would on a method literal.
 *
 * [STORES-05]
 */
export const cells = {
  subscribe: cellsWritable.subscribe,
  set: cellsWritable.set,
  update: cellsWritable.update,
  getCell: _getCell,
  setCellValue: _setCellValue,
  setCellValueAsString: _setCellValueAsString,
  setCellValueBatch: _setCellValueBatch,
  setCellFormat: _setCellFormat,
  resetCellFormat: _resetCellFormat,
  recalculate: _recalculate,
  replaceAndRecalculate: _replaceAndRecalculate,
  refreshFromEngine: _refreshFromEngine,
  deleteColsLocally: _deleteColsLocally,
  insertColsLocally: _insertColsLocally,
  deleteRowsLocally: _deleteRowsLocally,
  moveColsLocally: _moveColsLocally,
  moveRowsLocally: _moveRowsLocally,
  clear: _clearCells,
  _resetPerCellListeners: resetPerCellListeners,
};

export const cellStore = _cellStore;

// Selection state
export const selectedCell = writable<CellId | null>(null);
export const editingCell = writable<CellId | null>(null);
export const editValue = writable<string>("");

// Multi-selection: the anchor is where shift-selection started from
export const selectionAnchor = writable<CellId | null>(null);
// Far edge of a shift-extended selection — the corner opposite the
// anchor. Shift+Arrow navigates from here, not from ``selectedCell``
// (the active/main cell), so that Cmd+Shift+Down from B2 extends to
// B6 and a second Cmd+Shift+Down keeps walking from B6. Kept in sync
// by ``selectSingle`` / ``selectRange``.
export const selectionFarEdge = writable<CellId | null>(null);
// The full set of highlighted cells (includes selectedCell)
export const selectedCells = writable<Set<CellId>>(new Set());
// Whether a mouse drag selection is in progress
export const isDragging = writable<boolean>(false);

// Formula reference highlighting: maps cell IDs to their highlight color
export const formulaRefColors = writable<Map<CellId, string>>(new Map());

// ─── Per-cell indexed signals ────────────────────────────────────
//
// [perf] Cells used to re-run ALL of their ``$: isSelected``,
// ``$: isHighlighted``, ``$: isEditing``, ``$: isClipboardMarked``,
// ``$: refColor`` blocks on every arrow nav / drag / formula
// keystroke, because those blocks subscribed to the global selection
// stores above. With 1500 Cell instances × 5 blocks × a handful of
// store writes per selection change, that's tens of thousands of
// reactive-block evaluations per keystroke.
//
// Indexed signals below fire per-cell: when ``selectedCell`` moves
// from A1 → B2, only A1's and B2's subscribers wake; everyone else
// stays asleep. The primitive doesn't replace the original stores —
// they're still read by non-Cell consumers (Toolbar, Grid header
// highlights, StatusBar) — but Cell.svelte drives its ``.selected`` /
// ``.highlighted`` / ``.editing`` / ``.clipboard-marked`` classes off
// these instead.

/** Fires ``true`` when ``id`` is the new single-cell value, ``false``
 *  when it was and no longer is. Only listeners for the *outgoing*
 *  and *incoming* ids run on each transition. */
function indexedSingleSignal<T>(
  source: {
    subscribe: (run: (v: T | null) => void) => () => void;
  },
  matches: (v: T | null, id: CellId) => boolean,
): (id: CellId) => { subscribe: (run: (isIt: boolean) => void) => () => void } {
  const listeners = new Map<CellId, Set<(isIt: boolean) => void>>();
  let previous: T | null = null;
  source.subscribe((current) => {
    // Simple single-cell case: notify only the id that lost or gained
    // the flag. Guard against no-op notifies where the underlying
    // store fires with the same value.
    if (current === previous) return;
    // Cast previous as CellId to use as a Map key; guarded by the
    // outer null check in matches below.
    if (previous !== null) {
      const prevId = previous as unknown as CellId;
      const set = listeners.get(prevId);
      if (set) for (const fn of set) fn(matches(current, prevId));
    }
    if (current !== null) {
      const nextId = current as unknown as CellId;
      const set = listeners.get(nextId);
      if (set) for (const fn of set) fn(matches(current, nextId));
    }
    previous = current;
  });
  return (id: CellId) => ({
    subscribe(run) {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(run);
      run(matches(previous, id));
      return () => {
        const s = listeners.get(id);
        if (!s) return;
        s.delete(run);
        if (s.size === 0) listeners.delete(id);
      };
    },
  });
}

/** Fires ``true``/``false`` only for cells whose Set membership
 *  changed. Cheap even with large sets because we only walk the
 *  symmetric diff — cells that stayed in or stayed out do nothing. */
function indexedSetSignal(source: {
  subscribe: (run: (v: Set<CellId>) => void) => () => void;
}): (id: CellId) => {
  subscribe: (run: (inSet: boolean) => void) => () => void;
} {
  const listeners = new Map<CellId, Set<(inSet: boolean) => void>>();
  let previous: Set<CellId> = new Set();
  source.subscribe((current) => {
    for (const id of previous) {
      if (!current.has(id)) {
        const set = listeners.get(id);
        if (set) for (const fn of set) fn(false);
      }
    }
    for (const id of current) {
      if (!previous.has(id)) {
        const set = listeners.get(id);
        if (set) for (const fn of set) fn(true);
      }
    }
    previous = current;
  });
  return (id: CellId) => ({
    subscribe(run) {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(run);
      run(previous.has(id));
      return () => {
        const s = listeners.get(id);
        if (!s) return;
        s.delete(run);
        if (s.size === 0) listeners.delete(id);
      };
    },
  });
}

/** Same idea as ``indexedSetSignal`` but for ``Map<CellId, V>`` — fires
 *  when the per-cell value changes (including add/remove). */
function indexedMapSignal<V>(source: {
  subscribe: (run: (v: Map<CellId, V>) => void) => () => void;
}): (id: CellId) => {
  subscribe: (run: (v: V | undefined) => void) => () => void;
} {
  const listeners = new Map<CellId, Set<(v: V | undefined) => void>>();
  let previous: Map<CellId, V> = new Map();
  source.subscribe((current) => {
    for (const id of previous.keys()) {
      if (!current.has(id)) {
        const set = listeners.get(id);
        if (set) for (const fn of set) fn(undefined);
      }
    }
    for (const [id, v] of current) {
      if (previous.get(id) !== v) {
        const set = listeners.get(id);
        if (set) for (const fn of set) fn(v);
      }
    }
    previous = current;
  });
  return (id: CellId) => ({
    subscribe(run) {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(run);
      run(previous.get(id));
      return () => {
        const s = listeners.get(id);
        if (!s) return;
        s.delete(run);
        if (s.size === 0) listeners.delete(id);
      };
    },
  });
}

// The indexed-signal bindings themselves live below ``clipboardRange``;
// the clipboard writables now live in ``./clipboard`` and are
// re-exported below for consumers that still import from this module.

// True while the cell being edited has an unclosed function call at the
// caret — drives the "active argument" fill on backing cells
// (Google-Sheets-style: fill only while you're still typing inside
// ``SUM(…)``, outline-only once the ``)`` closes the call).
export const formulaInOpenCall = writable<boolean>(false);

// Clipboard state lives in ``./clipboard`` so ``persistence.ts`` can
// subscribe to ``_activeSheetId`` and clear the mark on sheet switch
// without forming a circular import with this module. Re-exported
// here for back-compat with the dozen consumers that have imported
// these names from ``stores/spreadsheet`` since the refactor. New
// callers should import directly from ``./clipboard``. [STORES-08]
export {
  clipboardRange,
  clipboardMode,
  clipboardBounds,
  markCopyRange,
  markCutRange,
  clearClipboardMark,
  type ClipboardMode,
} from "./clipboard";
import { clipboardRange } from "./clipboard";

/** [perf] Is ``id`` the active (primary) selection? */
export const isActiveCellSignal = indexedSingleSignal<CellId>(
  selectedCell,
  (v, id) => v === id,
);

/** [perf] Is ``id`` currently being edited? */
export const isEditingCellSignal = indexedSingleSignal<CellId>(
  editingCell,
  (v, id) => v === id,
);

/** [perf] Is ``id`` in the current multi-selection? Includes the
 *  active cell. */
export const isHighlightedCellSignal = indexedSetSignal(selectedCells);

/** [perf] Is ``id`` carrying the dashed "marching ants" copy/cut
 *  border? */
export const isClipboardMarkedCellSignal = indexedSetSignal(clipboardRange);

/** [perf] Highlight colour of ``id`` when it's a reference target of
 *  an open formula edit, or ``undefined``. */
export const formulaRefColorCellSignal =
  indexedMapSignal<string>(formulaRefColors);

/** Select a single cell, clearing any multi-selection */
export function selectSingle(cellId: CellId) {
  selectedCell.set(cellId);
  selectionAnchor.set(cellId);
  selectionFarEdge.set(cellId);
  selectedCells.set(new Set([cellId]));
}

/** Toggle a cell in the selection (Cmd/Ctrl+Click) */
// [sheet.selection.cmd-click]
export function selectToggle(cellId: CellId) {
  selectedCell.set(cellId);
  selectedCells.update((s) => {
    const next = new Set(s);
    if (next.has(cellId)) {
      next.delete(cellId);
      // If we removed the active cell, pick another one
      if (next.size > 0) {
        const first = [...next][next.size - 1];
        selectedCell.set(first);
      }
    } else {
      next.add(cellId);
    }
    return next;
  });
  // Keep anchor as-is for cmd+click
}

/** Compute the rectangular range between two cell IDs */
export function cellsInRange(from: CellId, to: CellId): CellId[] {
  const a = parseCellId(from);
  const b = parseCellId(to);
  const minCol = Math.min(a.colIndex, b.colIndex);
  const maxCol = Math.max(a.colIndex, b.colIndex);
  const minRow = Math.min(a.row, b.row);
  const maxRow = Math.max(a.row, b.row);

  const result: CellId[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      result.push(cellIdFromCoords(c, r));
    }
  }
  return result;
}

/**
 * Extend selection from anchor to target (Shift+Click, Shift+Arrow,
 * drag). ``keepActive`` leaves ``selectedCell`` alone — used by the
 * click-and-drag path so the "main" cell stays at the anchor while
 * the range grows, matching Google Sheets behaviour. Keyboard
 * shift-arrow intentionally does *not* set this, so the active
 * cell follows the extension point.
 */
export function selectRange(
  targetId: CellId,
  options?: { keepActive?: boolean },
) {
  const anchor = get(selectionAnchor);
  if (!anchor) {
    selectSingle(targetId);
    return;
  }
  if (!options?.keepActive) {
    selectedCell.set(targetId);
  }
  selectionFarEdge.set(targetId);
  selectedCells.set(new Set(cellsInRange(anchor, targetId)));
}

// Derived store: aggregate stats for selected cells
// [sheet.status-bar.numeric-stats]
export const selectionStats = derived(
  [selectedCells, cells],
  ([$selectedCells, $cells]) => {
    if ($selectedCells.size <= 1) return null;

    const numbers: number[] = [];

    for (const cellId of $selectedCells) {
      const cell = $cells.get(cellId);
      if (!cell) continue;
      const v = cell.computedValue;
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (typeof v === "number") {
        numbers.push(v);
      }
    }

    if (numbers.length === 0) return null;

    const sum = numbers.reduce((a, b) => a + b, 0);
    return {
      sum,
      average: sum / numbers.length,
      count: numbers.length,
      min: Math.min(...numbers),
      max: Math.max(...numbers),
    };
  },
);

// A1 ↔ (row, col) parsing is delegated to the engine
// (``lotus-core::{parse_cell_id, cell_id, index_to_col}``). These
// wrappers add the store's legacy 1-based-row shape and the grid-bound
// clamping that consumers expect; the underlying grammar lives in
// liblotus, not here.
export function parseCellId(id: CellId) {
  const parsed = parseCellIdRaw(id) ?? { row: 0, col: 0 };
  return {
    col: indexToCol(parsed.col),
    row: parsed.row + 1, // engine is 0-based; this API stays 1-based
    colIndex: parsed.col,
  };
}

export function cellIdFromCoords(colIndex: number, row: number) {
  const clampedCol = Math.max(0, Math.min(COLUMNS.length - 1, colIndex));
  const clampedRow = Math.max(1, Math.min(ROWS[ROWS.length - 1], row));
  return cellId(clampedRow - 1, clampedCol) as CellId;
}

/**
 * Compact A1-range name for a set of cell IDs. Single cell → ``"A1"``;
 * anything larger → ``"A1:B3"`` using the bounding rectangle. Used
 * by the debug log and by the clipboard annotation so pasted
 * content carries its source range. Non-rectangular selections still
 * collapse to their bounding box — fine in practice since every
 * real selection this app emits is rectangular.
 */
export function rangeNameFor(ids: Iterable<CellId>): string | null {
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  let any = false;
  for (const id of ids) {
    const { row, colIndex } = parseCellId(id);
    if (colIndex === -1) continue;
    any = true;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (colIndex < minCol) minCol = colIndex;
    if (colIndex > maxCol) maxCol = colIndex;
  }
  if (!any) return null;
  const tl = cellIdFromCoords(minCol, minRow);
  if (minRow === maxRow && minCol === maxCol) return tl;
  const br = cellIdFromCoords(maxCol, maxRow);
  return `${tl}:${br}`;
}

const NAV_STEP: Record<
  "up" | "down" | "left" | "right",
  { dc: number; dr: number }
> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

// Navigate from a cell in a direction. With ``meta=true`` this
// implements Google-Sheets-style Ctrl+Arrow jumps:
//   - on a non-empty cell whose neighbour is also non-empty: jump to
//     the far end of the contiguous run
//   - otherwise: walk past any blanks to the first non-empty, or snap
//     to the grid edge if there's nothing in that direction
// [sheet.navigation.arrow] [sheet.navigation.arrow-jump]
export function navigate(
  cellId: CellId,
  direction: "up" | "down" | "left" | "right",
  meta = false,
): CellId {
  const { colIndex, row } = parseCellId(cellId);

  // [sheet.filter.row-hide] Skip filter-hidden rows on up/down. The
  // ``hidden`` set is keyed by 0-based row index; the rest of this
  // function uses 1-based ``row``, so we convert at the boundary.
  const hidden = get(hiddenRowIndices);
  if (!meta) {
    switch (direction) {
      case "up": {
        const nextIdx = nextVisibleRow(row - 1, -1, hidden, ROWS.length);
        return cellIdFromCoords(colIndex, Math.max(1, nextIdx + 1));
      }
      case "down": {
        const nextIdx = nextVisibleRow(row - 1, 1, hidden, ROWS.length);
        return cellIdFromCoords(
          colIndex,
          Math.min(ROWS[ROWS.length - 1], nextIdx + 1),
        );
      }
      case "left":
        return cellIdFromCoords(Math.max(0, colIndex - 1), row);
      case "right":
        return cellIdFromCoords(
          Math.min(COLUMNS.length - 1, colIndex + 1),
          row,
        );
    }
  }

  const { dc, dr } = NAV_STEP[direction];
  const maxCol = COLUMNS.length - 1;
  const maxRow = ROWS[ROWS.length - 1];
  const inBounds = (c: number, r: number) =>
    c >= 0 && c <= maxCol && r >= 1 && r <= maxRow;

  const isNonEmpty = (c: number, r: number) => {
    const cell = cells.getCell(cellIdFromCoords(c, r));
    return !!(cell?.rawValue && String(cell.rawValue).trim() !== "");
  };

  // Already against the edge in this direction → stay put.
  if (!inBounds(colIndex + dc, row + dr)) return cellId;

  const currentFilled = isNonEmpty(colIndex, row);
  const neighbourFilled = isNonEmpty(colIndex + dc, row + dr);

  let c = colIndex + dc;
  let r = row + dr;

  if (currentFilled && neighbourFilled) {
    // Walk to the last non-empty in the contiguous run.
    while (inBounds(c + dc, r + dr) && isNonEmpty(c + dc, r + dr)) {
      c += dc;
      r += dr;
    }
    return cellIdFromCoords(c, r);
  }

  // Either current is empty or the neighbour is: walk past any
  // blanks to the next non-empty, or snap to the grid edge.
  while (inBounds(c, r) && !isNonEmpty(c, r)) {
    c += dc;
    r += dr;
  }
  if (!inBounds(c, r)) {
    const edgeCol = dc > 0 ? maxCol : dc < 0 ? 0 : colIndex;
    const edgeRow = dr > 0 ? maxRow : dr < 0 ? 1 : row;
    return cellIdFromCoords(edgeCol, edgeRow);
  }
  return cellIdFromCoords(c, r);
}

// ─── Undo / Redo ─────────────────────────────────────────────────

type CellSnapshot = Map<CellId, { rawValue: string; format: CellFormat }>;

interface UndoFrame {
  cells: CellSnapshot;
  // Engine pin state at snapshot time. ``=SQL(...)`` and other host
  // spills land here; without snapshotting them, undo would leave a
  // pin pointing at a cell whose raw value just got rolled back, so
  // the engine would re-spill ghost values on the next recalc.
  pins: Record<string, string[][]>;
  // Dirty-cell IDs at snapshot time. Restored verbatim on undo so the
  // next flush uploads exactly the restored content rather than the
  // mid-mutation dirty set. Named ranges + dropdown rules are
  // intentionally NOT in the frame — see specs/sheet.undo.scope.md.
  dirty: Set<CellId>;
}

const MAX_UNDO = 50;
const undoStack: UndoFrame[] = [];
const redoStack: UndoFrame[] = [];

// Persistence owns the dirty-cell set; spreadsheet owns the undo
// stack. The two cross paths exactly here, so persistence registers a
// snapshot/restore pair on module init and undo/redo route through it.
// Late binding avoids a top-level import cycle (persistence already
// imports from this module).
interface DirtyTracker {
  snapshot: () => Set<CellId>;
  restore: (next: Set<CellId>) => void;
}
let _dirtyTracker: DirtyTracker | null = null;

export function registerDirtyTracker(tracker: DirtyTracker): void {
  _dirtyTracker = tracker;
}

function snapshotCellsMap(): CellSnapshot {
  const map = get(cells) as Map<CellId, CellData>;
  const snap: CellSnapshot = new Map();
  for (const [id, cell] of map) {
    snap.set(id, { rawValue: cell.rawValue, format: { ...cell.format } });
  }
  return snap;
}

function snapshotFrame(): UndoFrame {
  return {
    cells: snapshotCellsMap(),
    pins: getPinsSnapshot(),
    dirty: _dirtyTracker ? _dirtyTracker.snapshot() : new Set<CellId>(),
  };
}

function restoreFrame(frame: UndoFrame): void {
  // Order matters: roll the engine's pin overlay back to the snapshot
  // BEFORE the cell map is reloaded, so ``replaceAndRecalculate``
  // (which rebuilds the WasmSheet via ``loadIntoEngine``) re-applies
  // the right pin set rather than resurrecting whatever was pinned
  // mid-mutation.
  replacePins(frame.pins);

  const map = new Map<CellId, CellData>();
  for (const [id, data] of frame.cells) {
    map.set(id, {
      rawValue: data.rawValue,
      computedValue: null,
      formula: data.rawValue.startsWith("=") ? data.rawValue : null,
      format: { ...data.format },
      error: null,
    });
  }
  cells.replaceAndRecalculate(map);

  if (_dirtyTracker) _dirtyTracker.restore(frame.dirty);
}

/** Call before any mutation to save the current state for undo */
// [sheet.undo.scope]
export function pushUndo() {
  undoStack.push(snapshotFrame());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

export function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(snapshotFrame());
  const frame = undoStack.pop()!;
  restoreFrame(frame);
}

export function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotFrame());
  const frame = redoStack.pop()!;
  restoreFrame(frame);
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function clearUndoHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

// Helper to get computed value for display
export function getCellDisplayValue(cellId: CellId): string {
  const cell = cells.getCell(cellId);
  if (!cell) return "";
  if (cell.error) return cell.error;
  if (cell.computedValue === null) return "";
  if (typeof cell.computedValue === "boolean") {
    return cell.computedValue ? "TRUE" : "FALSE";
  }
  return String(cell.computedValue);
}
