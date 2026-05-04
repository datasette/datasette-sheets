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
import { dropdownRules, dropdownPopoverFor } from "../../stores/dropdownRules";
import { createDefaultFormat } from "../../spreadsheet/formatter";
import type { CellData, CellId, DropdownRule } from "../../spreadsheet/types";

// [tests-09] Format-attribute combinations — the cases users
// actually hit that the per-attribute Cell.<attr>.test.ts files miss.
//
// Each per-attribute test asserts a single class or inline style in
// isolation. This file pins the *combinations*: the cascade outcome
// when multiple format attributes interact, and the precedence
// between them and orthogonal cell states (errored, dropdown chip,
// checkbox glyph).
//
// We use ``getComputedStyle`` sparingly — it's slower than class
// assertions and only earns its keep on the cases where the failure
// mode is "the class is present but the style cascade doesn't agree"
// (e.g. the document-order-dependent ``.h-*`` over ``.numeric``).

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  dropdownRules.set([]);
  dropdownPopoverFor.set(null);
});

function valueSpan(cellId: CellId): HTMLElement {
  const el = page
    .getByTestId(cellId)
    .element()
    .querySelector<HTMLElement>(".cell-value");
  if (!el) throw new Error(`No .cell-value inside cell ${cellId}`);
  return el;
}

function cellDiv(cellId: CellId): HTMLElement {
  return page.getByTestId(cellId).element() as HTMLElement;
}

// --- 1. Every text-styling flag together -------------------------------

