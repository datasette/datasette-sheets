/**
 * The cell-data writable + per-cell subscriber bag + ``cellStore(id)``
 * factory. Free of engine-recalc logic — mutations live in
 * ``./mutations`` and structural shifts in ``./structuralOps``.
 *
 * [STORES-05] Split out of the monolithic ``createCellStore`` so the
 * three concerns (storage / mutation / structural shift) are wired
 * through explicit imports rather than a single ``this``-bound
 * object literal.
 */
import { writable, get } from "svelte/store";
import type { CellData, CellId, CellValue } from "../../spreadsheet/types";
import { createDefaultFormat } from "../../spreadsheet/formatter";
import type { CellInput } from "../../engine";
import {
  adjustRefsForColumnBlockMove,
  adjustRefsForRowBlockMove,
  adjustRefsForDeletion,
  adjustRefsForInsertion,
  loadIntoEngine,
  ownedBy,
  rawInput,
  spillAt,
} from "../../engine";

// ─── Writable + per-cell subscriber bag ──────────────────────────

/** The shared cell-data writable. Components can read it as ``$cells``;
 *  per-cell subscribers should use ``cellStore(id)`` below. */
export const cellsWritable = writable<Map<CellId, CellData>>(new Map());

type CellStoreSubscriber = (cell: CellData | undefined) => void;

// [perf] Per-cell subscriber bags. The top-level ``cellsWritable``
// still fans out to every Cell if used with ``$cells``; components
// that only care about one cell should subscribe via ``cellStore(id)``
// below, which only fires when *that* cell's object reference changes.
//
// Combined with the immutable merge above, this turns an O(N)
// fan-out per edit into O(dependents) — a single cell edit with no
// formula references only wakes its own subscriber, not the whole
// grid.
const perCellListeners: Map<CellId, Set<CellStoreSubscriber>> = new Map();

// Diff baseline only — NOT a public-read snapshot. This map lags the
// writable by exactly one notification: it's updated *inside*
// ``diffAndNotify``, which Svelte invokes after the writable's
// ``update``/``set`` returns. Reading it from a synchronous-after-
// mutation path (e.g. inside an event handler that just called
// ``setCellValue``) returns the pre-mutation state. Use
// ``getCell(id)`` for the always-current value — that helper reads
// the writable directly via ``get(cellsWritable)``.
let lastNotifiedCellsMap: Map<CellId, CellData> = new Map();

function diffAndNotify(current: Map<CellId, CellData>): void {
  // Walk every id that's in either map; notify only those whose cell
  // reference changed. The immutable merge in
  // ``mergeComputedIntoCells`` keeps unchanged cells at the same ref,
  // so ``prev !== next`` is a safe equality signal.
  const prev = lastNotifiedCellsMap;
  const seen = new Set<CellId>();
  for (const id of prev.keys()) {
    seen.add(id);
    const p = prev.get(id);
    const n = current.get(id);
    if (p !== n) {
      const listeners = perCellListeners.get(id);
      if (listeners) for (const fn of listeners) fn(n);
    }
  }
  for (const id of current.keys()) {
    if (seen.has(id)) continue;
    const n = current.get(id);
    const listeners = perCellListeners.get(id);
    if (listeners) for (const fn of listeners) fn(n);
  }
  lastNotifiedCellsMap = current;
}

// Permanent top-level subscriber that maintains ``lastNotifiedCellsMap``
// + dispatches per-cell notifications. Hot — runs once per store
// mutation — but cheap: at most one Map walk per mutation, skipping
// cells whose reference didn't change.
cellsWritable.subscribe(diffAndNotify);

/**
 * [perf] Per-cell Svelte store factory. Returns a ``Readable`` that
 * only fires when *this cell's* data object reference changes —
 * driven by the ``diffAndNotify`` dispatcher above and the immutable
 * merges in ``mergeComputedIntoCells`` / ``markFormulaErrors``.
 *
 * Usage from a component:
 *
 *   $: cell$ = cellStore(cellId);
 *   $: cell = $cell$;
 *
 * Svelte's auto-subscribe handles resubscription when ``cellId``
 * changes (e.g. a reused Cell component rebinds to a new id).
 *
 * This is the per-cell reactivity primitive that makes edits,
 * selection, and formula-ref colouring feel fast at scale — the old
 * ``$: cell = $cells.get(cellId)`` pattern woke *every* Cell on
 * every single mutation, even ones that didn't affect that cell.
 */
