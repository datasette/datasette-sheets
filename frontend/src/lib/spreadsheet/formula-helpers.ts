import { WasmSheet } from "../../../vendor/lotus-wasm/lotus_wasm";
import {
  indexToCol,
  listEngineFunctionsJson,
  parseCellIdRaw,
  parseRange,
  spillAt,
} from "../engine";

/**
 * Analyze a partial formula up to the cursor position and determine
 * whether a cell reference is syntactically valid at that position.
 *
 * This is a cursor-position heuristic — it doesn't need the full lexer,
 * just character-level scanning.
 */
export function canInsertCellRef(text: string, cursorPos: number): boolean {
  if (!text.startsWith("=")) return false;
  // Caret at position 0 sits *before* the leading ``=``. Inserting a
  // ref there would prepend it (e.g. ``E4=ROUND(...)``), which is
  // exactly what happened when the user pressed ``Cmd+ArrowLeft`` +
  // ``Cmd+ArrowRight``: the scan-so-far was empty and ``lastKind``
  // still had its initial ``"operator"`` value.
  if (cursorPos < 1) return false;

  const before = text.slice(1, cursorPos);

  let inString = false;
  let stringChar = "";
  let lastKind: "operator" | "value" = "operator";

  for (let i = 0; i < before.length; i++) {
    const ch = before[i];

    if (inString) {
      if (ch === stringChar) {
        inString = false;
        lastKind = "value";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (/\s/.test(ch)) continue;

    if ("+-*/%^(,:".includes(ch)) {
      lastKind = "operator";
    } else if (ch === ")") {
      lastKind = "value";
    } else {
      lastKind = "value";
    }
  }

  if (inString) return false;
  if (lastKind !== "operator") return false;

  // Look at the next *meaningful* character after the caret — skip
  // any whitespace so that ``=SUM(1,| 2)`` (caret right after the
  // comma, with a space before the next arg) doesn't insert a ref
  // and shatter the formula. Quotes count as "alphanumeric-like"
  // here so we don't clobber an adjacent string literal either.
  // An AST-based version of this test belongs in the engine — see
  // TODO-liblotus-ref-insertable-at.md.
  let next = cursorPos;
  while (next < text.length && /\s/.test(text[next])) next++;
  const charAfter = text[next];
  if (charAfter && /[a-zA-Z0-9"']/.test(charAfter)) return false;

  return true;
}

/**
 * Raw formula token as emitted by the Rust engine's
 * ``formula_tokens``. Spans are start-inclusive / end-exclusive
 * over the formula string. ``kind`` is one of ``number``,
 * ``string``, ``cell_ref``, ``range``, ``name``, ``function``,
 * ``operator``, ``paren``, ``comma``, ``whitespace``, ``unknown``.
 */
export interface FormulaToken {
  start: number;
  end: number;
  kind: string;
}

/**
 * Tokenize a formula via the Rust engine. Returns ``[]`` for
 * non-formula input or on engine errors. Callers filter by
 * ``kind`` — this is the single source of truth for formula
 * lexical structure on the frontend.
 */
export function formulaTokens(formula: string): FormulaToken[] {
  if (!formula.startsWith("=")) return [];
  try {
    return JSON.parse(WasmSheet.formula_tokens(formula)) as FormulaToken[];
  } catch {
    return [];
  }
}

/**
 * True when a token is a string literal for the purposes of
 * colouring / autocomplete suppression. Terminated strings come
 * back as ``kind: "string"``. An unterminated trailing string is
 * reported as ``kind: "unknown"`` whose first character is a
 * quote; we treat those as strings too so the user still sees
 * green + autocomplete-off while mid-typing.
 */
function isStringToken(formula: string, t: FormulaToken): boolean {
  if (t.kind === "string") return true;
  if (t.kind === "unknown") {
    const first = formula[t.start];
    return first === '"' || first === "'";
  }
  return false;
}

/**
 * True when ``cursor`` falls strictly between the quote delimiters
 * of a string literal. Used to suppress autocomplete inside strings
 * — typing ``="abc"`` shouldn't pop AVERAGE / AND / ABS just because
 * ``a`` matches their prefix.
 *
 * For unterminated trailing strings (engine emits ``unknown``), any
 * cursor past the opening quote counts as inside — there's nothing
 * beyond the end of input to be past.
 */
// [sheet.editing.formula-string-coloring]
export function isCursorInString(text: string, cursor: number): boolean {
  for (const t of formulaTokens(text)) {
    if (cursor <= t.start) continue;
    if (!isStringToken(text, t)) continue;
    if (t.kind === "string" && cursor >= t.end) continue;
    return true;
  }
  return false;
}

// ─── Formula reference extraction (via Rust WASM) ───────────────

const REF_COLORS = [
  "#1a73e8", // blue
  "#e8710a", // orange
  "#9334e6", // purple
  "#e52592", // pink
  "#12b5cb", // cyan
  "#34a853", // green
  "#ea4335", // red
  "#f9ab00", // amber
];

export function getRefColor(index: number): string {
  return REF_COLORS[index % REF_COLORS.length];
}

/**
 * Single fixed colour for named-range tokens. Names are
 * workbook-scoped and not tied to a spatial cell position, so
 * rotating them through the cell-ref palette would just be noise —
 * one dedicated hue reads as "this is a different kind of thing".
 */
// [sheet.editing.formula-name-coloring]
export const NAME_REF_COLOR = "#5b21b6";

/**
 * Single fixed colour for string literals (``"abc"`` / ``'abc'``)
 * inside a formula. Picks a darker forest-green so it reads as a
 * different token kind from the green that occasionally cycles
 * through ``REF_COLORS`` for cell refs.
 */
// [sheet.editing.formula-string-coloring]
export const STRING_COLOR = "#188038";

/**
 * Find every string-literal range in a formula. Returns inclusive
 * ``start`` / exclusive ``end`` byte offsets covering the quotes
 * themselves so the caller can colour the whole token.
 *
 * An unterminated trailing string (engine emits ``unknown``
 * starting at a quote) still gets a span out to the end of input
 * so the user sees the colour while typing.
 */
// [sheet.editing.formula-string-coloring]
export function findStringLiterals(
  formula: string,
): Array<{ start: number; end: number }> {
  return formulaTokens(formula)
    .filter((t) => isStringToken(formula, t))
    .map(({ start, end }) => ({ start, end }));
}

/**
 * Kind of reference as reported by the Rust engine's ``extract_refs``
 * (see liblotus' lotus-core). ``name`` is the named-range token;
 * the rest are cell-level.
 */
export type FormulaRefKind =
  | "cell"
  | "range"
  | "whole_column"
  | "whole_row"
  | "name"
  | "spill";

export interface FormulaRef {
  start: number;
  end: number;
  text: string;
  kind: FormulaRefKind;
  cells: string[];
  color: string;
}

interface RustRef {
  start: number;
  end: number;
  text: string;
  kind?: FormulaRefKind;
  cells: string[];
}

/**
 * Extract all cell / range / name references from a formula string,
 * with their positions and assigned colours.
 *
 * Cell-kinded refs cycle through ``REF_COLORS``; name-kinded refs
 * use the dedicated ``NAME_REF_COLOR`` so they read as distinct
 * from the spatial refs.
 */
// ─── Function-help call-context + catalog ─────────────────────
//
// Both of these should move to ``lotus-core`` — see
// ``TODO-liblotus-function-help.md``. Today they live here so the
// help popup can ship; the call site should swap to the engine
// primitives when they land.

export interface CallAtCursor {
  /** Function name as written (case preserved). */
  name: string;
  /** 0-based index of the argument the caret is inside. */
  argIndex: number;
  /** Byte offset just after the opening ``(``. */
  argsStart: number;
  /** Byte offset of the matching ``)``, or ``-1`` if unterminated. */
  argsEnd: number;
}

/**
 * Find the innermost enclosing function call for a caret position
 * in a formula. Pure text scan — respects string literals, nested
 * calls, and anonymous grouping parens. Does **not** validate that
 * the function name exists (that's a catalog lookup).
 *
 * @returns ``null`` when the caret isn't inside a named call, or
 * when the formula isn't a formula (doesn't start with ``=``).
 */
// TODO(liblotus): replace with WasmSheet.signature_help — see
// TODO-liblotus-signature-help.md. Note the string-escape handling
// here diverges from canInsertCellRef above (this scanner handles
// ``\`` escapes, that one doesn't); both will go away with the
// engine primitive.
export function getCallAtCursor(
  text: string,
  cursor: number,
): CallAtCursor | null {
  if (!text.startsWith("=")) return null;
  if (cursor < 1) return null;

  interface Frame {
    name: string | null;
    argsStart: number;
    argIndex: number;
    depthAtOpen: number; // stack depth *after* this frame was pushed
  }

  const stack: Frame[] = [];
  let inString = false;
  let stringChar = "";

  // Scan strictly before the caret so that a caret positioned just
  // after ``(`` sits inside the call, and a caret positioned just
  // after the function name but before ``(`` does not.
  const end = Math.min(cursor, text.length);
  let i = 1;
  while (i < end) {
    const ch = text[i];

    if (inString) {
      if (ch === "\\" && i + 1 < end) {
        i += 2;
        continue;
      }
      if (ch === stringChar) inString = false;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      i++;
      continue;
    }

    if (ch === "(") {
      // Look backward for an identifier immediately before the paren.
      let nameEnd = i;
      while (nameEnd > 1 && /\s/.test(text[nameEnd - 1])) nameEnd--;
      let nameStart = nameEnd;
      while (nameStart > 1 && /[A-Za-z0-9_]/.test(text[nameStart - 1])) {
        nameStart--;
      }
      const rawName =
        nameStart < nameEnd && /[A-Za-z_]/.test(text[nameStart])
          ? text.slice(nameStart, nameEnd)
          : null;
      stack.push({
        name: rawName,
        argsStart: i + 1,
        argIndex: 0,
        depthAtOpen: stack.length + 1,
      });
      i++;
      continue;
    }

    if (ch === ")") {
      if (stack.length > 0) stack.pop();
      i++;
      continue;
    }

    if (ch === "," && stack.length > 0) {
      stack[stack.length - 1].argIndex++;
      i++;
      continue;
    }

    i++;
  }

  // Walk up the stack to find the innermost *named* open frame.
  let namedIdx = -1;
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k].name) {
      namedIdx = k;
      break;
    }
  }
  if (namedIdx === -1) return null;
  const frame = stack[namedIdx];

  // Scan forward from the caret to find the matching ``)`` of the
  // named frame. We start already inside ``stack.length - namedIdx``
  // open calls relative to that frame, so we need to see that many
  // unmatched closes before we're done.
  let toClose = stack.length - namedIdx;
  let argsEnd = -1;
  let inString2 = false;
  let stringChar2 = "";
  let depth = 0;
  let j = cursor;
  while (j < text.length) {
    const ch = text[j];
    if (inString2) {
      if (ch === "\\" && j + 1 < text.length) {
        j += 2;
        continue;
      }
      if (ch === stringChar2) inString2 = false;
      j++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString2 = true;
      stringChar2 = ch;
      j++;
      continue;
    }
    if (ch === "(") {
      depth++;
      j++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) {
        depth--;
      } else {
        toClose--;
        if (toClose === 0) {
          argsEnd = j;
          break;
        }
      }
      j++;
      continue;
    }
    j++;
  }

  return {
    name: frame.name as string,
    argIndex: frame.argIndex,
    argsStart: frame.argsStart,
    argsEnd,
  };
}

