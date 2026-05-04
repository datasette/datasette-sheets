/**
 * Wrapper around the Rust WASM spreadsheet engine.
 * Single source of truth for formula evaluation.
 */
import { WasmSheet } from "../../vendor/lotus-wasm/lotus_wasm";
import type { CellValue } from "./spreadsheet/types";

let sheet: WasmSheet | null = null;

// Workbook-global named ranges. Held outside the WasmSheet so every
// recalc pass (which builds a fresh WasmSheet via ``loadIntoEngine``)
// can re-inject them — parallels the server's ``_recalculate_sheet``
// which loads names from the DB on every pass. Keys are uppercased
// because the engine's name table is case-insensitive.
let _names: Record<string, string> = {};

// Host-injected pin values keyed by anchor cellId. Same reason as
// ``_names``: ``loadIntoEngine`` builds a fresh ``WasmSheet``, so we
// re-apply pins afterwards to keep async-data sources (``=SQL()``
// and friends) surviving every recalc. Cleared on sheet switch.
// [sheet.cell.pin]
let _pins: Record<string, string[][]> = {};

function applyNames(s: WasmSheet): void {
  for (const [k, v] of Object.entries(_names)) {
    try {
      s.set_name(k, v);
    } catch {
      // Skip any individually invalid name rather than throwing
      // out the whole recalc — the panel surfaces validation
      // errors at save time.
    }
  }
}

function applyPins(s: WasmSheet): void {
  for (const [id, rows] of Object.entries(_pins)) {
    try {
      s.pin_value(id, JSON.stringify(rows));
    } catch {
      // Impossible-input guard; caller-side validation should keep
      // these out. Don't abort the whole recalc for one bad pin.
    }
  }
}

/** Replace the in-memory named-range map. Call on sheet load. */
export function setEngineNames(names: Record<string, string>): void {
  _names = {};
  for (const [k, v] of Object.entries(names)) {
    _names[k.toUpperCase()] = v;
  }
}

/** Add or overwrite a single named range. Pushes the change into the
 *  live ``WasmSheet`` (if any) so callers can re-emit computed values
 *  via a delta ``setAndRecalculate([])`` instead of rebuilding the
 *  whole engine. The live ``set_name`` runs ``Sheet::recalculate``
 *  internally — see liblotus dag.rs::set_name. */
export function setEngineName(name: string, definition: string): void {
  _names[name.toUpperCase()] = definition;
  if (sheet) {
    try {
      sheet.set_name(name, definition);
    } catch {
      // Skip individually-invalid names; matches ``applyNames``.
    }
  }
}

/** Remove a named range by name (case-insensitive). Mirrors
 *  ``setEngineName`` — also drops the name from the live engine so a
 *  subsequent delta recalc sees the new state. */
export function removeEngineName(name: string): void {
  delete _names[name.toUpperCase()];
  if (sheet) {
    try {
      sheet.remove_name(name);
    } catch {
      // Engine throws on unknown names; harmless to drop.
    }
  }
}

/** Register the lotus-datetime + lotus-url handlers so ISO date / time
 *  strings auto-classify as jdate / jtime / jdatetime / jzoned (date
 *  arithmetic resolves to jspan) and URL strings auto-classify as
 *  jurl. Mirrors db.py::_recalculate_sheet on the backend. */
function registerHandlers(s: WasmSheet): void {
  try {
    s.register_datetime();
  } catch {
    // The wasm pkg must be built with --features datetime (see Justfile
    // engine-wasm). If a future split-feature build lacks it, classify
    // dates as plain strings rather than failing the whole load.
  }
  try {
    s.register_url();
  } catch {
    // Same story for --features url; fall back to plain strings.
  }
}

/** Initialize a fresh WASM sheet (call on sheet switch/load). */
export function resetEngine(): void {
  sheet = new WasmSheet();
  registerHandlers(sheet);
  applyNames(sheet);
  applyPins(sheet);
}

/** Get the engine instance, creating one if needed. */
function getEngine(): WasmSheet {
  if (!sheet) {
    sheet = new WasmSheet();
    registerHandlers(sheet);
  }
  return sheet;
}

/** Kind-discriminated cell input for ``WasmSheet.set_cells_typed`` —
 *  mirrors the lotus-pyo3 ``set_cells_typed`` shape so frontend recalc
 *  applies the same per-cell typed overrides the server persists.
 *  [sheet.cell.force-text] is the first user-visible producer of
 *  ``kind: "string"`` writes. */
