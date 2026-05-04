---
id: sheet.editing.escape-cancels
title: Escape discards in-progress edit and restores cell value
category: editing
status: draft
related:
  - sheet.clipboard.escape-cancels-mark
  - sheet.editing.blur-commits
---

## Trigger

- Escape key while a cell is in edit mode.

## Effect

1. Exit edit mode.
2. Discard the in-progress edit value — the cell's raw value is
   unchanged.
3. Clear any formula-ref pointing state (if active).
4. Return keyboard focus to the cell.

## Edge cases

- **The cell value was never changed:** still exits edit mode; no
  undo entry pushed.
- **Prevent propagation:** this handler must consume the Escape event
  so the document-level Escape handler (cancel clipboard mark) does
  not also fire. See the priority note in
  `sheet.clipboard.escape-cancels-mark`.
- **Signature-help popup is open:** still a single Escape. The
  popup is passive (``pointer-events: none``) and unmounts as a
  side effect of leaving edit mode; it must not swallow Escape
  and force the user to press twice.
- **Autocomplete popup is open:** autocomplete *is* interactive
  and claims Escape first — one press dismisses the popup and
  leaves the edit intact; a second press discards the edit. See
  [`sheet.editing.formula-autocomplete`](sheet.editing.formula-autocomplete.md).

## Escape priority

When multiple popups could respond to Escape while editing, the
resolution order (first match wins) is:

1. IME composition (implementation-defined, must consume Escape
   to cancel composition without touching the edit).
2. Autocomplete popup — dismisses itself, edit continues.
3. Edit mode itself — this spec: exit + discard.
4. Clipboard mark — cleared at the document level when nothing
   higher-priority claimed Escape.

## Visual feedback

- Input disappears; cell renders its displayed value as before.

## Rationale

Universal "cancel" affordance; users need a safe way out of a wrong
edit without committing garbage.
