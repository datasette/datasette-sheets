import { beforeEach, expect, test, describe } from "vitest";
import { get } from "svelte/store";
import {
  buildClipboardPayload,
  applyClipboardGrid,
  applyPastedFormat,
} from "../sheetClipboard";
import { parseClipboardData } from "../../clipboard";
import {
  cells,
  selectedCell,
  selectedCells,
  editingCell,
} from "../../stores/spreadsheet";
import { debugMode } from "../../stores/debug";
import { clearClipboardMark } from "../../stores/clipboard";
import { dropdownRules } from "../../stores/dropdownRules";
import type { CellId, DropdownRule } from "../../spreadsheet/types";

// [page-toolbar-01] Coverage for the document-level clipboard
// pipeline. ``buildClipboardPayload`` is the most testable target —
// nothing previously asserted that the html serialization actually
// round-trips bold / formulas / dropdowns through the page handler;
// this file fills that gap.

// [TESTS-10] cells/selectedCell/selectionAnchor/selectedCells reset
// runs globally via ``src/test-setup.ts``; the rest of these are
// spec-local stores not covered by the global setup.
beforeEach(() => {
  editingCell.set(null);
  debugMode.set(false);
  clearClipboardMark();
  dropdownRules.set([]);
});

describe("buildClipboardPayload — selection guards", () => {
  test("returns null when nothing is selected", () => {
    expect(buildClipboardPayload()).toBeNull();
  });

  test("returns null while editing a cell", () => {
    cells.setCellValue("A1", "hi");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));
    editingCell.set("A1");
    expect(buildClipboardPayload()).toBeNull();
  });
});

describe("buildClipboardPayload — payload shape", () => {
  test("emits a 1x1 html table with the value", () => {
    cells.setCellValue("A1", "hello");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload();
    expect(payload).not.toBeNull();
    expect(payload!.text).toBe("hello");
    expect(payload!.html).toContain("<table");
    expect(payload!.html).toContain("hello");
  });

  test("emits bold styling on bold cells", () => {
    cells.setCellValue("A1", "hi");
    cells.setCellFormat("A1", { bold: true });
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload();
    // buildCopyPayload uses <th> for bold cells (so external apps
    // that only honour tags pick it up) AND emits an inline
    // ``font-weight:bold`` for apps that only honour CSS.
    expect(payload!.html).toMatch(/<(th|td)[^>]*font-weight:bold/);
  });

  test("emits the formula via data-sheets-formula on formula cells", () => {
    cells.setCellValue("A1", "=2+3");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload();
    expect(payload!.html).toContain('data-sheets-formula="=2+3"');
    // Visible text is the computed value, not the formula.
    expect(payload!.text).toBe("5");
  });

  test("emits centered TRUE/FALSE for boolean cells", () => {
    cells.setCellValue("A1", "TRUE");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload();
    // formatValue uppercases booleans in the visible text path.
    expect(payload!.text).toBe("TRUE");
  });

  test("emits dropdown control attrs for dropdown cells", () => {
    cells.setCellValue("A1", "Doing");
    cells.setCellFormat("A1", {
      controlType: "dropdown",
      dropdownRuleId: "rule-1",
    });
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload();
    expect(payload!.html).toContain('data-sheets-control-type="dropdown"');
    expect(payload!.html).toContain('data-sheets-dropdown-rule-id="rule-1"');
  });

  test("currency formatting flows through to plain text", () => {
    cells.setCellValue("A1", "1234.5");
    cells.setCellFormat("A1", { type: "currency" });
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload();
    // Default currency format displays with a $ prefix.
    expect(payload!.text).toContain("$");
    expect(payload!.text).toContain("1,234.50");
  });

  test("debug mode prefixes plain text with the range identity", () => {
    cells.setCellValue("A1", "x");
    cells.setCellValue("B1", "y");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1", "B1"] as CellId[]));
    debugMode.set(true);

    const payload = buildClipboardPayload();
    expect(payload!.text.startsWith("# datasette-sheets:")).toBe(true);
    expect(payload!.text).toContain("A1:B1");
    // HTML payload stays clean — no debug comment in the table.
    expect(payload!.html).not.toContain("datasette-sheets:");
  });

  test("multi-cell rectangular selection emits a 2x2 table with TSV plain", () => {
    cells.setCellValue("A1", "a");
    cells.setCellValue("B1", "b");
    cells.setCellValue("A2", "c");
    cells.setCellValue("B2", "d");
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1", "B1", "A2", "B2"] as CellId[]));

    const payload = buildClipboardPayload();
    expect(payload!.text).toBe("a\tb\nc\td");
    // 2 rows = 2 <tr>s in the html table.
    expect(payload!.html.match(/<tr/g)?.length).toBe(2);
  });

  test("round-trips bold + dropdown back through parseClipboardData", () => {
    cells.setCellValue("A1", "Doing");
    cells.setCellFormat("A1", {
      bold: true,
      controlType: "dropdown",
      dropdownRuleId: "rule-xyz",
    });
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));

    const payload = buildClipboardPayload()!;
    const dt = new DataTransfer();
    dt.setData("text/html", payload.html);
    const { grid } = parseClipboardData(dt);
    expect(grid[0][0]).toMatchObject({
      value: "Doing",
      bold: true,
      controlType: "dropdown",
      dropdownRuleId: "rule-xyz",
    });
  });
});

