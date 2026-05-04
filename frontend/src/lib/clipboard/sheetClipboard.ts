/**
 * Document-level clipboard helpers for the sheets surface.
 *
 * Extracted from ``SheetsPage.svelte`` (page-toolbar-01) so the
 * clipboard pipeline can be unit-tested in isolation. Every helper is
 * a pure function over the store singletons + DOM globals — there's
 * no Svelte component context required.
 *
 * Two entry families:
 *   - ``handleCopy`` / ``handleCut`` / ``handlePaste`` are the
 *     ``ClipboardEvent``-driven document listeners. They short-circuit
 *     on the same focus / editing-cell guards the page used to
 *     enforce inline.
 *   - ``copyFromMenu`` / ``cutFromMenu`` / ``pasteFromMenu`` cover the
 *     right-click context menu paths, which can't piggy-back on a
 *     ``ClipboardEvent`` and must round-trip through
 *     ``navigator.clipboard``.
 *
 * Both families end up calling either ``buildClipboardPayload`` (write
 * side) or ``applyClipboardGrid`` (read side), so the html / plain
 * text serialization and the formula-shift / single-source-fill /
 * cut-clears-source rules live in exactly one place.
 */

import { get } from "svelte/store";
import { shiftFormulaRefs } from "../engine";
import {
  buildCopyPayload,
  parseClipboardData,
  type ClipboardCell,
  type CopyCell,
} from "../clipboard";
import { formatValue } from "../spreadsheet/formatter";
import {
  cells,
  COLUMNS,
  ROWS,
  selectedCell,
  selectedCells,
  editingCell,
  parseCellId,
  cellIdFromCoords,
  pushUndo,
  rangeNameFor,
} from "../stores/spreadsheet";
import {
  clipboardRange,
  clipboardMode,
  markCopyRange,
  markCutRange,
  clearClipboardMark,
} from "../stores/clipboard";
import { markCellDirty } from "../stores/persistence";
import { debugMode } from "../stores/debug";
import { dropdownRules } from "../stores/dropdownRules";
import type { CellId, CellFormat } from "../spreadsheet/types";

/**
 * Build the html + plain-text payload for the current selection,
 * or ``null`` if the selection is empty / the focus is somewhere
 * we shouldn't intercept. Shared between Cmd+C/X (which set it on
 * the ClipboardEvent) and the right-click menu (which writes via
 * navigator.clipboard.write).
 */
export function buildClipboardPayload(): {
  html: string;
  text: string;
} | null {
  if (get(editingCell) !== null) return null;
  const sel = get(selectedCells);
  if (sel.size === 0) return null;

  // Bounding box of the selection — in practice selections are always
  // rectangular (drag / Shift+arrow), but we iterate the full box and
  // fall back to empty strings for any holes.
  let minCol = Infinity,
    maxCol = -Infinity,
    minRow = Infinity,
    maxRow = -Infinity;
  for (const id of sel) {
    const { colIndex, row } = parseCellId(id);
    if (colIndex < minCol) minCol = colIndex;
    if (colIndex > maxCol) maxCol = colIndex;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }

  const cellMap = get(cells);
  const grid: CopyCell[][] = [];
  for (let r = minRow; r <= maxRow; r++) {
    const row: CopyCell[] = [];
    for (let c = minCol; c <= maxCol; c++) {
      const cell = cellMap.get(cellIdFromCoords(c, r));
      if (!cell) {
        row.push({ value: "" });
        continue;
      }
      const value = cell.error ?? formatValue(cell.computedValue, cell.format);
      // Carry rawValue when it's a formula. The plain-text and
      // visible-text payloads stay the computed value (clean for
      // external paste); the formula rides on the html as a
      // data-attr so an intra-app paste can shift refs.
      const isFormula = cell.rawValue?.startsWith("=") ?? false;
      row.push({
        value,
        bold: cell.format.bold || undefined,
        italic: cell.format.italic || undefined,
        underline: cell.format.underline || undefined,
        strikethrough: cell.format.strikethrough || undefined,
        textColor: cell.format.textColor,
        fillColor: cell.format.fillColor,
        hAlign: cell.format.hAlign,
        fontSize: cell.format.fontSize,
        numeric: typeof cell.computedValue === "number" || undefined,
        formula: isFormula ? cell.rawValue : undefined,
        controlType: cell.format.controlType,
        dropdownRuleId: cell.format.dropdownRuleId,
      });
    }
    grid.push(row);
  }

  const sourceAnchor = cellIdFromCoords(minCol, minRow);
  const { html, text } = buildCopyPayload(grid, sourceAnchor);
  // In debug mode, prefix the plaintext with a ``# from A1:B3 ...``
  // comment so pasting into a chat carries the range identity with
  // it. Leaves HTML alone (table renders cleanly in docs / email).
  const rangeName = rangeNameFor(get(selectedCells));
  const plain =
    get(debugMode) && rangeName
      ? `# datasette-sheets: from ${rangeName}\n${text}`
      : text;
  return { html, text: plain };
}

