---
id: sheet.format.date
title: Date format renders a parseable value as a localized date
category: format
status: draft
related:
  - sheet.format.time
  - sheet.format.datetime
---

## Trigger

- Pick "Date" in the number-format toolbar dropdown (or via the
  Format menu) on a selected cell.

## Effect

- Sets `type: "date"` on the cell's format.
- On render, the cell's raw value is parsed via `Date.parse`. If
  parsing succeeds, display uses `toLocaleDateString("en-US",
  {year: "numeric", month: "short", day: "numeric"})` — e.g.
  `Apr 21, 2026`.
- If parsing fails (value isn't a recognised date string), the raw
  value is rendered verbatim so the user still sees their input.

## Edge cases

- **Excel-serial numbers** (e.g. `44927` meaning 2023-01-01): not
  supported in v1. Numbers fall through to `String(value)`.
- **Locale:** fixed to `en-US` in v1 — locale-aware rendering lands
  with the custom-format dialog (see §7 stretch in TODO-styling.md).
- **ISO with time** (`2026-04-21T10:00:00`): the date portion is
  rendered; the time is dropped.

## Visual feedback

- Display updates immediately when the format is applied.

## Rationale

Display-only date formatting matches Google Sheets: the stored value
is whatever the user typed; the format only affects how it renders.
Avoids inventing a custom date-math engine for v1.
