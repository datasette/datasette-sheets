/**
 * Unit tests for the formula-helpers wrapper over the Rust engine's
 * ``extract_refs`` — specifically that ``kind`` is surfaced and that
 * name-kinded refs get the dedicated colour.
 */
import { describe, expect, test } from "vitest";
import {
  canInsertCellRef,
  expandRefCells,
  extractFormulaRefs,
  findStringLiterals,
  getCallAtCursor,
  isCursorInString,
  lookupFunction,
  NAME_REF_COLOR,
} from "../formula-helpers";
import { setEngineNames } from "../../engine";
import type { CellId } from "../types";

test("cell references are coloured from the rotating palette", () => {
  const refs = extractFormulaRefs("=A1+B2");
  expect(refs).toHaveLength(2);
  expect(refs[0].kind).toBe("cell");
  expect(refs[1].kind).toBe("cell");
  expect(refs[0].color).not.toBe(refs[1].color);
});

test("a bare identifier is reported as a name ref and gets the name colour", () => {
  const refs = extractFormulaRefs("=TaxRate");
  expect(refs).toHaveLength(1);
  expect(refs[0].kind).toBe("name");
  expect(refs[0].color).toBe(NAME_REF_COLOR);
  // Names have no backing cells; the engine returns an empty array.
  expect(refs[0].cells).toEqual([]);
});

test("mixed cell + name: names skip the cell-ref palette index", () => {
  // Two cell refs around a name — the two cells should still be
  // assigned *adjacent* palette entries (index 0 and 1), not 0 and 2.
  const refs = extractFormulaRefs("=A1*TaxRate+B1");
  expect(refs).toHaveLength(3);
  expect(refs.map((r) => r.kind)).toEqual(["cell", "name", "cell"]);
  expect(refs[1].color).toBe(NAME_REF_COLOR);
  // A1 and B1 got consecutive palette slots.
  expect(refs[0].color).not.toBe(refs[2].color);
});

test("unparseable input returns an empty list", () => {
  expect(extractFormulaRefs("=1 + +")).toEqual([]);
});

describe("findStringLiterals", () => {
  test("single double-quoted string: returns the whole token including quotes", () => {
    // =|"|a|s|d|f| |a|"|   (pipes show char boundaries)
    //  0 1       7 8 9
    expect(findStringLiterals('="asdf a"')).toEqual([{ start: 1, end: 9 }]);
  });

  test("single-quoted string is recognised too", () => {
    expect(findStringLiterals("='ok'")).toEqual([{ start: 1, end: 5 }]);
  });

  test("two strings in one formula return two spans", () => {
    expect(findStringLiterals('=CONCAT("a","b")')).toEqual([
      { start: 8, end: 11 },
      { start: 12, end: 15 },
    ]);
  });

  test("quote inside the other kind of quote is not a delimiter", () => {
    // Single-quoted string that contains a double quote: only one span,
    // covering the single-quoted token.
    expect(findStringLiterals(`='he said "hi"'`)).toEqual([
      { start: 1, end: 15 },
    ]);
  });

  test("unterminated trailing string still gets a span to the end", () => {
    // =|"|a|s|d|f   → span covers `"asdf`
    expect(findStringLiterals('="asdf')).toEqual([{ start: 1, end: 6 }]);
  });

  test("non-formula input returns nothing", () => {
    expect(findStringLiterals('"abc"')).toEqual([]);
    expect(findStringLiterals("")).toEqual([]);
  });
});

describe("isCursorInString", () => {
  test("cursor between matched quotes → true", () => {
    // ="asdf a|" — cursor is at position 8 (between `a` and closing `"`)
    expect(isCursorInString('="asdf a"', 8)).toBe(true);
  });

  test("cursor just after the closing quote → false", () => {
    expect(isCursorInString('="asdf a"', 9)).toBe(false);
  });

  test("cursor just after the opening quote → true", () => {
    expect(isCursorInString('="asdf a"', 2)).toBe(true);
  });

  test("cursor outside any string → false", () => {
    expect(isCursorInString("=A1+B2", 3)).toBe(false);
    expect(isCursorInString("=SUM(1,2)", 5)).toBe(false);
  });

  test("cursor inside an unterminated string → true", () => {
    expect(isCursorInString('="asdf', 4)).toBe(true);
  });

  test("non-formula input → false", () => {
    expect(isCursorInString('"abc"', 2)).toBe(false);
  });
});

