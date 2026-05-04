---
id: sheet.format.time
title: Time format renders a parseable value as a localized time
category: format
status: draft
related:
  - sheet.format.date
  - sheet.format.datetime
---

## Trigger

- Pick "Time" in the number-format toolbar dropdown on a selected
  cell.

## Effect

- Sets `type: "time"`.
- Renders via `toLocaleTimeString("en-US", {hour:"numeric",
  minute:"2-digit", second:"2-digit"})` — e.g. `3:14:59 PM`.
- Unparseable values render verbatim.

## Edge cases

- Same locale caveat as `sheet.format.date`.
- A date-only string (`2026-04-21`) renders as the start-of-day time
  (`12:00:00 AM` in en-US) — surprising but matches browser
  semantics; users who want a "real" time should type one.

## Visual feedback

- Display updates immediately.

## Rationale

Complements `sheet.format.date` so users can pick which component to
surface without needing a datetime.
