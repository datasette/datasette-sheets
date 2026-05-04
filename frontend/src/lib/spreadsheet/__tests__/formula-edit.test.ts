// Pure unit tests for the helpers extracted out of ``Cell.svelte``
// in CELL-GRID-01. End-to-end keyboard coverage stays in
// ``Cell.autocomplete.test.ts`` and ``Cell.signatureHelp.test.ts``;
// the tests here lock in the **logic** so future regressions don't
// require a full Svelte mount to reproduce.

import { beforeEach, describe, expect, test } from "vitest";
import { get } from "svelte/store";
import {
  buildFormulaSegments,
  computeAutocompleteMatches,
  createFormulaEditState,
  getPartialAtCursor,
  handleFormulaArrowKey,
  type FormulaArrowContext,
} from "../formula-edit";
import { formulaInOpenCall } from "../../stores/spreadsheet";
import { setEngineNames } from "../../engine";

beforeEach(() => {
  formulaInOpenCall.set(false);
  setEngineNames({});
});

// ─── buildFormulaSegments ───────────────────────────────────────────

describe("buildFormulaSegments", () => {
  test("non-ref formula text is one uncoloured segment", () => {
    expect(buildFormulaSegments("=1+2")).toEqual([
      { text: "=1+2", color: null },
    ]);
  });

  test("a single cell ref splits into prefix + ref segment", () => {
    const segs = buildFormulaSegments("=A1");
    // segments are ``=`` then the ref text, both contiguous.
    expect(segs.map((s) => s.text).join("")).toBe("=A1");
    const refSeg = segs.find((s) => s.text === "A1");
    expect(refSeg).toBeDefined();
    expect(refSeg!.color).not.toBeNull();
  });

  test("string literal picks up the dedicated string colour", () => {
    const segs = buildFormulaSegments('="hi"');
    const stringSeg = segs.find((s) => s.text === '"hi"');
    expect(stringSeg).toBeDefined();
    // STRING_COLOR is the forest-green hex from formula-helpers.
    expect(stringSeg!.color).toBe("#188038");
  });

  test("interleaved cell + string spans concatenate to original", () => {
    const formula = '=A1+"hi"+B2';
    const segs = buildFormulaSegments(formula);
    expect(segs.map((s) => s.text).join("")).toBe(formula);
  });

  test("two cell refs get distinct colours", () => {
    const segs = buildFormulaSegments("=A1+B2");
    const a1 = segs.find((s) => s.text === "A1");
    const b2 = segs.find((s) => s.text === "B2");
    expect(a1?.color).toBeTruthy();
    expect(b2?.color).toBeTruthy();
    expect(a1!.color).not.toBe(b2!.color);
  });
});

// ─── getPartialAtCursor ─────────────────────────────────────────────

describe("getPartialAtCursor", () => {
  test("typing a fresh identifier returns the prefix + start offset", () => {
    expect(getPartialAtCursor("=Tax", 4)).toEqual({ start: 1, prefix: "Tax" });
  });

  test("cursor outside any identifier → null", () => {
    // Caret at position 0 (before the ``=``) — no partial.
    expect(getPartialAtCursor("=Tax", 0)).toBeNull();
  });

  test("digit-only run is not a partial (must start with letter / _)", () => {
    expect(getPartialAtCursor("=123", 4)).toBeNull();
  });

  test("cell-ref shape (letters then digits) is rejected so autocomplete doesn't fire on `=A1`", () => {
    expect(getPartialAtCursor("=A1", 3)).toBeNull();
  });

  test("after a `:` returns null — right-half of a range needs a cell ref, not a name", () => {
    expect(getPartialAtCursor("=A:A", 4)).toBeNull();
    expect(getPartialAtCursor("=SUM(A:A", 8)).toBeNull();
  });

  test("identifier following an operator other than `:` is fine", () => {
    expect(getPartialAtCursor("=1+Al", 5)).toEqual({
      start: 3,
      prefix: "Al",
    });
  });

  test("partway through an identifier returns the slice up to cursor", () => {
    // ``=Algorithm`` with caret after ``Alg`` — partial is ``Alg``.
    expect(getPartialAtCursor("=Algorithm", 4)).toEqual({
      start: 1,
      prefix: "Alg",
    });
  });
});

// ─── computeAutocompleteMatches ─────────────────────────────────────

describe("computeAutocompleteMatches", () => {
  test("named ranges precede function names in the result", () => {
    const out = computeAutocompleteMatches("AL", ["Alpha"], ["ALL", "ALERT"]);
    expect(out).toEqual(["Alpha", "ALL", "ALERT"]);
  });

  test("case-insensitive prefix matching", () => {
    const out = computeAutocompleteMatches("tax", ["TaxRate"], []);
    expect(out).toEqual(["TaxRate"]);
  });

  test("user-defined name shadows a builtin with the same uppercase shape", () => {
    // Single ``SUM`` in the result, the user-defined one.
    const out = computeAutocompleteMatches("SU", ["Sum"], ["SUM", "SUMIF"]);
    expect(out).toEqual(["Sum", "SUMIF"]);
  });

  test("exact prefix match excluded — there's nothing to complete", () => {
    expect(computeAutocompleteMatches("SUM", [], ["SUM"])).toEqual([]);
  });

  test("no candidates → empty array", () => {
    expect(computeAutocompleteMatches("xyz", ["A"], ["B"])).toEqual([]);
  });
});

