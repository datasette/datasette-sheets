---
id: sheet.format.datetime
title: Datetime format renders a parseable value as date + time
category: format
status: draft
related:
  - sheet.format.date
  - sheet.format.time
---

## Trigger

- Pick "Date time" in the number-format toolbar dropdown on a
  selected cell.

## Effect

- Sets `type: "datetime"`.
- Renders via `toLocaleString("en-US", {year:"numeric",
  month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})`
  — e.g. `Apr 21, 2026, 3:14 PM`.
- Unparseable values render verbatim.

## Edge cases

- **Missing time component:** a bare date (`2026-04-21`) renders
  with `12:00 AM` — consistent with how the browser parses it, and
  better than inventing a different rule for this one case.
- Locale fixed to `en-US` in v1.

## Rationale

Third preset alongside date / time for the common "show me
timestamped rows" pattern.
