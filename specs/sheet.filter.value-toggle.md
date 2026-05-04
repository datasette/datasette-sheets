---
id: sheet.filter.value-toggle
title: Filter by values via checkbox list
category: filter
status: draft
related:
  - sheet.filter.column-popover
  - sheet.filter.row-hide
---

## Trigger

- Open a column's filter popover (`sheet.filter.column-popover`).

## Effect

1. The "Filter by values" section lists every distinct display
   string the column produces, sorted case-insensitively.
2. Each value has a checkbox; checked = visible, unchecked =
   hidden.
3. The user toggles checkboxes locally — staged state, no
   round-trips yet.
4. **Select all** / **Clear** shortcuts toggle every visible
   value at once. A "Displaying N" counter shows how many values
   stay visible after the staged toggles.
5. The search input filters the list down to values containing
   the query (case-insensitive). Search filters what the user
   *sees* in the picker; it doesn't change which values match
   the predicate.
6. **OK** persists the staged set as the column's predicate via
   `POST /filter/update` and broadcasts via SSE.
7. **Cancel** discards the staged toggles and closes the
   popover.

## Edge cases

- **Empty values**: render as a special "(Blanks)" row with
  italic muted text. Hiding "(Blanks)" hides every cell whose
  display string is `""`.
- **Cell value changes between open and OK**: the picker
  re-derives reactively, so the toggleable list always
  matches the current data. A toggled value that disappears
  from the column before OK simply has no effect on the
  predicate.
- **All values hidden**: every data row in the column hides.
  The user can re-open the popover and Select all / toggle
  individual values to bring rows back.
- **Concurrent predicate update via SSE**: the popover's
  ``persistedHidden`` derivation re-seeds when the column's
  predicate changes server-side. The user's staged edits stay
  put — clicking OK will overwrite the remote update with the
  local staging.

## Visual feedback

- "Saving…" replaces the OK label while the request is in
  flight; both buttons disable.
- Validation / network errors render below the value list in
  the error colour and don't dismiss the popover.

## Rationale

Checkbox-driven value filtering is the universal "how do I
hide this thing?" UX in spreadsheet apps. Stage-then-commit
matches Google Sheets' OK/Cancel pattern and protects the
user from accidentally hiding rows during exploration.
