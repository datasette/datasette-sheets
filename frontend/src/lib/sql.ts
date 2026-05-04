/**
 * ``=SQL(sql)`` / ``=SQL(dbname, sql)`` — custom array formula that
 * runs a query against a Datasette database and pins the result at
 * the anchor cell. The engine evaluates the pin as a first-class
 * spill (see [sheet.cell.pin] + [sheet.cell.spill]); this module
 * only owns the formula-parse, fetch, cache, and pin dance.
 */
// [sheet.cell.sql-array-formula]
import { pinValue, unpinValue, isPinned } from "./engine";

// Active workbook's Datasette database, pushed in by persistence.ts
// at ``setDatabase`` time. Keeping the name here rather than
// ``import { getDatabase } from "./stores/persistence"`` breaks a
// transitive cycle: persistence.ts ultimately reaches
// ``cells`` in spreadsheet.ts which also imports this module.
let _defaultDb = "";
export function setSqlDefaultDatabase(db: string): void {
  _defaultDb = db;
}

/** Parsed form of a ``=SQL(...)`` call. ``dbname: null`` means "use
 *  the active workbook's database" — resolved at fetch time so a
 *  cached call made before the workbook loaded still points at the
 *  right place. */
export interface SqlCall {
  dbname: string | null;
  sql: string;
}

interface CacheEntry {
  status: "loading" | "ready" | "error";
  rows?: string[][];
  error?: string;
}

// Keyed by the derived fetch URL so the two signatures dedupe
// naturally once resolved. In-memory only; cleared by a page reload
// but survives sheet switches (same URL = same cached result).
const _cache = new Map<string, CacheEntry>();
// Which cell is the anchor for each URL? One URL can power several
// cells (same query pasted twice); each gets re-pinned when the
// fetch resolves.
const _anchors = new Map<string, Set<string>>();

/** Extract a quoted string literal starting at ``s[start]``. Returns
 *  the unescaped value and the index of the char just past the
 *  closing quote, or ``null`` on mismatch / unterminated. Handles
 *  both `"` and `'` with standard backslash-escapes. */
function extractStringLiteral(
  s: string,
  start: number,
): { value: string; end: number } | null {
  const quote = s[start];
  if (quote !== '"' && quote !== "'") return null;
  let i = start + 1;
  let value = "";
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      value += s[i + 1];
      i += 2;
      continue;
    }
    if (c === quote) return { value, end: i + 1 };
    value += c;
    i++;
  }
  return null;
}

/**
 * Parse a cell's raw formula. Returns a ``SqlCall`` iff the entire
 * formula is a ``=SQL(...)`` call with one or two string-literal
 * arguments. Cell refs, expressions, or unexpected extras → null.
 *
 * Grammar (case-insensitive on the name):
 *   ``=SQL(STR)`` or ``=SQL(STR, STR)``
 *
 * This is deliberately narrow — composition (e.g. `=SUM(SQL(...))`)
 * is out of scope; users who want to aggregate a SQL result drop
 * the call in one cell and reference the spill via ``A1#``.
 */
// TODO(liblotus): replace with WasmSheet.parse_simple_call — see
// TODO-liblotus-call-shape.md. The hand-walked string-literal
// scanner here treats every ``\X`` as literal ``X``, which diverges
// from the engine lexer's escape rules; both go away with the
// engine primitive.
export function parseSqlCall(rawValue: string): SqlCall | null {
  const text = rawValue.trim();
  const header = text.match(/^=\s*SQL\s*\(\s*/i);
  if (!header) return null;

  let i = header[0].length;

  const first = extractStringLiteral(text, i);
  if (!first) return null;
  i = first.end;
  while (i < text.length && /\s/.test(text[i])) i++;

  // Single-arg form: next char must be ``)`` and the formula must
  // end there (allowing trailing whitespace).
  if (text[i] === ")") {
    if (!/^\s*$/.test(text.slice(i + 1))) return null;
    return { dbname: null, sql: first.value };
  }

  // Two-arg form: comma then a second string literal.
  if (text[i] !== ",") return null;
  i++;
  while (i < text.length && /\s/.test(text[i])) i++;
  const second = extractStringLiteral(text, i);
  if (!second) return null;
  i = second.end;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== ")") return null;
  if (!/^\s*$/.test(text.slice(i + 1))) return null;

  return { dbname: first.value, sql: second.value };
}

/** Build the Datasette data URL for a parsed call. Returns ``null``
 *  when ``dbname`` is implicit and no workbook is loaded yet — the
 *  caller should surface ``#SQL!`` and leave it to the user to
 *  refresh once the workbook's database is known. */
export function buildSqlUrl(call: SqlCall): string | null {
  const db = call.dbname ?? _defaultDb;
  if (!db) return null;
  const encoded = encodeURIComponent(call.sql);
  return `/${encodeURIComponent(db)}.json?sql=${encoded}&_shape=array`;
}

/**
 * Shape-tolerant parser for the Datasette JSON response. Accepts:
 *
 *   - ``?_shape=array`` → ``[{col: val, ...}, ...]`` (our default)
 *   - Default shape → ``{columns: [...], rows: [...]}``
 *
 * Returns a 2-D row-major string array with column headers as row 0,
 * data rows below. Null/undefined cells become ``""``. Throws on
 * anything that doesn't look like either.
 */