// ─── createFormulaEditState — discriminated union mode ──────────────

describe("createFormulaEditState", () => {
  function makeInput(value: string, caret: number): HTMLInputElement {
    const input = document.createElement("input");
    input.value = value;
    input.setSelectionRange(caret, caret);
    return input;
  }

  test("starts in idle mode with no pointing ref", () => {
    const s = createFormulaEditState();
    expect(get(s.mode).kind).toBe("idle");
    expect(get(s.pointingRef)).toBeNull();
  });

  test("updateAutocomplete sets autocomplete mode when prefix matches", () => {
    const s = createFormulaEditState();
    s.updateAutocomplete(makeInput("=SU", 3), []);
    const m = get(s.mode);
    expect(m.kind).toBe("autocomplete");
    if (m.kind === "autocomplete") {
      expect(m.matches).toContain("SUM");
      expect(m.replace).toEqual({ start: 1, end: 3 });
    }
  });

  test("updateAutocomplete closes when prefix matches nothing", () => {
    const s = createFormulaEditState();
    // First open the popup, then re-update with non-matching input.
    s.updateAutocomplete(makeInput("=SU", 3), []);
    expect(get(s.mode).kind).toBe("autocomplete");
    s.updateAutocomplete(makeInput("=XyZ", 4), []);
    expect(get(s.mode).kind).toBe("idle");
  });

  test("updateAutocomplete closes when cursor is inside a string literal", () => {
    const s = createFormulaEditState();
    s.updateAutocomplete(makeInput("=SU", 3), []);
    expect(get(s.mode).kind).toBe("autocomplete");
    // Inside ``"a..."`` — autocomplete must suppress.
    s.updateAutocomplete(makeInput('="abc"', 4), []);
    expect(get(s.mode).kind).toBe("idle");
  });

  test("updateAutocomplete preserves index when matches list stays large", () => {
    const s = createFormulaEditState();
    // ``=A`` matches AVERAGE / AND / ABS — three builtins.
    s.updateAutocomplete(makeInput("=A", 2), []);
    const initial = get(s.mode);
    expect(initial.kind).toBe("autocomplete");
    if (initial.kind === "autocomplete") {
      expect(initial.matches.length).toBeGreaterThanOrEqual(2);
    }
    // Bump index to 1 to simulate a user arrow-down.
    const cur = get(s.mode);
    if (cur.kind === "autocomplete") {
      s.mode.set({ ...cur, index: 1 });
    }
    // Refresh with the same input — index sticks because the new
    // matches array is the same length.
    s.updateAutocomplete(makeInput("=A", 2), []);
    const after = get(s.mode);
    expect(after.kind).toBe("autocomplete");
    if (after.kind === "autocomplete") expect(after.index).toBe(1);
  });

  test("updateAutocomplete resets index when it falls past the new list", () => {
    const s = createFormulaEditState();
    // Prime with a 3-entry match list and bump index to 2.
    s.updateAutocomplete(makeInput("=A", 2), []);
    const cur = get(s.mode);
    if (cur.kind === "autocomplete") {
      s.mode.set({ ...cur, index: cur.matches.length - 1 });
    }
    // Refine to a single match — index would be out of range, must
    // jump back to 0.
    s.updateAutocomplete(makeInput("=AV", 3), []);
    const after = get(s.mode);
    expect(after.kind).toBe("autocomplete");
    if (after.kind === "autocomplete") {
      expect(after.matches).toEqual(["AVERAGE"]);
      expect(after.index).toBe(0);
    }
  });

  test("updateSignatureHelp opens when caret is inside a known call", () => {
    const s = createFormulaEditState();
    s.updateSignatureHelp(makeInput("=SUM(", 5));
    const m = get(s.mode);
    expect(m.kind).toBe("signature-help");
    if (m.kind === "signature-help") {
      expect(m.info.name).toBe("SUM");
      expect(m.argIndex).toBe(0);
    }
    expect(get(formulaInOpenCall)).toBe(true);
  });

  test("updateSignatureHelp tracks the active argument across commas", () => {
    const s = createFormulaEditState();
    s.updateSignatureHelp(makeInput("=ROUND(3.14,", 12));
    const m = get(s.mode);
    expect(m.kind).toBe("signature-help");
    if (m.kind === "signature-help") expect(m.argIndex).toBe(1);
  });

  test("updateSignatureHelp idles + drops formulaInOpenCall when caret leaves the call", () => {
    const s = createFormulaEditState();
    s.updateSignatureHelp(makeInput("=SUM(", 5));
    expect(get(s.mode).kind).toBe("signature-help");
    s.updateSignatureHelp(makeInput("=SUM(1,2)", 9));
    expect(get(s.mode).kind).toBe("idle");
    expect(get(formulaInOpenCall)).toBe(false);
  });

  test("autocomplete suppresses signature-help refreshes", () => {
    const s = createFormulaEditState();
    // Force autocomplete open.
    s.updateAutocomplete(makeInput("=SU", 3), []);
    expect(get(s.mode).kind).toBe("autocomplete");
    // Even if the caret is "inside a call" by coincidence,
    // updateSignatureHelp must not flip the popup mode.
    s.updateSignatureHelp(makeInput("=SU", 3));
    expect(get(s.mode).kind).toBe("autocomplete");
    expect(get(formulaInOpenCall)).toBe(false);
  });

  test("reset drops every popup, pointing ref, and formulaInOpenCall", () => {
    const s = createFormulaEditState();
    s.updateSignatureHelp(makeInput("=SUM(", 5));
    s.setPointing({ start: 5, end: 7, cellId: "A1" });
    expect(get(s.mode).kind).toBe("signature-help");
    expect(get(s.pointingRef)).not.toBeNull();
    expect(get(formulaInOpenCall)).toBe(true);

    s.reset();
    expect(get(s.mode).kind).toBe("idle");
    expect(get(s.pointingRef)).toBeNull();
    expect(get(formulaInOpenCall)).toBe(false);
  });

  test("pointing setters are isolated from popup mode", () => {
    const s = createFormulaEditState();
    s.setPointing({ start: 1, end: 3, cellId: "A1" });
    expect(get(s.pointingRef)).toEqual({ start: 1, end: 3, cellId: "A1" });
    expect(get(s.mode).kind).toBe("idle");
    s.clearPointing();
    expect(get(s.pointingRef)).toBeNull();
  });
});