describe("canInsertCellRef", () => {
  // canInsertCellRef drives pointing mode: arrow keys insert a cell
  // reference iff the caret sits at a position the AST can accept
  // one. The engine-owned version will be stricter (see
  // TODO-liblotus-ref-insertable-at.md); these tests lock in the
  // current heuristic's most important boundaries.

  test("not a formula → false", () => {
    expect(canInsertCellRef("hello", 2)).toBe(false);
    expect(canInsertCellRef("", 0)).toBe(false);
  });

  test("cursor before the leading `=` → false", () => {
    // Regression: was returning true because the scan-so-far is
    // empty and ``lastKind`` still has its initial "operator"
    // value. ``Cmd+ArrowLeft`` then ``Cmd+ArrowRight`` used to
    // prepend a ref, turning ``=ROUND(3.14)`` into
    // ``E4=ROUND(3.14)``.
    expect(canInsertCellRef("=ROUND(3.14,2)", 0)).toBe(false);
  });

  test("immediately after leading `=`, empty formula → true", () => {
    expect(canInsertCellRef("=", 1)).toBe(true);
  });

  test("immediately after leading `=`, value follows → false", () => {
    expect(canInsertCellRef("=1+2", 1)).toBe(false);
  });

  test("after an operator at end of formula → true", () => {
    expect(canInsertCellRef("=1+", 3)).toBe(true);
  });

  test("after an operator but before an existing value → false", () => {
    expect(canInsertCellRef("=1+2", 3)).toBe(false);
  });

  test("inside a number literal → false", () => {
    expect(canInsertCellRef("=12345", 3)).toBe(false);
  });

  test("inside a function-name identifier → false", () => {
    expect(canInsertCellRef("=SUM", 3)).toBe(false);
    expect(canInsertCellRef("=SUM(", 3)).toBe(false);
  });

  test("just after an opening paren at end → true", () => {
    expect(canInsertCellRef("=SUM(", 5)).toBe(true);
  });

  test("just after a comma at end → true", () => {
    expect(canInsertCellRef("=SUM(1,", 7)).toBe(true);
  });

  test("after a comma but whitespace-then-value follows → false", () => {
    // Regression: used to insert a ref in the gap, turning
    // ``=SUM(1, 2)`` into ``=SUM(1,C4 2)``. Skipping whitespace
    // before checking the next meaningful char fixes it.
    expect(canInsertCellRef("=SUM(1, 2)", 7)).toBe(false);
  });

  test("inside a string literal → false", () => {
    expect(canInsertCellRef('="hello"', 4)).toBe(false);
  });
});

