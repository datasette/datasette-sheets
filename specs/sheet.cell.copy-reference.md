---
id: sheet.cell.copy-reference
title: "\"Copy reference\" copies the A1 range string"
category: cell
status: draft
related:
  - sheet.cell.context-menu
---

## Trigger

- Click "Copy reference" in the cell context menu (see
  `sheet.cell.context-menu`).

## Effect

1. Write the current selection's A1 reference string (e.g. `A3:A5`
   for a range, `B7` for a single cell) to the OS clipboard as plain
   text.
2. Close the menu.

## Edge cases

- **Non-rectangular selection**: collapses to its bounding box (same
  rule as elsewhere — see `sheet.formula-bar.label`).
- **Clipboard write fails**: native alert with the underlying
  message.

## Visual feedback

- None besides the menu closing.

## Rationale

When the user wants to type a formula somewhere else (a different
cell, a different sheet, a chat with a colleague) that references
this range, the cheapest path is to grab the A1 string itself rather
than recompute it. Distinct from the "copy values" Cut/Copy items —
those write the *contents* of the range; this one writes the *name*
of it.