export interface FnParam {
  name: string;
  optional?: boolean;
  repeatable?: boolean;
}

export interface FnInfo {
  name: string;
  params: FnParam[];
  summary: string;
}

/** Engine-side function-info JSON shape (from
 *  ``WasmSheet.list_functions()``). Mirrors lotus-core's
 *  ``FunctionInfo`` — keep this in sync if the engine grows fields. */
interface EngineFunctionInfo {
  name: string;
  aliases: string[];
  category: string | null;
  params: { name: string; optional: boolean; description?: string | null }[];
  variadic: {
    name: string;
    optional: boolean;
    description?: string | null;
  } | null;
  description: string;
  examples?: { formula: string; result: string }[];
}

function engineFnToLocal(fn: EngineFunctionInfo): FnInfo {
  const params: FnParam[] = fn.params.map((p) => ({
    name: p.name,
    optional: p.optional || undefined,
  }));
  if (fn.variadic) {
    params.push({
      name: fn.variadic.name,
      optional: fn.variadic.optional || undefined,
      repeatable: true,
    });
  }
  return { name: fn.name, params, summary: fn.description };
}

interface EngineCatalog {
  primary: Record<string, FnInfo>;
  aliasToPrimary: Record<string, string>;
}

let _engineCatalog: EngineCatalog | null = null;

