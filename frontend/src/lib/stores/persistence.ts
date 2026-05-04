import { get, writable, derived } from "svelte/store";
import type { CellData, CellId } from "../spreadsheet/types";
import {
  cells,
  selectedCell,
  columnWidths,
  COLUMNS,
  ROWS,
  clearUndoHistory,
  registerDirtyTracker,
} from "./spreadsheet";
// Imported from ``./clipboard`` directly (rather than via
// ``./spreadsheet``'s re-export) so the active-sheet subscriber
// below cannot see a half-evaluated module — the original cycle
// that necessitated the ``queueMicrotask`` hack. [STORES-08]
import { clearClipboardMark } from "./clipboard";
import { loadViews } from "./views";
import { loadNamedRanges } from "./namedRanges";
import { loadFilter } from "./filter";
import { loadDropdownRules } from "./dropdownRules";
import {
  listSheets,
  createSheet,
  getSheet,
  updateSheet,
  deleteSheet as apiDeleteSheet,
  reorderSheets as apiReorderSheets,
  deleteRows as apiDeleteRows,
  deleteColumns as apiDeleteColumns,
  insertColumns as apiInsertColumns,
  moveColumns as apiMoveColumns,
  type MoveColumnsResult,
  moveRows as apiMoveRows,
  type MoveRowsResult,
  saveCells,
  saveColumns,
  type SheetMeta,
  type CellData as ApiCellData,
  type CellChange,
  type ColumnChange,
} from "../api";
import {
  createDefaultFormat,
  hasNonDefaultFormat,
} from "../spreadsheet/formatter";
import { setSqlDefaultDatabase, clearSqlCache, syncSqlCell } from "../sql";
import {
  cellId as engineCellId,
  clearAllPins,
  parseCellIdRaw,
  setEngineNames,
} from "../engine";

// The database name, workbook ID, and client ID are set during init
let _database = "";
let _workbookId = 0;
let _clientId = "";

export function setDatabase(database: string) {
  _database = database;
  setSqlDefaultDatabase(database);
}

export function setWorkbookId(workbookId: number) {
  _workbookId = workbookId;
}

export function setClientId(clientId: string) {
  _clientId = clientId;
}

export function getClientId(): string {
  return _clientId;
}

export interface LocalSheetMeta {
  id: number;
  name: string;
  color: string;
}

const DEFAULT_COLORS = [
  "#276890",
  "#4a7c59",
  "#7b5ea7",
  "#c17d3a",
  "#a85454",
  "#5a8a8a",
  "#4a6fa5",
  "#8b5e3c",
];

// Stores
const _sheets = writable<LocalSheetMeta[]>([]);
// 0 means "no active sheet" — sheet ids are autoincrement integers and
// will always be >= 1, so 0 is a safe sentinel.
const _activeSheetId = writable<number>(0);

// Cut marker is scoped to the active sheet — cell IDs like "B2" mean
// different things on different sheets, so a dashed border pinned to
// B2 on sheet 1 must not visually leak onto B2 on sheet 2. Any change
// to the active sheet drops the pending cut.
// [sheet.clipboard.sheet-switch-clears-mark]
_activeSheetId.subscribe(() => {
  clearClipboardMark();
});

// The active sheet is mirrored into the URL hash as ``#sheet=<id>`` so
// a page refresh lands on the same tab the user left. Key/value
// format (rather than bare ``#<id>``) leaves room for other
// per-session state (cursor, selection) to piggyback later.
// [sheet.tabs.url-hash-remembers]
function readSheetFromHash(): number | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const raw = params.get("sheet");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function writeSheetToHash(sheetId: number) {
  if (typeof window === "undefined") return;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const value = String(sheetId);
  if (params.get("sheet") === value) return;
  params.set("sheet", value);
  const next = "#" + params.toString();
  // ``replaceState`` — don't pollute history with one entry per
  // sheet switch; Back should leave the workbook, not step through
  // every tab the user visited.
  window.history.replaceState(null, "", next);
}

export const sheets = derived(_sheets, ($s) => $s);
export const activeSheetId = derived(_activeSheetId, ($id) => $id);
export const activeSheet = derived(
  [_sheets, _activeSheetId],
  ([$sheets, $id]) => {
    return $sheets.find((s) => s.id === $id) ?? $sheets[0] ?? null;
  },
);

