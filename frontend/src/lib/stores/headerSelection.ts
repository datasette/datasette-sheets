/**
 * Header (row / column) drag-select state. [cell-grid-02]
 *
 * Both axes share one state machine. The Grid component used to carry
 * a parallel pair of `let` bindings + handler functions per axis
 * (`selectedColsSet` / `selectedRowsSet`, `colAnchor` / `rowAnchor`,
 * `extendColSelection` / `extendRowSelection`, …) — every fix had to
 * be applied twice and the eight `let`s constraints weren't enforced.
 * This store collapses both into one generic axis switch and exposes
 * a reactive `selected` Set + `anchor` / `farEdge` per axis.
 *
 * Conventions:
 *   - col axis indices are 0-based column offsets into ``COLUMNS``.
 *   - row axis indices are 1-based display rows (matching the row
 *     number rendered in the row header).
 *
 * Writes through to the cell-selection stores (``selectedCell``,
 * ``selectionAnchor``, ``selectedCells``) so the rest of the app
 * (formula bar, status bar, header range tint, copy/paste) sees a
 * normal range selection regardless of how it was initiated.
 *
 * `reconcileWith(sel)` is the listener side of the contract: when the
 * cell-selection set changes (e.g. user clicked a single cell), the
 * Grid component pipes that into here so we drop the header
 * highlight if it no longer fully covers the corresponding rows /
 * columns. Component owns its own subscribe / unsubscribe — see
 * Grid.svelte's onMount / onDestroy. The store is a module-level
 * singleton, so we deliberately keep the subscription out of here.
 */
