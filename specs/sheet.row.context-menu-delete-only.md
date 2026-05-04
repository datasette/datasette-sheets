---
id: sheet.row.context-menu-delete-only
title: Row context menu currently offers only delete
category: row
status: draft
related:
  - sheet.delete.row-right-click
---

## Trigger

- Right-click on a row header.

## Effect

- Open a context menu with a single action: "Delete row(s)". No
  insert-above / insert-below / hide / resize items yet.

## Edge cases

- Same as `sheet.column.context-menu-delete-only`.

## Visual feedback

- Small floating menu at the pointer position.

## Rationale

Mirror of column-context-menu-delete-only; explicit about the
current minimal surface.
