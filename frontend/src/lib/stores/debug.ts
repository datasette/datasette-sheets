import { derived, get, writable } from "svelte/store";
import type { CellId } from "../spreadsheet/types";

/**
 * In-browser debug mode. Toggled from the sheet header. When on:
 *
 *  - A document-level keydown listener appends entries to
 *    ``debugLog`` (capped at ``MAX_LOG`` so the ring doesn't grow
 *    without bound).
 *  - ``writeSelectionToClipboard`` prepends a ``# copied from
 *    A2:B5 ...`` header to the plaintext payload so pasting into an
 *    agent conversation carries the range identity with it.
 *
 * Both pieces read ``get(debugMode)`` at call time, so toggling
 * during a session takes effect immediately.
 */
const STORAGE_KEY = "datasette-sheets.debug-mode";
const MAX_LOG = 200;

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// [sheet.debug.mode]
export const debugMode = writable<boolean>(readInitial());

debugMode.subscribe((v) => {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
});

/** A single keypress + store snapshot captured at ``keydown`` time. */
export interface DebugEvent {
  t: number; // ms since page load
  key: string; // e.g. "b", "ArrowDown"
  mods: string[]; // ["Shift", "Meta"]
  active: CellId | null;
  selectionSize: number;
  selectionRange: string | null; // "A1:B3" or null
  editingCell: CellId | null;
  clipboardMode: string | null;
  clipboardRange: string | null;
}

const _debugLog = writable<DebugEvent[]>([]);
export const debugLog = derived(_debugLog, ($l) => $l);
export const debugLogLength = derived(_debugLog, ($l) => $l.length);

export function pushDebugEvent(e: DebugEvent) {
  if (!get(debugMode)) return;
  _debugLog.update((log) => {
    const next = log.length >= MAX_LOG ? log.slice(1) : log.slice();
    next.push(e);
    return next;
  });
}

export function clearDebugLog() {
  _debugLog.set([]);
}

/**
 * Render the log as a fixed-width plaintext block, suitable for
 * pasting into a chat. Timestamps are relative to the first event
 * so they stay short even if the browser has been open for hours.
 */
export function formatDebugLog(): string {
  const log = get(_debugLog);
  if (log.length === 0) return "# datasette-sheets debug log (empty)";
  const start = log[0].t;
  const lines: string[] = [
    `# datasette-sheets debug log — ${log.length} event(s)`,
    "# t(ms)  key              cell  sel  range       edit  clip",
  ];
  for (const e of log) {
    const dt = `${(e.t - start).toString().padStart(6)}`;
    const mods = e.mods.length ? e.mods.join("+") + "+" : "";
    const key = `${mods}${e.key}`.padEnd(16);
    const cell = (e.active ?? "-").padEnd(5);
    const sel = e.selectionSize.toString().padStart(3);
    const range = (e.selectionRange ?? "-").padEnd(11);
    const edit = (e.editingCell ?? "-").padEnd(5);
    const clip = e.clipboardMode
      ? `${e.clipboardMode}:${e.clipboardRange ?? "-"}`
      : "-";
    lines.push(`${dt}  ${key} ${cell} ${sel}  ${range} ${edit} ${clip}`);
  }
  return lines.join("\n");
}
