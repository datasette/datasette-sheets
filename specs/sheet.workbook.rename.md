---
id: sheet.workbook.rename
title: Rename the workbook via an inline editor next to the title
category: workbook
status: draft
---

## Trigger

- Click a pencil / edit affordance next to the workbook title in
  the header.

## Effect

1. Replace the title text with a text input populated with the
   current name. Display "Save" (primary) and "Cancel" buttons
   alongside.
2. Commit on Enter or Save click:
   - Trim the value. If empty, treat as cancel.
   - Persist. Update the header title and the window / document
     title.
3. Cancel on Escape or Cancel click: revert.

## Edge cases

- **Name unchanged on commit:** exit rename mode; no persistence
  call (or a no-op call — implementation's choice).
- **Persistence fails:** surface error; revert.
- **Tab in rename input:** default form-tab behaviour (move focus to
  the Save button, etc.) — do not enter cell-navigation mode.

## Visual feedback

- Input has an obvious focus ring; Save button is disabled when
  input is empty.

## Rationale

Straightforward affordance; keeps the title visible while editable.
