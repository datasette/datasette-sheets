---
id: sheet.named-range.define-from-context
title: "\"Define named range\" opens the panel with the range prefilled"
category: named-range
status: draft
related:
  - sheet.cell.context-menu
  - sheet.named-range.panel
  - sheet.named-range.save
---

## Trigger

- Click "Define named range…" in the cell context menu (see
  `sheet.cell.context-menu`).

## Effect

1. Close the context menu.
2. Open the Named Ranges side panel (see `sheet.named-range.panel`).
3. In the panel's editor, pre-fill the **Range or value** field with
   the current selection expressed as a formula (e.g. `=A1:A10`).
   Leave the **Name** field empty and focus it so the user can start
   typing immediately.

## Edge cases

- **Panel already open**: the editor swaps to "add new" mode with the
  prefilled range, discarding any unsaved draft in the existing
  editor.
- **Single-cell selection**: the prefill is `=A1` style, not a range.
- **Non-rectangular selection**: prefill uses the bounding box.

## Visual feedback

- The panel slides in from the right. The Name field receives focus.

## Rationale

A user who already has the range selected shouldn't have to retype it
into the panel. Matching Google Sheets' behaviour here makes the
gesture discoverable: right-click is the natural place to ask
"what can I do with this selection?".
