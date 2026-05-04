/**
 * Shared color palettes used by the various pickers across the app.
 * Pulling them out into one module so adding/removing a swatch
 * requires editing exactly one place per palette.
 *
 * Today there are two palettes with deliberately different intent:
 *
 * - ``CATEGORICAL_PALETTE`` — ColorPicker's default (text + fill
 *   colors). Bold categorical hues plus black/white/gray ramp,
 *   matching GSheets' default toolbar row.
 * - ``DROPDOWN_PALETTE`` — pastel chip backgrounds tuned for
 *   legibility against dark text. Used by ``DropdownRuleEditor``
 *   to color individual options.
 */

/** 12 swatches — black/white/gray ramp + 7 categorical hues. */
export const CATEGORICAL_PALETTE: readonly string[] = [
  "#000000",
  "#444444",
  "#888888",
  "#c4c4c4",
  "#ffffff",
  "#e53935",
  "#fb8c00",
  "#fdd835",
  "#43a047",
  "#1e88e5",
  "#8e24aa",
  "#d81b60",
];

/** 12 pastel swatches tuned for dropdown-chip backgrounds.
 *  Hex values match Google Sheets' chip palette closely so rules
 *  pasted between the two products feel familiar. */
export const DROPDOWN_PALETTE: readonly string[] = [
  "#cccccc",
  "#f4cccc",
  "#fce5cd",
  "#fff2cc",
  "#d9ead3",
  "#d0e0e3",
  "#cfe2f3",
  "#d9d2e9",
  "#ead1dc",
  "#b6d7a8",
  "#a4c2f4",
  "#ea9999",
];
