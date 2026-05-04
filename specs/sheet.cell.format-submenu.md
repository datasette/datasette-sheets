---
id: sheet.cell.format-submenu
title: Format actions in the cell right-click menu
category: cell
status: draft
related:
  - sheet.cell.context-menu
  - sheet.format.menu
  - sheet.format.clear
---

## Trigger

- Right-click on a cell or range to open the cell context menu.

## Effect

- The menu includes a "Format" section with a handful of common
  actions:
  - **Bold** — toggles `format.bold` across the selection (same
    active-cell-authoritative rule as Cmd+B).
  - **Italic** — toggles `format.italic`.
  - **Underline** — toggles `format.underline`.
  - **Clear formatting** — resets every format field (same as
    Cmd+\ / toolbar eraser).
- Clicking any of these closes the context menu.

## Edge cases

- **Range selection:** the actions apply to the whole selection.
  The toggle direction is read from the active cell alone, matching
  the keyboard-shortcut behaviour.
- **Full surface:** the cell context menu deliberately shows only
  the common-case subset. Colors, alignment, borders, number
  formats, etc. live in the header's Format menu
  (`sheet.format.menu`) and toolbar — keeping the right-click menu
  short.

## Visual feedback

- Menu closes immediately on action.

## Rationale

Right-click is a fast path. Offering the four most common format
actions there skips the toolbar for the frequent "make this row of
headers bold" workflow without duplicating the full Format menu
inline. The Format menu and toolbar remain the full surface.
