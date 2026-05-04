import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import {
  cells,
  cellStore,
  isActiveCellSignal,
  isHighlightedCellSignal,
  selectedCell,
  selectedCells,
} from "../spreadsheet";
import type { CellId } from "../../spreadsheet/types";

beforeEach(() => {
  cells.clear();
  cells._resetPerCellListeners();
  selectedCell.set(null);
  selectedCells.set(new Set());
});

// Locks down the contract that ``getCell`` returns the *current*
// writable value, not the diff baseline. Already passes today
// (every ``setCellValue`` calls ``update``, which hands the new map
// to the writable before returning) — the test exists so a future
// "lazy notify" change can't silently regress the synchronous read.
test("getCell sees the most recent setCellValue, not the diff baseline", () => {
  cells.setCellValue("A1" as CellId, "first");
  cells.setCellValue("A1" as CellId, "second");
  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("second");
});

// Regression guard for the original [STORES-10] symptom: a caller
// that mutates and then reads back inside the same tick (e.g.
// ``navigate`` after a multi-cell paste, or ``hasCheckboxInSelection``
// from an event handler) must see post-mutation state. Reading the
// diff baseline used to lag by one notification round.
test("getCell is current immediately after setCellValue returns", () => {
  cells.setCellValue("A1" as CellId, "first");
  cells.setCellValue("A1" as CellId, "second");
  cells.setCellValue("A1" as CellId, "third");

  expect(cells.getCell("A1" as CellId)?.rawValue).toBe("third");
});

// ─── cellStore(id) per-cell signal ────────────────────────────────
//
// [STORES-09] These exercise the load-bearing perf primitive: a
// component subscribed via ``cellStore("A1")`` should only fire when
// A1's data ref changes. The backing immutable-merge contract is
// already covered by ``cells/__tests__/mutations.test.ts``; here we
// drive the *subscriber* side to lock down the signal surface.

test("cellStore(A1) does not fire when an unrelated cell mutates", () => {
  cells.setCellValue("A1" as CellId, "anchor");

  // Subscribe AFTER the seeding so we count only follow-up fires;
  // discard the synchronous on-subscribe fire.
  let count = 0;
  const unsub = cellStore("A1" as CellId).subscribe(() => {
    count++;
  });
  count = 0;

  // Mutate an unrelated cell with no formula link to A1.
  cells.setCellValue("A2" as CellId, "elsewhere");

  unsub();
  // ``diffAndNotify`` should walk both ids and find A1's ref unchanged.
  expect(count).toBe(0);
});

test("cellStore(A1) fires once when A1's format changes", () => {
  cells.setCellValue("A1" as CellId, "1");

  let count = 0;
  let lastValueBold: boolean | undefined;
  const unsub = cellStore("A1" as CellId).subscribe((v) => {
    count++;
    lastValueBold = v?.format.bold;
  });
  count = 0;

  cells.setCellFormat("A1" as CellId, { bold: true });

  unsub();
  expect(count).toBe(1);
  expect(lastValueBold).toBe(true);
});

test("cellStore(A1) does not fire when a recalc produces no actual change", () => {
  cells.setCellValue("A1" as CellId, "10");
  cells.setCellValue("B1" as CellId, "=A1+1");

  let aFires = 0;
  let bFires = 0;
  const unsubA = cellStore("A1" as CellId).subscribe(() => {
    aFires++;
  });
  const unsubB = cellStore("B1" as CellId).subscribe(() => {
    bFires++;
  });
  aFires = 0;
  bFires = 0;

  // Force a full recalc — but neither cell's data should change, so
  // the immutable-merge contract should hand back the same refs and
  // ``diffAndNotify`` should fire *neither* listener.
  cells.recalculate();

  unsubA();
  unsubB();
  expect(aFires).toBe(0);
  expect(bFires).toBe(0);
});

// ─── isActiveCellSignal ──────────────────────────────────────────

test("isActiveCellSignal fires only the outgoing + incoming ids on a select transition", () => {
  // Subscribe to three ids, then select B2 (transition: null → B2).
  // Only B2's listener should fire ``true``; A1 and C3 stay false and
  // should NOT have been fired (they were never the active cell).
  let aFires = 0;
  let bFires = 0;
  let cFires = 0;
  let bLast = false;
  const unsubA = isActiveCellSignal("A1" as CellId).subscribe(() => {
    aFires++;
  });
  const unsubB = isActiveCellSignal("B2" as CellId).subscribe((v) => {
    bFires++;
    bLast = v;
  });
  const unsubC = isActiveCellSignal("C3" as CellId).subscribe(() => {
    cFires++;
  });
  // Discard the synchronous on-subscribe fires.
  aFires = 0;
  bFires = 0;
  cFires = 0;

  selectedCell.set("B2" as CellId);

  expect(bFires).toBe(1);
  expect(bLast).toBe(true);
  expect(aFires).toBe(0);
  expect(cFires).toBe(0);

  // Now flip B2 → A1: B2 should fire false, A1 fire true, C3 untouched.
  selectedCell.set("A1" as CellId);

  expect(aFires).toBe(1);
  expect(bFires).toBe(2); // first true, then false
  expect(cFires).toBe(0);

  unsubA();
  unsubB();
  unsubC();
});

// ─── isHighlightedCellSignal ─────────────────────────────────────

test("isHighlightedCellSignal fires only on the symmetric diff of the selection set", () => {
  // Seed: A1 already in the multi-selection.
  selectedCells.set(new Set(["A1"] as CellId[]));

  let aFires = 0;
  let bFires = 0;
  let cFires = 0;
  let aLast = false;
  let bLast = false;
  const unsubA = isHighlightedCellSignal("A1" as CellId).subscribe((v) => {
    aFires++;
    aLast = v;
  });
  const unsubB = isHighlightedCellSignal("B2" as CellId).subscribe((v) => {
    bFires++;
    bLast = v;
  });
  const unsubC = isHighlightedCellSignal("C3" as CellId).subscribe(() => {
    cFires++;
  });
  aFires = 0;
  bFires = 0;
  cFires = 0;

  // Selection now = {A1, B2}. A1 was in and stays in (no fire); B2
  // entered (fire true); C3 untouched.
  selectedCells.set(new Set(["A1", "B2"] as CellId[]));

  expect(aFires).toBe(0);
  expect(bFires).toBe(1);
  expect(bLast).toBe(true);
  expect(cFires).toBe(0);

  // Drop A1 from the selection: A1 fires false, B2 stays in (no fire),
  // C3 still untouched.
  selectedCells.set(new Set(["B2"] as CellId[]));
  expect(aFires).toBe(1);
  expect(aLast).toBe(false);
  expect(bFires).toBe(1);
  expect(cFires).toBe(0);

  // Sanity: the writable's current state matches.
  expect(get(selectedCells).has("B2" as CellId)).toBe(true);

  unsubA();
  unsubB();
  unsubC();
});
