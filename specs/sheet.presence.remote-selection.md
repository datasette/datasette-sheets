---
id: sheet.presence.remote-selection
title: Remote users' range selections render as a tinted fill
category: presence
status: draft
related:
  - sheet.presence.remote-cursor
---

## Trigger

- A presence update for a remote user includes a multi-cell selection.

## Effect

- Every cell in the remote user's selection (excluding their active
  cell, which gets the cursor treatment) receives a tinted
  background — the user's colour at low opacity, mixed with the
  cell's normal fill.

## Edge cases

- **Local cell is selected AND a remote user is selecting it:** both
  fills apply; the remote tint should be visible as a subtle
  overlay but not overwhelm the local "selected" style.
- **Remote user selects a full column/row:** tint paints every cell
  in that column/row.
- **Overlapping remote selections:** compose — if two remote users
  both select the same cell, blend their colours (or stripe;
  implementation-defined).

## Visual feedback

- Opacity ~10–15% so the cell content remains readable.

## Rationale

Gives collaborators awareness of what each other is working on
before a conflict happens.