/** Lazy + cached read of ``engine.list_functions()`` on the live
 *  ``WasmSheet`` instance. Instance-level (not the static
 *  ``WasmSheet.list_functions``) is what makes runtime-registered
 *  functions visible — ``register_datetime`` / ``register_url`` + any
 *  host ``register_function`` show up here. The result is stable for
 *  the session because we register the same handler set on every fresh
 *  engine, so cache-once is safe. */
function getEngineCatalog(): EngineCatalog {
  if (_engineCatalog) return _engineCatalog;
  const primary: Record<string, FnInfo> = {};
  const aliasToPrimary: Record<string, string> = {};
  try {
    const raw = JSON.parse(listEngineFunctionsJson()) as EngineFunctionInfo[];
    for (const fn of raw) {
      primary[fn.name] = engineFnToLocal(fn);
      for (const alias of fn.aliases) {
        aliasToPrimary[alias.toUpperCase()] = fn.name;
      }
    }
  } catch {
    // fall through with empty maps; the overlay still works
  }
  _engineCatalog = { primary, aliasToPrimary };
  return _engineCatalog;
}

/**
 * Hand-curated overlay. Two roles now that the engine reports
 * runtime-registered functions through its instance-level
 * ``list_functions()``:
 *
 *   1. **Discovery** for functions the engine doesn't expose at all
 *      (``COUNTA``, ``AND`` / ``OR`` / ``NOT`` aren't implemented in
 *      lotus-core; ``SQL`` is host-injected and intentionally lives
 *      outside the engine).
 *   2. **Enrichment** for functions the engine surfaces with minimal
 *      metadata. The engine's ``register_function`` API doesn't take
 *      param/description docs at registration time, so YEAR / TODAY
 *      / DAYS_BETWEEN / etc. arrive as ``{params: [], variadic:
 *      "args"}``. The overlay's hand-written entries shadow those
 *      bare reports with proper param names and one-line summaries.
 *
 * ``lookupFunction`` consults the overlay first so the enriched
 * version wins for any name in both. Delete a row when either:
 *   (a) the engine grows the function and reports it with rich
 *       metadata (Cargo `register_function` ergonomics — a future
 *       liblotus follow-up), or
 *   (b) we just don't care about the popup quality for that name.
 */
