---
id: sheet.delete.column-right-click
title: Right-click column header opens delete menu
category: delete
status: draft
related:
  - sheet.delete.column-confirm
  - sheet.delete.row-right-click
---

## Trigger

- Right-click (context-menu gesture) on a column header.

## Effect

- Same as `sheet.delete.row-right-click`, but for columns:
  - Resets selection to the right-clicked column if it wasn't in the
    existing column selection.
  - Menu label: "Delete column X" (single) or "Delete N columns
    (X–Y)" (multiple contiguous).

## Edge cases

- Same as row variant. Non-contiguous selection label drops the
  range hint.

## Visual feedback

- Same as row variant.

## Rationale

Symmetry with row-header delete.
