---
id: sheet.editing.blur-commits
title: Losing focus commits the in-progress edit
category: editing
status: draft
related:
  - sheet.editing.escape-cancels
  - sheet.navigation.enter-commit-down
  - sheet.navigation.tab-commit-right
---

## Trigger

- The edit input loses keyboard focus while in edit mode. Causes:
  user clicks outside the cell, clicks another cell, clicks another
  app, or invokes a shortcut that moves focus.

## Effect

1. Commit the current edit value: push to undo stack, persist.
2. Exit edit mode.
3. Do not attempt to move focus — the blur is already doing that.

## Edge cases

- **Blur and Enter/Tab fire together:** both paths commit the same
  value. The second commit is a no-op (value is unchanged).
- **Blur via Escape:** `sheet.editing.escape-cancels` fires first
  and sets "discard" state; blur must not re-commit the discarded
  value. (Implementation hint: Escape resets `editValue` to the
  cell's raw value before blur fires, so blur's commit is a no-op.)
- **Browser / OS window loses focus while editing:** treat as a blur
  — commit immediately. Re-focusing later should not re-enter edit
  mode.

## Visual feedback

- Input disappears; cell re-renders the committed (newly-displayed)
  value.

## Rationale

Matches Excel / Google Sheets. Users expect that clicking elsewhere
"just saves" their edit — dropping it on blur would be data loss.
