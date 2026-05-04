/**
 * Named-range state for the active sheet.
 *
 * Mirrors the server's ``datasette_sheets_named_range`` table. On
 * sheet load the list is fetched and pushed into the WASM engine via
 * ``setEngineNames`` so local recalc resolves name references the
 * same way the server does.
 */
import { writable } from "svelte/store";
import {
  listNamedRanges,
  setNamedRange as apiSet,
  deleteNamedRange as apiDelete,
  type NamedRangeMeta,
} from "../api";
import { setEngineName, removeEngineName, setEngineNames } from "../engine";
import { cells } from "./spreadsheet";

export type { NamedRangeMeta };

export const namedRanges = writable<NamedRangeMeta[]>([]);

/**
 * Controls the Named Ranges side panel. ``null`` = closed. When open,
 * ``initialName`` / ``initialDefinition`` pre-fill the editor — used
 * by the cell context-menu "Define named range" command to hand the
 * selected range straight to the form.
 */
export type NamedRangesPanelState = {
  initialName?: string;
  initialDefinition?: string;
} | null;

export const namedRangesPanel = writable<NamedRangesPanelState>(null);

export function openNamedRangesPanel(state: NamedRangesPanelState = {}) {
  namedRangesPanel.set(state ?? {});
}

export function closeNamedRangesPanel() {
  namedRangesPanel.set(null);
}

function sortByName(list: NamedRangeMeta[]): NamedRangeMeta[] {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

/** Fetch all named ranges for a sheet + push them into the WASM engine. */
export async function loadNamedRanges(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<void> {
  const list = await listNamedRanges(database, workbookId, sheetId);
  const sorted = sortByName(list);
  namedRanges.set(sorted);
  const map: Record<string, string> = {};
  for (const n of sorted) map[n.name] = n.definition;
  setEngineNames(map);
  cells.recalculate();
}

/** Create or overwrite a named range; refresh computed cell values.
 *
 *  [perf] Uses ``cells.refreshFromEngine()`` instead of
 *  ``cells.recalculate()`` — ``setEngineName`` pushes the name into
 *  the live ``WasmSheet`` (which runs its own recalc), so we just
 *  need to pull computed values back into the cells map. Avoids
 *  rebuilding the whole engine + re-applying every pin for a single
 *  name change. See ticket stores-07. */
export async function upsertNamedRange(
  database: string,
  workbookId: string,
  sheetId: string,
  name: string,
  definition: string,
): Promise<NamedRangeMeta> {
  const record = await apiSet(database, workbookId, sheetId, name, definition);
  namedRanges.update((list) => {
    const without = list.filter(
      (n) => n.name.toUpperCase() !== record.name.toUpperCase(),
    );
    return sortByName([...without, record]);
  });
  setEngineName(record.name, record.definition);
  cells.refreshFromEngine();
  return record;
}

/** Remove a named range by name (case-insensitive). Same delta-recalc
 *  path as ``upsertNamedRange``. */
export async function removeNamedRange(
  database: string,
  workbookId: string,
  sheetId: string,
  name: string,
): Promise<void> {
  await apiDelete(database, workbookId, sheetId, name);
  namedRanges.update((list) =>
    list.filter((n) => n.name.toUpperCase() !== name.toUpperCase()),
  );
  removeEngineName(name);
  cells.refreshFromEngine();
}