export type CellInput =
  | { kind: "raw"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "empty" }
  | { kind: "custom"; type_tag: string; data: string };

/** Convenience wrapper for the common ``kind: "raw"`` case. */
export function rawInput(value: string): CellInput {
  return { kind: "raw", value };
}

/**
 * Apply cell changes to the Rust engine and return all computed values.
 * Changes: array of [cellId, CellInput] pairs. A bare raw write should
 * use ``rawInput(rawValue)`` for clarity.
 * Returns a Map of cellId → typed computed value (number / string /
 * boolean / null / Custom{type_tag,data}). Booleans pass through native
 * JS — ``get_all_typed`` preserves the engine's CellValue::Boolean
 * variant rather than collapsing to ``"TRUE"`` / ``"FALSE"`` strings.
 */
export function setAndRecalculate(
  changes: [string, CellInput][],
): Map<string, CellValue> {
  const engine = getEngine();
  engine.set_cells_typed(JSON.stringify(changes));
  return typedMap(engine.get_all_typed());
}

/**
 * Load a full set of cells into the engine (used on sheet load).
 * Replaces the engine state entirely.
 */
export function loadIntoEngine(
  cellEntries: [string, CellInput][],
): Map<string, CellValue> {
  sheet = new WasmSheet();
  registerHandlers(sheet);
  applyNames(sheet);
  applyPins(sheet);
  if (cellEntries.length !== 0) {
    sheet.set_cells_typed(JSON.stringify(cellEntries));
  }
  // Even with no raw values, pins can spill — `get_all_typed` returns
  // the pinned-cells map so the store sees them.
  return typedMap(sheet.get_all_typed());
}

function typedMap(obj: unknown): Map<string, CellValue> {
  const out = new Map<string, CellValue>();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out.set(k, coerceTypedValue(v));
    }
  }
  return out;
}

/**
 * Matches a "looks-like-a-number" string the way a spreadsheet user
 * expects: optional sign, digits with optional fractional tail (or a
 * pure fractional like ``.5``), optional scientific suffix. No
 * leading/trailing whitespace, no thousand separators, no hex / octal
 * / underscore literals — those stay as strings.
 *
 * Used by ``coerceTypedValue`` instead of the previous
 * ``String(parseFloat(v)) === v`` round-trip predicate, which was
 * asymmetric (``"42"`` → 42 but ``"42.0"`` → ``"42.0"`` because
 * ``String(42) !== "42.0"``). That meant a single column of
 * ``=SQL(...)`` results could mix numeric- and string-typed cells
 * depending on whether SQLite returned ``42`` or ``42.0``, which then
 * cascaded to mixed alignment + formatter behaviour.
 *
 * This is local data-shape sniffing on a cell value (not formula
 * grammar), which the project's "engine owns parsing" rule
 * explicitly permits — see CLAUDE.md "Exception: pure data sanitation
 * of user-typed text".
 */
const NUMERIC_LITERAL_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Engine-typed values (number / string / boolean / null) usually pass
 * through as-is, but numeric strings need a second pass: ``pin_value``
 * (used by ``=SQL(…)`` and other host-injected arrays) wraps every
 * cell as ``CellValue::String`` because the wasm boundary takes a
 * 2-D string array. A pinned ``"42"`` should still feel like a number
 * to the rest of the app — same rule the old string-only path
 * applied. Booleans and non-numeric strings are unchanged.
 *  [sheet.cell.pin]
 */
function coerceTypedValue(v: unknown): CellValue {
  if (typeof v === "string") {
    if (NUMERIC_LITERAL_RE.test(v)) {
      const num = parseFloat(v);
      if (Number.isFinite(num)) return num;
    }
    return v;
  }
  if (
    v === null ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "string"
  ) {
    return v;
  }
  // Custom variants come across the wasm boundary as
  // ``{type_tag, data}`` plain objects. Pass through unchanged so the
  // formatter can branch on type_tag. [sheet.cell.custom]
  if (
    typeof v === "object" &&
    v !== null &&
    "type_tag" in v &&
    "data" in v &&
    typeof (v as { type_tag: unknown }).type_tag === "string" &&
    typeof (v as { data: unknown }).data === "string"
  ) {
    return v as { type_tag: string; data: string };
  }
  // Unknown types stringify defensively — main path is host pins and
  // formulas, both of which yield primitive JS values.
  return String(v);
}

