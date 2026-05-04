/**
 * [STORES-05] Free-function mutation tests. Pulls in the new
 * ``./mutations`` module directly — this is the layer that used to
 * be a ``this``-bound method bag, so per-cell ref-equality
 * guarantees and the error-marking fallback need their own coverage
 * now that they sit behind explicit imports rather than ``cells.foo``.
 */
import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import type { CellId } from "../../../spreadsheet/types";
import { cellsWritable } from "../store";
import { clearCells, setCellValue, setCellValueBatch } from "../mutations";

beforeEach(() => {
  clearCells();
});

test("setCellValue keeps unchanged cells at the same object reference", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("B1" as CellId, "2");
  setCellValue("C1" as CellId, "=A1+B1");

  // Snapshot the C1 ref BEFORE the unrelated edit. Then mutate D1 —
  // the C1 cell's data hasn't changed (still ``=A1+B1`` evaluating
  // to 3), so the immutable merge in ``mergeComputedIntoCells``
  // must hand back the *exact same object* so per-cell subscribers
  // (cellStore) don't fan out for a no-change.
  const before = get(cellsWritable).get("C1" as CellId)!;
  setCellValue("D1" as CellId, "99");
  const after = get(cellsWritable).get("C1" as CellId)!;

  expect(after).toBe(before);
  expect(after.computedValue).toBe(3);
});

test("setCellValue updates a cell's reference when its computed value moves", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("B1" as CellId, "=A1+10");

  // Snapshot B1 then change A1. The dependent's computed value
  // moves (11 → 12), so the per-cell ref MUST change — that's the
  // change-signal cellStore relies on.
  const before = get(cellsWritable).get("B1" as CellId)!;
  setCellValue("A1" as CellId, "2");
  const after = get(cellsWritable).get("B1" as CellId)!;

  expect(after).not.toBe(before);
  expect(after.computedValue).toBe(12);
});

test("setCellValue surfaces engine errors as #ERROR-style strings on the cell", () => {
  // ``=1/0`` is a divide-by-zero — the engine returns
  // ``#DIV/0!`` as a CellValue::String, which the merge classifies
  // as an error.
  setCellValue("A1" as CellId, "=1/0");
  const cell = get(cellsWritable).get("A1" as CellId)!;
  expect(cell.error).toBe("#DIV/0!");
  expect(cell.formula).toBe("=1/0");
});

test("setCellValueBatch applies every change and recalcs once", () => {
  setCellValue("A1" as CellId, "1");
  setCellValue("A2" as CellId, "2");
  setCellValue("A3" as CellId, "=A1+A2");

  // Subscribe AFTER the seeding so we only count the batch fire.
  let count = 0;
  const unsub = cellsWritable.subscribe(() => {
    count++;
  });
  count = 0; // discard svelte's on-subscribe fire

  setCellValueBatch([
    ["A1" as CellId, "10"],
    ["A2" as CellId, "20"],
  ]);

  unsub();
  // Batch path is one ``update`` call → one notification.
  expect(count).toBe(1);

  const map = get(cellsWritable);
  expect(map.get("A1" as CellId)!.rawValue).toBe("10");
  expect(map.get("A2" as CellId)!.rawValue).toBe("20");
  // Dependent must reflect the new inputs — the batch passes every
  // change to ``setAndRecalculate`` so the DAG sees the full delta.
  expect(map.get("A3" as CellId)!.computedValue).toBe(30);
});

test("setCellValue preserves an existing cell's format on value edit", () => {
  // Format-then-value path — used by every keyboard-typed edit on
  // a cell that already has bold/italic/etc.
  setCellValue("A1" as CellId, "old");
  cellsWritable.update((map) => {
    const next = new Map(map);
    const cell = next.get("A1" as CellId)!;
    next.set("A1" as CellId, {
      ...cell,
      format: { ...cell.format, bold: true },
    });
    return next;
  });
  setCellValue("A1" as CellId, "new");

  const cell = get(cellsWritable).get("A1" as CellId)!;
  expect(cell.rawValue).toBe("new");
  expect(cell.format.bold).toBe(true);
});
