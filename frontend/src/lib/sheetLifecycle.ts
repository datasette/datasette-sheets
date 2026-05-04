/**
 * SSE + presence lifecycle for the sheets surface.
 *
 * Extracted from ``SheetsPage.svelte`` (page-toolbar-01) so the four
 * lifetimes that used to tangle together in ``onMount`` /
 * ``onDestroy`` — SSE socket, presence broadcast debounce, presence
 * stale-cleanup interval, and the ``$activeSheetId`` reactive
 * reconnect — own a single teardown.
 *
 * Public surface:
 *
 *   - ``installSheetLifecycle({ database, workbookId, clientId,
 *     onConnectedChange })`` — install the SSE+presence pipeline.
 *     Subscribes to ``activeSheetId`` and reconnects on change.
 *     Returns a teardown that closes the socket, clears the
 *     debounce timer, stops the cleanup interval, and unsubscribes.
 *
 * The function is callable from a Svelte component's ``onMount``;
 * we intentionally don't ship a ``use:sheetLifecycle`` action
 * variant because the page already has a top-level mount hook and
 * we'd just be wrapping the same call in a different sugar.
 */

import { get } from "svelte/store";
import type { CellId, CellFormat } from "./spreadsheet/types";
import { SheetSSEClient, sendPresence } from "./sse";
import {
  COLUMNS,
  cells,
  selectedCell,
  selectedCells,
} from "./stores/spreadsheet";
import { activeSheetId, suppressAutoSave } from "./stores/persistence";
import {
  updatePresence,
  cleanStalePresences,
  clearAllPresences,
} from "./stores/presence";
import {
  handleFilterCreated,
  handleFilterUpdated,
  handleFilterDeleted,
} from "./stores/filter";
import { createDefaultFormat } from "./spreadsheet/formatter";
import { parseCellIdRaw } from "./engine";

/** Frequency at which we sweep stale presence rows (ms). */
const PRESENCE_CLEANUP_INTERVAL_MS = 5000;
/** Inactivity threshold: presence rows older than this get dropped. */
const PRESENCE_STALE_AFTER_MS = 10_000;
/** Debounce window for presence broadcasts (ms). */
const PRESENCE_DEBOUNCE_MS = 200;

export interface SheetLifecycleOptions {
  database: string;
  workbookId: string;
  clientId: string;
  /** Notified when SSE connection state flips, so the page header
   *  can render the connection dot. */
  onConnectedChange?: (connected: boolean) => void;
}

/**
 * Wire SSE + presence + cleanup interval. Returns a single teardown
 * that unwinds every piece. Idempotent: calling the teardown twice
 * is a no-op. ``activeSheetId`` is observed via ``subscribe`` rather
 * than a Svelte ``$:`` reactive so the wiring is testable outside a
 * component context.
 */
