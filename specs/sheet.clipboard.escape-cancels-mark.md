---
id: sheet.clipboard.escape-cancels-mark
title: Escape cancels a pending clipboard mark
category: clipboard
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.cut
  - sheet.clipboard.mark-visual
  - sheet.editing.escape-cancels
---

## Trigger

- The Escape key.
- Preconditions: a clipboard mark is currently painted (from a prior
  copy or cut), no cell is in edit mode, and focus is not inside a
  non-sheet text input.

## Effect

- Drop the clipboard mark. The dashed outline disappears from the
  source range.
- **The OS clipboard is not cleared.** A subsequent paste still
  works; it will simply behave as `copy` did even if the original
  action was `cut` — sources will not be removed, because the mark
  (and therefore the cut intent) is gone.

## Edge cases

- **No mark active:** Escape is a no-op here. (Other Escape handlers
  may fire — e.g. closing a context menu — but those are their own
  specs.)
- **Currently editing a cell:** the in-cell edit-mode Escape handler
  (`sheet.editing.escape-cancels`) wins. This handler must not fire.
- **Focus in a non-sheet text input:** do not intercept.

## Visual feedback

- Dashed border disappears from all previously-marked cells.

## Rationale

Matches Google Sheets. Escape is a universal "never mind" affordance;
mapping it to the most visually prominent pending action (the
clipboard mark) is the least-surprising choice. Leaving the OS
clipboard intact means Escape is undoable (just copy again) and
doesn't interfere with cross-app paste workflows.

## Notes

**Priority ordering:** when multiple "Escape" handlers could fire,
the priority from highest to lowest is:
1. In-cell edit-mode escape (`sheet.editing.escape-cancels`).
2. Close any open context menu / dialog.
3. Cancel clipboard mark (this spec).
4. No-op at the grid level.