describe("expandRefCells", () => {
  // Grid bounds used by Cell.svelte: 15 cols (A-O, 0..14), 100 rows.
  const MAX_COL = 14;
  const MAX_ROW = 100;
  const NO_NAMES = new Map<string, string>();

  function expand(formula: string) {
    const refs = extractFormulaRefs(formula);
    return refs.map((r) => expandRefCells(r, NO_NAMES, MAX_COL, MAX_ROW));
  }

  test("cell ref passes through untouched", () => {
    expect(expand("=A1")).toEqual([["A1"]]);
  });

  test("bounded range passes through untouched", () => {
    const [cells] = expand("=A1:B2");
    expect(cells).toContain("A1");
    expect(cells).toContain("B2");
    expect(cells).toHaveLength(4);
  });

  // Regression: ``=sum(A:A)`` highlighted nothing because the engine
  // returns an empty ``cells`` array for infinite ranges.
  test("whole_column expands to every row in that column", () => {
    const [cells] = expand("=SUM(A:A)");
    expect(cells).toHaveLength(MAX_ROW);
    expect(cells[0]).toBe("A1");
    expect(cells[MAX_ROW - 1]).toBe(`A${MAX_ROW}`);
  });

  test("whole_row like `1:1` expands across every column in that row", () => {
    const [cells] = expand("=SUM(1:1)");
    expect(cells).toHaveLength(MAX_COL + 1);
    expect(cells[0]).toBe("A1");
    expect(cells[MAX_COL]).toBe("O1");
  });

  test("multi-column whole_column `A:B` spans both columns", () => {
    const [cells] = expand("=SUM(A:B)");
    expect(cells).toHaveLength(MAX_ROW * 2);
    expect(cells).toContain("A1");
    expect(cells).toContain(`B${MAX_ROW}`);
  });

  describe("named ranges", () => {
    test("name with a bounded-range definition expands", () => {
      setEngineNames({ REVENUE: "=A1:A3" });
      const names = new Map([["REVENUE", "=A1:A3"]]);
      const refs = extractFormulaRefs("=Revenue");
      const cells = expandRefCells(refs[0], names, MAX_COL, MAX_ROW);
      expect(cells).toEqual(["A1", "A2", "A3"]);
    });

    test("name pointing at a single cell expands to that one cell", () => {
      setEngineNames({ RATE: "=A1" });
      const names = new Map([["RATE", "=A1"]]);
      const refs = extractFormulaRefs("=Rate");
      const cells = expandRefCells(refs[0], names, MAX_COL, MAX_ROW);
      expect(cells).toEqual(["A1"]);
    });

    test("name with a whole-column definition expands column-wide", () => {
      setEngineNames({ AAA: "=A:A" });
      const names = new Map([["AAA", "=A:A"]]);
      const refs = extractFormulaRefs("=aaa");
      const cells = expandRefCells(refs[0], names, MAX_COL, MAX_ROW);
      expect(cells).toHaveLength(MAX_ROW);
      expect(cells[0]).toBe("A1");
    });

    test("unknown name expands to nothing", () => {
      const refs = extractFormulaRefs("=unknown_xyz");
      const cells = expandRefCells(refs[0], NO_NAMES, MAX_COL, MAX_ROW);
      expect(cells).toEqual([]);
    });

    test("name whose definition is a non-range expression expands to nothing", () => {
      // =SUM(A1:A10) is a valid definition but not a single rectangle
      // to highlight. Skip rather than guess.
      setEngineNames({ TOTAL: "=SUM(A1:A10)" });
      const names = new Map([["TOTAL", "=SUM(A1:A10)"]]);
      const refs = extractFormulaRefs("=total");
      const cells = expandRefCells(refs[0], names, MAX_COL, MAX_ROW);
      expect(cells).toEqual([]);
    });
  });

  describe("spill operator A1#", () => {
    test("kind is reported as spill with the anchor in cells", () => {
      const refs = extractFormulaRefs("=SUM(A1#)");
      const spill = refs.find((r) => r.kind === "spill");
      expect(spill).toBeDefined();
      expect(spill!.cells).toEqual(["A1"]);
    });

    test("expands to the live spill region", async () => {
      // Need a real spill in the engine for ``spillAt`` to return a
      // region. Import the cell store so setCellValue drives
      // loadIntoEngine like production.
      const { cells } = await import("../../stores/spreadsheet");
      cells.clear();
      cells.setCellValue("A1" as CellId, "=SEQUENCE(3)");

      const refs = extractFormulaRefs("=SUM(A1#)");
      const spill = refs.find((r) => r.kind === "spill");
      const expanded = expandRefCells(spill!, NO_NAMES, MAX_COL, MAX_ROW);
      expect(expanded).toEqual(["A1", "A2", "A3"]);
    });

    test("falls back to anchor-only when the spill hasn't placed", async () => {
      const { cells } = await import("../../stores/spreadsheet");
      cells.clear();
      // Just a scalar in A1, no spill — ``spillAt`` returns null.
      cells.setCellValue("A1" as CellId, "42");

      const refs = extractFormulaRefs("=A1#");
      const spill = refs.find((r) => r.kind === "spill");
      const expanded = expandRefCells(spill!, NO_NAMES, MAX_COL, MAX_ROW);
      expect(expanded).toEqual(["A1"]);
    });
  });
});

