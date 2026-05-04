// API client for datasette-sheets backend.
//
// Every call goes through openapi-fetch with types generated from the
// Python router's OpenAPI document. To regenerate after changing routes or
// schemas: `just types`.

import type { components } from "../../api.d.ts";
import { client } from "./client";

// Re-export schema types under the names the rest of the app already uses.
export type SheetMeta = components["schemas"]["SheetRecord"];
export type ColumnData = components["schemas"]["ColumnRecord"];
export type CellData = components["schemas"]["CellRecord"];
export type CellChange = components["schemas"]["CellChangeBody"];
export type ColumnChange = components["schemas"]["ColumnChangeBody"];
export type SheetViewMeta = components["schemas"]["ViewRecord"];
export type WorkbookMeta = components["schemas"]["WorkbookRecord"];
export type NamedRangeMeta = components["schemas"]["NamedRangeRecord"];
export type DropdownRuleRecord = components["schemas"]["DropdownRuleRecord"];
export type DropdownOptionRecord =
  components["schemas"]["DropdownOptionRecord"];
export type FilterMeta = components["schemas"]["FilterRecord"];
export type FilterPredicate = components["schemas"]["FilterPredicate"];

// Structured API error. Callers that want to react to specific HTTP
// statuses (409 conflict, 403 permission, 422 validation, …) can do
// `if (e instanceof ApiError && e.status === 409) …` and inspect
// `e.body` for the parsed Pydantic response — no need to regex over
// stringified messages.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Unwrap an openapi-fetch result: throw on error, otherwise return `data`.
// Exported so tests can drive it directly without mocking the entire
// openapi-fetch client surface.
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.error !== undefined) {
    const status = result.response?.status ?? 0;
    throw new ApiError(`API error ${status}`, status, result.error);
  }
  // Note: `data` is allowed to be `null` for empty responses; only
  // `undefined` indicates openapi-fetch couldn't parse one. If the
  // response was OK we still treat that as success — `void` callers
  // never inspect the return value.
  if (result.data === undefined && result.response.ok) {
    return undefined as T;
  }
  return result.data as T;
}

// -- Workbooks ------------------------------------------------------------

export async function updateWorkbook(
  database: string,
  workbookId: string,
  updates: { name?: string; sort_order?: number },
): Promise<WorkbookMeta> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/update",
      {
        params: { path: { database, workbook_id: workbookId } },
        body: updates,
      },
    ),
  );
  return data.workbook;
}

// -- Sheets ---------------------------------------------------------------

export async function listSheets(
  database: string,
  workbookId: string,
): Promise<SheetMeta[]> {
  const data = unwrap(
    await client.GET(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets",
      { params: { path: { database, workbook_id: workbookId } } },
    ),
  );
  return data.sheets;
}

export async function createSheet(
  database: string,
  workbookId: string,
  name: string,
  color?: string,
): Promise<{ sheet: SheetMeta; columns: ColumnData[] }> {
  return unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/create",
      {
        params: { path: { database, workbook_id: workbookId } },
        body: { name, color: color ?? "#8b774f" },
      },
    ),
  );
}

export async function getSheet(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<{ sheet: SheetMeta; columns: ColumnData[]; cells: CellData[] }> {
  return unwrap(
    await client.GET(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
      },
    ),
  );
}

// TODO: migrate to PATCH/DELETE when datasette-plugin-router supports them
export async function updateSheet(
  database: string,
  workbookId: string,
  sheetId: string,
  updates: { name?: string; color?: string; sort_order?: number },
): Promise<{ sheet: SheetMeta }> {
  return unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/update",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: updates,
      },
    ),
  );
}

export async function deleteSheet(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<void> {
  unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/delete",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
      },
    ),
  );
}

export async function reorderSheets(
  database: string,
  workbookId: string,
  sheetIds: string[],
): Promise<SheetMeta[]> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/reorder",
      {
        params: { path: { database, workbook_id: workbookId } },
        body: { sheet_ids: sheetIds },
      },
    ),
  );
  return data.sheets;
}

