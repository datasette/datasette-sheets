// Formula-edit subsystem extracted from ``Cell.svelte`` (CELL-GRID-01).
//
// While a cell is in edit mode and the input starts with ``=``, four
// distinct features cooperate:
//
//   1. **Coloured segments** — the formula overlay paints cell refs +
//      string literals in the same hues the cell-highlight uses, so
//      ``=A1+"hi"`` reads as a quick visual map of which dependencies
//      it touches.
//   2. **Autocomplete** — typing an identifier prefix (``=Tax``) pops
//      a list of named ranges + builtin function names that match.
//   3. **Signature help** — the caret sitting inside a ``=FN(…)`` call
//      opens a Google-Sheets-style tooltip with the function's params
//      and the active argument highlighted.
//   4. **Pointing mode** — pressing arrow keys at a position the
//      grammar accepts a cell ref inserts the navigated-to cell into
//      the formula text in-place; subsequent arrows extend the ref.
//
// The original implementation in ``Cell.svelte`` mixed all four into
// the same module-scope ``let``s and 200-line ``handleKeydown``. This
// module pulls the **logic** out: pure helpers + a state factory that
// the component instantiates per edit session. The component still
// owns DOM concerns (focus, ``setSelectionRange``, the auto-widen
// mirror) and the input-element reference; this module owns "what
// state is the popup in" and "given a key, what changes".
//
// Mutual exclusion that was previously hand-coded with nested ``if``s
// (autocomplete suppresses signature-help, etc.) is encoded here as a
// discriminated union over the popup mode — there is exactly one
// ``mode.kind`` at a time, so the surface for a future bug magnet is
// gone.

import { get, writable, type Writable } from "svelte/store";
import {
  extractFormulaRefs,
  findStringLiterals,
  getCallAtCursor,
  isCursorInString,
  listFunctionNames,
  lookupFunction,
  STRING_COLOR,
  type FnInfo,
} from "./formula-helpers";
import { formulaInOpenCall } from "../stores/spreadsheet";

// ---------------------------------------------------------------------------
// Pure helpers — no DOM, no stores. Trivially unit-testable.
// ---------------------------------------------------------------------------

/**
 * One coloured run of formula text. ``color = null`` means "use the
 * default text colour" — the formula overlay still renders the
 * segment, just unstyled.
 */
export interface Segment {
  text: string;
  color: string | null;
}

/**
 * Split a ``=…`` formula into coloured segments. Cell-ref / range /
 * name spans pick up the per-ref palette colour from
 * ``extractFormulaRefs``; string literals pick up ``STRING_COLOR``.
 *
 * Spans cannot overlap: the engine's lexer skips strings when
 * emitting refs, and ``findStringLiterals`` is independent — so a
 * simple sort-by-start interleave works.
 */
// [sheet.editing.formula-string-coloring]
export function buildFormulaSegments(formula: string): Segment[] {
  const refs = extractFormulaRefs(formula);
  const strings = findStringLiterals(formula);
  const spans: Array<{ start: number; end: number; color: string }> = [
    ...refs.map((r) => ({ start: r.start, end: r.end, color: r.color })),
    ...strings.map((s) => ({ ...s, color: STRING_COLOR })),
  ];
  if (spans.length === 0) return [{ text: formula, color: null }];
  spans.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let pos = 0;
  for (const span of spans) {
    if (span.start > pos) {
      segments.push({ text: formula.slice(pos, span.start), color: null });
    }
    segments.push({
      text: formula.slice(span.start, span.end),
      color: span.color,
    });
    pos = span.end;
  }
  if (pos < formula.length) {
    segments.push({ text: formula.slice(pos), color: null });
  }
  return segments;
}

/**
 * Walk backward from the cursor while characters match the engine's
 * identifier grammar (``[A-Za-z_][A-Za-z0-9_]*``). Returns the
 * partial identifier the user is typing or ``null`` if the cursor
 * isn't in one. Shapes that look like a cell reference (``A1``,
 * ``BC42``) are rejected so autocomplete doesn't fire while the
 * user is entering a ref.
 */
