---
id: sheet.format.font-size
title: Font size stepper sets cell font size in points
category: format
status: draft
related:
  - sheet.format.wrap
---

## Trigger

- Click the `−` or `+` button in the toolbar's font-size stepper, or
  type a number into the input and blur / press Enter.

## Effect

- Set `fontSize` on every selected cell to the chosen point size.
- Render the `.cell-value` with an inline `font-size: <n>pt`.
- Clamp to `[6, 72]` — outside this range silently snaps.
- Stepper `+/-` adjust by 1pt each click.

## Edge cases

- **No selection:** no-op.
- **Unset:** default is the theme's base size (today ~13px / 10pt,
  matching Google Sheets).
- **Interaction with row height:** the row box doesn't currently
  grow to fit oversized fonts. Very large sizes visually overflow
  the row (clipped by `.cell { overflow: hidden }`). Dynamic row
  height lands alongside the `wrap: wrap` spec — see
  `sheet.format.wrap`.

## Visual feedback

- Input reflects the active cell's size.
- The cell's text re-renders at the new size.

## Rationale

Matches Google Sheets / Excel stepper affordance. Keeping the input
editable + the two buttons keeps the common "bump by one" and
"type 14" paths both fast.
