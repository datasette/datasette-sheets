import { beforeEach, describe, expect, test } from "vitest";
import {
  cells,
  cellStore,
  pushUndo,
  undo,
  clearUndoHistory,
} from "../spreadsheet";
import { pinValue, pinnedCells, clearAllPins } from "../../engine";
import {
  markCellDirty,
  _getDirtyCellIdsForTest,
  _resetDirtyCellIdsForTest,
} from "../persistence";
import type { CellId } from "../../spreadsheet/types";

beforeEach(() => {
  cells.clear();
  clearUndoHistory();
  clearAllPins();
  _resetDirtyCellIdsForTest();
});

describe("undo restore — pins", () => {
  test("undoing a pin clears it from the engine overlay", () => {
    // Baseline: nothing pinned.
    expect(pinnedCells()).toEqual([]);

    // Snapshot the clean state.
    pushUndo();

    // Mutate: install a host-injected pin (this is what the
    // ``=SQL(...)`` path does after a fetch resolves) and edit a
    // cell so the cell map also drifts from the snapshot.
    pinValue("D1", [["pinned"]]);
    cells.setCellValue("A1" as CellId, "after");

    expect(pinnedCells()).toContain("D1");

    // Undo should roll the pin overlay back to the empty snapshot
    // alongside the cell map.
    undo();

    expect(pinnedCells()).toEqual([]);
    // And of course the cell value is back to its pre-mutation state.
    expect(cells.getCell("A1" as CellId)?.rawValue ?? "").toBe("");
  });
});

describe("undo restore — dirty cell set", () => {
  test("dirty markers are restored to the snapshot's set", () => {
    // T0: A1 already dirty (e.g. user typed once and the debounced
    // save hasn't fired yet).
    cells.setCellValue("A1" as CellId, "first");
    markCellDirty("A1" as CellId);

    pushUndo();

    // T1: user types again into A1 — still dirty.
    cells.setCellValue("A1" as CellId, "second");
    markCellDirty("A1" as CellId);

    expect(_getDirtyCellIdsForTest().has("A1" as CellId)).toBe(true);

    undo();

    // After undo: the cell value is "first" and the dirty set
    // matches what it was when ``pushUndo`` snapshotted it.
    expect(cells.getCell("A1" as CellId)?.rawValue).toBe("first");
    const dirty = _getDirtyCellIdsForTest();
    expect(dirty.has("A1" as CellId)).toBe(true);
    expect(dirty.size).toBe(1);
  });

  test("undo of a fresh insertion drops the cell from the dirty set", () => {
    // T0: nothing dirty.
    pushUndo();

    // T1: user creates a brand-new cell.
    cells.setCellValue("B2" as CellId, "new");
    markCellDirty("B2" as CellId);
    expect(_getDirtyCellIdsForTest().has("B2" as CellId)).toBe(true);

    undo();

    // After undo: dirty set is back to empty (matches the T0
    // snapshot), so the next flush won't send a stale empty-string
    // upsert under the B2 key.
    expect(_getDirtyCellIdsForTest().size).toBe(0);
  });
});

describe("undo restore — single-pass diff", () => {
  test("restoreFrame fires per-cell subscribers once, not twice", () => {
    cells.setCellValue("A1" as CellId, "first");

    pushUndo();
    cells.setCellValue("A1" as CellId, "second");

    // Subscribe AFTER the mutation but BEFORE the undo, so the
    // initial subscribe-fire (which happens synchronously) doesn't
    // count toward our undo-driven notification count.
    let count = 0;
    const unsub = cellStore("A1" as CellId).subscribe(() => {
      count++;
    });
    // Discard the synchronous subscribe-fire.
    count = 0;

    undo();

    // Old code did ``cells.set(map)`` AND ``cells.recalculate()``,
    // each running ``diffAndNotify`` — two notifications per cell.
    // The combined ``replaceAndRecalculate`` collapses to one.
    expect(count).toBe(1);

    unsub();
  });
});
