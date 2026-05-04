import { beforeEach, describe, expect, test } from "vitest";
import {
  adjustRefsForColumnBlockMove,
  adjustRefsForRowBlockMove,
  adjustRefsForRowBlockMoveDataFollowing,
  adjustRefsForDeletion,
  cellId,
  clearAllPins,
  loadIntoEngine,
  parseCellIdRaw,
  parseRange,
  pinValue,
  pinnedCells,
  resetEngine,
  setAndRecalculate,
} from "../engine";

beforeEach(() => {
  // Wipe any pin state from prior tests; ``loadIntoEngine`` re-applies
  // pins on top of the new sheet, so leftover pins would leak across
  // cases otherwise.
  clearAllPins();
  resetEngine();
});

/** Convenience: pin a single 2-D array at ``A1`` and read the resulting
 *  computed map back through the same path the SheetsPage uses on load. */
function pinAndRead(rows: string[][]): Map<string, unknown> {
  pinValue("A1", rows);
  return loadIntoEngine([]);
}

describe("coerceTypedValue (via pinValue → loadIntoEngine)", () => {
  test("plain integer-shaped string coerces to number", () => {
    const out = pinAndRead([["42"]]);
    expect(out.get("A1")).toBe(42);
  });

  test('"42.0" coerces to number 42 (was the leaky case)', () => {
    // Old ``String(parseFloat(v)) === v`` predicate failed here because
    // ``String(42)`` is ``"42"``, not ``"42.0"``. The new regex-based
    // sniff treats "looks numeric" as a sufficient predicate.
    const out = pinAndRead([["42.0"]]);
    expect(out.get("A1")).toBe(42);
  });

  test("mixed 42 / 42.0 row both come through as numbers", () => {
    pinValue("A1", [["42.0", "42"]]);
    const out = loadIntoEngine([]);
    expect(out.get("A1")).toBe(42);
    expect(out.get("B1")).toBe(42);
  });

  test('scientific notation like "1e3" coerces to 1000', () => {
    const out = pinAndRead([["1e3"]]);
    expect(out.get("A1")).toBe(1000);
  });

  test("negative + decimal shapes coerce", () => {
    pinValue("A1", [["-0.5", "-1", ".5", "0.0"]]);
    const out = loadIntoEngine([]);
    expect(out.get("A1")).toBe(-0.5);
    expect(out.get("B1")).toBe(-1);
    expect(out.get("C1")).toBe(0.5);
    expect(out.get("D1")).toBe(0);
  });

  test("non-numeric strings stay strings", () => {
    const out = pinAndRead([["abc"]]);
    expect(out.get("A1")).toBe("abc");
  });

  test("empty / whitespace-only / trailing-space stay as-is", () => {
    pinValue("A1", [["", "  ", "42 "]]);
    const out = loadIntoEngine([]);
    // Whitespace is not part of the numeric grammar — these are user-
    // visible strings.
    expect(out.get("A1")).toBe("");
    expect(out.get("B1")).toBe("  ");
    expect(out.get("C1")).toBe("42 ");
  });

  test("partial-numeric strings (42abc, 1e, .) stay strings", () => {
    pinValue("A1", [["42abc", "1e", "."]]);
    const out = loadIntoEngine([]);
    expect(out.get("A1")).toBe("42abc");
    expect(out.get("B1")).toBe("1e");
    expect(out.get("C1")).toBe(".");
  });

  test("hex / underscore literals stay strings (not part of spreadsheet grammar)", () => {
    pinValue("A1", [["0x1F", "1_000"]]);
    const out = loadIntoEngine([]);
    expect(out.get("A1")).toBe("0x1F");
    expect(out.get("B1")).toBe("1_000");
  });
});