test("bold + italic + underline + strikethrough all render simultaneously", () => {
  cells.setCellValue("A1", "loud");
  cells.setCellFormat("A1", {
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1");
  // Every flag lives on the same span — none of them should clobber
  // any other.
  expect(span.classList.contains("bold")).toBe(true);
  expect(span.classList.contains("italic")).toBe(true);
  expect(span.classList.contains("underline")).toBe(true);
  expect(span.classList.contains("strikethrough")).toBe(true);
});

// --- 2. fillColor + borders + textColor compose ------------------------

test("textColor + fillColor + borders.top all land on the same cell", () => {
  cells.setCellValue("A1", "rich");
  cells.setCellFormat("A1", {
    textColor: "#ff0000",
    fillColor: "#fef08a",
    borders: { top: { style: "solid", color: "#0000ff" } },
  });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const span = valueSpan("A1");
  // textColor → inline color on the span.
  expect(span.style.color).toBe("rgb(255, 0, 0)");

  const cell = cellDiv("A1");
  // fillColor → --cell-fill custom property (resolved into background
  // by the stylesheet).
  expect(cell.style.getPropertyValue("--cell-fill").trim()).toBe("#fef08a");
  // borders → per-side custom property.
  expect(cell.style.getPropertyValue("--cell-border-top").trim()).toBe(
    "1.5px solid #0000ff",
  );
});

// --- 3. wrap + vAlign --------------------------------------------------

test("wrap=wrap + vAlign=middle: both classes set, white-space normal applied", () => {
  cells.setCellValue("A1", "wrapping centred");
  cells.setCellFormat("A1", { wrap: "wrap", vAlign: "middle" });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const cell = cellDiv("A1");
  expect(cell.classList.contains("wrap-wrap")).toBe(true);
  expect(cell.classList.contains("v-middle")).toBe(true);

  const span = valueSpan("A1");
  // wrap=wrap unlocks white-space:normal — without it the cell
  // collapses on long text.
  expect(getComputedStyle(span).whiteSpace).toBe("normal");
});

// --- 4. fontSize + bold ------------------------------------------------

test("fontSize=24 + bold: inline font-size in pt, bold class on the span", () => {
  cells.setCellValue("A1", "BIG");
  cells.setCellFormat("A1", { fontSize: 24, bold: true });
  render(Cell, { props: { cellId: "A1" as CellId } });

  const span = valueSpan("A1");
  expect(span.classList.contains("bold")).toBe(true);
  // Inline style is the source of truth for fontSize — the bold
  // class must not strip it.
  expect(span.style.fontSize).toBe("24pt");
  // Computed font-size resolves the inline 24pt → 32px (96dpi/72).
  expect(getComputedStyle(span).fontSize).toBe("32px");
});

// --- 5. currency on a boolean — type signal wins -----------------------

test("format.type=currency on a boolean computedValue: TRUE rendered, no $-mask", () => {
  // [sheet.cell.boolean] formatter short-circuits booleans BEFORE the
  // number-format dispatch, so applying ``currency`` to a boolean must
  // not produce ``$1.00``. The unit-level case is covered in
  // formatter.test.ts; this pins the live render.
  const data: CellData = {
    rawValue: "",
    computedValue: true,
    formula: null,
    format: { ...createDefaultFormat(), type: "currency" },
    error: null,
  };
  cells.set(new Map([["A1" as CellId, data]]));
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1");
  expect(span.textContent).toBe("TRUE");
  expect(span.classList.contains("boolean")).toBe(true);
  // ``currency`` was on the format but the boolean short-circuit ran
  // first — so the .numeric class is NOT applied (no number to align).
  expect(span.classList.contains("numeric")).toBe(false);
});

test("format.type=currency on a string computedValue: string rendered verbatim", () => {
  // String values short-circuit before the number-format switch as
  // well — currency must not lie about a string.
  cells.setCellValue("A1", "not a number");
  cells.setCellFormat("A1", { type: "currency" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const span = valueSpan("A1");
  expect(span.textContent).toBe("not a number");
});

// --- 6. controlType=checkbox + format.type=currency: glyph wins -------

test("controlType=checkbox + currency: checkbox glyph renders, currency text does not", () => {
  cells.setCellValue("A1", "TRUE");
  cells.setCellFormat("A1", { controlType: "checkbox", type: "currency" });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const cell = cellDiv("A1");
  // Checkbox glyph short-circuits the value-text branch entirely.
  expect(cell.querySelector(".cell-checkbox")).toBeTruthy();
  expect(cell.querySelector(".cell-value")).toBeNull();
});

// --- 7. controlType=dropdown + bold: chip retains bold flag -----------

test("controlType=dropdown + bold: chip renders, bold class follows the cell-value branch", () => {
  // Note: the bold class lives on the .cell-value span. When the
  // dropdown chip branch renders, the .cell-value span is NOT
  // emitted — but the cell's format still tracks bold so a future
  // chip-uses-bold rule has the data. Pin current behavior so a
  // change to either side is intentional.
  const rule: DropdownRule = {
    id: 1,
    name: "Status",
    multi: false,
    source: {
      kind: "list",
      options: [{ value: "Doing", color: "#fff2cc" }],
    },
  };
  dropdownRules.set([rule]);
  cells.setCellValue("A1", "Doing");
  cells.setCellFormat("A1", {
    controlType: "dropdown",
    dropdownRuleId: 1,
    bold: true,
  });
  render(Cell, { props: { cellId: "A1" as CellId } });
  const cell = cellDiv("A1");
  expect(cell.querySelector(".cell-dropdown")).toBeTruthy();
  // No .cell-value, so no .bold span — that's the v1 contract.
  expect(cell.querySelector(".cell-value")).toBeNull();
  // The format itself still carries bold for a future styled-chip
  // implementation.
  expect(cells.getCell("A1" as CellId)?.format.bold).toBe(true);
});

// --- 8. errored cell + bold: the .error class doesn't clobber bold ----

test("errored cell + bold: error text rendered with both .error and .bold", () => {
  // Seed an errored cell directly — same shape the recalc path uses.
  // Cell.svelte's displayValue picks ``cell.error`` over the
  // computedValue when error is non-null, so the rendered text is the
  // error string itself.
  const data: CellData = {
    rawValue: "=DELETED!",
    computedValue: "#REF!",
    formula: "=DELETED!",
    format: { ...createDefaultFormat(), bold: true },
    error: "#REF!",
  };
  cells.set(new Map([["A1" as CellId, data]]));
  render(Cell, { props: { cellId: "A1" as CellId } });

  const cell = cellDiv("A1");
  const span = valueSpan("A1");
  // Error class lives on the cell container; bold lives on the span.
  // The .error class must NOT strip .bold off the span.
  expect(cell.classList.contains("error")).toBe(true);
  expect(span.classList.contains("bold")).toBe(true);
  expect(span.textContent).toBe("#REF!");
});