// ─── handleFormulaArrowKey ──────────────────────────────────────────

describe("handleFormulaArrowKey", () => {
  function ctxFrom(
    overrides: Partial<FormulaArrowContext> = {},
  ): FormulaArrowContext {
    return {
      cellId: "B2",
      editValue: "=",
      input: null,
      canInsertCellRef: () => true,
      navigate: (_from, dir) =>
        ({ up: "B1", down: "B3", left: "A2", right: "C2" })[dir],
      setEditValue: () => {},
      ...overrides,
    };
  }

  function evt(key: string): KeyboardEvent {
    let prevented = false;
    let stopped = false;
    return {
      key,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      get defaultPrevented() {
        return prevented;
      },
      get propagationStopped() {
        return stopped;
      },
    } as unknown as KeyboardEvent;
  }

  test("non-arrow keys pass through", () => {
    const s = createFormulaEditState();
    const r = handleFormulaArrowKey(s, evt("a"), ctxFrom());
    expect(r.kind).toBe("passthrough");
  });

  test("non-formula edit value passes through", () => {
    const s = createFormulaEditState();
    const r = handleFormulaArrowKey(
      s,
      evt("ArrowDown"),
      ctxFrom({ editValue: "abc" }),
    );
    expect(r.kind).toBe("passthrough");
  });

  test("when the grammar rejects a ref insertion AND no pointing ref → passthrough", () => {
    const s = createFormulaEditState();
    const r = handleFormulaArrowKey(
      s,
      evt("ArrowDown"),
      ctxFrom({ editValue: "=1+2", canInsertCellRef: () => false }),
    );
    expect(r.kind).toBe("passthrough");
  });

  test("first arrow at an insertable position inserts the navigated cell", () => {
    const s = createFormulaEditState();
    let edited = "";
    const r = handleFormulaArrowKey(
      s,
      evt("ArrowDown"),
      ctxFrom({
        cellId: "B2",
        editValue: "=",
        input: { selectionStart: 1 } as HTMLInputElement,
        setEditValue: (v) => {
          edited = v;
        },
      }),
    );
    expect(r.kind).toBe("handled");
    if (r.kind === "handled") {
      // ``B3`` inserted at offset 1, caret lands after the ref.
      expect(r.caret).toBe(3);
      expect(r.refreshSignatureHelp).toBe(true);
    }
    expect(edited).toBe("=B3");
    expect(get(s.pointingRef)).toEqual({ start: 1, end: 3, cellId: "B3" });
  });

  test("second arrow extends from the previous pointing ref, not from the caret", () => {
    const s = createFormulaEditState();
    s.setPointing({ start: 1, end: 3, cellId: "B3" });
    let edited = "";
    const r = handleFormulaArrowKey(
      s,
      evt("ArrowDown"),
      // Even with canInsertCellRef returning false, the existing
      // pointing ref makes ``allowRef`` true.
      ctxFrom({
        cellId: "B2",
        editValue: "=B3",
        input: { selectionStart: 3 } as HTMLInputElement,
        // navigate is called from ``B3`` (the pointing ref), so emit
        // ``B4`` rather than from B2 → B3.
        navigate: (from, dir) => {
          expect(from).toBe("B3");
          expect(dir).toBe("down");
          return "B4";
        },
        canInsertCellRef: () => false,
        setEditValue: (v) => {
          edited = v;
        },
      }),
    );
    expect(r.kind).toBe("handled");
    expect(edited).toBe("=B4");
    expect(get(s.pointingRef)).toEqual({ start: 1, end: 3, cellId: "B4" });
  });
});