function apiSheetToLocal(s: SheetMeta): LocalSheetMeta {
  return { id: s.id, name: s.name, color: s.color };
}

function apiCellsToMap(apiCells: ApiCellData[]): Map<CellId, CellData> {
  const map = new Map<CellId, CellData>();
  for (const c of apiCells) {
    const col = COLUMNS[c.col_idx];
    if (!col) continue;
    const cellId = `${col}${c.row_idx + 1}` as CellId;
    let format = createDefaultFormat();
    if (c.format_json) {
      try {
        format = { ...format, ...JSON.parse(c.format_json) };
      } catch {
        // ignore bad format
      }
    }
    // typed_kind from the server installs the local typed override so
    // engine.set_cells_typed sees the same kind on every recalc — the
    // cell stays force-text after reload instead of auto-classifying
    // back. [sheet.cell.force-text]
    const typedKind = c.typed_kind === "string" ? "string" : undefined;
    map.set(cellId, {
      rawValue: c.raw_value,
      computedValue: null,
      // Force-text cells are literal text, never formulas.
      formula:
        typedKind === "string"
          ? null
          : c.raw_value.startsWith("=")
            ? c.raw_value
            : null,
      format,
      error: null,
      typedKind,
    });
  }
  return map;
}

function cellIdToCoords(
  cellId: CellId,
): { row_idx: number; col_idx: number } | null {
  const parsed = parseCellIdRaw(cellId);
  if (!parsed) return null;
  if (parsed.col >= COLUMNS.length) return null;
  return { row_idx: parsed.row, col_idx: parsed.col };
}

/**
 * Reset every piece of sheet-scoped state to its empty baseline. Called
 * before fetching the destination sheet so pins, named ranges, SQL
 * fetch cache, undo history, and selection from the previous sheet
 * can never bleed into the next one — all of these share the cell-id
 * namespace, which is meaningful only within a single sheet.
 * [sheet.cell.pin] [sheet.cell.sql-array-formula]
 */
function resetSheetScopedState() {
  cells.clear();
  selectedCell.set(null);
  clearAllPins();
  clearSqlCache();
  setEngineNames({});
  clearUndoHistory();
}

/** Thrown by ``transitionToSheet`` when the pre-switch flush fails;
 *  callers should leave ``activeSheetId`` untouched and surface the
 *  error to the user (the in-flight dirty markers are still queued
 *  so a retry / next flush will re-send them). */