const FUNCTION_CATALOG_OVERLAY: Record<string, FnInfo> = {
  // Gap 1: engine missing these builtins.
  COUNTA: {
    name: "COUNTA",
    params: [
      { name: "value1" },
      { name: "value2", optional: true, repeatable: true },
    ],
    summary: "Count of cells that are not empty.",
  },
  AND: {
    name: "AND",
    params: [
      { name: "logical1" },
      { name: "logical2", optional: true, repeatable: true },
    ],
    summary: "TRUE when every argument is truthy.",
  },
  OR: {
    name: "OR",
    params: [
      { name: "logical1" },
      { name: "logical2", optional: true, repeatable: true },
    ],
    summary: "TRUE when any argument is truthy.",
  },
  NOT: {
    name: "NOT",
    params: [{ name: "logical" }],
    summary: "Logical negation: TRUE becomes FALSE and vice versa.",
  },
  // ─── Datasette data source ────────────────────────────────────
  // Gap 3: SQL is host-injected, not part of lotus-core.
  // [sheet.cell.sql-array-formula]
  SQL: {
    name: "SQL",
    params: [{ name: "sql_or_dbname" }, { name: "sql", optional: true }],
    summary:
      'Run SQL against a Datasette database and spill the result. Single-arg form (=SQL("select …")) uses the workbook\'s database; two-arg form (=SQL("db", "select …")) picks a named database.',
  },
  // ─── lotus-datetime family ────────────────────────────────────
  // Gap 2: register_datetime() functions; the engine's static
  // list_functions doesn't see them. [sheet.cell.custom]
  YEAR: {
    name: "YEAR",
    params: [{ name: "date" }],
    summary: "Calendar year of a date / datetime / zoned datetime.",
  },
  MONTH: {
    name: "MONTH",
    params: [{ name: "date" }],
    summary: "Month-of-year (1–12) of a date / datetime / zoned datetime.",
  },
  DAY: {
    name: "DAY",
    params: [{ name: "date" }],
    summary: "Day-of-month (1–31) of a date / datetime / zoned datetime.",
  },
  WEEKDAY: {
    name: "WEEKDAY",
    params: [{ name: "date" }],
    summary: "Day-of-week as a number (1 = Monday).",
  },
  HOUR: {
    name: "HOUR",
    params: [{ name: "datetime" }],
    summary: "Hour-of-day (0–23) of a time / datetime / zoned datetime.",
  },
  MINUTE: {
    name: "MINUTE",
    params: [{ name: "datetime" }],
    summary: "Minute-of-hour (0–59).",
  },
  SECOND: {
    name: "SECOND",
    params: [{ name: "datetime" }],
    summary: "Second-of-minute (0–59).",
  },
  DATE: {
    name: "DATE",
    params: [{ name: "year" }, { name: "month" }, { name: "day" }],
    summary: "Construct a calendar date (jdate) from year / month / day.",
  },
  TIME: {
    name: "TIME",
    params: [
      { name: "hour" },
      { name: "minute" },
      { name: "second", optional: true },
    ],
    summary: "Construct a time-of-day (jtime).",
  },
  TODAY: {
    name: "TODAY",
    params: [],
    summary: "Today's calendar date in the system's local timezone.",
  },
  NOW: {
    name: "NOW",
    params: [],
    summary: "Current zoned datetime in the system's local timezone.",
  },
  UTCNOW: {
    name: "UTCNOW",
    params: [],
    summary: "Current zoned datetime in UTC.",
  },
  PARSE_DATE: {
    name: "PARSE_DATE",
    params: [{ name: "text" }, { name: "format", optional: true }],
    summary:
      "Parse text as a date. Without ``format`` expects ISO 8601 (YYYY-MM-DD); with ``format`` uses jiff strptime.",
  },
  DAYS_BETWEEN: {
    name: "DAYS_BETWEEN",
    params: [{ name: "start" }, { name: "end" }],
    summary: "Whole days from ``start`` to ``end`` (negative if start > end).",
  },
  HOURS_BETWEEN: {
    name: "HOURS_BETWEEN",
    params: [{ name: "start" }, { name: "end" }],
    summary: "Whole hours from ``start`` to ``end``.",
  },
  DATEADD: {
    name: "DATEADD",
    params: [{ name: "date" }, { name: "span" }],
    summary: "Add a span to a date / datetime / zoned datetime.",
  },
  DATESUB: {
    name: "DATESUB",
    params: [{ name: "date" }, { name: "span" }],
    summary: "Subtract a span from a date / datetime / zoned datetime.",
  },
  DAYS: {
    name: "DAYS",
    params: [{ name: "n" }],
    summary: "A jspan of ``n`` days.",
  },
  HOURS: {
    name: "HOURS",
    params: [{ name: "n" }],
    summary: "A jspan of ``n`` hours.",
  },
  MINUTES: {
    name: "MINUTES",
    params: [{ name: "n" }],
    summary: "A jspan of ``n`` minutes.",
  },
  SECONDS: {
    name: "SECONDS",
    params: [{ name: "n" }],
    summary: "A jspan of ``n`` seconds.",
  },
};