describe("parseRange", () => {
  test("garbage returns null rather than throwing", () => {
    expect(parseRange("")).toBeNull();
    expect(parseRange("not a range")).toBeNull();
    expect(parseRange("A1")).toBeNull(); // single cells aren't ranges
    expect(parseRange("A1:")).toBeNull();
  });

  test("bounded rectangle round-trips", () => {
    const r = parseRange("A1:B2");
    expect(r).not.toBeNull();
    expect(r!.start).toEqual({ row: 0, col: 0 });
    expect(r!.end_col).toBe(1);
    expect(r!.end_row).toBe(1);
    expect(r!.unbounded).toBe(false);
    expect(r!.normalized).toBe("A1:B2");
  });

  test("whole-column range A:A is reported unbounded with end_row null", () => {
    const r = parseRange("A:A");
    expect(r).not.toBeNull();
    expect(r!.start).toEqual({ row: 0, col: 0 });
    expect(r!.end_col).toBe(0);
    expect(r!.end_row).toBeNull();
    expect(r!.unbounded).toBe(true);
  });

  test("multi-column whole-column A:F", () => {
    const r = parseRange("A:F");
    expect(r).not.toBeNull();
    expect(r!.start.col).toBe(0);
    expect(r!.end_col).toBe(5);
    expect(r!.end_row).toBeNull();
    expect(r!.unbounded).toBe(true);
  });

  test("absolute markers ($) are stripped from normalized output", () => {
    const r = parseRange("$A$1:$B$2");
    expect(r).not.toBeNull();
    expect(r!.start).toEqual({ row: 0, col: 0 });
    expect(r!.end_col).toBe(1);
    expect(r!.end_row).toBe(1);
    expect(r!.normalized).toBe("A1:B2");
  });
});

describe("parseCellIdRaw", () => {
  test("garbage returns null", () => {
    expect(parseCellIdRaw("")).toBeNull();
    expect(parseCellIdRaw("not a cell")).toBeNull();
    expect(parseCellIdRaw("A1:B2")).toBeNull(); // a range, not a cell id
    expect(parseCellIdRaw("123A")).toBeNull();
  });

  test("single-letter column", () => {
    expect(parseCellIdRaw("A1")).toEqual({ row: 0, col: 0 });
  });

  test("two-letter column", () => {
    // AA → col 26, row 9
    expect(parseCellIdRaw("AA10")).toEqual({ row: 9, col: 26 });
  });

  test("ZZ100 — far corner of a two-letter column space", () => {
    // ZZ → 26*26 + 26 - 1 = 701, row index = 99
    expect(parseCellIdRaw("ZZ100")).toEqual({ row: 99, col: 701 });
  });
});

describe("cellId ↔ parseCellIdRaw round-trip", () => {
  test("a sample grid round-trips through both directions", () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [0, 25],
      [9, 26],
      [99, 701],
      [12, 1],
      [4, 4],
    ];
    for (const [row, col] of samples) {
      const id = cellId(row, col);
      expect(parseCellIdRaw(id)).toEqual({ row, col });
    }
  });
});

describe("pinValue + pinnedCells + clearAllPins", () => {
  test("pinValue registers the cell in pinnedCells()", () => {
    expect(pinnedCells()).toEqual([]);
    pinValue("A1", [["7"]]);
    expect(pinnedCells()).toEqual(["A1"]);
  });

  test("clearAllPins empties pinnedCells AND drops the value from the engine", () => {
    pinValue("A1", [["7"]]);
    // Confirm the pin is materialised in the computed map.
    expect(loadIntoEngine([]).get("A1")).toBe(7);

    clearAllPins();
    expect(pinnedCells()).toEqual([]);

    // After clearAllPins, a fresh load with no cells must produce no
    // value at A1 — the engine has forgotten the pin too. Resurrection
    // here would mean clearAllPins only nuked the JS map but left the
    // wasm sheet's pin map intact.
    const out = loadIntoEngine([]);
    expect(out.get("A1")).toBeUndefined();
  });
});

describe("setAndRecalculate", () => {
  test("setAndRecalculate([]) returns the current state and preserves pinned values", () => {
    pinValue("A1", [["42"]]);
    // Prime the engine.
    loadIntoEngine([["B1", { kind: "raw", value: "100" }]]);

    // Empty changes — no mutations, just a refresh.
    const out = setAndRecalculate([]);
    expect(out.get("A1")).toBe(42);
    expect(out.get("B1")).toBe(100);
    // Pin still registered.
    expect(pinnedCells()).toEqual(["A1"]);
  });
});