// -- Rows -----------------------------------------------------------------

export async function deleteRows(
  database: string,
  workbookId: string,
  sheetId: string,
  rowIndices: number[],
  clientId?: string,
): Promise<number[]> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/rows/delete",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { row_indices: rowIndices, client_id: clientId ?? null },
      },
    ),
  );
  return data.deleted;
}

export async function deleteColumns(
  database: string,
  workbookId: string,
  sheetId: string,
  colIndices: number[],
  clientId?: string,
): Promise<number[]> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/columns/delete",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { col_indices: colIndices, client_id: clientId ?? null },
      },
    ),
  );
  return data.deleted;
}

export async function insertColumns(
  database: string,
  workbookId: string,
  sheetId: string,
  at: number,
  count: number,
  clientId?: string,
): Promise<number[]> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/columns/insert",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { at, count, client_id: clientId ?? null },
      },
    ),
  );
  return data.inserted;
}

export interface MoveColumnsResult {
  src_start: number;
  src_end: number;
  final_start: number;
  width: number;
}

export interface MoveRowsResult {
  src_start: number;
  src_end: number;
  final_start: number;
  width: number;
}

// [sheet.column.drag-reorder]
export async function moveColumns(
  database: string,
  workbookId: string,
  sheetId: string,
  srcStart: number,
  srcEnd: number,
  destGap: number,
  clientId?: string,
): Promise<MoveColumnsResult | null> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/columns/move",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: {
          src_start: srcStart,
          src_end: srcEnd,
          dest_gap: destGap,
          client_id: clientId ?? null,
        },
      },
    ),
  );
  return data.moved ?? null;
}

// [sheet.row.drag-reorder]
export async function moveRows(
  database: string,
  workbookId: string,
  sheetId: string,
  srcStart: number,
  srcEnd: number,
  destGap: number,
  clientId?: string,
): Promise<MoveRowsResult | null> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/rows/move",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: {
          src_start: srcStart,
          src_end: srcEnd,
          dest_gap: destGap,
          client_id: clientId ?? null,
        },
      },
    ),
  );
  return data.moved ?? null;
}

// -- Cells / Columns ------------------------------------------------------

export async function saveCells(
  database: string,
  workbookId: string,
  sheetId: string,
  changes: CellChange[],
  clientId?: string,
): Promise<{ cells: CellData[] }> {
  return unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/cells",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { changes, client_id: clientId ?? null },
      },
    ),
  );
}

export async function saveColumns(
  database: string,
  workbookId: string,
  sheetId: string,
  columns: ColumnChange[],
): Promise<{ columns: ColumnData[] }> {
  return unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/columns",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { columns },
      },
    ),
  );
}

// -- Views ----------------------------------------------------------------

export async function listViews(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<SheetViewMeta[]> {
  const data = unwrap(
    await client.GET(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/views",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
      },
    ),
  );
  return data.views;
}

export async function createView(
  database: string,
  workbookId: string,
  sheetId: string,
  body: {
    view_name: string;
    range: string;
    use_headers: boolean;
    enable_insert?: boolean;
    enable_update?: boolean;
    enable_delete?: boolean;
    delete_mode?: "clear" | "shift";
  },
): Promise<SheetViewMeta> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/views/create",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body,
      },
    ),
  );
  return data.view;
}

// -- Named ranges ---------------------------------------------------------

export async function listNamedRanges(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<NamedRangeMeta[]> {
  const data = unwrap(
    await client.GET(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/names",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
      },
    ),
  );
  return data.named_ranges;
}

export async function setNamedRange(
  database: string,
  workbookId: string,
  sheetId: string,
  name: string,
  definition: string,
): Promise<NamedRangeMeta> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/names/set",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { name, definition },
      },
    ),
  );
  return data.named_range;
}

export async function deleteNamedRange(
  database: string,
  workbookId: string,
  sheetId: string,
  name: string,
): Promise<void> {
  unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/names/{name}/delete",
      {
        params: {
          path: {
            database,
            workbook_id: workbookId,
            sheet_id: sheetId,
            name,
          },
        },
      },
    ),
  );
}

