/**
 * Shared command helpers for cell formatting. These wrap the usual
 * pattern — push undo, mark each target dirty, merge the partial
 * format into every cell in the (expanded) selection — so the
 * toolbar, keyboard shortcuts, the Format menu, and the cell
 * context-menu submenu all dispatch the same way.
 */

import { get } from "svelte/store";
import {
  cells,
  selectedCell,
  selectedCells,
  pushUndo,
} from "./stores/spreadsheet";
import { markCellDirty } from "./stores/persistence";
import type { CellFormat, CellId } from "./spreadsheet/types";

/** Truthy-of-computed for a cell. A checkbox cell that's never been
 *  clicked has ``computedValue === null`` (treated as unchecked); a
 *  ``"TRUE"`` raw value rides through the engine as
 *  ``Boolean(true)``; numerics / non-empty strings count as checked
 *  too, matching Excel/GSheets when a checkbox format is laid over
 *  pre-existing data. [sheet.format.checkbox] */
export function isCheckboxChecked(
  cell: { computedValue: unknown } | undefined | null,
): boolean {
  return Boolean(cell?.computedValue);
}

/** Cells to apply a format command to: the full multi-selection if
 *  any, else the active cell. Returns an empty array when nothing is
 *  selected (caller becomes a no-op). */
function targets(): CellId[] {
  const sel = get(selectedCells);
  if (sel.size > 0) return [...sel];
  const active = get(selectedCell);
  return active ? [active] : [];
}

/**
 * Merge a partial CellFormat into every target cell. Optimised path
 * for the common "push once, apply many" pattern. Silently no-ops
 * when nothing is selected.
 */
export function applyFormat(partial: Partial<CellFormat>): void {
  const ts = targets();
  if (ts.length === 0) return;
  pushUndo();
  for (const id of ts) {
    markCellDirty(id);
    cells.setCellFormat(id, partial);
  }
}

/**
 * Active-cell-authoritative toggle of a boolean flag across the
 * selection. Reads the active cell's current value, negates it, then
 * writes the negation to every target.
 */
export function toggleFormatFlag(
  flag: "bold" | "italic" | "underline" | "strikethrough",
): void {
  const ts = targets();
  if (ts.length === 0) return;
  const active = get(selectedCell);
  const activeCell = active ? cells.getCell(active) : undefined;
  const newValue = !activeCell?.format[flag];
  pushUndo();
  for (const id of ts) {
    markCellDirty(id);
    cells.setCellFormat(id, { [flag]: newValue });
  }
}

/**
 * Reset every format field on the selection to its default — matches
 * Google Sheets' Cmd+\. Fields that don't have a "false" default
 * (type, decimals, currencySymbol) are re-set explicitly; boolean and
 * optional fields are cleared with `undefined` / `false`.
 *
 * Recalculates once so any type-driven display (currency, percentage)
 * reverts.
 */
/**
 * Flip every checkbox-formatted cell in the selection. Direction
 * follows the "majority" rule: if every checkbox cell in the
 * selection is currently checked, uncheck them all; otherwise check
 * them all. Targets a single focused cell when the selection is
 * empty. Cells without ``controlType === "checkbox"`` are skipped —
 * a Space-press on a mixed selection only flips the checkboxes.
 *  [sheet.format.checkbox]
 */
export function toggleCheckboxes(): void {
  const ts = targets();
  if (ts.length === 0) return;
  const checkboxes = ts.filter(
    (id) => cells.getCell(id)?.format.controlType === "checkbox",
  );
  if (checkboxes.length === 0) return;
  const allChecked = checkboxes.every((id) =>
    isCheckboxChecked(cells.getCell(id)),
  );
  const newRaw = allChecked ? "FALSE" : "TRUE";
  pushUndo();
  for (const id of checkboxes) {
    markCellDirty(id);
    cells.setCellValue(id, newRaw);
  }
}

/**
 * Two-step dropdown clear: empty the value first, then on a second
 * press of an already-empty dropdown, drop the dropdown format
 * itself. Per-cell — a mixed selection clears values on filled
 * cells and drops format on the rest in one keystroke. Targets a
 * single focused cell when the multi-selection is empty (matches
 * the rest of the format-command surface).
 *  [sheet.data.dropdown] [sheet.delete.delete-key-clears]
 */
export function clearDropdownStep(): void {
  const ts = targets();
  if (ts.length === 0) return;
  pushUndo();
  for (const id of ts) {
    const target = cells.getCell(id);
    const isDropdownCell = target?.format.controlType === "dropdown";
    const isAlreadyEmpty = isDropdownCell && (target?.rawValue ?? "") === "";
    markCellDirty(id);
    if (isAlreadyEmpty) {
      cells.setCellFormat(id, {
        controlType: undefined,
        dropdownRuleId: undefined,
      });
    } else {
      cells.setCellValue(id, "");
    }
  }
}

// [sheet.format.clear]
export function clearAllFormat(): void {
  const ts = targets();
  if (ts.length === 0) return;
  pushUndo();
  for (const id of ts) {
    markCellDirty(id);
    cells.setCellFormat(id, {
      type: "general",
      decimals: 2,
      currencySymbol: "$",
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      textColor: undefined,
      fillColor: undefined,
      hAlign: undefined,
      vAlign: undefined,
      wrap: undefined,
      fontSize: undefined,
      borders: undefined,
      controlType: undefined,
      dropdownRuleId: undefined,
    });
  }
  cells.recalculate();
}
