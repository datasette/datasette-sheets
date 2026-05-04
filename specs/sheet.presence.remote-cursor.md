---
id: sheet.presence.remote-cursor
title: Remote users' cursors render on the grid with a name badge
category: presence
status: draft
related:
  - sheet.presence.remote-selection
  - sheet.presence.avatar-strip
  - sheet.presence.expiry
---

## Trigger

- A presence update is received from a remote user showing their
  current active cell, and the user has an assigned colour.

## Effect

- The cell corresponding to the remote user's cursor gains an
  outline in the user's colour.
- A small name badge sits just outside the top-left corner of the
  cell, containing the user's display name, coloured in the user's
  colour.

## Edge cases

- **Multiple remote users on the same cell:** stack badges or
  overlap them; the spec does not mandate layout, but every present
  user must have some indication.
- **Remote user's active cell is off-screen:** no indicator appears
  in the visible grid. An optional "user is over there →" indicator
  in the viewport edges is acceptable but not required.
- **Local user's own cursor:** never render via remote-cursor UI,
  even if the server echoes it back.

## Visual feedback

- Outline thickness: ~2px. Badge: small pill, rounded corners,
  contrasting text (typically white on the user's colour).

## Rationale

Matches Google Sheets / Figma. Colour + name = enough to identify
the other editor at a glance.
