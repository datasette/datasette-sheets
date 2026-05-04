---
id: sheet.column.context-menu-delete-only
title: Column context menu (deprecated — now has insert items too)
category: column
status: deprecated
related:
  - sheet.column.context-menu
  - sheet.column.insert-left-right
  - sheet.delete.column-right-click
---

## Status

**Deprecated.** The "only delete" limitation this spec encoded is no
longer true: the column context menu now also offers insert-before
and insert-after actions. Superseded by:

- `sheet.column.context-menu` — the umbrella spec for what the
  menu contains.
- `sheet.column.insert-left-right` — the insert behavior.
- `sheet.delete.column-right-click` + `sheet.delete.column-confirm`
  — the delete behavior (unchanged).

## Notes — history

Kept in place so any bug report or commit that cites this ID still
resolves. When the menu gains further actions (hide / freeze / fit),
they should land under `sheet.column.context-menu` or split into
their own specs — don't revive this one.