import { derived, get, writable, type Readable } from "svelte/store";
import {
  COLUMNS,
  ROWS,
  cellIdFromCoords,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "./spreadsheet";
import type { CellId } from "../spreadsheet/types";

export type Axis = "row" | "col";

export interface HeaderAxisState {
  selected: Set<number>;
  anchor: number | null;
  farEdge: number | null;
  dragActive: boolean;
}

const EMPTY: HeaderAxisState = {
  selected: new Set(),
  anchor: null,
  farEdge: null,
  dragActive: false,
};

const colState = writable<HeaderAxisState>({ ...EMPTY, selected: new Set() });
const rowState = writable<HeaderAxisState>({ ...EMPTY, selected: new Set() });

function stateFor(axis: Axis) {
  return axis === "col" ? colState : rowState;
}

function range(a: number, b: number): number[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/**
 * Apply a whole-axis selection. Mirrors ``applyColSelection`` /
 * ``applyRowSelection`` from the pre-store Grid: clear the other
 * axis, expand the chosen axis to a full grid of cell ids, and pin
 * the active cell + anchor to the first row/col of the selection so
 * formula-bar focus and copy-payload bounds line up.
 */
function applySelection(axis: Axis, indices: number[]) {
  if (indices.length === 0) return;
  if (axis === "col") {
    rowState.update((s) => (s.selected.size === 0 ? s : { ...EMPTY }));
    const ids = new Set<CellId>();
    for (const c of indices) {
      for (const r of ROWS) ids.add(cellIdFromCoords(c, r));
    }
    const first = Math.min(...indices);
    selectedCell.set(cellIdFromCoords(first, 1));
    selectionAnchor.set(cellIdFromCoords(first, 1));
    selectedCells.set(ids);
  } else {
    colState.update((s) => (s.selected.size === 0 ? s : { ...EMPTY }));
    const ids = new Set<CellId>();
    for (const r of indices) {
      for (let c = 0; c < COLUMNS.length; c++) ids.add(cellIdFromCoords(c, r));
    }
    const first = Math.min(...indices);
    selectedCell.set(cellIdFromCoords(0, first));
    selectionAnchor.set(cellIdFromCoords(0, first));
    selectedCells.set(ids);
  }
}

function clamp(axis: Axis, idx: number): number {
  if (axis === "col") return Math.max(0, Math.min(COLUMNS.length - 1, idx));
  const maxRow = ROWS[ROWS.length - 1];
  return Math.max(1, Math.min(maxRow, idx));
}

/** Header click / shift-click. Mousedown of a fresh drag.
 *  ``shift`` true + an existing anchor extends from anchor → idx. */
function startDrag(axis: Axis, idx: number, shift: boolean): void {
  const store = stateFor(axis);
  const cur = get(store);
  if (shift && cur.anchor !== null) {
    const next: HeaderAxisState = {
      anchor: cur.anchor,
      farEdge: idx,
      selected: new Set(range(cur.anchor, idx)),
      dragActive: true,
    };
    store.set(next);
    applySelection(axis, [...next.selected]);
  } else {
    const next: HeaderAxisState = {
      anchor: idx,
      farEdge: idx,
      selected: new Set([idx]),
      dragActive: true,
    };
    store.set(next);
    applySelection(axis, [idx]);
  }
}

/** Mouseenter while drag is active — extend from anchor → idx. */
function extendDragTo(axis: Axis, idx: number): void {
  const store = stateFor(axis);
  const cur = get(store);
  if (!cur.dragActive || cur.anchor === null) return;
  const next: HeaderAxisState = {
    anchor: cur.anchor,
    farEdge: idx,
    selected: new Set(range(cur.anchor, idx)),
    dragActive: true,
  };
  store.set(next);
  applySelection(axis, [...next.selected]);
}

/** Mouseup — stop the drag, but keep the selection. */
function endDrag(axis: Axis): void {
  const store = stateFor(axis);
  store.update((s) => (s.dragActive ? { ...s, dragActive: false } : s));
}

/**
 * Shift+Arrow on a header-initiated selection. Walks ``farEdge`` by
 * one in the given direction, treating it (not the anchor) as the
 * moving endpoint. Google-Sheets-style: A→{A} + Shift+Right gives
 * {A,B}; another Shift+Right gives {A,B,C}; Shift+Left shrinks back.
 */
function extend(axis: Axis, step: 1 | -1): void {
  const store = stateFor(axis);
  const cur = get(store);
  if (cur.anchor === null || cur.farEdge === null) return;
  const next = clamp(axis, cur.farEdge + step);
  if (next === cur.farEdge) return;
  const indices = range(cur.anchor, next);
  store.set({
    anchor: cur.anchor,
    farEdge: next,
    selected: new Set(indices),
    dragActive: cur.dragActive,
  });
  applySelection(axis, indices);
}

/**
 * Reconcile header highlights against the cell-selection set. Called
 * whenever ``selectedCells`` updates: if the highlighted columns no
 * longer fully cover every row (or vice versa), clear that axis. The
 * caller passes ``sel`` from the subscription callback rather than
 * reading ``$selectedCells`` again — Svelte's auto-subscription read
 * can be stale relative to the value the subscriber was just notified
 * of, which would race the just-applied header highlight off.
 */
function reconcileWith(sel: Set<CellId>): void {
  const cs = get(colState);
  if (cs.selected.size > 0) {
    const stillFull = [...cs.selected].every((c) =>
      ROWS.every((r) => sel.has(cellIdFromCoords(c, r))),
    );
    if (!stillFull) colState.set({ ...EMPTY, selected: new Set() });
  }
  const rs = get(rowState);
  if (rs.selected.size > 0) {
    const stillFull = [...rs.selected].every((r) =>
      COLUMNS.every((_, c) => sel.has(cellIdFromCoords(c, r))),
    );
    if (!stillFull) rowState.set({ ...EMPTY, selected: new Set() });
  }
}

/**
 * Reset both axes. Used after a row/column delete commits — the
 * indices that were highlighted no longer point to the same cells
 * (rows shifted up, cols shifted left), so blow the highlight away.
 */
function clear(axis?: Axis): void {
  if (axis === undefined || axis === "col") {
    colState.set({ ...EMPTY, selected: new Set() });
  }
  if (axis === undefined || axis === "row") {
    rowState.set({ ...EMPTY, selected: new Set() });
  }
}

/** Imperatively set the axis state — used by the column-insert path
 *  in Grid.svelte to translate the selection along with the inserted
 *  columns. Most callers should use the gesture helpers above. */
function setAxis(axis: Axis, next: Partial<HeaderAxisState>): void {
  const store = stateFor(axis);
  store.update((s) => ({ ...s, ...next }));
}

export const headerSelection = {
  col: { subscribe: colState.subscribe } as Readable<HeaderAxisState>,
  row: { subscribe: rowState.subscribe } as Readable<HeaderAxisState>,
  startDrag,
  extendDragTo,
  endDrag,
  extend,
  reconcileWith,
  clear,
  setAxis,
};

/**
 * Convenience: a reactive Set of selected indices per axis. Most
 * callers want this rather than the full ``HeaderAxisState`` (the
 * other fields are only relevant inside the gesture handlers).
 */
export const selectedCols: Readable<Set<number>> = derived(
  colState,
  ($s) => $s.selected,
);
export const selectedRows: Readable<Set<number>> = derived(
  rowState,
  ($s) => $s.selected,
);

/** Test-only reset. Mirrors the shape used by other singleton stores
 *  in this module (see ``_resetOverlayTriggerForTests``). */
export function _resetHeaderSelectionForTests(): void {
  colState.set({ ...EMPTY, selected: new Set() });
  rowState.set({ ...EMPTY, selected: new Set() });
}