/**
 * Cmd+C/X path: build the payload, set it on the event, signal
 * "we handled it" so the browser doesn't fall back to copying the
 * native text selection. Returns true when something was written.
 */
export function writeSelectionToClipboard(e: ClipboardEvent): boolean {
  if (!e.clipboardData) return false;
  // Only intercept when the focus is somewhere inside our sheets app.
  const active = document.activeElement as HTMLElement | null;
  if (
    active &&
    active.tagName === "INPUT" &&
    active.closest(".sheets-root") === null
  ) {
    return false;
  }
  const payload = buildClipboardPayload();
  if (!payload) return false;
  e.clipboardData.setData("text/html", payload.html);
  e.clipboardData.setData("text/plain", payload.text);
  e.preventDefault();
  return true;
}

/**
 * Right-click menu path: write the same payload to the OS clipboard
 * via the async ``navigator.clipboard`` API. Used by the cell
 * context menu's Cut and Copy items, where there's no
 * ClipboardEvent to hook into.
 */
// [sheet.cell.copy-from-menu]
export async function writeSelectionViaClipboardApi(): Promise<boolean> {
  const payload = buildClipboardPayload();
  if (!payload) return false;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    // Fall back to plain text — some browsers reject ClipboardItem
    // for non-secure contexts or when the page lacks permission.
    try {
      await navigator.clipboard.writeText(payload.text);
      return true;
    } catch {
      return false;
    }
  }
}

/** Merge format attributes from a pasted cell into the target's
 *  format. Only sets flags / props that are truthy on the source —
 *  leaves the rest of the target's format alone, so paste
 *  additively applies styling rather than clobbering it.
 *
 *  Special case for ``controlType: "dropdown"``: the rule the source
 *  cell points at is workbook-scoped, so a paste from another
 *  workbook (or a deleted rule) would leave the cell with a
 *  ``controlType`` referencing nothing. Drop the controlType +
 *  dropdownRuleId in that case so the cell renders as plain text,
 *  rather than as a broken dropdown chip. */
export function applyPastedFormat(targetId: CellId, item: ClipboardCell): void {
  const partial: Partial<CellFormat> = {};
  if (item.bold) partial.bold = true;
  if (item.italic) partial.italic = true;
  if (item.underline) partial.underline = true;
  if (item.strikethrough) partial.strikethrough = true;
  if (item.textColor) partial.textColor = item.textColor;
  if (item.fillColor) partial.fillColor = item.fillColor;
  if (item.hAlign) partial.hAlign = item.hAlign;
  if (item.fontSize && Number.isFinite(item.fontSize))
    partial.fontSize = item.fontSize;
  if (item.controlType) {
    if (
      item.controlType === "dropdown" &&
      item.dropdownRuleId &&
      !get(dropdownRules).some((r) => r.id === item.dropdownRuleId)
    ) {
      // Unknown rule — skip controlType + ruleId entirely.
    } else {
      partial.controlType = item.controlType;
      if (item.dropdownRuleId) partial.dropdownRuleId = item.dropdownRuleId;
    }
  } else if (item.dropdownRuleId) {
    // No controlType but a stray ruleId — preserve as-is for forward
    // compatibility (matches pre-validation behaviour).
    partial.dropdownRuleId = item.dropdownRuleId;
  }
  if (Object.keys(partial).length > 0) {
    cells.setCellFormat(targetId, partial);
  }
}