export function cellStore(id: CellId): {
  subscribe: (run: CellStoreSubscriber) => () => void;
} {
  return {
    subscribe(run) {
      let listeners = perCellListeners.get(id);
      if (!listeners) {
        listeners = new Set();
        perCellListeners.set(id, listeners);
      }
      listeners.add(run);
      // Svelte-store contract: fire once with the current value on
      // subscribe so downstream ``$: ...`` blocks see an initial
      // assignment. The diff baseline is fine for this — we only need
      // it to match what later ``diffAndNotify`` calls will compare
      // against, so a fresh subscriber sees a coherent before→after
      // sequence (no double-fire on a value that was already up to
      // date when this subscription opened).
      run(lastNotifiedCellsMap.get(id));
      return () => {
        const set = perCellListeners.get(id);
        if (!set) return;
        set.delete(run);
        if (set.size === 0) perCellListeners.delete(id);
      };
    },
  };
}

/** [perf] Reset per-cell subscriber bags — call from tests that
 *  reset module state in ``beforeEach`` so a stale subscriber
 *  doesn't fire against the next test's cellStore. Prod code
 *  never needs this; the unsubscribe returned by ``cellStore``
 *  cleans up naturally when components unmount. */
export function resetPerCellListeners(): void {
  perCellListeners.clear();
  lastNotifiedCellsMap = new Map();
}

/** Read the most-recent cell value. ``get({ subscribe })`` opens +
 *  closes a transient subscription and returns the writable's
 *  *current* value — synchronous against the store, not against the
 *  ``diffAndNotify`` subscriber chain. This matters when a caller
 *  mutates the store and then immediately reads back inside the same
 *  tick: the ``lastNotifiedCellsMap`` baseline lags by one
 *  notification and would return the pre-mutation state. The
 *  transient subscribe costs are in the noise next to the engine
 *  recalc. */
export function getCell(cellId: CellId): CellData | undefined {
  return get(cellsWritable).get(cellId);
}

// ─── Pure helpers — value classification + formula adjustment ────

/** Per-cell error detection. Engine errors flow back as ``CellValue::String("#…")``
 *  — a JS string starting with ``#``. Numbers, booleans, and well-formed
 *  strings are never errors. */
export function isErrorValue(val: CellValue): val is string {
  return typeof val === "string" && val.startsWith("#");
}

/** Run ``adjustRefsForDeletion`` on a cell's formula text (if it has
 *  one). Returns a new CellData only when the text actually changed,
 *  otherwise hands back the existing object so Svelte reactivity
 *  doesn't wake up for no reason. */
export function maybeAdjustFormula(
  cell: CellData,
  deletedCols: number[],
  deletedRows: number[],
): CellData {
  if (!cell.formula) return cell;
  const next = adjustRefsForDeletion(cell.rawValue, deletedCols, deletedRows);
  if (next === cell.rawValue) return cell;
  return {
    ...cell,
    rawValue: next,
    formula: next.startsWith("=") ? next : null,
    // Blank the computed value so recalculate() below recomputes
    // against the new text.
    computedValue: null,
    error: null,
  };
}

/** Sibling of ``maybeAdjustFormula`` for the insertion direction.
 *  Same immutable-when-unchanged discipline so Svelte subscribers
 *  don't wake up on cells whose formulas contain no straddled refs. */
export function maybeAdjustFormulaForInsertion(
  cell: CellData,
  insertedCols: number[],
  insertedRows: number[],
): CellData {
  if (!cell.formula) return cell;
  const next = adjustRefsForInsertion(
    cell.rawValue,
    insertedCols,
    insertedRows,
  );
  if (next === cell.rawValue) return cell;
  return {
    ...cell,
    rawValue: next,
    formula: next.startsWith("=") ? next : null,
    computedValue: null,
    error: null,
  };
}

/** Sibling of ``maybeAdjustFormula`` for column drag-reorder.
 *  Wraps ``adjustRefsForColumnBlockMove`` with the same
 *  immutable-when-unchanged + clear-computed discipline.
 */
// [sheet.column.drag-reorder]
export function maybeAdjustFormulaForMove(
  cell: CellData,
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): CellData {
  if (!cell.formula) return cell;
  const next = adjustRefsForColumnBlockMove(
    cell.rawValue,
    srcStart,
    srcEnd,
    finalStart,
  );
  if (next === cell.rawValue) return cell;
  return {
    ...cell,
    rawValue: next,
    formula: next.startsWith("=") ? next : null,
    computedValue: null,
    error: null,
  };
}

/** Sibling of ``maybeAdjustFormulaForMove`` for the row axis.
 *  Wraps ``adjustRefsForRowBlockMove`` (positional variant for
 *  cell formulas).
 */
// [sheet.row.drag-reorder]
export function maybeAdjustFormulaForRowMove(
  cell: CellData,
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): CellData {
  if (!cell.formula) return cell;
  const next = adjustRefsForRowBlockMove(
    cell.rawValue,
    srcStart,
    srcEnd,
    finalStart,
  );
  if (next === cell.rawValue) return cell;
  return {
    ...cell,
    rawValue: next,
    formula: next.startsWith("=") ? next : null,
    computedValue: null,
    error: null,
  };
}

// ─── Engine merge helpers ────────────────────────────────────────

