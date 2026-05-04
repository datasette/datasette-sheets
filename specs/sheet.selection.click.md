---
id: sheet.selection.click
title: Single click solo-selects a cell
category: selection
status: draft
related:
  - sheet.selection.shift-click
  - sheet.selection.cmd-click
  - sheet.selection.drag
---

## Trigger

- Left mouse button press (mousedown) on a cell, no modifier keys.
- Precondition: the clicked cell is not currently in edit mode.

## Effect

1. Replace the current selection with a single-cell selection of the
   clicked cell.
2. Move the **selection anchor** to the clicked cell. (Subsequent
   Shift+click or Shift+Arrow measures from this anchor.)
3. Give the clicked cell keyboard focus.
4. Clear any active named-view highlight (see `sheet.view.triangle-indicator`).

## Edge cases

- **Clicking the already-selected cell:** no state change. Do not
  re-emit selection events; do not scroll.
- **Clicking a cell while a different cell is editing:** the edit-mode
  cell retains focus; the click is ignored. (To move focus away from
  an editor, commit or cancel first.)
- **Clicking a cell while **this** cell is editing:** also a no-op —
  the click inside the editor's text is a text-caret action, not a
  selection change.

## Visual feedback

- The clicked cell renders with the "selected" style: inner accent
  border and a pale accent fill.
- The previous cell's selected style is removed.
- Column and row header highlights are removed unless the new
  selection still covers a full column or row (see header-click
  specs).

## Rationale

Baseline selection primitive; identical to Excel / Google Sheets / any
spreadsheet since VisiCalc.