/**
 * Apply a parsed clipboard payload at the current active cell.
 * Shared between the document-level paste handler (which gets its
 * payload from a ClipboardEvent) and the menu-triggered paste
 * (which reads via ``navigator.clipboard``).
 *
 * If the payload carries a `sourceAnchor` (intra-app copy), any
 * cell with a `formula` is rewritten via `shiftFormulaRefs` so its
 * relative refs point at the equivalent destination cells. Without
 * an anchor (paste from external apps), the parsed text value is
 * pasted as-is.
 *
 * When the payload is exactly 1×1 and the user has a multi-cell
 * selection, the source is filled across every selected cell,
 * with the formula re-shifted per-target.
 *
 * ``options.valuesOnly`` (Cmd/Ctrl+Shift+V) drops the formula
 * marker entirely — every cell pastes its visible text — and
 * skips both the source-anchor formula shift and the format
 * application. See [sheet.clipboard.paste-as-values].
 */
export function applyClipboardGrid(
  parsed: ReturnType<typeof parseClipboardData>,
  options: { valuesOnly?: boolean } = {},
): void {
  const anchor = get(selectedCell);
  const { grid, sourceAnchor } = parsed;
  if (!anchor || grid.length === 0) return;

  const valuesOnly = options.valuesOnly === true;

  pushUndo();

  const maxRow = ROWS[ROWS.length - 1];
  const maxCol = COLUMNS.length;

  const sel = get(selectedCells);
  const isSingleSourceFill =
    grid.length === 1 && grid[0].length === 1 && sel.size > 1;

  const pasted = new Set<CellId>();

  if (isSingleSourceFill) {
    // [sheet.clipboard.paste-fill-selection]
    const item = grid[0][0];
    const src = sourceAnchor ? parseCellId(sourceAnchor as CellId) : null;
    for (const targetId of sel) {
      const { colIndex: tCol, row: tRow } = parseCellId(targetId);
      const value =
        !valuesOnly && item.formula && src
          ? shiftFormulaRefs(
              item.formula,
              tRow - src.row,
              tCol - src.colIndex,
              maxRow,
              maxCol,
            )
          : item.value;
      markCellDirty(targetId);
      cells.setCellValue(targetId, value);
      // [sheet.clipboard.paste-as-values]
      if (!valuesOnly) applyPastedFormat(targetId, item);
      pasted.add(targetId);
    }
  } else {
    const { colIndex: startCol, row: startRow } = parseCellId(anchor);

    // Delta from the copy's top-left to this paste's top-left. Used
    // to rewrite relative refs in any pasted formula.
    let dRow = 0;
    let dCol = 0;
    if (!valuesOnly && sourceAnchor) {
      const src = parseCellId(sourceAnchor as CellId);
      dRow = startRow - src.row;
      dCol = startCol - src.colIndex;
    }

    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const targetId = cellIdFromCoords(startCol + c, startRow + r);
        const item = grid[r][c];
        markCellDirty(targetId);
        // [sheet.clipboard.paste-formula-shift]
        const value =
          !valuesOnly && item.formula && sourceAnchor
            ? shiftFormulaRefs(item.formula, dRow, dCol, maxRow, maxCol)
            : item.value;
        cells.setCellValue(targetId, value);
        // Carry the full pasted format (bold, dropdown, etc.).
        // Was bold-only historically; matches the single-source-
        // fill branch above. [sheet.data.dropdown]
        // [sheet.clipboard.paste-as-values]
        if (!valuesOnly) applyPastedFormat(targetId, item);
        pasted.add(targetId);
      }
    }
  }

  // If the clipboard marker is a cut, this paste consumes it:
  // clear the source cells that the paste didn't just overwrite
  // (self-overlap — cells in both source and target keep their new
  // value), then drop the marker. Copy leaves everything alone —
  // the source stays, the marker stays so the user can paste again.
  if (get(clipboardMode) === "cut") {
    for (const id of get(clipboardRange)) {
      if (pasted.has(id)) continue;
      markCellDirty(id);
      cells.setCellValue(id, "");
    }
    clearClipboardMark();
  }
}

