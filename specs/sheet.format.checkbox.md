---
id: sheet.format.checkbox
title: Cells can be formatted as a checkbox; click or Space toggles TRUE/FALSE
category: format
related:
  - sheet.cell.boolean
  - sheet.format.menu
  - sheet.format.clear
---

## Trigger

- Format menu → Checkbox applies `format.controlType = "checkbox"` to
  every target cell (selection if any, else the active cell).
- Click on the rendered checkbox glyph (single click, not the cell
  body) → toggle.
- Space key with the focused cell formatted as a checkbox, or with
  any selected cell formatted as a checkbox → toggle.

## Effect

- The cell's text rendering is replaced by an interactive checkbox
  glyph (~14×14, accent-coloured fill when checked, ✓ glyph
  centred). Empty / unchecked state shows an empty box.
- Clicking the glyph or pressing Space writes `raw_value = "TRUE"`
  or `"FALSE"` (engine literal evaluator turns those into
  `Boolean(true|false)`); the data API and persistence layer
  round-trip JSON `true`/`false` per `sheet.cell.boolean`.
- Multi-cell Space follows the **majority rule**: if every checkbox
  cell in the selection is currently checked, uncheck them all;
  otherwise check them all. Cells without `controlType ===
  "checkbox"` in the selection are skipped — Space only flips the
  checkboxes.
- Edit mode (F2 / double-click / type-to-replace) drops back to the
  plain text input. Saving anything other than `TRUE` / `FALSE`
  keeps the format and renders the user's text in place of the glyph
  on the next render — but as soon as the value parses to a boolean
  again the glyph reappears.

## Edge cases

- **Pre-existing data:** applying the format to a cell whose
  `computedValue` is truthy renders the glyph as checked; falsy
  (empty, 0, `""`) renders unchecked. `raw_value` is **not** touched
  until the user clicks — matches Google Sheets, lets you "preview"
  the format without committing values.
- **Spill members:** a checkbox-formatted cell that becomes a spill
  member ignores click (would error `#SPILL!`). The glyph still
  reflects the spilled value visually.
- **Hyperlink + checkbox:** the `↗` icon is suppressed on checkbox
  cells. Pick one mode at a time.
- **Clipboard:** intra-app copy/paste round-trips `controlType` via
  the `data-sheets-control-type` attribute on the `<td>`. External
  apps see the plain `TRUE` / `FALSE` text, no checkbox.
- **Clear formatting** (`Cmd+\` or Format → Clear formatting) drops
  `controlType` back to undefined so the cell reverts to text.
- **`raw_value` rendering after edit:** if a user edits a checkbox
  cell to `=A1+5`, the glyph reflects the truthiness of the formula
  result. Once it evaluates back to a boolean (e.g. via `=A1>5`),
  the cell is once again clickable as a checkbox.

## Visual feedback

- Unchecked: empty box with a 1.5px grey border, hover lifts the
  border to the accent colour.
- Checked: filled with the accent colour, white ✓ glyph centred.
- Focus ring (keyboard nav onto the cell, then tabbing to the glyph)
  uses the standard accent outline.

## Rationale

Matches Google Sheets and Excel "Insert → Checkbox". The control is
modelled as a `controlType` field rather than a `NumberFormatType`
extension so future controls (`select`, `multiselect`, `slider`)
can slot into the same dispatch surface without re-shaping
`CellFormat`.
