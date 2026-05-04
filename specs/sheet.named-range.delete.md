---
id: sheet.named-range.delete
title: Delete a named range
category: named-range
status: draft
related:
  - sheet.named-range.panel
  - sheet.named-range.save
---

## Trigger

- Click the trailing `×` button on a row in the Named Ranges list.

## Effect

1. Prompt for confirmation ("Delete named range *name*?"). On cancel,
   do nothing.
2. On confirm, remove the row from the workbook and from the list.
3. Trigger a re-evaluation of every formula on the sheet. Any cell
   that referenced the deleted name now shows `#NAME?`.
4. If the deleted row was being edited in the editor at the time,
   collapse the editor back to "+ Add a range".

## Edge cases

- **Network / validation failure**: surface the message and leave
  the row in the list.
- **Deleting while the definition references cells in the sheet**:
  the cells themselves are untouched; only the name → definition
  mapping goes away.

## Visual feedback

- The row disappears from the list immediately on success.

## Rationale

A destructive confirm is standard for named-range deletes because
the effect — dependent cells going to `#NAME?` — isn't obvious from
the delete site.