/**
 * Apply an engine-computed cell→value map into ``newCells``. Writes
 * ``newCells`` in place so the caller's surrounding ``update`` only
 * performs one Svelte store notification (instead of the old "mutate,
 * recalculate, mutate again" pattern that woke every subscriber
 * twice per edit).
 *
 * [perf] **Immutable** at the cell-object level: a cell whose
 * ``computedValue`` / ``error`` / spill flags didn't change keeps its
 * *exact* reference. That's what the per-cell store primitive below
 * uses as its change signal — ``oldRef !== newRef`` → notify. Pre-
 * existing in-place mutation (``cell.computedValue = …``) would look
 * identical before and after a recalc, so every subscriber had to
 * assume every cell might have changed.
 *
 * Three passes, in order, because later passes depend on earlier ones:
 *   1. Merge computed values back onto known cells.
 *   2. Synthesize spill-member cells for any ids the engine returned
 *      that the store didn't know about.
 *   3. Classify anchors + members — must come last so synthesized
 *      spill members get the flag too.
 */
export function mergeComputedIntoCells(
  newCells: Map<CellId, CellData>,
  computed: Map<string, CellValue>,
): void {
  for (const [cellId, cell] of newCells) {
    const val = computed.get(cellId);
    let nextComputed: CellData["computedValue"];
    let nextError: string | null;
    if (val !== undefined) {
      nextComputed = val;
      nextError = isErrorValue(val) ? val : null;
    } else {
      nextComputed = cell.rawValue || null;
      nextError = null;
    }
    if (nextComputed !== cell.computedValue || nextError !== cell.error) {
      newCells.set(cellId, {
        ...cell,
        computedValue: nextComputed,
        error: nextError,
      });
    }
  }

  // [sheet.cell.spill]
  for (const [cellId, val] of computed) {
    if (newCells.has(cellId as CellId)) continue;
    newCells.set(cellId as CellId, {
      rawValue: "",
      computedValue: val,
      formula: null,
      format: createDefaultFormat(),
      error: isErrorValue(val) ? val : null,
    });
  }

  // [sheet.cell.spill]
  // Use strict equality against the raw field (no ``?? false``) so
  // newly-created cells — where the flag is ``undefined`` — always
  // get the boolean materialised. Consumers (Cell.svelte and the
  // spill test) expect ``isSpillAnchor``/``isSpillMember`` to be
  // booleans, not ``undefined``.
  for (const [cellId, cell] of newCells) {
    const anchor = ownedBy(cellId);
    const nextIsAnchor = anchor === cellId && spillAt(cellId) !== null;
    const nextIsMember = anchor !== null && anchor !== cellId;
    if (
      nextIsAnchor !== cell.isSpillAnchor ||
      nextIsMember !== cell.isSpillMember
    ) {
      newCells.set(cellId, {
        ...cell,
        isSpillAnchor: nextIsAnchor,
        isSpillMember: nextIsMember,
      });
    }
  }
}

/** Error-path fallback: mark all formula cells as errored when the
 *  engine throws. Shared between the full-rebuild and delta paths.
 *  Immutable — only allocates when a cell's state would change. */
export function markFormulaErrors(
  newCells: Map<CellId, CellData>,
  errMsg: string,
): void {
  for (const [cellId, cell] of newCells) {
    if (!cell.formula) continue;
    if (cell.computedValue !== null || cell.error !== errMsg) {
      newCells.set(cellId, { ...cell, computedValue: null, error: errMsg });
    }
  }
}

/** Reload every raw value into a fresh ``WasmSheet`` and merge the
 *  computed map back into ``newCells``. Mutates ``newCells`` in
 *  place — caller passes the same map it's about to return from a
 *  ``cells.update(...)`` callback so structural ops can do mutate +
 *  recalc under a single Svelte notification (no double
 *  ``diffAndNotify`` fire). Shared between ``recalculate`` /
 *  ``replaceAndRecalculate`` / ``deleteColsLocally`` /
 *  ``insertColsLocally`` / ``deleteRowsLocally``. */
export function reloadIntoEngineAndMerge(
  newCells: Map<CellId, CellData>,
): void {
  const entries: [string, CellInput][] = [];
  for (const [cellId, cell] of newCells) {
    if (cell.rawValue) {
      // Reconstruct the typed override from CellData.typedKind so a
      // force-text cell stays force-text after reload — without
      // this, the engine auto-classifies on the first recalc and
      // the cell briefly flickers to its classified form. [sheet.cell.force-text]
      if (cell.typedKind === "string") {
        entries.push([cellId, { kind: "string", value: cell.rawValue }]);
      } else {
        entries.push([cellId, rawInput(cell.rawValue)]);
      }
    }
  }
  try {
    const computed = loadIntoEngine(entries);
    mergeComputedIntoCells(newCells, computed);
  } catch (e) {
    markFormulaErrors(newCells, e instanceof Error ? e.message : "Error");
  }
}
