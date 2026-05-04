---
id: sheet.presence.connection-dot
title: Colored dot reflects real-time connection state
category: presence
status: draft
---

## Trigger

- The real-time channel (SSE, WebSocket, etc.) changes state:
  connected, disconnected, reconnecting.

## Effect

- Render a small coloured dot in the app header:
  - **Connected:** green (or success colour).
  - **Disconnected / reconnecting:** red (or error colour), with a
    pulse animation (opacity cycling 1 → 0.3 → 1 at ~1.5s).
- Optional hover tooltip: "Connected" / "Reconnecting…" / "Offline".

## Edge cases

- **No real-time channel in this build** (e.g. a local-only desktop
  app): hide the dot entirely rather than always-green.
- **Rapid flicker on weak networks:** debounce state transitions
  (~1s) to avoid distracting pulse-on / pulse-off oscillation.

## Visual feedback

- Small (~8px) circle. Pulse uses opacity only — no scale change.

## Rationale

Users need to know when their edits aren't being synced without
parsing a connection log.
