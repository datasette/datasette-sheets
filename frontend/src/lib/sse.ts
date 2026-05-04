/**
 * SSE client for real-time sheet updates.
 * Connects to the events endpoint and dispatches events to callbacks.
 */

export interface CellUpdateEvent {
  changes: Array<{
    row_idx: number;
    col_idx: number;
    raw_value: string;
    format_json?: string | null;
    /** Echoed kind discriminator from the originating client. Lets
     *  remote receivers install the same typed override (force-text
     *  in v1) instead of letting their local engine auto-classify.
     *  [sheet.cell.force-text] */
    kind?: "raw" | "string";
  }>;
  actor: string | null;
}

export interface SheetMetaEvent {
  name: string;
  color: string;
}

export interface PresenceEvent {
  actor: string;
  display_name: string;
  profile_picture_url: string | null;
  cursor: { row: number; col: number } | null;
  selection: string[];
  color: string;
}

export interface RowsDeletedEvent {
  row_indices: number[]; // 0-based sheet row_idx values, sorted
  actor: string | null;
}

export interface ColumnsDeletedEvent {
  col_indices: number[]; // 0-based sheet col_idx values, sorted
  actor: string | null;
}

export interface ColumnsInsertedEvent {
  // Zero-based indices the new blank columns occupy *after* the
  // shift. For a ``count=N`` insert at ``k`` this is
  // ``[k, k+1, …, k+N-1]``.
  col_indices: number[];
  actor: string | null;
}

// [sheet.column.drag-reorder]
export interface ColumnsMovedEvent {
  src_start: number;
  src_end: number;
  // Post-move starting index of the moved block.
  final_start: number;
  width: number;
  actor: string | null;
}

// [sheet.row.drag-reorder]
export interface RowsMovedEvent {
  src_start: number;
  src_end: number;
  final_start: number;
  width: number;
  actor: string | null;
}

// [sheet.filter.create]
import type { FilterMeta } from "./api";

export interface FilterCreateEvent {
  filter: FilterMeta;
}
export interface FilterUpdateEvent {
  filter: FilterMeta;
}
export interface FilterDeleteEvent {
  sheet_id: number;
}

export interface SSECallbacks {
  onCellUpdate?: (event: CellUpdateEvent) => void;
  onSheetMeta?: (event: SheetMetaEvent) => void;
  onPresence?: (event: PresenceEvent) => void;
  onRowsDeleted?: (event: RowsDeletedEvent) => void;
  onColumnsDeleted?: (event: ColumnsDeletedEvent) => void;
  onColumnsInserted?: (event: ColumnsInsertedEvent) => void;
  onColumnsMoved?: (event: ColumnsMovedEvent) => void;
  onRowsMoved?: (event: RowsMovedEvent) => void;
  onFilterCreate?: (event: FilterCreateEvent) => void;
  onFilterUpdate?: (event: FilterUpdateEvent) => void;
  onFilterDelete?: (event: FilterDeleteEvent) => void;
  onConnected?: (clientId: string) => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
}

export class SheetSSEClient {
  private eventSource: EventSource | null = null;
  private database: string;
  private workbookId: number;
  private sheetId: number;
  private clientId: string;
  private callbacks: SSECallbacks;
  private _connected = false;
  private _hasOpenedOnce = false;

  constructor(
    database: string,
    workbookId: number,
    sheetId: number,
    clientId: string,
    callbacks: SSECallbacks,
  ) {
    this.database = database;
    this.workbookId = workbookId;
    this.sheetId = sheetId;
    this.clientId = clientId;
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    const url = `/${this.database}/-/sheets/api/workbooks/${this.workbookId}/sheets/${this.sheetId}/events?client_id=${this.clientId}`;
    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener("connected", (e: MessageEvent) => {
      this._connected = true;
      const data = JSON.parse(e.data);
      this.callbacks.onConnected?.(data.client_id);
    });

    this.eventSource.addEventListener("cell-update", (e: MessageEvent) => {
      const data: CellUpdateEvent = JSON.parse(e.data);
      this.callbacks.onCellUpdate?.(data);
    });

    this.eventSource.addEventListener("sheet-meta", (e: MessageEvent) => {
      const data: SheetMetaEvent = JSON.parse(e.data);
      this.callbacks.onSheetMeta?.(data);
    });

    this.eventSource.addEventListener("presence", (e: MessageEvent) => {
      const data: PresenceEvent = JSON.parse(e.data);
      this.callbacks.onPresence?.(data);
    });

    this.eventSource.addEventListener("rows-deleted", (e: MessageEvent) => {
      const data: RowsDeletedEvent = JSON.parse(e.data);
      this.callbacks.onRowsDeleted?.(data);
    });

    this.eventSource.addEventListener("columns-deleted", (e: MessageEvent) => {
      const data: ColumnsDeletedEvent = JSON.parse(e.data);
      this.callbacks.onColumnsDeleted?.(data);
    });

    this.eventSource.addEventListener("columns-inserted", (e: MessageEvent) => {
      const data: ColumnsInsertedEvent = JSON.parse(e.data);
      this.callbacks.onColumnsInserted?.(data);
    });

    // [sheet.column.drag-reorder]
    this.eventSource.addEventListener("columns-moved", (e: MessageEvent) => {
      const data: ColumnsMovedEvent = JSON.parse(e.data);
      this.callbacks.onColumnsMoved?.(data);
    });

    // [sheet.row.drag-reorder]
    this.eventSource.addEventListener("rows-moved", (e: MessageEvent) => {
      const data: RowsMovedEvent = JSON.parse(e.data);
      this.callbacks.onRowsMoved?.(data);
    });

    // [sheet.filter.create]
    this.eventSource.addEventListener("filter-create", (e: MessageEvent) => {
      const data: FilterCreateEvent = JSON.parse(e.data);
      this.callbacks.onFilterCreate?.(data);
    });
    this.eventSource.addEventListener("filter-update", (e: MessageEvent) => {
      const data: FilterUpdateEvent = JSON.parse(e.data);
      this.callbacks.onFilterUpdate?.(data);
    });
    this.eventSource.addEventListener("filter-delete", (e: MessageEvent) => {
      const data: FilterDeleteEvent = JSON.parse(e.data);
      this.callbacks.onFilterDelete?.(data);
    });

    // EventSource auto-reconnects on error
    this.eventSource.onerror = () => {
      if (this._connected) {
        this._connected = false;
        this.callbacks.onDisconnect?.();
      }
    };

    this.eventSource.onopen = () => {
      if (this._hasOpenedOnce) {
        this.callbacks.onReconnect?.();
      }
      this._hasOpenedOnce = true;
    };
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this._connected = false;
      this._hasOpenedOnce = false;
    }
  }

  get connected(): boolean {
    return this._connected;
  }
}

import { client as presenceClient } from "./client";

/**
 * Send presence (cursor position) to other clients.
 */
export async function sendPresence(
  database: string,
  workbookId: number,
  sheetId: number,
  clientId: string,
  cursor: { row: number; col: number } | null,
  selection: string[] = [],
): Promise<void> {
  try {
    await presenceClient.POST(
      "/{database}/-/sheets/api/workbooks/{workbook_id}/sheets/{sheet_id}/presence",
      {
        params: {
          path: { database, workbook_id: workbookId, sheet_id: sheetId },
        },
        body: { client_id: clientId, cursor, selection },
      },
    );
  } catch {
    // Presence is best-effort
  }
}
