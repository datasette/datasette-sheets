---
id: sheet.undo.scope
title: Which actions push to the undo stack
category: undo
status: draft
related:
  - sheet.undo.cmd-z
  - sheet.undo.redo
---

## Trigger

- Before any mutation that should be reversible.

## Effect

A snapshot is pushed to the undo stack before each of:

- **Cell value commits** from Enter, Tab, blur, or formula-bar commit
  (one snapshot per commit, regardless of whether the value changed).
- **Delete / Backspace** on a selection (one snapshot per keypress).
- **Paste** operations (one snapshot — the entire paste counts as
  one undoable unit).
- **Format actions** — bold toggle, currency / percentage / number /
  clear-format button clicks.

Actions that **do not** push to the stack (and are therefore not
undoable via Cmd+Z):

- Row and column deletes (see `sheet.delete.row-confirm` — confirm
  dialog's copy reflects this).
- Sheet tab operations: add, delete, rename, colour.
- Column resize.
- Workbook rename.
- Remote changes received via collaboration / presence channels.
- **Workbook-scoped engine state**: named ranges and dropdown rules.
  Adding, renaming, or deleting either is not on the cell undo stack
  — matches Google Sheets, where renaming a named range or editing a
  data-validation rule is its own modal action, not a cell mutation.
  Cells that *reference* such state are still snapshotted normally;
  if a referenced rule was deleted between snapshot and undo, the
  restored cell points at a missing rule (handled like any other
  dangling reference).

## Edge cases

- **Snapshot size:** snapshots must capture at least raw value +
  format for every cell that could change, plus enough engine-side
  state to roll back without ghosts: pin overlays (host-injected
  `=SQL(...)` arrays) and the dirty-cell set both belong in the
  frame. Full-workbook snapshots are acceptable for small sheets;
  implementations may optimise with delta encoding.
- **Remote changes while an undo stack exists:** do not clear the
  stack. Undo may "un-do" a local change onto a state that no longer
  matches the remote — that's acceptable (local-first semantics);
  the subsequent save reconciles.

## Visual feedback

- None directly. The affected action's own visual feedback applies.

## Rationale

Explicit spec of what's undoable prevents "Cmd+Z doesn't work on X"
surprise. The current scope is deliberately limited while the
plugin is pre-release; destructive structural edits (row/col delete)
are gated behind confirm dialogs instead.