/** Get a single cell's computed value. */
export function getComputed(cellId: string): CellValue {
  const val = getEngine().get_typed(cellId) as CellValue;
  return val ?? null;
}

/** Evaluate a standalone formula (no cell context). */
export function evaluate(formula: string): string {
  return WasmSheet.evaluate(formula);
}

/** Raw JSON string from ``engine.list_functions()``. Parsed shape lives
 *  in ``spreadsheet/formula-helpers.ts::EngineFunctionInfo``. Calling
 *  this on an instance (rather than the static ``WasmSheet``) is what
 *  makes runtime-registered functions visible — ``register_datetime`` /
 *  ``register_url`` + any host ``register_function`` show up in the
 *  result. */
export function listEngineFunctionsJson(): string {
  return getEngine().list_functions();
}

/** Raw JSON string from ``engine.signature_help(formula, cursor)`` —
 *  ``"null"`` when the cursor isn't inside a known function call.
 *  Instance-level so registered customs (YEAR, host extensions, …)
 *  resolve alongside SUM / IF / etc. */
export function signatureHelpJson(formula: string, cursor: number): string {
  return getEngine().signature_help(formula, cursor);
}

/** Size of the spill region anchored at ``cellId`` if any. */
export interface SpillRegion {
  rows: number;
  cols: number;
}

/**
 * If ``cellId`` is an array-formula anchor, return the shape of the
 * region its formula spills into; otherwise ``null``. A 1×1 array is
 * treated as a scalar by the engine and does not register as a spill.
 */
// [sheet.cell.spill]
export function spillAt(cellId: string): SpillRegion | null {
  try {
    const raw = getEngine().spill_at(cellId);
    return JSON.parse(raw) as SpillRegion | null;
  } catch {
    return null;
  }
}

/**
 * If ``cellId`` was populated by a spill from another cell's formula,
 * return that anchor's id; otherwise ``null``. The anchor itself
 * returns its own id (so ``ownedBy(anchor) === anchor`` and
 * ``ownedBy(spillMember) === anchor``) — wasm's ``owned_by`` exposes
 * exactly that shape.
 */
// [sheet.cell.spill]
export function ownedBy(cellId: string): string | null {
  try {
    const raw = getEngine().owned_by(cellId);
    return JSON.parse(raw) as string | null;
  } catch {
    return null;
  }
}

/**
 * If ``cellId`` is an array-formula anchor, return the full 2-D array
 * it spilled (row-major, empty cells as ``""``). ``null`` for
 * anything else — user-authored cells, spill members, blocked spills.
 */
// [sheet.cell.spill]
export function getArray(cellId: string): string[][] | null {
  try {
    const raw = getEngine().get_array(cellId);
    return JSON.parse(raw) as string[][] | null;
  } catch {
    return null;
  }
}

/**
 * Host-injected spill values — an overlay on top of formula evaluation
 * so async data sources (``=SQL()``, future ``=IMPORTJSON()``, etc.)
 * can drop arrays into cells without the engine needing async or
 * a plugin API. See ``TODO-liblotus-host-spills.md`` for the
 * engine-side semantics.
 *
 *   pin > native spill > formula eval > empty
 *
 * Pins are session-only; the host is authoritative on when to
 * re-install them after a reload.
 */
// [sheet.cell.pin]
export function pinValue(cellId: string, rows: string[][]): void {
  _pins[cellId] = rows;
  try {
    getEngine().pin_value(cellId, JSON.stringify(rows));
  } catch (e) {
    // Engine only throws on impossible input (empty / ragged).
    // Drop the bogus pin so we don't resurrect it on next recalc.
    delete _pins[cellId];
    console.warn(`pinValue failed for ${cellId}:`, e);
  }
}

// [sheet.cell.pin]
export function unpinValue(cellId: string): void {
  delete _pins[cellId];
  try {
    getEngine().unpin_value(cellId);
  } catch {
    // no-op
  }
}

/** Drop every pin. Use on sheet switch — pins are scoped to a sheet
 *  because they share the cell-id namespace with user-authored cells. */
// [sheet.cell.pin]
export function clearAllPins(): void {
  const ids = Object.keys(_pins);
  _pins = {};
  if (!sheet) return;
  for (const id of ids) {
    try {
      sheet.unpin_value(id);
    } catch {
      // no-op
    }
  }
}

/** True if the cell's value comes from ``pinValue`` rather than its
 *  own formula. */
