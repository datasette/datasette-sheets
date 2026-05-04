---
id: sheet.undo.cmd-z
title: Cmd/Ctrl+Z reverts the last undoable action
category: undo
status: draft
related:
  - sheet.undo.redo
  - sheet.undo.scope
---

## Trigger

- Cmd+Z (macOS) or Ctrl+Z, on a focused cell not in edit mode.

## Effect

1. If the undo stack is empty, no-op.
2. Pop a snapshot from the undo stack and push the current state to
   the redo stack.
3. Restore cells from the snapshot (raw values + format) and
   recalculate formulas.
4. Do **not** restore non-cell UI state: the selection, active cell,
   scroll position, and column widths stay where they are.

## Edge cases

- **In edit mode:** Cmd+Z is passed through to the text input for
  native undo behaviour; does not pop the cell stack.
- **Max undo depth** (e.g. 50 entries): oldest snapshots are
  discarded silently. Users don't get a warning.

## Visual feedback

- Affected cells re-render with their prior values.

## Rationale

Excel / Google Sheets baseline. Leaving selection / scroll intact is
the convention because restoring them often confuses the user about
where they are.
