---
id: sheet.presence.broadcast-debounce
title: Local cursor / selection changes broadcast at most once per debounce window
category: presence
status: draft
related:
  - sheet.presence.expiry
---

## Trigger

- The local user's active cell or selection changes.

## Effect

- Enqueue a presence broadcast. If another broadcast is already
  pending within the debounce window (typical: 200ms), coalesce —
  the pending broadcast carries the latest state when it fires.
- After firing, reset the window.

## Edge cases

- **Continuous drag-select:** many selection updates per second; the
  debounce ensures only ~5/s reach the network, with the latest
  state always included.
- **User idle for longer than the expiry window:** the presence
  record may expire on peers; the next movement will re-establish
  it. Implementations should also send a keepalive broadcast on an
  interval roughly half the expiry window to prevent false expiry.

## Visual feedback

- None directly. Remote users see smoother cursor updates.

## Rationale

Avoids saturating the real-time channel during drag-select while
still feeling live.