export function installSheetLifecycle(opts: SheetLifecycleOptions): () => void {
  const { database, workbookId, clientId, onConnectedChange } = opts;

  let sseClient: SheetSSEClient | null = null;
  let presenceTimer: ReturnType<typeof setTimeout> | null = null;

  function connectSSE(sheetId: string) {
    // Disconnect old SSE
    if (sseClient) {
      sseClient.disconnect();
      clearAllPresences();
    }

    sseClient = new SheetSSEClient(database, workbookId, sheetId, clientId, {
      onConnected() {
        onConnectedChange?.(true);
      },
      onDisconnect() {
        onConnectedChange?.(false);
      },
      onReconnect() {
        onConnectedChange?.(true);
      },
      onCellUpdate(event) {
        // Apply remote cell changes — batch + suppress auto-save to avoid echoing back
        suppressAutoSave(() => {
          const batch: (
            | [CellId, string]
            | [CellId, string, "raw" | "string"]
          )[] = [];
          const formatUpdates: [CellId, unknown][] = [];
          const formatResets: CellId[] = [];
          for (const change of event.changes) {
            const col = COLUMNS[change.col_idx];
            if (!col) continue;
            const cellId = `${col}${change.row_idx + 1}` as CellId;
            // [sheet.cell.force-text] Echoed kind from the
            // originating client lets us install the typed override
            // locally, matching what the server stored.
            if (change.kind === "string") {
              batch.push([cellId, change.raw_value, "string"]);
            } else {
              batch.push([cellId, change.raw_value]);
            }
            if (change.format_json) {
              try {
                formatUpdates.push([
                  cellId,
                  {
                    ...createDefaultFormat(),
                    ...JSON.parse(change.format_json),
                  },
                ]);
              } catch {
                // malformed JSON from a remote client — skip the format,
                // keep the raw cell value we already applied above.
              }
            } else {
              // Explicit null/missing format_json from the server
              // means the remote client cleared formatting. Reset our
              // local cell to default so e.g. an unbold actually
              // propagates — a plain setCellFormat would merge and
              // leave the stale bold flag in place.
              formatResets.push(cellId);
            }
          }
          if (batch.length > 0) {
            cells.setCellValueBatch(batch); // single recalculate for all changes
          }
          for (const [cellId, format] of formatUpdates) {
            cells.setCellFormat(cellId, format as Partial<CellFormat>);
          }
          for (const cellId of formatResets) {
            cells.resetCellFormat(cellId);
          }
        });
      },
      onPresence(event) {
        updatePresence(
          event.actor,
          event.display_name || event.actor,
          event.profile_picture_url || null,
          event.cursor,
          event.selection,
          event.color,
        );
      },
      onSheetMeta(_event) {
        // Sheet meta changes are handled by the persistence store's API responses
      },
      onRowsDeleted(event) {
        // Apply the same shift a remote originator just ran on the server
        // so this client's grid stays in sync without a full reload.
        suppressAutoSave(() => {
          cells.deleteRowsLocally(event.row_indices);
        });
      },
      onColumnsDeleted(event) {
        suppressAutoSave(() => {
          cells.deleteColsLocally(event.col_indices);
        });
      },
      onColumnsInserted(event) {
        // ``col_indices`` is the full expanded list ([at, at+1, …,
        // at+count-1]); recover ``at`` + ``count`` from its extent.
        // Non-contiguous inserts aren't a thing on the wire today —
        // the server only emits contiguous blocks — so a min/length
        // read is enough.
        if (event.col_indices.length === 0) return;
        const at = Math.min(...event.col_indices);
        const count = event.col_indices.length;
        suppressAutoSave(() => {
          cells.insertColsLocally(at, count);
        });
      },
      // [sheet.column.drag-reorder]
      onColumnsMoved(event) {
        suppressAutoSave(() => {
          cells.moveColsLocally(
            event.src_start,
            event.src_end,
            event.final_start,
          );
        });
      },
      // [sheet.row.drag-reorder]
      onRowsMoved(event) {
        suppressAutoSave(() => {
          cells.moveRowsLocally(
            event.src_start,
            event.src_end,
            event.final_start,
          );
        });
      },
      // [sheet.filter.create]
      onFilterCreate(event) {
        handleFilterCreated(event.filter);
      },
      onFilterUpdate(event) {
        handleFilterUpdated(event.filter);
      },
      onFilterDelete() {
        handleFilterDeleted();
      },
    });
    sseClient.connect();
    // Filter load happens in persistence.ts alongside loadNamedRanges
    // / loadViews — see ``transitionToSheet`` / ``loadSheetCells``.
  }

  // Reconnect SSE when active sheet changes. ``subscribe`` fires
  // synchronously with the current value at registration; we skip
  // that initial null/empty firing and only act on real ids.
  const unsubscribeActive = activeSheetId.subscribe((id) => {
    if (!id) return;
    connectSSE(id);
  });

  // Send our cursor + selection when it changes
  // [sheet.presence.broadcast-debounce]
  function broadcastSelection(cellId: CellId | null, sel: Set<CellId>): void {
    if (!cellId) return;
    const sheetId = get(activeSheetId);
    if (!sheetId) return;
    if (presenceTimer) clearTimeout(presenceTimer);
    presenceTimer = setTimeout(() => {
      const parsed = parseCellIdRaw(cellId);
      if (!parsed) return;
      const selection = [...sel];
      sendPresence(
        database,
        workbookId,
        sheetId,
        clientId,
        { row: parsed.row, col: parsed.col },
        selection,
      );
    }, PRESENCE_DEBOUNCE_MS);
  }

  // Watch both selection stores. ``derived`` would re-fire when
  // either changes; we just subscribe to both and read the other
  // imperatively — same effect, no extra store allocation. Both
  // subscriptions fire synchronously on registration, so the first
  // call sees ``null`` selectedCell and is a no-op.
  const unsubscribeCell = selectedCell.subscribe((id) => {
    broadcastSelection(id, get(selectedCells));
  });
  const unsubscribeCells = selectedCells.subscribe((sel) => {
    broadcastSelection(get(selectedCell), sel);
  });

  // Clean up stale presences every 5s
  const presenceCleanupInterval = setInterval(
    () => cleanStalePresences(PRESENCE_STALE_AFTER_MS),
    PRESENCE_CLEANUP_INTERVAL_MS,
  );

  let torn = false;
  return () => {
    if (torn) return;
    torn = true;
    sseClient?.disconnect();
    sseClient = null;
    if (presenceTimer) {
      clearTimeout(presenceTimer);
      presenceTimer = null;
    }
    clearInterval(presenceCleanupInterval);
    unsubscribeActive();
    unsubscribeCell();
    unsubscribeCells();
  };
}
