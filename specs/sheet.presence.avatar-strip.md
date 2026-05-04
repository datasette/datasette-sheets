---
id: sheet.presence.avatar-strip
title: Connected users shown as a horizontal strip of avatars
category: presence
status: draft
related:
  - sheet.presence.remote-cursor
  - sheet.presence.expiry
---

## Trigger

- Any user is actively present (has a non-expired presence record).

## Effect

- Render one circular avatar per present user (including the local
  user) in a horizontal strip in the app header.
- If a user has a profile picture URL, show the image.
- Otherwise, render a colour-filled circle with the first letter of
  the user's display name in uppercase.
- Each avatar's border is the user's colour, matching the cursor /
  selection tint.

## Edge cases

- **Many users:** cap visible avatars (e.g. 5) and render a "+N"
  pill at the end. Hover / tap reveals the overflow list.
- **No other users present:** show just the local user's avatar (or
  hide the strip entirely — implementation-defined).
- **User profile image fails to load:** fall back to the initial
  circle.

## Visual feedback

- Avatar size: small enough not to crowd the header (~24–32px).
- Hover tooltip with the full user name.

## Rationale

Glanceable "who is here" indicator; complements the in-grid presence
indicators.
