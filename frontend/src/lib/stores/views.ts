import { writable, derived } from "svelte/store";
import { COLUMNS } from "./spreadsheet";
import {
  listViews,
  deleteView as apiDeleteView,
  type SheetViewMeta,
} from "../api";
import type { CellId } from "../spreadsheet/types";

export type { SheetViewMeta };

export const sheetViews = writable<SheetViewMeta[]>([]);

/** Currently active view (user clicked a view triangle) */
export const activeView = writable<SheetViewMeta | null>(null);

/** Map from CellId → SheetViewMeta for cells within any view's range */
export const viewCellMap = derived(sheetViews, ($views) => {
  const map = new Map<CellId, SheetViewMeta>();
  for (const v of $views) {
    for (let r = v.min_row; r <= v.max_row; r++) {
      for (let c = v.min_col; c <= v.max_col; c++) {
        const col = COLUMNS[c];
        if (!col) continue;
        map.set(`${col}${r + 1}` as CellId, v);
      }
    }
  }
  return map;
});

/** Map from CellId → SheetViewMeta for top-left cells of each view */
export const viewTopLeftCells = derived(sheetViews, ($views) => {
  const map = new Map<CellId, SheetViewMeta>();
  for (const v of $views) {
    const col = COLUMNS[v.min_col];
    if (!col) continue;
    map.set(`${col}${v.min_row + 1}` as CellId, v);
  }
  return map;
});

export async function loadViews(
  database: string,
  workbookId: string,
  sheetId: string,
) {
  const views = await listViews(database, workbookId, sheetId);
  sheetViews.set(views);
  activeView.set(null);
}

export async function removeView(
  database: string,
  workbookId: string,
  sheetId: string,
  viewId: string,
) {
  await apiDeleteView(database, workbookId, sheetId, viewId);
  sheetViews.update((views) => views.filter((v) => v.id !== viewId));
  activeView.set(null);
}
