---
id: sheet.status-bar.stat-picker
title: Status-bar aggregate chooser remembers the user's pick across sessions
category: status-bar
status: draft
related:
  - sheet.status-bar.numeric-stats
---

## Trigger

- The status bar is showing numeric aggregates (see
  `sheet.status-bar.numeric-stats`) — i.e. the selection has at
  least one numeric cell.

## Effect

- Render a small, inline dropdown (or equivalent affordance) with
  these options, in this order: **Sum**, **Avg**, **Min**, **Max**.
- **Avg** is the default on a fresh install.
- The currently picked option's aggregate value renders to the
  immediate right of the picker, updating live as the selection
  changes.
- On picker change, persist the choice so future sessions open with
  the same pick.

## Edge cases

- **No persistent storage available** (private browsing, storage
  disabled, not applicable on the platform): fall back to Avg each
  session. Never surface a warning — the picker still works within
  the session.
- **Picker changed with no selection / with a single cell:** the
  choice is still persisted, even if nothing is currently rendered
  next to it.
- **Stored value from a future version lists an unknown option:**
  ignore it; reset to Avg.

## Visual feedback

- Compact — slightly smaller than the rest of the status bar text,
  transparent background, border appears on hover/focus.

## Rationale

One pick covers the common case ("what's the sum of this
selection?") without rendering all four aggregates at once. Users
who care about a specific aggregate (typically Sum or Avg) pick it
once and never think about it again, which is why persistence
matters more than it looks.