// [sheet.cell.pin]
export function isPinned(cellId: string): boolean {
  return Object.prototype.hasOwnProperty.call(_pins, cellId);
}

/** All currently-pinned anchor cell IDs. */
// [sheet.cell.pin]
export function pinnedCells(): string[] {
  return Object.keys(_pins);
}

/** Deep-copy of the current pin map — for undo snapshots that need to
 *  restore exact pin state later. */
// [sheet.cell.pin]
export function getPinsSnapshot(): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  for (const [id, rows] of Object.entries(_pins)) {
    out[id] = rows.map((row) => row.slice());
  }
  return out;
}

/** Replace every pin atomically: drop all existing pins, then install
 *  ``pins``. Used by undo / redo to roll engine pin state back to a
 *  prior frame's snapshot. */
// [sheet.cell.pin]
export function replacePins(pins: Record<string, string[][]>): void {
  clearAllPins();
  for (const [id, rows] of Object.entries(pins)) {
    pinValue(id, rows);
  }
}

/**
 * Parsed output of `WasmSheet.parse_range` — exposes the Rust engine's
 * canonical A1-range parser so the frontend never has to reimplement it.
 */
export interface ParsedRange {
  start: { row: number; col: number };
  end_col: number;
  /** `null` when the end row is unbounded downward (`A:F`, `A1:F`). */
  end_row: number | null;
  unbounded: boolean;
  normalized: string;
}

/** Parse an A1 range. Returns `null` for unparseable input (no throw). */
export function parseRange(input: string): ParsedRange | null {
  try {
    return JSON.parse(WasmSheet.parse_range(input)) as ParsedRange;
  } catch {
    return null;
  }
}

/** True if the range is unbounded downward. Garbage input returns false. */
export function isUnboundedRange(input: string): boolean {
  return WasmSheet.is_unbounded_range(input);
}

// ── Coordinate helpers (delegated to the engine) ───────────────
//
// The A1 grammar — `A1` ↔ (row, col) and the column letters A → AA → AAA
// → … — lives in `lotus-core`. These wrappers are the JS-side surface
// so callers don't reach for `cellId.match(/^[A-Z]+/)` or `chr(65+i)`
// equivalents and drift from the engine.

/** Column index → A1 letters. `0 → "A"`, `26 → "AA"`. */
export function indexToCol(index: number): string {
  return WasmSheet.index_to_col(index);
}

/** A1 letters → column index. Throws for non-letter input. */
export function colToIndex(letters: string): number {
  return WasmSheet.col_to_index(letters);
}

/** Build an A1 cell id from 0-based `(row, col)`. */
export function cellId(row: number, col: number): string {
  return WasmSheet.cell_id(row, col);
}

/**
 * Parse an A1 cell id into 0-based `{row, col}`. Returns `null` for
 * garbage. Note: ``parseCellId`` in ``stores/spreadsheet.ts`` adds the
 * legacy 1-based-row + clamping shape on top of this — prefer that
 * for store/UI code, this for raw engine math.
 */
export function parseCellIdRaw(
  input: string,
): { row: number; col: number } | null {
  try {
    return JSON.parse(WasmSheet.parse_cell_id(input)) as {
      row: number;
      col: number;
    };
  } catch {
    return null;
  }
}

/**
 * Rewrite a formula's refs to account for deleted rows/columns,
 * Google-Sheets style: refs past the deletion shift to stay pointing
 * at the same data, ranges trim, refs fully inside the deletion
 * become ``#REF!``. Non-formula input is returned unchanged.
 *
 * The server runs this same transformation on every formula cell
 * before the DB shift (see db.py::_rewrite_formulas_for_deletion);
 * the frontend calls it to keep the optimistic local shift in sync.
 */
// [sheet.delete.refs-rewrite]
export function adjustRefsForDeletion(
  formula: string,
  deletedCols: number[] = [],
  deletedRows: number[] = [],
): string {
  try {
    return WasmSheet.adjust_refs_for_deletion(
      formula,
      JSON.stringify({ cols: deletedCols, rows: deletedRows }),
    );
  } catch {
    // Fall back to the original text on any tokenizer failure. The
    // server is authoritative; we just want to avoid a broken UI.
    return formula;
  }
}

/**
 * Mirror of ``adjustRefsForDeletion`` for row/column insertion. Refs
 * at or past each inserted index shift outward by the count of
 * insertions at-or-before their index; ranges whose endpoints
 * straddle an insertion grow to include the new blank row/col.
 * Absolute components (``$``) keep their markers but still shift
 * positionally. The server runs this same rewrite via
 * ``db.py::_rewrite_formulas_for_insertion``.
 */
