---
id: sheet.filter.create-view
title: Create SQL view from filter
category: filter
status: draft
related:
  - sheet.filter.column-popover
---

## Trigger

- Click "Create view…" in the filter chevron popover.
- Or: click the formula-bar's "Create view" entry while a filter
  exists and no explicit range is selected.

## Effect

1. The Create-View dialog opens with:
   - **Range** pre-filled with the filter's rectangle in A1
     form (`B2:E9`).
   - **Use first row as column headers** checked (filters always
     treat their top row as headers, so the dialog's existing
     default already does the right thing).
   - **View name** suggested from the active sheet's name —
     non-identifier chars replaced with `_`, leading underscores
     stripped, prefixed with `view_` if it would otherwise start
     with a digit, and lowercased. Example: `Customer Orders` ⇒
     `customer_orders`. The suggestion is editable; the server
     enforces the actual rules via `validate_view_name`.
2. The filter popover closes when the dialog opens (no two
   foreground modals at once).
3. The dialog otherwise behaves identically to the formula-bar
   path — same triggers, same trigger-mode toggles, same error
   surface.

## Edge cases

- **Filter rectangles are bounded.** The "INSERT — append a new
  row" checkbox stays disabled with the existing "Change to
  unbounded" nudge link. UPDATE and DELETE work normally — they
  identify rows via the synthetic `_sheet_row` column.
- **The view does NOT inherit the filter's predicates or sort.**
  A `SELECT * FROM the_view` returns every row in the rectangle,
  not just the rows the filter is currently showing. This is
  deliberate: views are persisted DDL artifacts and SQL
  consumers expect "the view is the data," not "the view is what
  the spreadsheet UI is showing right now."
- **Filter mutations after view creation don't affect the view.**
  The view's range is captured at create time; subsequent
  predicate toggles, sort changes, or filter deletion leave the
  view alone. Symmetrically, view deletion has no filter side
  effect.
- **Active sheet has no name yet** (rare — fresh, not-yet-renamed
  sheet): the suggestion falls through to the empty string and
  the user types one.

## Visual feedback

- "Create view…" row in the popover renders identical to the
  Sort rows above it, sitting in its own divider-bordered
  section between Sort and Filter-by-values.

## Rationale

Filters already encode a clean rectangle + header row — exactly
the two things the Create-View dialog asks the user to type. The
shortcut saves typing for the most common case (turning a
filtered region into an addressable SQL surface) without
coupling view lifetime to filter state. SQL consumers see every
row in the rectangle; if they want filtering, they `WHERE` it
themselves.
