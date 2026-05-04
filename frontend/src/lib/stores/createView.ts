/**
 * Single-mount overlay store for the Create-View dialog.
 *
 * Two surfaces summon the dialog — the formula-bar's "Create
 * view" button and the filter chevron popover's "Create view…"
 * row. Both write to ``createViewDialog`` and SheetsPage hosts
 * the lone ``<CreateViewDialog>`` mount, driven by the store.
 *
 * ``range`` is the only payload the trigger needs to pass — the
 * dialog reads everything else (database / workbookId, active
 * sheet) from its existing props + stores.
 */
import { writable } from "svelte/store";

export type CreateViewDialogState = { range: string } | null;

export const createViewDialog = writable<CreateViewDialogState>(null);

export function openCreateViewDialog(range: string): void {
  createViewDialog.set({ range });
}

export function closeCreateViewDialog(): void {
  createViewDialog.set(null);
}
