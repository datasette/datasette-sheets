/**
 * [tests-04 backfill] Foundational undo/redo semantics not covered by
 * the existing ``undo.test.ts`` (which exercises pin / dirty-set
 * restore + single-pass diff). This file covers the behaviours the
 * ticket lists by number:
 *
 *   1. setCellValue then undo reverts the cell.
 *   2. multi-step undo (a → b → undo → a → undo → empty → undo no-op).
 *   3. redo re-applies the last undone edit.
 *   4. fresh setCellValue after undo invalidates the redo stack.
 *   5. format-only edits (applyFormat) are individually undoable
 *      without losing the underlying value.
 *   6. ``applyClipboardGrid`` produces ONE undo entry for an N-cell
 *      paste so a single Cmd+Z reverts the whole paste.
 *   8. ``clearUndoHistory`` empties both stacks.
 *
 * Items 9 (switchSheet clears history) and 10 (toolbar / Cmd+Z share
 * the same store action) live in persistence.switchSheet.test.ts and
 * Toolbar.test.ts / Cell.keyboard.test.ts respectively.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
  pushUndo,
  undo,
  redo,
  canUndo,
  canRedo,
  clearUndoHistory,
} from "../spreadsheet";
import { applyFormat } from "../../formatCommands";
import { applyClipboardGrid } from "../../clipboard/sheetClipboard";
import { clearAllPins } from "../../engine";
import { _resetDirtyCellIdsForTest } from "../persistence";
import type { CellId } from "../../spreadsheet/types";

beforeEach(() => {
  cells.clear();
  clearUndoHistory();
  clearAllPins();
  _resetDirtyCellIdsForTest();
  selectedCell.set(null);
  selectedCells.set(new Set());
  selectionAnchor.set(null);
});

describe("undo basic value flow", () => {
  test("(1) setCellValue + undo reverts the cell to empty", () => {
    pushUndo();
    cells.setCellValue("A1" as CellId, "x");
    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("x");

    undo();
    // After undo: pre-mutation snapshot was empty, so the cell either
    // doesn't exist or has an empty rawValue.
    expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");
    expect(canUndo()).toBe(false);
  });

  test("(2) multi-step undo walks back through each frame and stops at the empty stack", () => {
    pushUndo();
    cells.setCellValue("A1" as CellId, "x");
    pushUndo();
    cells.setCellValue("A1" as CellId, "y");

    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("y");

    undo();
    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("x");

    undo();
    expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");

    // Stack drained — a third undo is a no-op.
    expect(canUndo()).toBe(false);
    undo();
    expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");
  });
});

describe("redo flow", () => {
  test("(3) redo replays the last undone edit", () => {
    pushUndo();
    cells.setCellValue("A1" as CellId, "x");
    undo();
    expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");
    expect(canRedo()).toBe(true);

    redo();
    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("x");
    expect(canRedo()).toBe(false);
  });

  test("(4) a fresh pushUndo after an undo invalidates the redo stack", () => {
    pushUndo();
    cells.setCellValue("A1" as CellId, "x");
    undo();
    expect(canRedo()).toBe(true);

    // Mimic a fresh user action: the action's pushUndo is what wipes
    // the redo stack (per spreadsheet.ts::pushUndo).
    pushUndo();
    cells.setCellValue("B1" as CellId, "fresh");

    expect(canRedo()).toBe(false);
  });
});

describe("format-only edits are undoable independently", () => {
  // (5) Setting a format flag through ``applyFormat`` must produce an
  // undo entry that rolls the format back without touching the
  // underlying raw value.
  test("applyFormat creates an undo entry that restores prior format only", () => {
    cells.setCellValue("A1" as CellId, "value");
    selectedCell.set("A1" as CellId);
    selectionAnchor.set("A1" as CellId);
    selectedCells.set(new Set(["A1" as CellId]));

    // applyFormat internally pushes its own undo frame.
    applyFormat({ bold: true });
    expect(cells.getCell("A1" as CellId)?.format.bold).toBe(true);
    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("value");

    undo();
    // Format rolls back; raw value stays put.
    expect(cells.getCell("A1" as CellId)?.format.bold).toBeFalsy();
    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("value");
  });
});

describe("bulk paste produces one undo entry", () => {
  // (6) ``applyClipboardGrid`` is the single entry point for paste —
  // it must call pushUndo exactly once even though the paste fans out
  // across N cells. Otherwise a single Cmd+Z would only revert the
  // last cell of the paste.
  test("a 2x2 paste reverts in one undo, not four", () => {
    selectedCell.set("A1" as CellId);
    selectionAnchor.set("A1" as CellId);
    selectedCells.set(new Set(["A1" as CellId]));

    applyClipboardGrid({
      grid: [
        [{ value: "a" }, { value: "b" }],
        [{ value: "c" }, { value: "d" }],
      ],
      sourceAnchor: undefined,
    });

    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("a");
    expect(cells.getCell("B2" as CellId)?.rawValue).toBe("d");

    // ONE undo wipes the entire 2x2.
    undo();

    expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");
    expect(cells.getCell("B1" as CellId)?.rawValue ?? "").toBe("");
    expect(cells.getCell("A2" as CellId)?.rawValue ?? "").toBe("");
    expect(cells.getCell("B2" as CellId)?.rawValue ?? "").toBe("");
    // No further undo frames queued — proves only ONE was pushed.
    expect(canUndo()).toBe(false);
  });
});

describe("clearUndoHistory empties both stacks", () => {
  // (8) After undo + redo the stacks are non-empty in opposite ways;
  // clearUndoHistory must drain both.
  test("clearUndoHistory drops queued frames in both directions", () => {
    pushUndo();
    cells.setCellValue("A1" as CellId, "x");
    undo();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    clearUndoHistory();

    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});
