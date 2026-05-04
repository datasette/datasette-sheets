/**
 * Workbook-scoped dropdown rules. Cells reference a rule via
 * ``CellFormat.dropdownRuleId``; the rule's option list + colors
 * drive the chip rendering in ``Cell.svelte`` and the popover in
 * ``DropdownPopover.svelte``.
 *
 * Storage is workbook-level: editing options on rule X updates every
 * cell across every sheet of the workbook that points at X. The
 * server is the source of truth (table
 * ``datasette_sheets_dropdown_rule``); this store is a typed
 * client-side mirror loaded once per workbook. [sheet.data.dropdown]
 */
import { derived, writable } from "svelte/store";
import type { DropdownRule, DropdownOption } from "../spreadsheet/types";
import {
  listDropdownRules as apiList,
  createDropdownRule as apiCreate,
  updateDropdownRule as apiUpdate,
  deleteDropdownRule as apiDelete,
  type DropdownRuleRecord,
} from "../api";
import { cells } from "./spreadsheet";
import type { CellId } from "../spreadsheet/types";

export const dropdownRules = writable<DropdownRule[]>([]);

/** The cell whose dropdown popover is currently open, or ``null``.
 *  Single-popover-at-a-time globally — clicking another dropdown
 *  cell closes the previous popover and opens this one.
 *  [sheet.data.dropdown] */
export const dropdownPopoverFor = writable<CellId | null>(null);

export function openDropdownPopover(cellId: CellId) {
  dropdownPopoverFor.set(cellId);
}

export function closeDropdownPopover() {
  dropdownPopoverFor.set(null);
}

/** O(1) ``id → rule`` map for cell-render lookups. Derived once per
 *  store update so the ~1500 cells in a sheet don't each .find()
 *  the array. */
export const dropdownRulesById = derived(dropdownRules, ($rules) => {
  const map = new Map<number, DropdownRule>();
  for (const r of $rules) map.set(r.id, r);
  return map;
});

/** Side-panel state. ``null`` = closed. ``ruleId`` non-null edits an
 *  existing rule; ``ruleId === null`` opens a fresh-create form. */
export type DropdownPanelState = { ruleId: number | null } | null;

export const dropdownRulesPanel = writable<DropdownPanelState>(null);

export function openDropdownRulesPanel(ruleId: number | null = null) {
  dropdownRulesPanel.set({ ruleId });
}

export function closeDropdownRulesPanel() {
  dropdownRulesPanel.set(null);
}

function sortRules(list: DropdownRule[]): DropdownRule[] {
  return [...list].sort((a, b) => {
    const an = a.name ?? "";
    const bn = b.name ?? "";
    if (an && bn) return an.localeCompare(bn, "en", { sensitivity: "base" });
    if (an) return -1;
    if (bn) return 1;
    return a.id - b.id;
  });
}

/** Convert a wire record into the internal ``DropdownRule`` shape.
 *  Today the shapes are identical; the indirection is a hedge for
 *  v2 ``source.kind === "range"`` records that might carry different
 *  fields. */
function fromRecord(record: DropdownRuleRecord): DropdownRule {
  return {
    id: record.id,
    name: record.name ?? undefined,
    multi: record.multi,
    source: {
      kind: "list",
      options: (record.source.options ?? []).map((o) => ({
        value: o.value,
        color: o.color,
      })),
    },
  };
}

export async function loadDropdownRules(
  database: string,
  workbookId: number,
): Promise<void> {
  const list = await apiList(database, workbookId);
  dropdownRules.set(sortRules(list.map(fromRecord)));
}

export async function createDropdownRule(
  database: string,
  workbookId: number,
  draft: {
    name?: string;
    options: DropdownOption[];
    multi: boolean;
  },
): Promise<DropdownRule> {
  const record = await apiCreate(database, workbookId, {
    name: draft.name,
    multi: draft.multi,
    options: draft.options,
  });
  const rule = fromRecord(record);
  dropdownRules.update((list) => sortRules([...list, rule]));
  return rule;
}

export async function updateDropdownRule(
  database: string,
  workbookId: number,
  ruleId: number,
  patch: {
    name?: string;
    nameSet?: boolean;
    options?: DropdownOption[];
    multi?: boolean;
  },
): Promise<DropdownRule> {
  const record = await apiUpdate(database, workbookId, ruleId, {
    name: patch.name,
    nameSet: patch.nameSet,
    multi: patch.multi,
    options: patch.options,
  });
  const rule = fromRecord(record);
  dropdownRules.update((list) =>
    sortRules(list.map((r) => (r.id === rule.id ? rule : r))),
  );
  // [perf] No ``cells.recalculate()`` — dropdown rules don't affect
  // formula evaluation. Cells consume the rule via the
  // ``dropdownRulesById`` derived store, so updating ``dropdownRules``
  // above is enough to re-render every cell pointing at this rule
  // (chip color, option list). See ticket stores-07.
  return rule;
}

export async function deleteDropdownRule(
  database: string,
  workbookId: number,
  ruleId: number,
): Promise<void> {
  await apiDelete(database, workbookId, ruleId);
  dropdownRules.update((list) => list.filter((r) => r.id !== ruleId));
  cells.recalculate();
}

/** Split a multi-select cell value into its constituent option
 *  values. Empty raw string → empty array. Whitespace around
 *  commas is trimmed; empty segments dropped. [sheet.data.dropdown] */
export function splitMultiValue(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Inverse of ``splitMultiValue``. Dedupes while preserving the
 *  caller's order. */
export function joinMultiValue(values: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.join(",");
}
