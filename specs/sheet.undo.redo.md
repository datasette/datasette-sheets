---
id: sheet.undo.redo
title: Redo replays the last undone action
category: undo
status: draft
related:
  - sheet.undo.cmd-z
  - sheet.undo.scope
---

## Trigger

Any of:
- Cmd+Shift+Z (macOS)
- Cmd+Y (macOS)
- Ctrl+Y (other platforms)
- Ctrl+Shift+Z (other platforms)

…on a focused cell not in edit mode.

## Effect

1. If the redo stack is empty, no-op.
2. Pop a snapshot from the redo stack and push the current state to
   the undo stack.
3. Restore cells from the snapshot.

## Edge cases

- **A new action (typing, paste, etc.) clears the redo stack.**
  Once the user has branched off an undo, the forward history is
  gone. This matches every mainstream editor.
- **In edit mode:** passed through to the input.

## Visual feedback

- Affected cells re-render.

## Rationale

Supporting multiple shortcut conventions maximises platform
familiarity.
