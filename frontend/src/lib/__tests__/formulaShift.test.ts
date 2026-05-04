import { describe, expect, test } from "vitest";
import { shiftFormulaRefs, loadIntoEngine } from "../engine";
import { buildCopyPayload, parseClipboardData } from "../clipboard";

const MAX_ROW = 100;
const MAX_COL = 15; // A..O

// [sheet.clipboard.paste-formula-shift]
describe("shiftFormulaRefs", () => {
  test("relative refs shift by (dRow, dCol)", () => {
    expect(shiftFormulaRefs("=A2*B1*4", 1, 0, MAX_ROW, MAX_COL)).toBe(
      "=A3*B2*4",
    );
    expect(shiftFormulaRefs("=A2*B1*4", 0, 1, MAX_ROW, MAX_COL)).toBe(
      "=B2*C1*4",
    );
  });

  test("absolute refs stay put", () => {
    expect(shiftFormulaRefs("=$A$1*B1", 5, 5, MAX_ROW, MAX_COL)).toBe(
      "=$A$1*G6",
    );
  });

  test("mixed-absolute shifts only the relative axis", () => {
    expect(shiftFormulaRefs("=$A2*A$1", 1, 1, MAX_ROW, MAX_COL)).toBe(
      "=$A3*B$1",
    );
  });

  test("off-grid refs become #REF!", () => {
    const out = shiftFormulaRefs("=A1*2", -1, 0, MAX_ROW, MAX_COL);
    expect(out).toContain("#REF!");
  });

  test("non-formula input passes through unchanged", () => {
    expect(shiftFormulaRefs("123", 1, 0, MAX_ROW, MAX_COL)).toBe("123");
    expect(shiftFormulaRefs("hello", 1, 0, MAX_ROW, MAX_COL)).toBe("hello");
    expect(shiftFormulaRefs("", 1, 0, MAX_ROW, MAX_COL)).toBe("");
  });

  test("zero delta is a no-op", () => {
    expect(shiftFormulaRefs("=A1+B2", 0, 0, MAX_ROW, MAX_COL)).toBe("=A1+B2");
  });

  test("end-to-end: shift result evaluates to the expected number", () => {
    // A2=10, B1=3, B3=4, C1=5. `=$A2*B$1*4` at B2 evaluates to
    // 10 * 3 * 4 = 120. Shift by (1, 1) → `=$A3*C$1*4` at C3 =
    // (A3=0) * C1=5 * 4 = 0. Shift by (0, 1) keeps the col-absolute
    // `$A2` pinned and moves `B$1` → `C$1` = 5 * 10 * 4 = 200.
    const shifted = shiftFormulaRefs("=$A2*B$1*4", 0, 1, MAX_ROW, MAX_COL);
    expect(shifted).toBe("=$A2*C$1*4");
    const values = loadIntoEngine([
      ["A2", { kind: "raw", value: "10" }],
      ["B1", { kind: "raw", value: "3" }],
      ["C1", { kind: "raw", value: "5" }],
      ["C2", { kind: "raw", value: shifted }],
    ]);
    // 10 * 5 * 4 = 200. ``loadIntoEngine`` returns native JS values now —
    // numbers stay numbers, no string round-trip.
    expect(values.get("C2")).toBe(200);
  });
});

describe("clipboard formula round-trip", () => {
  test("buildCopyPayload emits source-anchor + per-cell formula attrs", () => {
    const { html } = buildCopyPayload(
      [[{ value: "8", formula: "=A2*B1*4" }]],
      "B2",
    );
    expect(html).toContain('data-sheets-source-anchor="B2"');
    expect(html).toContain('data-sheets-formula="=A2*B1*4"');
    // Visible cell value is still the computed value.
    expect(html).toContain(">8<");
  });

  test("parseClipboardData round-trips anchor + formula", () => {
    const { html, text } = buildCopyPayload(
      [
        [
          { value: "1", formula: "=A1" },
          { value: "8", formula: "=A2*B1*4" },
        ],
      ],
      "B2",
    );
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    dt.setData("text/plain", text);

    const parsed = parseClipboardData(dt);
    expect(parsed.sourceAnchor).toBe("B2");
    expect(parsed.grid[0][0].formula).toBe("=A1");
    expect(parsed.grid[0][1].formula).toBe("=A2*B1*4");
    // Plain values still come through.
    expect(parsed.grid[0][0].value).toBe("1");
  });

  test("buildCopyPayload without sourceAnchor omits the marker", () => {
    const { html } = buildCopyPayload([[{ value: "x" }]]);
    expect(html).not.toContain("data-sheets-source-anchor");
    expect(html).not.toContain("data-sheets-formula");
  });

  test("parseClipboardData returns no sourceAnchor for plain-text-only paste", () => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "1\t2\n3\t4");
    const parsed = parseClipboardData(dt);
    expect(parsed.sourceAnchor).toBeUndefined();
    expect(parsed.grid[0][0].formula).toBeUndefined();
  });

  test("html escaping survives in the formula round-trip", () => {
    // Formulas with < / > / & should round-trip via attribute encoding.
    const formula = '=IF(A1<5, "yes", "no")';
    const { html } = buildCopyPayload([[{ value: "yes", formula }]], "A1");
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    const parsed = parseClipboardData(dt);
    expect(parsed.grid[0][0].formula).toBe(formula);
  });
});
