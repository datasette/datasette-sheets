---
id: sheet.status-bar.numeric-stats
title: Status bar shows Count plus one user-picked aggregate
category: status-bar
status: draft
related:
  - sheet.status-bar.count-only
  - sheet.status-bar.stat-picker
---

## Trigger

- The selection contains more than one cell AND at least one cell
  has a numeric computed value.

## Effect

Render a compact right-aligned row at the bottom of the grid with
two items:

1. **Count** — number of numeric cells in the selection. Always
   first, always present.
2. **One user-picked aggregate** — Sum, Avg, Min, or Max — chosen
   from a dropdown. See `sheet.status-bar.stat-picker` for the
   picker itself. The value renders next to the picker using
   locale-appropriate formatting with up to ~4 decimal places.

Only the picker swaps; Count is not behind the picker.

## Edge cases

- **Mix of numeric and non-numeric:** aggregates run only over
  numeric cells. Count reflects that (count of numeric cells, not
  total cells).
- **Selection of a whole column/row:** same — aggregates are over
  numeric cells only.
- **All values identical:** any pick (min/max/avg/sum) renders the
  one value.

## Visual feedback

- Right-aligned within the status bar row; Count on the left of the
  pair, picker + value on the right.
- Read-only text + a discreet dropdown; not interactive beyond the
  picker itself.

## Rationale

Showing all five (Sum / Avg / Min / Max / Count) wastes header real
estate for information most users don't want at once. Count is
always useful as a "how big is my selection" confirmation; one
user-picked aggregate covers the common case ("what's the sum of
these numbers") without the noise.

## Notes

**History:** earlier drafts of this spec displayed all five
aggregates simultaneously, matching a literal reading of Google
Sheets' status bar. In practice the dropdown compresses better and
lets the user pin the stat they care about across sessions.