// Cmd+C / Ctrl+C on the selected range: write the range to the
// clipboard as both text/html (table) and text/plain (TSV), and
// paint the dashed clipboard border. Google-Sheets-style: the
// border stays after a paste so the user can paste again; Esc /
// a fresh copy-or-cut / a sheet switch drops it.
// [sheet.clipboard.copy]
export function handleCopy(e: ClipboardEvent): void {
  if (!writeSelectionToClipboard(e)) return;
  markCopyRange(get(selectedCells));
}

// Cmd+X / Ctrl+X: like copy, but flips the clipboard marker into
// "cut" mode so the next paste removes the source cells. Same
// dashed-border visual as copy; only the paste behaviour differs.
// [sheet.clipboard.cut]
export function handleCut(e: ClipboardEvent): void {
  if (!writeSelectionToClipboard(e)) return;
  markCutRange(get(selectedCells));
}

// Cmd+V / Ctrl+V: apply clipboard data at the active cell. Handled at
// the document level so it works regardless of whether the currently-
// focused element is a cell div, the grid container, or anything else
// inside the sheets page. Skipped when an input is focused so native
// text-paste into edit/rename inputs still works.
// [sheet.clipboard.paste]
export function handlePaste(e: ClipboardEvent): void {
  if (!e.clipboardData) return;
  if (get(editingCell) !== null) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    return;
  }
  if (!get(selectedCell)) return;

  const parsed = parseClipboardData(e.clipboardData);
  if (parsed.grid.length === 0) return;

  e.preventDefault();
  applyClipboardGrid(parsed);
}

// Cmd/Ctrl+Shift+V: paste the displayed values only — drop any
// formula markers and ignore both the intra-app source anchor and
// any formatting attributes carried on the html. Browsers don't
// fire a `paste` event for this combo outside of contenteditable
// surfaces, so we explicitly read the OS clipboard and route
// through `applyClipboardGrid` with `valuesOnly`. Same focus /
// editing-cell guards as `handlePaste`.
// [sheet.clipboard.paste-as-values]
export async function pasteValuesShortcut(): Promise<void> {
  if (get(editingCell) !== null) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    return;
  }
  if (!get(selectedCell)) return;

  const dt = new DataTransfer();
  let gotData = false;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type === "text/html" || type === "text/plain") {
          const blob = await item.getType(type);
          dt.setData(type, await blob.text());
          gotData = true;
        }
      }
    }
  } catch {
    try {
      const text = await navigator.clipboard.readText();
      dt.setData("text/plain", text);
      gotData = true;
    } catch {
      return;
    }
  }
  if (!gotData) return;
  const parsed = parseClipboardData(dt);
  if (parsed.grid.length === 0) return;
  applyClipboardGrid(parsed, { valuesOnly: true });
}

// [sheet.cell.copy-from-menu]
export async function copyFromMenu(): Promise<void> {
  const ok = await writeSelectionViaClipboardApi();
  if (ok) markCopyRange(get(selectedCells));
}

// [sheet.cell.cut-from-menu]
export async function cutFromMenu(): Promise<void> {
  const ok = await writeSelectionViaClipboardApi();
  if (ok) markCutRange(get(selectedCells));
}

/**
 * Right-click "Paste" menu path: read from the OS clipboard via
 * ``navigator.clipboard.read`` (rich; needs a permission grant in
 * some browsers) and fall back to ``readText`` for plain text.
 * Synthesize a DataTransfer so ``parseClipboardData`` doesn't need
 * to know about the alternate code path.
 */
// [sheet.cell.paste-from-menu]
export async function pasteFromMenu(): Promise<void> {
  if (get(editingCell) !== null) return;
  if (!get(selectedCell)) return;
  const dt = new DataTransfer();
  let gotData = false;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type === "text/html" || type === "text/plain") {
          const blob = await item.getType(type);
          dt.setData(type, await blob.text());
          gotData = true;
        }
      }
    }
  } catch {
    // Permission denied or unsupported — fall back to plain text.
    try {
      const text = await navigator.clipboard.readText();
      dt.setData("text/plain", text);
      gotData = true;
    } catch {
      return;
    }
  }
  if (!gotData) return;
  const parsed = parseClipboardData(dt);
  if (parsed.grid.length === 0) return;
  applyClipboardGrid(parsed);
}
