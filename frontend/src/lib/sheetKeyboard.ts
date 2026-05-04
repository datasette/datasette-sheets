/**
 * Document-level keyboard shortcuts for the sheets surface.
 *
 * Extracted from ``SheetsPage.svelte`` (page-toolbar-01) so the
 * shortcut wiring is independently testable. ``installDocumentShortcuts``
 * registers a single ``keydown`` listener on ``document`` and returns
 * a teardown that removes it. The listener handles three concerns:
 *
 *   1. Debug-event capture — when ``debugMode`` is on, every
 *      non-modifier-only keystroke pushes a snapshot into the debug
 *      log (active cell, selection range, clipboard state, …). Runs
 *      *before* any side-effecting branch below so the log captures
 *      state at the moment of the press, not after handlers consume
 *      the event.
 *
 *   2. ``Cmd/Ctrl+Shift+V`` triggers "paste values only" — reads
 *      the OS clipboard explicitly and applies it via
 *      ``pasteValuesShortcut`` (formulas + format are stripped).
 *      Browsers don't fire a ``paste`` event for this combo on a
 *      non-contenteditable focus, so the document keydown is the
 *      only way to catch it.
 *
 *   3. ``Cmd/Ctrl+Shift+[`` and ``Cmd/Ctrl+Shift+]`` cycle the active
 *      sheet tab. Layout-independent: ``e.code`` is read first, with
 *      ``e.key`` ("[" / "]" / "{" / "}") as a fallback for browsers
 *      that report the shifted glyph. Skipped while a cell is being
 *      edited or while focus sits in another input/textarea.
 *
 *   4. ``Esc`` cancels the clipboard mark and dismisses any open
 *      overlay. Skipped while a cell is being edited (Esc inside a
 *      cell aborts the edit; that's owned by ``Cell.svelte``).
 *
 * Tagged sites: ``[sheet.tabs.keyboard-switch]``,
 * ``[sheet.clipboard.escape-cancels-mark]``,
 * ``[sheet.clipboard.paste-as-values]``.
 */

import { get } from "svelte/store";
import {
  selectedCell,
  selectedCells,
  editingCell,
  rangeNameFor,
} from "./stores/spreadsheet";
import {
  clipboardRange,
  clipboardMode,
  clearClipboardMark,
} from "./stores/clipboard";
import { debugMode, pushDebugEvent, type DebugEvent } from "./stores/debug";
import { activeSheetId, sheets, switchSheet } from "./stores/persistence";
import { openOverlay, closeAnyOverlay } from "./stores/openOverlay";
import { pasteValuesShortcut } from "./clipboard/sheetClipboard";

function snapshotForDebug(e: KeyboardEvent): DebugEvent | null {
  const mods: string[] = [];
  if (e.shiftKey) mods.push("Shift");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.metaKey) mods.push("Meta");
  if (e.altKey) mods.push("Alt");
  // Don't log modifier-only taps (Shift, Meta, …) — noisy.
  if (
    e.key.length === 0 ||
    e.key === "Shift" ||
    e.key === "Meta" ||
    e.key === "Control" ||
    e.key === "Alt"
  ) {
    return null;
  }
  return {
    t: Date.now(),
    key: e.key,
    mods,
    active: get(selectedCell),
    selectionSize: get(selectedCells).size,
    selectionRange: rangeNameFor(get(selectedCells)),
    editingCell: get(editingCell),
    clipboardMode: get(clipboardMode),
    clipboardRange: rangeNameFor(get(clipboardRange)),
  };
}

function isInputFocused(): boolean {
  const focused = document.activeElement as HTMLElement | null;
  return (
    !!focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")
  );
}

/**
 * Document-level keydown: Esc cancels a pending copy/cut, and the
 * debug logger (if enabled) snapshots the event + stores for later
 * inspection. Keeping both in one listener so the ordering is
 * deterministic: the log entry captures state *before* Esc clears
 * the mark, so you can see the transition.
 * [sheet.clipboard.escape-cancels-mark]
 */
export function handleDocumentKeydown(e: KeyboardEvent): void {
  if (get(debugMode)) {
    const snap = snapshotForDebug(e);
    if (snap) pushDebugEvent(snap);
  }

  // Cmd/Ctrl+Shift+V — "paste values only". Browsers don't fire a
  // ``paste`` event for this combo on a non-contenteditable focus,
  // so we read the clipboard ourselves and route through
  // ``pasteValuesShortcut``. Skip while editing or while focus is
  // in another input — same guards as the regular paste handler.
  // [sheet.clipboard.paste-as-values]
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    const isV = e.code === "KeyV" || e.key === "v" || e.key === "V";
    if (isV) {
      if (get(editingCell) !== null) return;
      if (isInputFocused()) return;
      e.preventDefault();
      void pasteValuesShortcut();
      return;
    }
  }

  // Cmd/Ctrl+Shift+[ / ] cycles to the previous / next sheet
  // tab. ``e.code`` is layout-independent; the ``e.key`` fallbacks
  // cover browsers that report the shifted glyph. Skip while
  // editing (switchSheet would drop the uncommitted edit) or while
  // focus is in another input/textarea (rename tab, formula bar).
  // [sheet.tabs.keyboard-switch]
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    const isPrev = e.code === "BracketLeft" || e.key === "[" || e.key === "{";
    const isNext = e.code === "BracketRight" || e.key === "]" || e.key === "}";
    if (isPrev || isNext) {
      if (get(editingCell) !== null) return;
      if (isInputFocused()) return;
      const allSheets = get(sheets);
      if (allSheets.length < 2) return;
      const currentIdx = allSheets.findIndex(
        (s) => s.id === get(activeSheetId),
      );
      if (currentIdx < 0) return;
      const delta = isPrev ? -1 : 1;
      const nextIdx =
        (currentIdx + delta + allSheets.length) % allSheets.length;
      e.preventDefault();
      void switchSheet(allSheets[nextIdx].id);
      return;
    }
  }

  if (e.key !== "Escape") return;
  if (get(editingCell) !== null) return;

  // [page-toolbar-04] Esc dismisses the currently-open popover, if
  // any. Falls through to the clipboard-mark clear below — policy
  // is "one Esc cancels every transient piece of state at once",
  // matching how Toolbar's Esc behaved before this refactor.
  // FormatMenu used to ``e.stopPropagation()`` on Esc, swallowing
  // the clipboard clear; we deliberately drop that, so the
  // behaviour is the same regardless of which popover is open.
  if (get(openOverlay) !== null) {
    closeAnyOverlay();
  }

  if (get(clipboardRange).size === 0) return;
  if (isInputFocused()) return;
  clearClipboardMark();
}

/**
 * Install the document-level shortcut handler. Returns a teardown
 * that removes the listener — call from ``onDestroy``.
 */
export function installDocumentShortcuts(): () => void {
  document.addEventListener("keydown", handleDocumentKeydown);
  return () => {
    document.removeEventListener("keydown", handleDocumentKeydown);
  };
}
