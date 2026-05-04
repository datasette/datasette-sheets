---
id: sheet.named-range.save
title: Save a named range
category: named-range
status: draft
related:
  - sheet.named-range.panel
  - sheet.named-range.delete
---

## Trigger

- Click **Save** (or **Done**) in the Named Ranges editor, or press
  `Cmd/Ctrl+Enter` while either input is focused.

## Effect

1. Trim leading/trailing whitespace from both fields. If either is
   empty, show an inline error and don't submit.
2. Send the (name, definition) pair to the workbook. On validation
   failure (name looks like a cell reference, name shadows a
   built-in function, definition doesn't parse, etc.) surface the
   server's message inline and keep the editor open.
3. On success:
   - Collapse the editor back to "+ Add a range".
   - Update the list to include / reflect the new row, sorted
     case-insensitively by name.
   - Trigger a re-evaluation of every formula on the sheet so cells
     that referenced the name (or that would reference it) update
     their displayed value.
4. When the Name field was changed while editing an existing row,
   delete the old-named row first so the rename doesn't leave a
   duplicate behind. Case-only renames skip the delete step.

## Edge cases

- **Duplicate name**: an upsert semantics — re-saving an existing
  name overwrites its definition, no warning.
- **Circular name definition** (name A references name B references
  name A): dependent cells show `#CIRCULAR!` rather than a save
  error.
- **Unknown name referenced from a formula**: dependent cells show
  `#NAME?` until the name is defined.

## Visual feedback

- Save button shows "Saving…" while the request is in flight; inputs
  are disabled.
- Validation errors render in the error colour below the fields.

## Rationale

Upsert-on-save keeps the flow one-click whether the user is adding
or editing. Surfacing server-side validation inline avoids forcing a
round-trip through the browser's native `alert()` dialog for a
common "oops I picked a bad name" case.