export function lookupFunction(name: string): FnInfo | null {
  const upper = name.toUpperCase();
  const { primary, aliasToPrimary } = getEngineCatalog();
  // Overlay first so the curated metadata shadows the engine's
  // bare-bones report for runtime-registered customs (YEAR, TODAY,
  // …). Aliases still resolve through the engine's table — a few
  // overlay entries (e.g. AVG → AVERAGE) would never trigger
  // otherwise. Engine fallback covers everything the overlay
  // doesn't know.
  const resolved = aliasToPrimary[upper] ?? upper;
  return (
    FUNCTION_CATALOG_OVERLAY[upper] ??
    FUNCTION_CATALOG_OVERLAY[resolved] ??
    primary[resolved] ??
    null
  );
}

/** All primary function names, uppercase. Aliases are excluded.
 *  Includes both engine builtins and the overlay. */
export function listFunctionNames(): string[] {
  const { primary } = getEngineCatalog();
  const merged = new Set<string>([
    ...Object.keys(primary),
    ...Object.keys(FUNCTION_CATALOG_OVERLAY),
  ]);
  return [...merged];
}

/** Resolves aliases — returns ``true`` if ``name`` or any alias points at a catalog entry. */
export function isFunctionName(name: string): boolean {
  return lookupFunction(name) !== null;
}

