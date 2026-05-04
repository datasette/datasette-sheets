import { beforeEach, expect, test } from "vitest";
import { cells, navigate } from "../spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// These tests document the Google-Sheets ``Ctrl+Arrow`` semantics:
//   - non-empty → next-non-empty   : jump to the end of the run
//   - non-empty → next-empty       : jump past the gap to the next
//                                    non-empty, or the edge
//   - empty                        : jump past blanks to the next
//                                    non-empty, or the edge
// All tests seed the store directly and call ``navigate`` with
// ``meta=true`` to exercise the Cmd+Arrow path.

beforeEach(() => cells.clear());

function seed(entries: Record<string, string>) {
  for (const [id, val] of Object.entries(entries)) {
    cells.setCellValue(id as CellId, val);
  }
}

// Last grid row exposed by the UI. ROWS is 1..100.
const LAST_ROW = 100;
const LAST_COL_LETTER = "O"; // COLUMNS ends at "O" (index 14)

test("Cmd+Down jumps to the last cell in a contiguous run", () => {
  seed({ A1: "a", A2: "b", A3: "c" });
  expect(navigate("A1", "down", true)).toBe("A3");
});

test("Cmd+Down on non-empty when next cell is empty jumps over the gap", () => {
  seed({ A1: "a", A5: "b", A6: "c" });
  expect(navigate("A1", "down", true)).toBe("A5");
});

test("Cmd+Down from an empty cell walks to the first non-empty", () => {
  seed({ A5: "data" });
  expect(navigate("A1", "down", true)).toBe("A5");
});

test("Cmd+Down with nothing below goes to the last row", () => {
  seed({ A1: "only" });
  expect(navigate("A1", "down", true)).toBe(`A${LAST_ROW}` as CellId);
});

test("Cmd+Up walks to the top of a contiguous run", () => {
  seed({ A4: "a", A5: "b", A6: "c" });
  expect(navigate("A6", "up", true)).toBe("A4");
});

test("Cmd+Right jumps to the end of a row run", () => {
  seed({ A1: "a", B1: "b", C1: "c" });
  expect(navigate("A1", "right", true)).toBe("C1");
});

test("Cmd+Right from an empty cell jumps over blanks", () => {
  seed({ D1: "hit" });
  expect(navigate("A1", "right", true)).toBe("D1");
});

test("Cmd+Right with no data falls back to the last column", () => {
  expect(navigate("A1", "right", true)).toBe(`${LAST_COL_LETTER}1` as CellId);
});

test("Cmd+Left walks to the start of a run", () => {
  seed({ B1: "a", C1: "b", D1: "c" });
  expect(navigate("D1", "left", true)).toBe("B1");
});

// Regression for the Enter-commit code path in Cell.svelte: the inline
// regex implementation silently did nothing past the last row, but
// ``navigate(...)`` is what the commit handler funnels through now —
// it returns the same cell when there's nowhere to step. The Enter
// branch checks ``targetId !== cellId`` before moving focus, so this
// "no-op when at the last row" contract is what keeps the focus on
// the active cell after Enter at the bottom of the grid.
test("Enter on the last row stays put (down returns same cell)", () => {
  expect(navigate(`A${LAST_ROW}` as CellId, "down", false)).toBe(
    `A${LAST_ROW}` as CellId,
  );
});

// Same shape for Tab on the last column — exercised by Cell.svelte's
// Tab-commit branch.
test("Tab on the last column stays put (right returns same cell)", () => {
  expect(navigate(`${LAST_COL_LETTER}1` as CellId, "right", false)).toBe(
    `${LAST_COL_LETTER}1` as CellId,
  );
});
