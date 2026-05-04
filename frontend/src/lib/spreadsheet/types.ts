// Cell types

/** Engine-emitted Custom variant — a typed cell whose interpretation
 *  is owned by a registered handler (jdate / jtime / jdatetime /
 *  jzoned / jspan via lotus-datetime, plus host-registered handlers).
 *  ``data`` is the handler's canonical serialised form (ISO 8601 for
 *  the j* family). [sheet.cell.custom] */
export interface CustomCellValue {
  type_tag: string;
  data: string;
}
export type CellValue = string | number | boolean | null | CustomCellValue;

export interface CellData {
  rawValue: string; // What the user typed
  computedValue: CellValue; // The calculated result
  formula: string | null; // The formula (if starts with =)
  format: CellFormat;
  error: string | null;
  // Per-cell typed override — bypasses engine auto-classification on
  // every recalc until cleared by a raw write. Today only ``"string"``
  // is produced (via the leading-' force-text UX); future affordances
  // (column-type hints, custom-type widgets) will plug into the same
  // field. Absent/undefined → engine auto-classifies on every recalc,
  // matching the legacy behaviour. [sheet.cell.force-text]
  typedKind?: "string";
  // Spill / array-formula classification, populated during recalc.
  //   ``isSpillAnchor``: this cell's formula produced a >1x1 array —
  //     its value is the top-left of a region that overflows into
  //     surrounding cells.
  //   ``isSpillMember``: this cell was filled by another cell's spill
  //     — user didn't author the value, and editing it would block
  //     the originating anchor with ``#SPILL!``.
  isSpillAnchor?: boolean;
  isSpillMember?: boolean;
}

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type WrapMode = "overflow" | "wrap" | "clip";
export type BorderStyle = "solid" | "dashed" | "dotted";

export interface BorderEdge {
  style: BorderStyle;
  color: string;
}

export interface CellBorders {
  top?: BorderEdge;
  right?: BorderEdge;
  bottom?: BorderEdge;
  left?: BorderEdge;
}

export type NumberFormatType =
  | "general"
  | "currency"
  | "percentage"
  | "number"
  | "date"
  | "time"
  | "datetime"
  | "scientific";

/** Interactive control rendered in place of the cell's text.
 *  ``"checkbox"`` toggles ``raw_value`` between ``"TRUE"`` /
 *  ``"FALSE"``; ``"dropdown"`` pairs with ``dropdownRuleId`` and
 *  renders a chip popover sourced from a workbook-scoped
 *  ``DropdownRule``. The field is named generically so future
 *  controls — ``"slider"``, … — slot into the same dispatch surface
 *  without re-shaping ``CellFormat``. Absent means the cell renders
 *  as plain text per ``type``. */
export type ControlType = "checkbox" | "dropdown";

/** A single selectable option on a ``DropdownRule``. ``value`` is
 *  what gets written into the cell's ``raw_value`` (so it must not
 *  contain ``,`` — multi-select rules join values with that
 *  delimiter); ``color`` is the chip background. [sheet.data.dropdown] */
export interface DropdownOption {
  value: string;
  color: string;
}

/** Source of a dropdown rule's options. v1 has only ``"list"``
 *  (hardcoded, edited via the rule editor side panel); ``"range"``
 *  (read from a sheet range, like Google Sheets' "From a range") is
 *  reserved for v2 — the wrapper here keeps room without a breaking
 *  rename. [sheet.data.dropdown] */
export type DropdownSource = {
  kind: "list";
  options: DropdownOption[];
};

/** Workbook-scoped data-validation rule referenced by cells via
 *  ``CellFormat.dropdownRuleId``. Multiple cells (across sheets) can
 *  share one rule — editing an option's color updates every cell
 *  that points at it. Strict-mode-only in v1: invalid values are
 *  rejected server-side and rendered as muted "invalid" chips
 *  client-side. [sheet.data.dropdown] */
export interface DropdownRule {
  id: number;
  name?: string;
  source: DropdownSource;
  /** When true, a cell's value is a comma-delimited list of option
   *  values; when false, exactly one option's value is the cell. */
  multi: boolean;
}

export interface CellFormat {
  type: NumberFormatType;
  decimals: number;
  currencySymbol: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** CSS color (hex or rgb()). Absent means theme default. */
  textColor?: string;
  /** CSS color (hex or rgb()). Absent means theme default. */
  fillColor?: string;
  /** Explicit horizontal alignment. Absent → auto (numbers right, text left). */
  hAlign?: HAlign;
  /** Explicit vertical alignment. Absent → middle. */
  vAlign?: VAlign;
  /** Overflow behavior. Absent → "overflow" (GSheets default). */
  wrap?: WrapMode;
  /** Font size in points. Absent → theme default. */
  fontSize?: number;
  /** Per-edge borders. Undefined edges mean no border on that edge. */
  borders?: CellBorders;
  /** Interactive control replacing the cell's text rendering. See
   *  [[ControlType]]. */
  controlType?: ControlType;
  /** When ``controlType === "dropdown"``, the workbook-scoped
   *  ``DropdownRule.id`` whose options gate this cell. Ignored for
   *  any other ``controlType``. [sheet.data.dropdown] */
  dropdownRuleId?: number;
}

export interface CellPosition {
  col: string;
  row: number;
}

export type CellId = string; // e.g., "A1", "B2"