describe("adjustRefsForDeletion", () => {
  // The wrapper has a ``try { … } catch { return formula; }`` swallow
  // path — these tests pin the no-op + error-fallback branches so a
  // future change to the wrapper or engine shape can't silently drop
  // formulas on the floor.

  test("empty cols + rows leaves a formula alone", () => {
    expect(adjustRefsForDeletion("=1+2", [], [])).toBe("=1+2");
    expect(adjustRefsForDeletion("=A1+B2", [], [])).toBe("=A1+B2");
  });

  test("non-formula input passes through unchanged regardless of deletions", () => {
    // Both the no-deletion path and the deletion-with-non-formula path
    // must return the input string verbatim. Deleting a row from
    // ``"hello"`` is meaningless; the wrapper must not throw.
    expect(adjustRefsForDeletion("not a formula", [0], [])).toBe(
      "not a formula",
    );
    expect(adjustRefsForDeletion("hello", [], [0])).toBe("hello");
    expect(adjustRefsForDeletion("", [0], [0])).toBe("");
  });
});

// [sheet.column.drag-reorder]
describe("adjustRefsForColumnBlockMove", () => {
  // Mirrors the table in TODO-liblotus-column-block-move.md. The
  // wasm wrapper passes its three integers straight to the Rust
  // primitive; this catches binding-shape regressions and the
  // try/catch fallback path on tokenizer failure.

  test("single cell follows the move", () => {
    expect(adjustRefsForColumnBlockMove("=D1", 3, 3, 2)).toBe("=C1");
    expect(adjustRefsForColumnBlockMove("=C1", 3, 3, 2)).toBe("=D1");
    expect(adjustRefsForColumnBlockMove("=B5+D5", 3, 3, 2)).toBe("=B5+C5");
  });

  test("absolute markers preserved", () => {
    expect(adjustRefsForColumnBlockMove("=$D$1", 3, 3, 2)).toBe("=$C$1");
    expect(adjustRefsForColumnBlockMove("=$D1", 3, 3, 2)).toBe("=$C1");
    expect(adjustRefsForColumnBlockMove("=D$1", 3, 3, 2)).toBe("=C$1");
  });

  test("bounded ranges stay positional", () => {
    expect(adjustRefsForColumnBlockMove("=A1:D10", 3, 3, 2)).toBe("=A1:D10");
    expect(adjustRefsForColumnBlockMove("=B1:C10", 3, 3, 2)).toBe("=B1:C10");
  });

  test("whole-column ranges follow via interior bbox", () => {
    expect(adjustRefsForColumnBlockMove("=SUM(D:D)", 3, 3, 2)).toBe(
      "=SUM(C:C)",
    );
    // forward across {1,3,2}, bbox B:D — unchanged.
    expect(adjustRefsForColumnBlockMove("=SUM(B:D)", 3, 3, 2)).toBe(
      "=SUM(B:D)",
    );
    // forward across {1,3}, bbox B:D — grows.
    expect(adjustRefsForColumnBlockMove("=SUM(B:C)", 3, 3, 2)).toBe(
      "=SUM(B:D)",
    );
  });

  test("whole-row ranges unaffected by column move", () => {
    expect(adjustRefsForColumnBlockMove("=SUM(1:5)", 3, 3, 2)).toBe(
      "=SUM(1:5)",
    );
  });

  test("spill anchor follows", () => {
    expect(adjustRefsForColumnBlockMove("=A1#", 0, 0, 2)).toBe("=C1#");
  });

  test("non-formula passes through", () => {
    expect(adjustRefsForColumnBlockMove("not a formula", 3, 3, 2)).toBe(
      "not a formula",
    );
    expect(adjustRefsForColumnBlockMove("", 3, 3, 2)).toBe("");
  });

  test("block move (multi-col) follows", () => {
    // Move B:D (cols 1..3) to start at 4: B(1)→4, E(4)→1.
    expect(adjustRefsForColumnBlockMove("=B1+E1", 1, 3, 4)).toBe("=E1+B1");
    // Whole-col B:D → bbox {4,5,6} = E:G.
    expect(adjustRefsForColumnBlockMove("=SUM(B:D)", 1, 3, 4)).toBe(
      "=SUM(E:G)",
    );
  });

  test("no-op (final_start == src_start) leaves formula alone", () => {
    expect(adjustRefsForColumnBlockMove("=A1+B2", 3, 3, 3)).toBe("=A1+B2");
  });
});

