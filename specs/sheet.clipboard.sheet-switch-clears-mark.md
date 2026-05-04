---
id: sheet.clipboard.sheet-switch-clears-mark
title: Switching sheets clears the clipboard mark
category: clipboard
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.cut
  - sheet.clipboard.mark-visual
  - sheet.tabs.click-switch
---

## Trigger

- The active sheet changes (tab click, keyboard shortcut, etc.).

## Effect

- If a clipboard mark is currently painted on the previously-active
  sheet, drop it.
- The OS clipboard is not cleared; a subsequent paste (on either
  sheet) still works and behaves as `copy` regardless of the
  original mode.

## Edge cases

- **Switch back before pasting:** the mark does not re-appear. The
  user must re-copy or re-cut if they want the cut semantics.
- **Cut then switch then paste on new sheet:** paste behaves as copy
  — sources stay — because the mark was cancelled.

## Visual feedback

- Dashed border disappears when the previous sheet is unloaded from
  view.

## Rationale

Cell coordinates on the old sheet do not map to the new one, so the
mark would be misleading if carried across. This matches Google
Sheets' behaviour (sort of — Sheets actually *does* carry the mark
across a tab switch, but that relies on server-side range tracking
we don't want to emulate at the spec level).
