---
id: sheet.format.text-color
title: Text color picker applies a color to the selection
category: format
status: draft
related:
  - sheet.format.fill-color
  - sheet.format.clear
---

## Trigger

- Click the text-color toolbar button (fonts icon + colored strip +
  dropdown caret). A popover with a 10-swatch palette, a custom hex
  input, and a "reset" swatch opens below the button.

## Effect

- Clicking a palette swatch sets `textColor` on every selected cell
  to that hex color and closes the popover.
- Entering a hex into the custom field and pressing Enter or
  clicking Apply applies that hex.
- Clicking the reset swatch clears `textColor` (falls back to the
  theme default).

## Edge cases

- **Hex validation:** `#rgb` and `#rrggbb` accepted; other inputs
  are ignored (no-op on Apply).
- **No selection:** button is still clickable; the picker opens but
  choosing a color no-ops.
- **Popover dismissal:** click outside the toolbar, press Escape,
  or pick a color.
- **Numeric cells:** `textColor` overrides the accent-color default
  (same rule as alignment — an explicit choice wins over the auto
  "numbers in accent" rule).

## Visual feedback

- The button's color strip reflects the cell's current `textColor`
  (empty when unset).
- The active swatch in the palette is highlighted when it matches
  the cell's color.

## Rationale

Matches Google Sheets. Pulling the palette out as its own component
(`ColorPicker.svelte`) lets the same picker drive fill color and,
later, border color.
