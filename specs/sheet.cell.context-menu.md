---
id: sheet.cell.context-menu
title: Right-click a cell opens the cell context menu
category: cell
status: draft
related:
  - sheet.cell.copy-from-menu
  - sheet.cell.cut-from-menu
  - sheet.cell.paste-from-menu
  - sheet.cell.copy-reference
  - sheet.named-range.define-from-context
  - sheet.cell.copy-api-url
  - sheet.cell.open-api-url
  - sheet.delete.context-menu-dismiss
---

## Trigger

- Right-click (context-menu gesture) anywhere inside the grid body
  (not on a row or column header).

## Effect

1. If the right-clicked cell is **not** already part of the current
   selection, collapse the selection to that single cell first.
   (Right-clicking a cell inside the current range keeps the range.)
2. Open a context menu positioned at the pointer coordinates.
3. The menu opens with a small **range header** showing the
   selection's A1 string (e.g. `A3:A5`, or `B7` for a single cell)
   so the user can see what every action below will operate on.
4. Below the header, the actions are grouped by dividers:
   - **Cut / Copy / Paste** — clipboard parity with the Cmd/Ctrl
     shortcuts (see `sheet.cell.cut-from-menu`,
     `sheet.cell.copy-from-menu`, `sheet.cell.paste-from-menu`).
   - **Copy reference** — write the A1 string itself to the
     clipboard (see `sheet.cell.copy-reference`).
   - **Define named range…** — open the Named Ranges panel
     pre-filled with the selection (see
     `sheet.named-range.define-from-context`).
   - **Copy API URL** / **Open API URL in new tab** — see
     `sheet.cell.copy-api-url` and `sheet.cell.open-api-url`.
4. The menu is positioned so it doesn't overflow the viewport; flip
   direction / shift left if needed.

## Edge cases

- **Right-click while editing a cell**: suppressed — the text input's
  native context menu wins.
- **Right-click on a row or column header**: handled by the header
  context menu, not this one (see
  `sheet.delete.row-right-click` / `sheet.delete.column-right-click`).
- **Non-rectangular selection**: the displayed range collapses to the
  bounding box.

## Visual feedback

- Menu appears with a subtle shadow. The hint on the right renders in
  the secondary text colour and the sheet's monospace font so the
  range reads as code.

## Rationale

Right-click is the universal "contextual actions for this thing"
gesture. Separating the cell-body menu from the header menus lets
each hold actions scoped to what the user actually clicked on.