describe("getCallAtCursor", () => {
  // The signature-help popup keys off this — every call-frame edge
  // case here was a real bug that would manifest as the popup either
  // failing to open or pointing at the wrong frame.

  test("non-formula input returns null", () => {
    expect(getCallAtCursor("hello", 2)).toBeNull();
    expect(getCallAtCursor("", 0)).toBeNull();
  });

  test("just `=` with caret at 1 returns null (no open call)", () => {
    expect(getCallAtCursor("=", 1)).toBeNull();
  });

  test("caret on the function name (before the `(`) returns null", () => {
    // ``=SUM|(...)`` — caret is at index 4, sitting *between* ``M`` and
    // ``(``. The scanner must not push a frame yet because the open
    // paren is still ahead of the caret.
    expect(getCallAtCursor("=SUM(1,2)", 4)).toBeNull();
  });

  test("caret just after `(` opens the frame at argIndex 0", () => {
    // ``=SUM(|)`` — cursor=5. argsStart=5, argsEnd points at the
    // matching `)` at index 5.
    const r = getCallAtCursor("=SUM()", 5);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("SUM");
    expect(r!.argIndex).toBe(0);
    expect(r!.argsStart).toBe(5);
    expect(r!.argsEnd).toBe(5);
  });

  test("caret in the second argument bumps argIndex to 1", () => {
    // ``=SUM(1,|2)`` — cursor=7. argIndex tracks comma count.
    const r = getCallAtCursor("=SUM(1,2)", 7);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("SUM");
    expect(r!.argIndex).toBe(1);
  });

  test("caret in a nested call returns the inner frame", () => {
    // ``=IF(A1, SUM(|))`` — cursor sits inside SUM's args, must
    // return the SUM frame rather than IF.
    const text = "=IF(A1, SUM())";
    const cursor = text.indexOf("SUM(") + 4; // just past the `(`
    const r = getCallAtCursor(text, cursor);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("SUM");
    expect(r!.argIndex).toBe(0);
  });

  test("anonymous parens are skipped — the surrounding named frame wins", () => {
    // ``=IF(A1, (1+|2))`` — cursor inside an anonymous group; the
    // namedIdx walk skips the unnamed frame and reports IF, which is
    // currently the user-visible call.
    const text = "=IF(A1, (1+2))";
    const cursor = text.indexOf("1+") + 2; // between `+` and `2`
    const r = getCallAtCursor(text, cursor);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("IF");
    // Two args seen on IF so far (the comma between A1 and the group).
    expect(r!.argIndex).toBe(1);
  });

  test("unterminated call reports argsEnd = -1", () => {
    // ``=SUM(1, 2`` — no closing paren. The forward scan never finds
    // its match; argsEnd must stay at its sentinel.
    const r = getCallAtCursor("=SUM(1, 2", 9);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("SUM");
    expect(r!.argsEnd).toBe(-1);
  });

  test("caret inside a string literal still reports the surrounding call (current behaviour)", () => {
    // ``=SUM("hi |there", 1)`` — caret is inside the first string
    // arg. The ticket flagged that this returns the SUM frame rather
    // than ``null``: the open ``(`` is committed before the string
    // starts, and the frame stays on the stack. Locking in current
    // behaviour; the engine-owned signature_help primitive will
    // revisit it (TODO-liblotus-signature-help.md).
    const text = '=SUM("hi there", 1)';
    const cursor = text.indexOf("hi ") + 3; // just after the space
    const r = getCallAtCursor(text, cursor);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("SUM");
  });
});

describe("lookupFunction", () => {
  test("alias resolves to the catalog entry", () => {
    // Engine-side aliases now drive resolution (avg → AVERAGE).
    const info = lookupFunction("avg");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("AVERAGE");
  });

  test("unknown name returns null", () => {
    expect(lookupFunction("nonexistent")).toBeNull();
  });

  test("engine builtin (SUM) is resolved from list_functions, not the static overlay", () => {
    const info = lookupFunction("SUM");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("SUM");
    // params come from the engine — variadic rolls up as the last
    // repeatable param.
    expect(info!.params.some((p) => p.repeatable)).toBe(true);
  });

  test("lotus-datetime function (YEAR) resolves with overlay-enriched metadata", () => {
    // YEAR is now reported by the engine's instance-level
    // list_functions() — but its register_function metadata is
    // bare (no per-param docs). The overlay shadows that bare
    // report with a proper ``date`` param so the popup reads
    // correctly. lookupFunction prefers overlay over engine for
    // exactly this case.
    const info = lookupFunction("YEAR");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("YEAR");
    expect(info!.params).toHaveLength(1);
    expect(info!.params[0].name).toBe("date");
  });

  test("TODAY (no-args) resolves and reports an empty params list", () => {
    const info = lookupFunction("today");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("TODAY");
    expect(info!.params).toHaveLength(0);
  });

  test("engine-only datetime function (QUARTER) resolves via the engine", () => {
    // QUARTER isn't in the curated overlay — it falls through to
    // the engine's instance list_functions(), which now sees
    // runtime-registered customs. This is the regression target
    // for the static→instance migration.
    const info = lookupFunction("QUARTER");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("QUARTER");
  });
});