// [sheet.row.drag-reorder]
describe("adjustRefsForRowBlockMove", () => {
  // Mirrors the table in TODO-liblotus-row-block-move.md positional
  // variant. Cases hand-verified against the forward-row formula.

  test("single cell follows the move", () => {
    expect(adjustRefsForRowBlockMove("=B5", 4, 4, 2)).toBe("=B3");
    expect(adjustRefsForRowBlockMove("=B3", 4, 4, 2)).toBe("=B4");
    expect(adjustRefsForRowBlockMove("=B5+C5", 4, 4, 2)).toBe("=B3+C3");
  });

  test("absolute markers preserved", () => {
    expect(adjustRefsForRowBlockMove("=$B$5", 4, 4, 2)).toBe("=$B$3");
    expect(adjustRefsForRowBlockMove("=$B5", 4, 4, 2)).toBe("=$B3");
    expect(adjustRefsForRowBlockMove("=B$5", 4, 4, 2)).toBe("=B$3");
  });

  test("bounded ranges stay positional (cell-formula semantic)", () => {
    expect(adjustRefsForRowBlockMove("=A1:D5", 4, 4, 2)).toBe("=A1:D5");
    expect(adjustRefsForRowBlockMove("=B3:B5", 4, 4, 2)).toBe("=B3:B5");
  });

  test("whole-row ranges follow via interior bbox", () => {
    expect(adjustRefsForRowBlockMove("=SUM(5:5)", 4, 4, 2)).toBe("=SUM(3:3)");
    // Range fully contains the affected band → bbox unchanged.
    expect(adjustRefsForRowBlockMove("=SUM(3:5)", 4, 4, 2)).toBe("=SUM(3:5)");
    // Partial overlap → bbox shifts.
    expect(adjustRefsForRowBlockMove("=SUM(3:4)", 4, 4, 2)).toBe("=SUM(4:5)");
  });

  test("whole-col ranges unaffected by row move", () => {
    expect(adjustRefsForRowBlockMove("=SUM(A:C)", 4, 4, 2)).toBe("=SUM(A:C)");
  });

  test("spill anchor follows", () => {
    expect(adjustRefsForRowBlockMove("=B5#", 4, 4, 2)).toBe("=B3#");
  });

  test("non-formula passes through", () => {
    expect(adjustRefsForRowBlockMove("not a formula", 4, 4, 2)).toBe(
      "not a formula",
    );
    expect(adjustRefsForRowBlockMove("", 4, 4, 2)).toBe("");
  });

  test("block move (multi-row) follows", () => {
    expect(adjustRefsForRowBlockMove("=A2+A5", 1, 3, 4)).toBe("=A5+A2");
    expect(adjustRefsForRowBlockMove("=SUM(2:4)", 1, 3, 4)).toBe("=SUM(5:7)");
  });

  test("no-op (final_start == src_start) leaves formula alone", () => {
    expect(adjustRefsForRowBlockMove("=A1+B2", 4, 4, 4)).toBe("=A1+B2");
  });
});

// [sheet.row.drag-reorder]
describe("adjustRefsForRowBlockMoveDataFollowing", () => {
  // The data-following variant differs from positional only in
  // the bounded-range branch. Hand-verified against
  // TODO-liblotus-row-block-move.md.

  test("bounded range fully containing affected band → unchanged", () => {
    // forward({2,3,4}) = {3,4,2}, bbox 2..4 = same as input.
    expect(adjustRefsForRowBlockMoveDataFollowing("=A3:A5", 4, 4, 2)).toBe(
      "=A3:A5",
    );
  });

  test("bounded range partial overlap → bbox shifts", () => {
    // forward({2,3}) = {3,4}, bbox 3..4.
    expect(adjustRefsForRowBlockMoveDataFollowing("=A3:A4", 4, 4, 2)).toBe(
      "=A4:A5",
    );
  });

  test("bounded range straddling the band → bbox grows", () => {
    // forward({3,4,5}) = {4,2,5}, bbox 2..5.
    expect(adjustRefsForRowBlockMoveDataFollowing("=A4:A6", 4, 4, 2)).toBe(
      "=A3:A6",
    );
  });

  test("bounded range covering just the moved row", () => {
    // forward({4}) = {2}, bbox 2..2.
    expect(adjustRefsForRowBlockMoveDataFollowing("=A5:A5", 4, 4, 2)).toBe(
      "=A3:A3",
    );
  });

  test("non-bounded branches identical to positional variant", () => {
    expect(adjustRefsForRowBlockMoveDataFollowing("=B5", 4, 4, 2)).toBe("=B3");
    expect(adjustRefsForRowBlockMoveDataFollowing("=SUM(A:C)", 4, 4, 2)).toBe(
      "=SUM(A:C)",
    );
  });
});