// [sheet.editing.formula-autocomplete]
export function getPartialAtCursor(
  text: string,
  cursor: number,
): { start: number; prefix: string } | null {
  let i = cursor;
  while (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1])) i--;
  if (i >= cursor) return null;
  if (!/[A-Za-z_]/.test(text[i])) return null;
  // If the char immediately before our partial is `:`, we're in
  // the right-half of a range reference (e.g. the trailing ``A``
  // in ``A:A`` or ``A1:A10``). The grammar requires a cell ref
  // there, not a named identifier — autocompleting a named range
  // would produce ``A:AAA`` etc. which isn't a valid range.
  if (i > 0 && text[i - 1] === ":") return null;
  const prefix = text.slice(i, cursor);
  if (/^[A-Za-z]+\d+$/.test(prefix)) return null;
  return { start: i, prefix };
}

/**
 * Filter ``namedRangeNames`` and ``fnNames`` against ``prefix`` (the
 * uppercased partial). Named ranges come first (user-defined beats
 * builtin on exact collision). Dedup by uppercase, so a user-defined
 * range named ``SUM`` shadows the builtin in the list. Exact
 * matches are excluded — there's nothing to complete.
 */
// [sheet.editing.formula-autocomplete]
export function computeAutocompleteMatches(
  prefix: string,
  namedRangeNames: readonly string[],
  fnNames: readonly string[],
): string[] {
  const upper = prefix.toUpperCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of namedRangeNames) {
    const u = n.toUpperCase();
    if (seen.has(u)) continue;
    if (u.startsWith(upper) && u !== upper) {
      out.push(n);
      seen.add(u);
    }
  }
  for (const n of fnNames) {
    if (seen.has(n)) continue;
    if (n.startsWith(upper) && n !== upper) {
      out.push(n);
      seen.add(n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// State machine — discriminated union over the popup mode.
// ---------------------------------------------------------------------------

/**
 * Pointing-mode anchor. While set, arrow keys overwrite this slice of
 * the formula text instead of inserting a fresh ref. Cleared on any
 * non-arrow keystroke (Escape, Enter, Tab, plain typing).
 */
export interface FormulaPointingRef {
  /** Inclusive start byte offset of the ref text in the formula. */
  start: number;
  /** Exclusive end byte offset. */
  end: number;
  /** The cell currently inserted at ``[start, end)``. */
  cellId: string;
}

/**
 * Discriminated union of "what popup is open under the input." The
 * three states are mutually exclusive — there is no UX in which two
 * are visible at once.
 */
export type FormulaPopupMode =
  | { kind: "idle" }
  | {
      kind: "autocomplete";
      matches: string[];
      index: number;
      replace: { start: number; end: number };
    }
  | { kind: "signature-help"; info: FnInfo; argIndex: number };

const IDLE: FormulaPopupMode = { kind: "idle" };

/**
 * Per-edit-session state bag. The factory creates fresh stores each
 * call so unit tests can spin up an isolated instance and the
 * component can re-create on every ``editingCell`` enter / exit.
 */
export interface FormulaEditState {
  /** What popup is open. ``idle`` when neither autocomplete nor
   * signature-help applies. */
  mode: Writable<FormulaPopupMode>;
  /** Pointing-mode anchor (orthogonal to the popup mode — pointing
   * persists across signature-help refreshes after an arrow insert). */
  pointingRef: Writable<FormulaPointingRef | null>;

  // ── Mode helpers ──────────────────────────────────────────────────

  /**
   * Re-evaluate the autocomplete state for the current input value /
   * cursor. Closes autocomplete + clears any leftover signature-help
   * if the prefix doesn't match anything; otherwise sets
   * ``mode = autocomplete``. Caller passes the live name list (read
   * from the namedRanges store) so this module doesn't have to import
   * it.
   */
  updateAutocomplete(
    input: HTMLInputElement,
    namedRangeNames: readonly string[],
  ): void;
  /** Force-close autocomplete (Escape, blur, commit). */
  closeAutocomplete(): void;
  /**
   * Re-evaluate the signature-help state. Skipped while autocomplete
   * is open — the two never stack. Sets ``mode = signature-help`` if
   * the caret is inside a known function call, otherwise back to
   * ``idle``. Side-effects ``formulaInOpenCall`` so other cells'
   * "active argument" highlight can react.
   */
  updateSignatureHelp(input: HTMLInputElement): void;
  /** Force-close signature help (Escape, blur, commit). */
  closeSignatureHelp(): void;

  // ── Pointing helpers ──────────────────────────────────────────────

  /** Replace the pointing anchor wholesale. */
  setPointing(ref: FormulaPointingRef | null): void;
  /** Clear the pointing anchor. Idempotent. */
  clearPointing(): void;

  // ── Composite ─────────────────────────────────────────────────────

  /**
   * Drop every popup, clear pointing, drop ``formulaInOpenCall``.
   * Used on commit / Escape / blur.
   */
  reset(): void;
}

export function createFormulaEditState(): FormulaEditState {
  const mode = writable<FormulaPopupMode>(IDLE);
  const pointingRef = writable<FormulaPointingRef | null>(null);

  function isAutocompleteOpen(): boolean {
    return get(mode).kind === "autocomplete";
  }

  function closeAutocomplete() {
    if (isAutocompleteOpen()) mode.set(IDLE);
  }

  function closeSignatureHelp() {
    const m = get(mode);
    if (m.kind === "signature-help") mode.set(IDLE);
    formulaInOpenCall.set(false);
  }

  function updateAutocomplete(
    input: HTMLInputElement,
    namedRangeNames: readonly string[],
  ) {
    const val = input.value;
    if (!val.startsWith("=")) return closeAutocomplete();
    const cursor = input.selectionStart ?? val.length;
    // [sheet.editing.formula-string-coloring]
    if (isCursorInString(val, cursor)) return closeAutocomplete();
    const partial = getPartialAtCursor(val, cursor);
    if (!partial) return closeAutocomplete();
    const matches = computeAutocompleteMatches(
      partial.prefix,
      namedRangeNames,
      listFunctionNames(),
    );
    if (matches.length === 0) return closeAutocomplete();
    // Preserve the highlighted index when the match list shrinks; jump
    // back to zero if the previously-highlighted name fell out.
    const prev = get(mode);
    const prevIndex = prev.kind === "autocomplete" ? prev.index : 0;
    const index = prevIndex >= matches.length ? 0 : prevIndex;
    mode.set({
      kind: "autocomplete",
      matches,
      index,
      replace: { start: partial.start, end: cursor },
    });
  }

  function updateSignatureHelp(input: HTMLInputElement) {
    // Autocomplete takes precedence — hide help while the
    // autocomplete popup is visible so the two don't stack.
    if (isAutocompleteOpen()) {
      formulaInOpenCall.set(false);
      return;
    }
    const val = input.value;
    if (!val.startsWith("=")) {
      closeSignatureHelp();
      return;
    }
    const cursor = input.selectionStart ?? val.length;
    // NOTE: grammar-level scan; should delegate to the engine's
    // ``call_context`` once liblotus ships it (see
    // ``TODO-liblotus-function-help.md``).
    const call = getCallAtCursor(val, cursor);
    if (!call) {
      closeSignatureHelp();
      return;
    }
    // Active call at the caret → drives both the signature popup and
    // the "backing cell gets a fill" highlight on other cells.
    formulaInOpenCall.set(true);
    const info = lookupFunction(call.name);
    if (!info) {
      // Unknown function — per spec, show nothing rather than an
      // empty frame. Still leave ``formulaInOpenCall`` set so the
      // backing-cell fill stays visible, matching the original
      // handler's behaviour.
      const m = get(mode);
      if (m.kind === "signature-help") mode.set(IDLE);
      return;
    }
    mode.set({ kind: "signature-help", info, argIndex: call.argIndex });
  }

  function setPointing(ref: FormulaPointingRef | null) {
    pointingRef.set(ref);
  }

  function clearPointing() {
    if (get(pointingRef) !== null) pointingRef.set(null);
  }

  function reset() {
    mode.set(IDLE);
    pointingRef.set(null);
    formulaInOpenCall.set(false);
  }

  return {
    mode,
    pointingRef,
    updateAutocomplete,
    closeAutocomplete,
    updateSignatureHelp,
    closeSignatureHelp,
    setPointing,
    clearPointing,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Pointing-mode arrow handler.
// ---------------------------------------------------------------------------

/**
 * Inputs the arrow handler needs that aren't already on the state
 * bag. Lives here so the component just provides plain values + a
 * couple of callbacks.
 */
export interface FormulaArrowContext {
  /** The cell whose input is being edited. Used as the navigation
   * origin when there is no existing pointing ref. */
  cellId: string;
  /** Current edit-buffer text (always a ``=…`` formula at the call
   * site — the dispatcher only invokes us in that case). */
  editValue: string;
  /** The live ``<input>`` element so we can read the caret position
   * and so the post-tick callback can ``setSelectionRange``. */
  input: HTMLInputElement | null;
  /** Predicate from ``formula-helpers`` — exposed via ctx so tests
   * don't need to mock the WASM engine just to drive the handler. */
  canInsertCellRef: (text: string, cursor: number) => boolean;
  /** ``stores/spreadsheet.ts::navigate``. Returns the cell id one
   * step in ``dir`` from ``from``. */
  navigate: (from: string, dir: "up" | "down" | "left" | "right") => string;
  /** Setter for the edit buffer. */
  setEditValue: (next: string) => void;
}

export type ArrowHandlerResult =
  | {
      kind: "handled";
      /** Where to put the caret after the DOM flush — caller awaits
       * a tick + applies this. */
      caret: number;
      /** Whether to nudge signature help after the caret move. The
       * original handler did this unconditionally because programmatic
       * ``setSelectionRange`` doesn't fire keyup. */
      refreshSignatureHelp: boolean;
    }
  | { kind: "passthrough" };

const ARROW_DIR: Record<string, "up" | "down" | "left" | "right" | undefined> =
  {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

/**
 * Pointing-mode arrow keystroke handler. Returns ``"handled"`` with
 * the new state already written to ``state`` and the caret target
 * computed; the caller awaits a tick, applies the caret, and calls
 * ``state.updateSignatureHelp`` if asked. Returns ``"passthrough"``
 * when the key isn't an arrow at a ref-insertable position — caller
 * falls through to its other arrow / non-arrow branches.
 *
 * This intentionally only owns the "arrow inserts a ref" branch; the
 * companion "arrow keys clear pointingRef and pass through to native
 * caret movement" is left to the caller because it overlaps with the
 * non-formula branch of ``handleKeydown``.
 */
// [sheet.editing.formula-ref-pointing]
export function handleFormulaArrowKey(
  state: FormulaEditState,
  e: KeyboardEvent,
  ctx: FormulaArrowContext,
): ArrowHandlerResult {
  const dir = ARROW_DIR[e.key];
  if (!dir) return { kind: "passthrough" };
  if (!ctx.editValue.startsWith("=")) return { kind: "passthrough" };

  const cursorPos = ctx.input?.selectionStart ?? ctx.editValue.length;
  const pointing = get(state.pointingRef);
  const allowRef = ctx.canInsertCellRef(ctx.editValue, cursorPos) || pointing;

  if (!allowRef) return { kind: "passthrough" };

  e.preventDefault();
  e.stopPropagation();

  const fromCell = pointing ? pointing.cellId : ctx.cellId;
  const targetId = ctx.navigate(fromCell, dir);

  let newValue: string;
  let refStart: number;

  if (pointing) {
    newValue =
      ctx.editValue.slice(0, pointing.start) +
      targetId +
      ctx.editValue.slice(pointing.end);
    refStart = pointing.start;
  } else {
    newValue =
      ctx.editValue.slice(0, cursorPos) +
      targetId +
      ctx.editValue.slice(cursorPos);
    refStart = cursorPos;
  }

  const refEnd = refStart + targetId.length;
  state.setPointing({ start: refStart, end: refEnd, cellId: targetId });
  ctx.setEditValue(newValue);

  return { kind: "handled", caret: refEnd, refreshSignatureHelp: true };
}