// [sheet.insert.refs-rewrite]
export function adjustRefsForInsertion(
  formula: string,
  insertedCols: number[] = [],
  insertedRows: number[] = [],
): string {
  try {
    return WasmSheet.adjust_refs_for_insertion(
      formula,
      JSON.stringify({ cols: insertedCols, rows: insertedRows }),
    );
  } catch {
    return formula;
  }
}

/**
 * Mirror of ``adjustRefsForDeletion`` / ``adjustRefsForInsertion``
 * for column drag-reorder. Rewrite every column-bearing ref in
 * ``formula`` to reflect a contiguous block of columns
 * ``[srcStart, srcEnd]`` moving to land starting at ``finalStart``
 * in the post-move layout.
 *
 * Single-column drag passes ``srcStart === srcEnd``; multi-column
 * drag (a B:E header selection) sets the contiguous selection
 * range. Width is derived as ``srcEnd - srcStart + 1``.
 *
 * Semantic (matches the engine — see TODO-liblotus-column-block-move.md):
 *   - Single cell refs follow the data (`=D1` → `=C1`).
 *   - Bounded ranges (`A1:D5`) stay positional — the rectangle
 *     is unchanged even though its data permutes inside.
 *   - Whole-column ranges (`B:D`) follow via interior-bbox.
 *   - Whole-row ranges unaffected.
 *   - Absolute markers (`$D$1`) preserved.
 *   - Spill anchors (`D1#`) follow.
 *   - No `#REF!` case — block move is a permutation.
 *
 * The server runs the same rewrite via
 * ``db.py::_rewrite_formulas_for_move``; the frontend calls it for
 * optimistic local shifts.
 */
// [sheet.column.drag-reorder]
export function adjustRefsForColumnBlockMove(
  formula: string,
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): string {
  try {
    return WasmSheet.adjust_refs_for_column_block_move(
      formula,
      srcStart,
      srcEnd,
      finalStart,
    );
  } catch {
    // Tokenizer failure — fall back. Server is authoritative.
    return formula;
  }
}

/**
 * Row-axis sibling of ``adjustRefsForColumnBlockMove``. Single
 * cells follow data, bounded ranges stay positional, whole-row
 * ranges follow via interior-bbox, whole-col ranges unaffected,
 * absolute markers preserved, spill anchors follow.
 *
 * Used for cell-formula rewrite. Named-range definitions call
 * the data-following variant below.
 */
// [sheet.row.drag-reorder]
export function adjustRefsForRowBlockMove(
  formula: string,
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): string {
  try {
    return WasmSheet.adjust_refs_for_row_block_move(
      formula,
      srcStart,
      srcEnd,
      finalStart,
    );
  } catch {
    return formula;
  }
}

/**
 * Data-following variant for row drag-reorder: bounded ranges
 * apply the row forward map per-interior-row + bbox, the way
 * whole-row ranges already do. Used for named-range definition
 * rewrite — named bounded ranges denote *named cells*, not
 * rectangles.
 */
// [sheet.row.drag-reorder]
export function adjustRefsForRowBlockMoveDataFollowing(
  formula: string,
  srcStart: number,
  srcEnd: number,
  finalStart: number,
): string {
  try {
    return WasmSheet.adjust_refs_for_row_block_move_data_following(
      formula,
      srcStart,
      srcEnd,
      finalStart,
    );
  } catch {
    return formula;
  }
}

/**
 * Shift every relative cell/range reference in `formula` by
 * ``(dRow, dCol)``. Absolute components (``$``-prefixed) stay put;
 * mixed-absolute (``$A1`` / ``A$1``) shift only the relative axis.
 * Refs that would land outside ``1..=maxRow`` / ``1..=maxCol``
 * become ``#REF!`` (a range with any off-grid endpoint collapses).
 * Non-formula input passes through unchanged.
 *
 * Used by paste: compute the delta from the source-anchor to the
 * paste target and rewrite each copied formula so its refs point
 * at the equivalent destination cells.
 */
export function shiftFormulaRefs(
  formula: string,
  dRow: number,
  dCol: number,
  maxRow: number,
  maxCol: number,
): string {
  try {
    return WasmSheet.shift_formula_refs(formula, dRow, dCol, maxRow, maxCol);
  } catch {
    return formula;
  }
}
