import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import { cells } from "../spreadsheet";
import { createDefaultFormat } from "../../spreadsheet/formatter";

beforeEach(() => {
  cells.clear();
});

test("resetCellFormat drops every non-default attribute", () => {
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", {
    bold: true,
    italic: true,
    underline: true,
    textColor: "#ff0000",
    fillColor: "#ffff00",
    hAlign: "center",
  });

  // Sanity: attributes are actually set.
  expect(get(cells).get("A1")?.format.bold).toBe(true);
  expect(get(cells).get("A1")?.format.textColor).toBe("#ff0000");

  cells.resetCellFormat("A1");

  const reset = get(cells).get("A1")!;
  expect(reset.format).toEqual(createDefaultFormat());
  // Regression check: the value itself is untouched.
  expect(reset.rawValue).toBe("hi");
});

test("resetCellFormat on an unknown cell is a no-op", () => {
  cells.setCellValue("A1", "hi");
  cells.resetCellFormat("B2");
  // B2 stays absent; A1 stays intact.
  expect(get(cells).has("B2")).toBe(false);
  expect(get(cells).get("A1")?.rawValue).toBe("hi");
});

// [STORES-09] The ``resetCellFormat`` doc-comment exists because the
// SSE path needs *replace* semantics for ``format_json: null`` — a
// remote unbold has to actually drop ``bold: true``, but the default
// format omits the key entirely, so a merge ({...defaults,
// ...current}) leaves the stale flag in place. Lock that contract
// down by demonstrating the divergence on the same starting cell.
test("resetCellFormat replaces; setCellFormat with the default would merge", () => {
  // Start with a cell carrying an explicit ``bold: true``.
  cells.setCellValue("A1", "hi");
  cells.setCellFormat("A1", { bold: true });
  expect(get(cells).get("A1")!.format.bold).toBe(true);

  // The SSE path that received ``format_json: null`` calls
  // ``resetCellFormat`` — bold is gone.
  cells.resetCellFormat("A1");
  expect(get(cells).get("A1")!.format.bold).toBeUndefined();

  // Re-arm bold, then demonstrate that the *merge* path
  // (``setCellFormat`` with the default object) does NOT clear
  // existing flags — that's the bug the SSE-side switch to
  // ``resetCellFormat`` was added to fix.
  cells.setCellFormat("A1", { bold: true });
  cells.setCellFormat("A1", createDefaultFormat());
  expect(get(cells).get("A1")!.format.bold).toBe(true);
});