describe("applyPastedFormat", () => {
  test("merges only truthy attrs onto the target", () => {
    cells.setCellValue("A1", "x");
    cells.setCellFormat("A1", { italic: true });

    applyPastedFormat("A1", {
      value: "x",
      bold: true,
      italic: undefined,
      textColor: "#ff0000",
    });

    const cell = get(cells).get("A1");
    // bold gets added, italic is preserved (the undefined source
    // doesn't clobber the existing flag).
    expect(cell?.format.bold).toBe(true);
    expect(cell?.format.italic).toBe(true);
    expect(cell?.format.textColor).toBe("#ff0000");
  });

  test("ignores fontSize when not finite", () => {
    cells.setCellValue("A1", "x");
    applyPastedFormat("A1", { value: "x", fontSize: NaN });
    const cell = get(cells).get("A1");
    expect(cell?.format.fontSize).toBeUndefined();
  });

  // [tests-12] [sheet.data.dropdown]
  test("dropdown controlType + known rule id writes both fields", () => {
    const rule: DropdownRule = {
      id: "rule-known",
      name: "Status",
      multi: false,
      source: { kind: "list", options: [{ value: "Todo", color: "#ccc" }] },
    };
    dropdownRules.set([rule]);
    cells.setCellValue("A1", "Todo");

    applyPastedFormat("A1", {
      value: "Todo",
      controlType: "dropdown",
      dropdownRuleId: "rule-known",
    });

    const cell = get(cells).get("A1");
    expect(cell?.format.controlType).toBe("dropdown");
    expect(cell?.format.dropdownRuleId).toBe("rule-known");
  });

  // [tests-12] [sheet.data.dropdown]
  test("dropdown controlType + unknown rule id drops the controlType so the cell renders as plain text", () => {
    // No rules registered — the pasted dropdownRuleId is dangling.
    dropdownRules.set([]);
    cells.setCellValue("A1", "Todo");

    applyPastedFormat("A1", {
      value: "Todo",
      bold: true, // benign attr that should still apply
      controlType: "dropdown",
      dropdownRuleId: "rule-missing",
    });

    const cell = get(cells).get("A1");
    // controlType + dropdownRuleId are dropped; bold still flows.
    expect(cell?.format.controlType).toBeUndefined();
    expect(cell?.format.dropdownRuleId).toBeUndefined();
    expect(cell?.format.bold).toBe(true);
  });
});

// [tests-12] applyClipboardGrid + sourceAnchor — the full paste-side
// wiring that shiftFormulaRefs (covered in pure form by
// formulaShift.test.ts) plugs into. These tests assert the formula
// lands on the destination cell with refs adjusted for the move.
// [sheet.clipboard.paste-formula-shift]
describe("applyClipboardGrid — formula shift via sourceAnchor", () => {
  test("pastes a formula one row down and shifts relative refs by +1 row", () => {
    selectedCell.set("A2");
    selectedCells.set(new Set(["A2" as CellId]));

    applyClipboardGrid({
      grid: [[{ value: "5", formula: "=A1+1" }]],
      sourceAnchor: "A1" as CellId,
    });

    // Source was A1, destination is A2, so the relative `A1` shifts
    // to `A2` in the pasted formula.
    expect(get(cells).get("A2")?.rawValue).toBe("=A2+1");
  });

  test("pastes a 1x2 formula row across columns and shifts refs by +1 col", () => {
    selectedCell.set("B5");
    selectedCells.set(new Set(["B5" as CellId]));

    applyClipboardGrid({
      grid: [
        [
          { value: "v1", formula: "=A1" },
          { value: "v2", formula: "=B1+B2" },
        ],
      ],
      sourceAnchor: "A1" as CellId,
    });

    // Anchor moved from A1 → B5: dCol=+1, dRow=+4.
    expect(get(cells).get("B5")?.rawValue).toBe("=B5");
    expect(get(cells).get("C5")?.rawValue).toBe("=C5+C6");
  });

  test("single-source-fill across multi-cell selection re-shifts the formula per target", () => {
    // Sourced from A1, filling A2 + A3. Each target gets its own
    // shifted formula relative to the source anchor. Reference an
    // on-grid cell (B9) — A..O is the full column set, so anything
    // past O would shift to #REF! and not exercise the per-target
    // dRow re-shift this test is about.
    selectedCell.set("A2");
    selectedCells.set(new Set(["A2", "A3"] as CellId[]));

    applyClipboardGrid({
      grid: [[{ value: "1", formula: "=B9" }]],
      sourceAnchor: "A1" as CellId,
    });

    expect(get(cells).get("A2")?.rawValue).toBe("=B10");
    expect(get(cells).get("A3")?.rawValue).toBe("=B11");
  });
});