export class SaveBeforeSwitchError extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Failed to save before switching sheet: ${cause.message}`
        : "Failed to save before switching sheet",
    );
    this.name = "SaveBeforeSwitchError";
    this.cause = cause;
  }
}

/**
 * Owner of the full sheet-switch sequence. The only path that may
 * mutate ``_activeSheetId``.
 *
 * 1. Flush dirty state for the outgoing sheet. If that fails, throw
 *    ``SaveBeforeSwitchError`` and leave the active sheet untouched
 *    — the user keeps editing what they were editing, and the dirty
 *    markers stay queued for the next flush instead of being silently
 *    re-targeted at the new sheet.
 * 2. Reset every piece of sheet-scoped state synchronously so no
 *    stale pin / name / undo frame survives the await.
 * 3. Fetch the new sheet.
 * 4. Apply the new cell map and column widths, **then** flip
 *    ``_activeSheetId``. The id flips after the data is in place so
 *    subscribers that read ``cells`` and ``activeSheetId`` together
 *    (presence broadcast, SSE reconnect) never see the new id paired
 *    with the previous sheet's content.
 * 5. Load named ranges + views in parallel; replay any ``=SQL(...)``
 *    cells the load surfaced.
 */
async function transitionToSheet(newSheetId: number): Promise<void> {
  try {
    await saveCellsToWorkbook();
  } catch (e) {
    throw new SaveBeforeSwitchError(e);
  }

  resetSheetScopedState();

  const data = await getSheet(_database, _workbookId, newSheetId);

  // Load cells first — don't recalc yet, named ranges aren't in the
  // engine until ``loadNamedRanges`` below. A recalc now would
  // misresolve any formula that references a name as ``#NAME?``.
  const cellMap = apiCellsToMap(data.cells);
  cells.set(cellMap);

  // Default column widths to 100 for any column the server didn't
  // persist a value for.
  const widths: Record<string, number> = Object.fromEntries(
    COLUMNS.map((c) => [c, 100]),
  );
  for (const col of data.columns) {
    const colName = COLUMNS[col.col_idx];
    if (colName) {
      widths[colName] = col.width;
    }
  }
  columnWidths.set(widths);

  // Cell map and widths are in place — flip the id now so any
  // subscriber driven by ``activeSheetId`` (presence, SSE) sees the
  // new id with consistent cell content.
  _activeSheetId.set(newSheetId);

  // Named ranges feed the engine + trigger the first recalc; views
  // load in parallel.
  await Promise.all([
    loadNamedRanges(_database, _workbookId, newSheetId),
    loadViews(_database, _workbookId, newSheetId),
    loadFilter(_database, _workbookId, newSheetId),
  ]);

  // Replay any ``=SQL(...)`` cells the load surfaced. Done after
  // ``loadNamedRanges`` so the SQL module has seen the active
  // database via ``setSqlDefaultDatabase``.
  for (const [cellId, cell] of cellMap) {
    if (cell.rawValue) syncSqlCell(cellId, cell.rawValue);
  }
}

/** Load a sheet's cells into the cell store. Used at cold start
 *  (``initWorkbook``) where the active id is already set and there
 *  is no prior sheet to flush. */
async function loadSheetCells(sheetId: number) {
  const data = await getSheet(_database, _workbookId, sheetId);

  resetSheetScopedState();

  const cellMap = apiCellsToMap(data.cells);
  cells.set(cellMap);

  const widths: Record<string, number> = Object.fromEntries(
    COLUMNS.map((c) => [c, 100]),
  );
  for (const col of data.columns) {
    const colName = COLUMNS[col.col_idx];
    if (colName) {
      widths[colName] = col.width;
    }
  }
  columnWidths.set(widths);

  await Promise.all([
    loadNamedRanges(_database, _workbookId, sheetId),
    loadViews(_database, _workbookId, sheetId),
    loadFilter(_database, _workbookId, sheetId),
  ]);

  for (const [cellId, cell] of cellMap) {
    if (cell.rawValue) syncSqlCell(cellId, cell.rawValue);
  }
}

/** Initialize: fetch sheets from server, load active sheet */
export async function initWorkbook() {
  const sheetList = await listSheets(_database, _workbookId);

  // Workbook-scoped — load once per workbook visit. Must precede
  // ``loadSheetCells`` so cells with ``dropdownRuleId`` render their
  // chip on first paint instead of flickering through "missing rule"
  // → resolved.
  await loadDropdownRules(_database, _workbookId);

  if (sheetList.length === 0) {
    // No sheets yet — create the first one
    const result = await createSheet(_database, _workbookId, "Sheet 1");
    _sheets.set([apiSheetToLocal(result.sheet)]);
    _activeSheetId.set(result.sheet.id);
    installHashSync();

    // Set column widths from defaults
    const widths: Record<string, number> = {};
    for (const col of result.columns) {
      const colName = COLUMNS[col.col_idx];
      if (colName) widths[colName] = col.width;
    }
    columnWidths.set(widths);
    cells.clear();
    clearUndoHistory();
    return;
  }

  _sheets.set(sheetList.map(apiSheetToLocal));

  // Prefer the sheet the hash points at (page refresh, shared link).
  // Fall back to the first sheet if the hash is empty or references a
  // sheet that no longer exists.
  const hashId = readSheetFromHash();
  const initial =
    hashId && sheetList.some((s) => s.id === hashId) ? hashId : sheetList[0].id;
  _activeSheetId.set(initial);
  installHashSync();
  await loadSheetCells(initial);
}

// Guarded so repeated ``initWorkbook`` calls don't stack listeners or
// re-subscribe. One install per page life is enough.
let _hashSyncInstalled = false;

function installHashSync() {
  if (_hashSyncInstalled || typeof window === "undefined") return;
  _hashSyncInstalled = true;

  // Push active sheet → hash on every switch.
  _activeSheetId.subscribe((id) => {
    if (id) writeSheetToHash(id);
  });

  // Pull hash → active sheet on back/forward or manual edit. Only
  // switch when the hash points at a known, non-current sheet — an
  // unknown id means the user pasted a stale link; leave them where
  // they are.
  window.addEventListener("hashchange", () => {
    const hashId = readSheetFromHash();
    if (hashId == null) return;
    if (hashId === get(_activeSheetId)) return;
    const known = get(_sheets).some((s) => s.id === hashId);
    if (!known) return;
    void switchSheet(hashId);
  });
}

/** Switch to a different sheet. Throws ``SaveBeforeSwitchError`` if
 *  the pre-switch flush failed — in that case the active sheet is
 *  unchanged and the dirty set is preserved for the next flush. */
export async function switchSheet(sheetId: number) {
  await transitionToSheet(sheetId);
}

/** Add a new sheet */
export async function addSheet(name?: string): Promise<number> {
  try {
    await saveCellsToWorkbook();
  } catch (e) {
    throw new SaveBeforeSwitchError(e);
  }

  const currentSheets = get(_sheets);
  const num = currentSheets.length + 1;
  const colorIndex = currentSheets.length % DEFAULT_COLORS.length;
  const sheetName = name ?? `Sheet ${num}`;

  const result = await createSheet(
    _database,
    _workbookId,
    sheetName,
    DEFAULT_COLORS[colorIndex],
  );

  // Reset every sheet-scoped engine overlay before flipping the id.
  // The new sheet is empty so we do not call the fetch path, but the
  // engine pin map / named-range table / SQL cache from the outgoing
  // sheet would otherwise survive into the fresh sheet's first
  // recalc and surface phantom values.
  resetSheetScopedState();
  columnWidths.set(Object.fromEntries(COLUMNS.map((c) => [c, 100])));

  _sheets.update((s) => [...s, apiSheetToLocal(result.sheet)]);
  _activeSheetId.set(result.sheet.id);

  return result.sheet.id;
}

/** Delete a sheet */
export async function deleteSheet(sheetId: number) {
  const currentSheets = get(_sheets);
  if (currentSheets.length <= 1) return;

  await apiDeleteSheet(_database, _workbookId, sheetId);

  const remaining = currentSheets.filter((s) => s.id !== sheetId);
  _sheets.set(remaining);

  const currentActive = get(_activeSheetId);
  if (sheetId === currentActive) {
    // Drop the dirty set for the now-deleted sheet — there is nothing
    // server-side to upsert into, and ``transitionToSheet``'s
    // pre-flush would otherwise fire a doomed save. Then route
    // through the helper so undo / pins / names from the deleted
    // sheet cannot survive the swap.
    _dirtyCellIds.clear();
    _columnWidthsDirty = false;
    await transitionToSheet(remaining[0].id);
  }
}

/** Rename a sheet */
export async function renameSheet(sheetId: number, newName: string) {
  await updateSheet(_database, _workbookId, sheetId, { name: newName });
  _sheets.update((s) =>
    s.map((sheet) =>
      sheet.id === sheetId ? { ...sheet, name: newName } : sheet,
    ),
  );
}

/** Set sheet tab color */
export async function setSheetColor(sheetId: number, color: string) {
  await updateSheet(_database, _workbookId, sheetId, { color });
  _sheets.update((s) =>
    s.map((sheet) => (sheet.id === sheetId ? { ...sheet, color } : sheet)),
  );
}

/**
 * Reorder the workbook's sheets to the given sequence of ids.
 * Optimistic: updates the local store first so drag UX feels instant,
 * then POSTs the full permutation. On failure the original order is
 * restored.
 */
export async function reorderSheets(orderedIds: number[]) {
  const before = get(_sheets);
  const byId = new Map(before.map((s) => [s.id, s]));
  const reordered = orderedIds
    .map((id) => byId.get(id))
    .filter((s): s is LocalSheetMeta => s !== undefined);
  // If the caller handed us ids that don't match the current sheet set
  // 1:1 — e.g. a stale drag across a background sheet-add — bail out
  // before we touch the UI. The server would reject it anyway.
  if (reordered.length !== before.length) return;
  _sheets.set(reordered);
  try {
    await apiReorderSheets(_database, _workbookId, orderedIds);
  } catch (e) {
    _sheets.set(before);
    throw e;
  }
}

/** Move a single sheet one slot left/right, clamped at the ends. */
export async function moveSheet(sheetId: number, direction: -1 | 1) {
  const current = get(_sheets);
  const idx = current.findIndex((s) => s.id === sheetId);
  if (idx < 0) return;
  const target = idx + direction;
  if (target < 0 || target >= current.length) return;
  const next = current.slice();
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  await reorderSheets(next.map((s) => s.id));
}

/** Get available tab colors */
export function getColorPalette(): string[] {
  return [...DEFAULT_COLORS];
}

/**
 * Save indicator state — `"saving"` while a request is in flight,
 * `"saved"` for ~1.5s after a successful flush, `"idle"` otherwise.
 * Rendered by ``SheetsPage.svelte`` next to the connection dot.
 */
export type SaveStatus = "idle" | "saving" | "saved";
const _saveStatus = writable<SaveStatus>("idle");
export const saveStatus = derived(_saveStatus, ($s) => $s);

let _savedResetTimer: ReturnType<typeof setTimeout> | null = null;
const SAVED_INDICATOR_MS = 1500;

function markSaving() {
  if (_savedResetTimer) {
    clearTimeout(_savedResetTimer);
    _savedResetTimer = null;
  }
  _saveStatus.set("saving");
}

function markSaved() {
  _saveStatus.set("saved");
  if (_savedResetTimer) clearTimeout(_savedResetTimer);
  _savedResetTimer = setTimeout(() => {
    _saveStatus.set("idle");
    _savedResetTimer = null;
  }, SAVED_INDICATOR_MS);
}

/** Save current cell state to the server */
export async function saveCellsToWorkbook() {
  const activeId = get(_activeSheetId);
  if (!activeId) return;
  // Nothing dirty → no indicator flash. Callers like ``switchSheet``
  // invoke us unconditionally; we still want "Saved" to appear only
  // for real flushes.
  if (_dirtyCellIds.size === 0 && !_columnWidthsDirty) return;

  markSaving();
  try {
    if (_dirtyCellIds.size > 0) {
      const cellMap = get(cells) as Map<CellId, CellData>;
      const changes: CellChange[] = [];
      // Snapshot the in-flight set so any markCellDirty() that fires
      // during the await (fast typing, SSE merge, paste-driven format
      // updates) is preserved for the next flush instead of being
      // wiped by an unconditional clear.
      const inFlight = new Set(_dirtyCellIds);

      for (const cellId of inFlight) {
        const coords = cellIdToCoords(cellId);
        if (!coords) continue;

        const cell = cellMap.get(cellId);
        const rawValue = cell?.rawValue ?? "";
        const formatted =
          cell && hasNonDefaultFormat(cell.format)
            ? JSON.stringify(cell.format)
            : null;
        // Force-text cells carry typedKind="string" on CellData; emit
        // that as the API kind discriminator so the server installs
        // the same typed override. [sheet.cell.force-text]
        changes.push({
          row_idx: coords.row_idx,
          col_idx: coords.col_idx,
          raw_value: rawValue,
          format_json: formatted,
          kind: cell?.typedKind === "string" ? "string" : "raw",
        });
      }

      if (changes.length > 0) {
        await saveCells(
          _database,
          _workbookId,
          activeId,
          changes,
          _clientId || undefined,
        );
      }
      for (const id of inFlight) _dirtyCellIds.delete(id);
    }

    // Save column widths only if they changed. Like the cell path
    // above, snapshot the dirty generation before the await so a
    // width tweak that arrives mid-flight isn't wiped by the clear.
    if (_columnWidthsDirty) {
      const sentGen = _columnWidthsGen;
      const widths = get(columnWidths);
      const colChanges: ColumnChange[] = COLUMNS.map((name, idx) => ({
        col_idx: idx,
        name: null,
        width: widths[name] ?? 100,
      }));
      await saveColumns(_database, _workbookId, activeId, colChanges);
      if (_columnWidthsGen === sentGen) _columnWidthsDirty = false;
    }

    markSaved();
  } catch (e) {
    // Drop the indicator back to idle so a failed save doesn't leave
    // "Saving…" pinned in the header. The caller (flush or debounced)
    // still logs the error.
    _saveStatus.set("idle");
    throw e;
  }
}

/** Track whether column widths have changed since last save */
let _columnWidthsDirty = false;
// Bumped on every column-width mutation. Captured at save start and
// re-checked after the await so a width change that arrives mid-flight
// keeps the dirty flag set for the next flush.
let _columnWidthsGen = 0;

/** Set of cell IDs that have been locally modified since last save (including deletions). */
const _dirtyCellIds: Set<CellId> = new Set();

/** Mark a specific cell as dirty (local user edit).
 *
 * Suppressed while ``suppressAutoSave`` is active so SSE-driven and
 * other remote-origin writes can never enter the dirty set, even if
 * a future caller forgets the "don't markCellDirty inside an SSE
 * handler" convention. Without this gate the next save tick after
 * suppression unwinds would echo the remote edit back to the
 * server. */
export function markCellDirty(cellId: CellId) {
  if (_suppressAutoSave > 0) return;
  _dirtyCellIds.add(cellId);
}

// Wire the dirty-set into the undo/redo machinery. ``pushUndo``
// snapshots this set; ``undo`` / ``redo`` restore it so the next
// flush uploads exactly the restored content rather than the
// mid-mutation dirty markers. [sheet.undo.scope]
registerDirtyTracker({
  snapshot: () => new Set(_dirtyCellIds),
  restore: (next) => {
    _dirtyCellIds.clear();
    for (const id of next) _dirtyCellIds.add(id);
  },
});

/** Test-only: read the current dirty-cell set. Returned as a copy so
 *  callers can't mutate the internal state. */
export function _getDirtyCellIdsForTest(): Set<CellId> {
  return new Set(_dirtyCellIds);
}

/** Test-only: drop every dirty marker. Used in ``beforeEach`` resets. */
export function _resetDirtyCellIdsForTest(): void {
  _dirtyCellIds.clear();
}

/**
 * Suppress auto-save while applying remote SSE changes.
 * Increment to suppress, decrement to re-enable.
 */
let _suppressAutoSave = 0;

export function suppressAutoSave(fn: () => void) {
  _suppressAutoSave++;
  try {
    fn();
  } finally {
    _suppressAutoSave--;
  }
}

/** Auto-save: debounced save on cell/column changes */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 150;

// [sheet.save.auto-debounce]
function debouncedSave() {
  if (_suppressAutoSave > 0) return;
  if (_dirtyCellIds.size === 0 && !_columnWidthsDirty) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCellsToWorkbook().catch((err) => {
      console.error("Auto-save failed:", err);
    });
  }, DEBOUNCE_MS);
}

/** Flush pending changes immediately — call on explicit commit (Enter/Tab/blur). */
// [sheet.save.flush-on-commit]
export function flushSave() {
  if (_suppressAutoSave > 0) return;
  if (_dirtyCellIds.size === 0 && !_columnWidthsDirty) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saveCellsToWorkbook().catch((err) => {
    console.error("Flush save failed:", err);
  });
}

export function enableAutoSave() {
  cells.subscribe(debouncedSave);
  columnWidths.subscribe(() => {
    _columnWidthsDirty = true;
    _columnWidthsGen++;
    debouncedSave();
  });
}

/**
 * Delete whole columns from the active sheet. Mirrors ``removeRows``
 * but on the column axis — applies a local shift for instant UI
 * feedback, then hits the server (which persists the shift and
 * broadcasts to other clients).
 */
export async function removeCols(colIndices: number[]): Promise<number[]> {
  const sheetId = get(_activeSheetId);
  if (!sheetId || colIndices.length === 0) return [];
  // Drop dirty markers for cells in doomed columns.
  for (const id of Array.from(_dirtyCellIds)) {
    const parsed = parseCellIdRaw(id);
    if (!parsed) continue;
    if (colIndices.includes(parsed.col)) _dirtyCellIds.delete(id);
  }
  cells.deleteColsLocally(colIndices);
  return await apiDeleteColumns(
    _database,
    _workbookId,
    sheetId,
    colIndices,
    _clientId,
  );
}

/**
 * Insert ``count`` blank columns at index ``at``, shifting every
 * column at-or-past ``at`` right by ``count``. Mirror of
 * ``removeCols`` on the insert axis: apply the local shift for
 * instant feedback, then hit the server (which persists the shift
 * and broadcasts ``columns-inserted`` to other clients).
 */
export async function insertCols(at: number, count: number): Promise<number[]> {
  const sheetId = get(_activeSheetId);
  if (!sheetId || count <= 0 || at < 0) return [];
  // Dirty markers keyed by cellId ("A1" etc.) — when a column shifts
  // right, that cellId refers to a different column afterwards, so
  // the safest thing is to re-key dirty markers through the same
  // shift the store applies. Walk every dirty id once.
  const shifted = new Set<CellId>();
  for (const id of _dirtyCellIds) {
    const parsed = parseCellIdRaw(id);
    if (!parsed) {
      shifted.add(id);
      continue;
    }
    if (parsed.col < at) {
      shifted.add(id);
      continue;
    }
    const newColIdx = parsed.col + count;
    if (newColIdx >= COLUMNS.length) continue; // shifted off the visible band — drop the marker
    shifted.add(engineCellId(parsed.row, newColIdx) as CellId);
  }
  _dirtyCellIds.clear();
  for (const id of shifted) _dirtyCellIds.add(id);

  cells.insertColsLocally(at, count);
  return await apiInsertColumns(
    _database,
    _workbookId,
    sheetId,
    at,
    count,
    _clientId,
  );
}

/**
 * Move a contiguous block of columns to a new gap position. Drives
 * column drag-reorder. The originator pre-validates ``destGap``
 * against ``srcStart``/``srcEnd`` and applies the optimistic local
 * shift via ``cells.moveColsLocally`` BEFORE calling this; if the
 * server rejects (4xx) the caller is responsible for the inverse
 * shift.
 *
 * Returns the resolved move parameters from the server (so callers
 * can confirm the resolved ``finalStart``) or ``null`` for a no-op
 * server response.
 *
 * Dirty-cell tracking: same shape as ``insertCols`` — keys re-key
 * via the same forward map ``moveColsLocally`` uses on the cell
 * store, so a dirty cell at the source col follows its data to the
 * destination col.
 */
// [sheet.column.drag-reorder]
export async function moveCols(
  srcStart: number,
  srcEnd: number,
  destGap: number,
): Promise<MoveColumnsResult | null> {
  const sheetId = get(_activeSheetId);
  if (!sheetId) return null;
  if (srcStart < 0 || srcEnd < srcStart || destGap < 0) return null;

  const width = srcEnd - srcStart + 1;
  // Mirror the server's no-op gate so we don't fire a network
  // round-trip for an in-place drop.
  if (destGap >= srcStart && destGap <= srcEnd + 1) return null;
  const finalStart = destGap <= srcStart ? destGap : destGap - width;
  if (finalStart === srcStart) return null;

  // Re-key dirty cell markers via the same forward map the cell
  // store uses. A dirty cell at the source col follows its data to
  // the destination col — without this, an in-flight save for a
  // moved cell would write to the wrong post-move col.
  function forward(c: number): number {
    if (c >= srcStart && c <= srcEnd) return c - srcStart + finalStart;
    if (finalStart < srcStart) {
      if (c >= finalStart && c < srcStart) return c + width;
      return c;
    }
    if (c > srcEnd && c < finalStart + width) return c - width;
    return c;
  }
  const shifted = new Set<CellId>();
  for (const id of _dirtyCellIds) {
    const parsed = parseCellIdRaw(id);
    if (!parsed) {
      shifted.add(id);
      continue;
    }
    const newCol = forward(parsed.col);
    if (newCol === parsed.col) {
      shifted.add(id);
      continue;
    }
    if (newCol >= COLUMNS.length) continue;
    shifted.add(engineCellId(parsed.row, newCol) as CellId);
  }
  _dirtyCellIds.clear();
  for (const id of shifted) _dirtyCellIds.add(id);

  cells.moveColsLocally(srcStart, srcEnd, finalStart);
  return await apiMoveColumns(
    _database,
    _workbookId,
    sheetId,
    srcStart,
    srcEnd,
    destGap,
    _clientId,
  );
}

/**
 * Move a contiguous block of rows to a new gap position. Drives
 * row drag-reorder. Mirror of ``moveCols`` on the row axis.
 */
// [sheet.row.drag-reorder]
export async function moveRows(
  srcStart: number,
  srcEnd: number,
  destGap: number,
): Promise<MoveRowsResult | null> {
  const sheetId = get(_activeSheetId);
  if (!sheetId) return null;
  if (srcStart < 0 || srcEnd < srcStart || destGap < 0) return null;

  const width = srcEnd - srcStart + 1;
  // Server-side no-op gate mirrored locally so we don't fire a
  // network round-trip for an in-place drop.
  if (destGap >= srcStart && destGap <= srcEnd + 1) return null;
  const finalStart = destGap <= srcStart ? destGap : destGap - width;
  if (finalStart === srcStart) return null;

  // Re-key dirty cell markers via the same forward map the cell
  // store uses. A dirty cell at the source row follows its data
  // to the destination row.
  function forward(r: number): number {
    if (r >= srcStart && r <= srcEnd) return r - srcStart + finalStart;
    if (finalStart < srcStart) {
      if (r >= finalStart && r < srcStart) return r + width;
      return r;
    }
    if (r > srcEnd && r < finalStart + width) return r - width;
    return r;
  }
  const shifted = new Set<CellId>();
  for (const id of _dirtyCellIds) {
    const parsed = parseCellIdRaw(id);
    if (!parsed) {
      shifted.add(id);
      continue;
    }
    const newRow = forward(parsed.row);
    if (newRow === parsed.row) {
      shifted.add(id);
      continue;
    }
    if (newRow >= ROWS.length) continue;
    shifted.add(engineCellId(newRow, parsed.col) as CellId);
  }
  _dirtyCellIds.clear();
  for (const id of shifted) _dirtyCellIds.add(id);

  cells.moveRowsLocally(srcStart, srcEnd, finalStart);
  return await apiMoveRows(
    _database,
    _workbookId,
    sheetId,
    srcStart,
    srcEnd,
    destGap,
    _clientId,
  );
}

/**
 * Delete whole rows from the active sheet. The server runs the
 * single-UPDATE shift; this function applies the same shift locally
 * first (before the request returns) so the UI doesn't have a visible
 * gap. Dirty-cell tracking is cleared for the deleted rows so the
 * next auto-save doesn't try to re-upsert them.
 */
export async function removeRows(rowIndices: number[]): Promise<number[]> {
  const sheetId = get(_activeSheetId);
  if (!sheetId || rowIndices.length === 0) return [];
  // Clear dirty markers for cells in rows we're about to drop so the
  // debounced save doesn't race the API call.
  for (const id of Array.from(_dirtyCellIds)) {
    const parsed = parseCellIdRaw(id);
    if (!parsed) continue;
    if (rowIndices.includes(parsed.row)) _dirtyCellIds.delete(id);
  }
  // Optimistic local shift — gives the user an instant response.
  cells.deleteRowsLocally(rowIndices);
  return await apiDeleteRows(
    _database,
    _workbookId,
    sheetId,
    rowIndices,
    _clientId,
  );
}

/**
 * Test-only: reset every module-level mutable singleton owned by
 * ``persistence.ts`` to its empty baseline. Call from ``beforeEach``
 * in any test that imports ``./persistence``.
 *
 * The store has eleven module-level globals (sheet list, active id,
 * client/workbook ids, dirty-cell set, column-width gen counter,
 * suppression count, save / saved-indicator timers, hash-sync flag,
 * save status). Each test file used to clear its own subset, which
 * meant tests passing in isolation could fail when run after one
 * that left behind a dirty marker, a pending timer, or a stale id.
 *
 * Caveats:
 * - The ``hashchange`` listener and ``_activeSheetId`` subscriber
 *   installed by ``installHashSync`` are *not* removed — they are
 *   one-shot per page life. A test that calls ``initWorkbook`` more
 *   than once will not double-install (the ``_hashSyncInstalled``
 *   flag is reset and re-checked), but the original listener stays
 *   wired. Tests that touch ``window.location.hash`` should set up a
 *   ``vi.spyOn(window.history, "replaceState")`` rather than rely
 *   on listener teardown.
 * - The clipboard-clear subscriber installed at module top-level on
 *   ``_activeSheetId`` is also persistent. It is harmless on reset
 *   (a no-op clear of an already-empty range).
 *
 * The L-effort fix is to wrap this state in a class so reset becomes
 * "instantiate a new SheetsClient"; until that lands, this helper is
 * the canonical reset point — don't reach into the module's internals
 * directly. [STORES-08]
 */
export function resetPersistenceStateForTests(): void {
  _database = "";
  _workbookId = 0;
  _clientId = "";
  setSqlDefaultDatabase("");
  _dirtyCellIds.clear();
  _columnWidthsDirty = false;
  _columnWidthsGen = 0;
  _suppressAutoSave = 0;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (_savedResetTimer) {
    clearTimeout(_savedResetTimer);
    _savedResetTimer = null;
  }
  // Reset the install-once guard so a fresh ``initWorkbook`` in the
  // next test can re-enter the install path. The listeners themselves
  // still leak (see caveats above) — assert behaviour, not absence
  // of listeners, in tests that exercise the hash sync.
  _hashSyncInstalled = false;
  _sheets.set([]);
  _activeSheetId.set(0);
  _saveStatus.set("idle");
}
