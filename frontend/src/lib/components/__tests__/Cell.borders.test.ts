import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import { sheetViews } from "../../stores/views";
import type { CellId } from "../../spreadsheet/types";
import type { SheetViewMeta } from "../../api";

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  sheetViews.set([]);
});

function cellDiv(cellId: CellId): HTMLElement {
  return page.getByTestId(cellId).element() as HTMLElement;
}

// User borders ride on the ``--cell-border-<side>`` custom properties
// so the ``view-edge-*`` / ``clipboard-edge-*`` classes can still
// override them via the cascade. The custom property is what we set
// from JS; a CSS rule on ``.cell`` resolves it into ``border-<side>``.

// [sheet.format.borders]
test("borders.bottom emits --cell-border-bottom custom property", () => {
  cells.setCellValue("A1", "x");
  cells.setCellFormat("A1", {
    borders: { bottom: { style: "solid", color: "#ff0000" } },
  });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const s = cellDiv("A1").style;
  expect(s.getPropertyValue("--cell-border-bottom").trim()).toBe(
    "1.5px solid #ff0000",
  );
});

test("all-four-edges border preset emits a custom property per side", () => {
  cells.setCellValue("A1", "x");
  const edge = { style: "dashed" as const, color: "#0000ff" };
  cells.setCellFormat("A1", {
    borders: { top: edge, right: edge, bottom: edge, left: edge },
  });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const s = cellDiv("A1").style;
  expect(s.getPropertyValue("--cell-border-top").trim()).toBe(
    "1.5px dashed #0000ff",
  );
  expect(s.getPropertyValue("--cell-border-right").trim()).toBe(
    "1.5px dashed #0000ff",
  );
  expect(s.getPropertyValue("--cell-border-bottom").trim()).toBe(
    "1.5px dashed #0000ff",
  );
  expect(s.getPropertyValue("--cell-border-left").trim()).toBe(
    "1.5px dashed #0000ff",
  );
});

test("borders unset leaves the default grid lines alone", () => {
  cells.setCellValue("A1", "x");
  render(Cell, { props: { cellId: "A1" as CellId } });
  const s = cellDiv("A1").style;
  expect(s.getPropertyValue("--cell-border-top")).toBe("");
  expect(s.getPropertyValue("--cell-border-bottom")).toBe("");
});

// CELL-GRID-07: a user border on a side that's already a view edge
// would, before the fix, paint over the dashed view edge because
// inline ``border-top:`` beats the ``.view-edge-top`` class. We now
// skip emission on those sides so the view edge stays visible.
test("user top-border on a view top-edge defers to the view edge", () => {
  const view: SheetViewMeta = {
    id: 1,
    view_name: "test",
    range_str: "A1:B2",
    min_row: 0,
    min_col: 0,
    max_row: 1,
    max_col: 1,
    use_headers: false,
    color: "#6366f1",
    enable_insert: false,
    enable_update: false,
    enable_delete: false,
    delete_mode: "soft",
  };
  sheetViews.set([view]);

  cells.setCellValue("A1", "x");
  cells.setCellFormat("A1", {
    borders: {
      top: { style: "solid", color: "#ff0000" },
      // Right side is NOT a view edge for A1 (B1 is on the right
      // edge), so it should still emit.
      right: { style: "solid", color: "#ff0000" },
    },
  });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const s = cellDiv("A1").style;
  // Top is suppressed — the .view-edge-top class can do its job.
  expect(s.getPropertyValue("--cell-border-top")).toBe("");
  // Right was not a view edge — still emitted.
  expect(s.getPropertyValue("--cell-border-right").trim()).toBe(
    "1.5px solid #ff0000",
  );
  // The view edge class is still on the cell.
  expect(cellDiv("A1").classList.contains("view-edge-top")).toBe(true);
});