describe("applyClipboardGrid — basic flows", () => {
  test("pastes a 1x1 grid at the active cell", () => {
    selectedCell.set("B2");
    selectedCells.set(new Set(["B2" as CellId]));

    applyClipboardGrid({
      grid: [[{ value: "hello" }]],
      sourceAnchor: undefined,
    });

    expect(get(cells).get("B2")?.rawValue).toBe("hello");
  });

  test("with a single-source-fill spreads across multi-cell selection", () => {
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1", "A2", "A3"] as CellId[]));

    applyClipboardGrid({
      grid: [[{ value: "x" }]],
      sourceAnchor: undefined,
    });

    expect(get(cells).get("A1")?.rawValue).toBe("x");
    expect(get(cells).get("A2")?.rawValue).toBe("x");
    expect(get(cells).get("A3")?.rawValue).toBe("x");
  });

  test("no-ops with empty grid", () => {
    selectedCell.set("A1");
    selectedCells.set(new Set(["A1" as CellId]));
    applyClipboardGrid({ grid: [], sourceAnchor: undefined });
    expect(get(cells).get("A1")).toBeUndefined();
  });

  test("no-ops without an active cell", () => {
    applyClipboardGrid({
      grid: [[{ value: "x" }]],
      sourceAnchor: undefined,
    });
    expect(get(cells).get("A1")).toBeUndefined();
  });
});

// [sheet.clipboard.paste-as-values] Cmd/Ctrl+Shift+V: drops the
// formula marker, the source-anchor formula shift, and the format
// application. Mirrors the formula-shift block above so the
// expected vs. actual contrast is visible side-by-side.
describe("applyClipboardGrid — valuesOnly", () => {
  test("drops the formula marker and pastes the displayed value as-is", () => {
    selectedCell.set("A2");
    selectedCells.set(new Set(["A2" as CellId]));

    applyClipboardGrid(
      {
        grid: [[{ value: "mundaecoffee", formula: "=URL_PATH_SEGMENT(F2,1)" }]],
        sourceAnchor: "G2" as CellId,
      },
      { valuesOnly: true },
    );

    // Without valuesOnly this would be an =URL_PATH_SEGMENT(...)
    // formula shifted to the new anchor; with it, the displayed
    // text wins.
    expect(get(cells).get("A2")?.rawValue).toBe("mundaecoffee");
  });

  test("does not apply pasted format attrs", () => {
    selectedCell.set("B2");
    selectedCells.set(new Set(["B2" as CellId]));

    applyClipboardGrid(
      {
        grid: [
          [
            {
              value: "hi",
              bold: true,
              italic: true,
              textColor: "#ff0000",
              fillColor: "#00ff00",
            },
          ],
        ],
        sourceAnchor: undefined,
      },
      { valuesOnly: true },
    );

    const cell = get(cells).get("B2");
    expect(cell?.rawValue).toBe("hi");
    expect(cell?.format.bold).toBeUndefined();
    expect(cell?.format.italic).toBeUndefined();
    expect(cell?.format.textColor).toBeUndefined();
    expect(cell?.format.fillColor).toBeUndefined();
  });

  test("single-source-fill across selection drops formula per target", () => {
    selectedCell.set("A2");
    selectedCells.set(new Set(["A2", "A3"] as CellId[]));

    applyClipboardGrid(
      {
        grid: [[{ value: "1", formula: "=B9" }]],
        sourceAnchor: "A1" as CellId,
      },
      { valuesOnly: true },
    );

    // Compare with the equivalent test in the formula-shift block:
    // there A2 → "=B10", A3 → "=B11". With valuesOnly both land as
    // the literal source value.
    expect(get(cells).get("A2")?.rawValue).toBe("1");
    expect(get(cells).get("A3")?.rawValue).toBe("1");
  });
});