// ─── End function-help catalog ─────────────────────────────────

export function extractFormulaRefs(formula: string): FormulaRef[] {
  if (!formula.startsWith("=")) return [];

  try {
    const json = WasmSheet.extract_refs(formula);
    const rustRefs: RustRef[] = JSON.parse(json);

    let cellRefIdx = 0;
    return rustRefs.map((r) => {
      const kind: FormulaRefKind = r.kind ?? "cell";
      const color =
        kind === "name" ? NAME_REF_COLOR : getRefColor(cellRefIdx++);
      return {
        start: r.start,
        end: r.end,
        text: r.text,
        kind,
        cells: r.cells,
        color,
      };
    });
  } catch {
    return [];
  }
}

// ─── Ref-highlight expansion ──────────────────────────────────
//
// ``extract_refs`` returns ``cells: []`` for ``whole_column``,
// ``whole_row``, and ``name`` refs — the engine doesn't enumerate
// infinite ranges, and names don't have cells of their own. For the
// formula-edit highlight we want to paint every backing cell, so we
// expand on the frontend:
//
// - ``whole_column``: parseRange handles ``A:A`` / ``A:C``. Cols
//   are bounded by the grid; rows fill 1..maxRow.
// - ``whole_row``: parseRange returns null for ``1:1``-shaped text,
//   so handle here as a simple ``N:M`` match.
// - ``name``: look up the name's definition, strip the leading
//   ``=``, and try the same shapes. Complex definitions (``=SUM(A:A)``,
//   arithmetic) are skipped — there's no single rectangle to paint.
//
// See ``TODO-liblotus-whole-row-range.md`` — the whole-row shortcut
// should move to the engine's ``parse_range``.