export function parseDatasetteJson(body: unknown): string[][] {
  // array-of-objects (?_shape=array)
  if (Array.isArray(body)) {
    if (body.length === 0) return [[]];
    const first = body[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const cols = Object.keys(first as Record<string, unknown>);
      const rows = (body as Record<string, unknown>[]).map((obj) =>
        cols.map((c) => stringify(obj[c])),
      );
      return [cols, ...rows];
    }
    if (Array.isArray(first)) {
      return (body as unknown[][]).map((r) => r.map(stringify));
    }
    throw new Error("Unrecognized JSON array shape");
  }
  // {columns, rows}
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const cols = obj.columns;
    const rows = obj.rows;
    if (Array.isArray(cols) && Array.isArray(rows)) {
      const headers = cols.map((c) => stringify(c));
      const data = (rows as unknown[]).map((r) => {
        if (Array.isArray(r)) return r.map(stringify);
        if (r && typeof r === "object") {
          return headers.map((h) =>
            stringify((r as Record<string, unknown>)[h]),
          );
        }
        return [stringify(r)];
      });
      return [headers, ...data];
    }
  }
  throw new Error("Unrecognized JSON shape");
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

/** Hard cap so one pathological query can't hang the UI. */
const MAX_ROWS = 10_000;

/** The actual fetch. Exposed for tests. */
export async function fetchSqlData(url: string): Promise<string[][]> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body: unknown = await res.json();
  const rows = parseDatasetteJson(body);
  if (rows.length > MAX_ROWS + 1) {
    // +1 for the header row. Truncate silently; the spec documents
    // this and the cell's error tooltip will carry the notice.
    rows.length = MAX_ROWS + 1;
  }
  return rows;
}

/** Drop the cache and anchor map — for tests and on sheet switch. */
export function clearSqlCache(): void {
  _cache.clear();
  _anchors.clear();
}

/** Record that ``cellId`` wants the data for ``url`` and pin its
 *  current state. Called from the store whenever a SQL formula is
 *  committed. Idempotent: re-registering the same cell is safe, and
 *  switching a cell between URLs dissociates it from the old one. */
export function syncSqlCell(cellId: string, rawValue: string): void {
  const call = parseSqlCall(rawValue);
  if (!call) {
    // Cell is no longer a SQL call. If we were tracking it, clean up.
    detachCell(cellId);
    if (isPinned(cellId)) unpinValue(cellId);
    return;
  }

  const url = buildSqlUrl(call);
  if (!url) {
    pinValue(cellId, [["#SQL!"]]);
    return;
  }

  // Dissociate the cell from any previous URL before attaching to
  // the new one.
  detachCell(cellId, url);
  attachCell(cellId, url);

  const entry = _cache.get(url);
  if (entry?.status === "ready" && entry.rows) {
    pinValue(cellId, entry.rows);
    return;
  }
  if (entry?.status === "error") {
    pinValue(cellId, [[`#SQL! ${entry.error ?? ""}`.trim()]]);
    return;
  }
  if (entry?.status === "loading") {
    pinValue(cellId, [["#LOADING!"]]);
    return;
  }

  // Fresh call — pin loading, kick off fetch.
  pinValue(cellId, [["#LOADING!"]]);
  _cache.set(url, { status: "loading" });
  void runFetch(url);
}

function attachCell(cellId: string, url: string): void {
  let set = _anchors.get(url);
  if (!set) {
    set = new Set();
    _anchors.set(url, set);
  }
  set.add(cellId);
}

function detachCell(cellId: string, exceptUrl?: string): void {
  for (const [url, set] of _anchors) {
    if (url === exceptUrl) continue;
    if (set.delete(cellId) && set.size === 0) {
      _anchors.delete(url);
    }
  }
}

async function runFetch(url: string): Promise<void> {
  try {
    const rows = await fetchSqlData(url);
    _cache.set(url, { status: "ready", rows });
    repinAll(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    _cache.set(url, { status: "error", error: message });
    repinAll(url);
  }
  // [perf] Pull the new pinned state from the engine into the cells
  // map. The engine already has the pin via ``pinValue`` above —
  // ``refreshFromEngine`` reuses the existing WasmSheet (no
  // ``loadIntoEngine`` rebuild) and the immutable merge means cells
  // whose value didn't change keep their ref + don't wake their
  // per-cell subscribers. Lazy import breaks the
  // sql.ts → spreadsheet.ts → persistence.ts → (SSE) → sql.ts cycle.
  const { cells } = await import("./stores/spreadsheet");
  cells.refreshFromEngine();
}

function repinAll(url: string): void {
  const set = _anchors.get(url);
  if (!set) return;
  const entry = _cache.get(url);
  if (!entry) return;
  for (const cellId of set) {
    if (entry.status === "ready" && entry.rows) {
      pinValue(cellId, entry.rows);
    } else if (entry.status === "error") {
      pinValue(cellId, [[`#SQL! ${entry.error ?? ""}`.trim()]]);
    }
  }
}

/** Force a refetch for a cell — clears the URL's cache entry and
 *  re-syncs. Used by the "Refresh data" context-menu action. */
export function refreshSqlCell(cellId: string, rawValue: string): void {
  const call = parseSqlCall(rawValue);
  if (!call) return;
  const url = buildSqlUrl(call);
  if (!url) return;
  _cache.delete(url);
  syncSqlCell(cellId, rawValue);
}
