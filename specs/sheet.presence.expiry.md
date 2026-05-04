---
id: sheet.presence.expiry
title: Presence records time out if not refreshed
category: presence
status: draft
related:
  - sheet.presence.broadcast-debounce
---

## Trigger

- A presence record has not received an update from its user within
  the expiry window (typical: 10 seconds).

## Effect

- Remove the presence record: avatar disappears from the strip,
  cursor / selection overlays disappear from the grid.
- No visible transition is required — vanishing is acceptable.

## Edge cases

- **Clock skew between users:** use monotonic "last seen" timestamps
  set at receive time on the local client rather than embedded by
  the sender.
- **Expiry thread cadence:** check frequently enough that a user who
  left 11s ago disappears around 11s (typical: run the expiry sweep
  every 5s).
- **Network blip:** a user who comes back within the window should
  resume smoothly without their avatar ever disappearing.

## Visual feedback

- Presence UI simply removes the indicator.

## Rationale

Users disconnect, close tabs, or lose network; a stale avatar is
worse than a missing one.