function expandRect(
  startCol: number,
  endCol: number,
  startRow: number,
  endRow: number,
  maxCol: number,
  maxRow: number,
): string[] {
  const c0 = Math.max(0, Math.min(maxCol, startCol));
  const c1 = Math.max(0, Math.min(maxCol, endCol));
  const r0 = Math.max(1, Math.min(maxRow, startRow));
  const r1 = Math.max(1, Math.min(maxRow, endRow));
  const cells: string[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      // ``indexToCol`` delegates to the engine's A1 grammar, so
      // multi-letter columns (AA, ZZ, …) work for free if the grid
      // ever grows past Z.
      cells.push(`${indexToCol(c)}${r}`);
    }
  }
  return cells;
}

/**
 * Cells to highlight for a given ref while the user is editing a
 * formula. Returns ``ref.cells`` untouched for ``cell`` and ``range``
 * refs; expands ``whole_column`` / ``whole_row`` / ``name`` into
 * concrete cell ids using the grid bounds and the name map.
 *
 * Exported for unit tests.
 */
export function expandRefCells(
  ref: FormulaRef,
  nameDefs: Map<string, string>,
  maxCol: number,
  maxRow: number,
): string[] {
  if (ref.kind === "cell" || ref.kind === "range") {
    return ref.cells;
  }

  if (ref.kind === "whole_column") {
    const p = parseRange(ref.text);
    if (!p) return [];
    return expandRect(p.start.col, p.end_col, 1, maxRow, maxCol, maxRow);
  }

  if (ref.kind === "whole_row") {
    const m = ref.text.match(/^(\d+):(\d+)$/);
    if (!m) return [];
    const r1 = parseInt(m[1], 10);
    const r2 = parseInt(m[2], 10);
    return expandRect(
      0,
      maxCol,
      Math.min(r1, r2),
      Math.max(r1, r2),
      maxCol,
      maxRow,
    );
  }

  // Spill operator ``A1#`` — engine emits ``cells: [anchor_id]``.
  // Resolve the anchor's live region size via ``spillAt`` and paint
  // the full rectangle. If the anchor hasn't spilled yet (blocked,
  // scalar result, or not-yet-evaluated), we still highlight the
  // anchor cell so the user can see what they typed refers to.
  // [sheet.cell.spill]
  if (ref.kind === "spill") {
    const anchor = ref.cells[0];
    if (!anchor) return [];
    const region = spillAt(anchor);
    if (!region) return [anchor];
    const parsed = parseCellIdRaw(anchor);
    if (!parsed) return [anchor];
    // ``parseCellIdRaw`` is engine-backed, so multi-letter columns
    // round-trip; ``expandRect`` builds the grid using 1-based rows,
    // matching the rest of this module.
    const col0 = parsed.col;
    const row0 = parsed.row + 1;
    return expandRect(
      col0,
      col0 + region.cols - 1,
      row0,
      row0 + region.rows - 1,
      maxCol,
      maxRow,
    );
  }

  if (ref.kind === "name") {
    const def = nameDefs.get(ref.text.toUpperCase());
    if (!def) return [];
    const body = (def.startsWith("=") ? def.slice(1) : def).trim();

    const p = parseRange(body);
    if (p) {
      const startRow = p.start.row + 1;
      const endRow = p.end_row != null ? p.end_row + 1 : maxRow;
      return expandRect(
        p.start.col,
        p.end_col,
        startRow,
        endRow,
        maxCol,
        maxRow,
      );
    }

    const mRow = body.match(/^(\d+):(\d+)$/);
    if (mRow) {
      const r1 = parseInt(mRow[1], 10);
      const r2 = parseInt(mRow[2], 10);
      return expandRect(
        0,
        maxCol,
        Math.min(r1, r2),
        Math.max(r1, r2),
        maxCol,
        maxRow,
      );
    }

    // Single-cell name like ``=A1``: parseRange rejects single
    // cells. Use extract_refs on the body for a single cell ref.
    const inner = extractFormulaRefs("=" + body);
    if (inner.length === 1 && inner[0].kind === "cell") {
      return inner[0].cells;
    }

    return [];
  }

  return [];
}