// -- Dropdown rules -------------------------------------------------------

export async function listDropdownRules(
  database: string,
  workbookId: string,
): Promise<DropdownRuleRecord[]> {
  const data = unwrap(
    await client.GET(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/dropdown-rules",
      { params: { path: { database, workbook_id: workbookId } } },
    ),
  );
  return data.dropdown_rules;
}

export async function createDropdownRule(
  database: string,
  workbookId: string,
  draft: {
    name?: string;
    multi: boolean;
    options: DropdownOptionRecord[];
  },
): Promise<DropdownRuleRecord> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/dropdown-rules/create",
      {
        params: { path: { database, workbook_id: workbookId } },
        body: {
          name: draft.name ?? null,
          multi: draft.multi,
          options: draft.options,
        },
      },
    ),
  );
  return data.dropdown_rule;
}

export async function updateDropdownRule(
  database: string,
  workbookId: string,
  ruleId: string,
  patch: {
    name?: string | null;
    nameSet?: boolean;
    multi?: boolean;
    options?: DropdownOptionRecord[];
  },
): Promise<DropdownRuleRecord> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/dropdown-rules/{rule_id}/update",
      {
        params: {
          path: { database, workbook_id: workbookId, rule_id: ruleId },
        },
        body: {
          name_set: patch.nameSet ?? false,
          name: patch.name ?? null,
          multi: patch.multi ?? null,
          options: patch.options ?? null,
        },
      },
    ),
  );
  return data.dropdown_rule;
}

export async function deleteDropdownRule(
  database: string,
  workbookId: string,
  ruleId: string,
): Promise<void> {
  unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/dropdown-rules/{rule_id}/delete",
      {
        params: {
          path: { database, workbook_id: workbookId, rule_id: ruleId },
        },
      },
    ),
  );
}

// -- Filter ---------------------------------------------------------------

export async function getFilter(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<FilterMeta | null> {
  const data = unwrap(
    await client.GET(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/filter",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
      },
    ),
  );
  // ``unwrap`` may return ``undefined`` for empty bodies / mocked
  // test envs that don't reach the server. Treat that the same as
  // "no filter configured" — same gentle landing as ``getViews``.
  return data?.filter ?? null;
}

export async function createFilter(
  database: string,
  workbookId: string,
  sheetId: string,
  range: string,
  clientId?: string,
): Promise<FilterMeta> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/filter/create",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { range, client_id: clientId ?? null },
      },
    ),
  );
  return data.filter;
}

export async function setFilterSort(
  database: string,
  workbookId: string,
  sheetId: string,
  colIdx: number | null,
  direction: "asc" | "desc" | null,
  clientId?: string,
): Promise<FilterMeta> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/filter/update",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: {
          set_sort: true,
          sort_col_idx: colIdx,
          sort_direction: direction,
          client_id: clientId ?? null,
        },
      },
    ),
  );
  return data.filter;
}

export async function setFilterPredicate(
  database: string,
  workbookId: string,
  sheetId: string,
  colIdx: number,
  hidden: string[] | null,
  clientId?: string,
): Promise<FilterMeta> {
  const data = unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/filter/update",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: {
          set_predicate: true,
          predicate_col_idx: colIdx,
          predicate_hidden: hidden,
          client_id: clientId ?? null,
        },
      },
    ),
  );
  return data.filter;
}

export async function deleteFilter(
  database: string,
  workbookId: string,
  sheetId: string,
): Promise<void> {
  unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/filter/delete",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
      },
    ),
  );
}

export async function deleteView(
  database: string,
  workbookId: string,
  sheetId: string,
  viewId: string,
): Promise<void> {
  unwrap(
    await client.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/views/{view_id}/delete",
      {
        params: {
          path: {
            database,
            workbook_id: workbookId,
            sheet_id: sheetId,
            view_id: viewId,
          },
        },
      },
    ),
  );
}
