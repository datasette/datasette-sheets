---
id: sheet.format.toolbar-layout
title: Rich format toolbar layout and behaviour
category: format
status: draft
related:
  - sheet.format.menu
  - sheet.format.font-size
  - sheet.format.borders
---

## Trigger

- Always visible between the workbook header and the formula bar.

## Effect

- Renders the rich format toolbar with icon buttons grouped by
  divider. Left → right:
  1. **History** — Undo, Redo
  2. **Number formats** — `$`, `%`, `.0`, decrease-decimal,
     increase-decimal, "123 ▾" more-number-formats dropdown
  3. **Font size** — `−`, `<input type=number>`, `+`
  4. **Text styling** — Bold, Italic, Underline, Strikethrough
  5. **Colors** — Text color ▾, Fill color ▾
  6. **Borders** — Border-all ▾ (opens the BorderPicker)
  7. **Alignment** — H-align three buttons, V-align three buttons
  8. **Wrapping** — Wrap mode ▾
  9. **Clear formatting** — Eraser button

- Buttons carry an `active` depressed state when the active cell's
  format has the corresponding attribute set (Bold lights up on a
  bold cell, H-align=center highlights the center button, etc.).

- When no cell is selected, the whole toolbar fades to `0.65`
  opacity so the "nothing is selected" state is legible at a glance.
  Undo / Redo still fire — they operate on snapshot state, not the
  current selection.

- Dropdowns (color pickers, border picker, more-number-formats
  menu, wrap menu) are mutually exclusive: opening one closes any
  other. Outside-click and Escape both dismiss.

## Edge cases

- **Toolbar overflow on narrow viewports:** the toolbar
  `flex-wrap: wrap`s to a second line instead of horizontally
  scrolling. A future `⋮ more` overflow drawer could collapse the
  right-most groups; for v1 wrapping is good enough.
- **Editing a cell:** the format buttons still fire, but edits
  apply to the cell's whole value (not a text selection within the
  edit input).

## Visual feedback

- Buttons hover lightly and depress when active.
- Color buttons show a thin strip in the current color beneath the
  glyph.

## Rationale

Matches the group ordering Google Sheets uses so muscle memory
transfers. Every button dispatches through
`lib/formatCommands.ts` — the same helpers the Format menu and
cell context menu use — so there's one source of truth for each
operation.
