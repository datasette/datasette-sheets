---
id: sheet.cell.open-api-url
title: "\"Open API URL\" opens the data-API URL for the current selection"
category: cell
status: draft
related:
  - sheet.cell.context-menu
  - sheet.cell.copy-api-url
---

## Trigger

- Click **Open API URL in new tab** in the cell context menu (see
  `sheet.cell.context-menu`).

## Effect

1. Build the data-API URL for the current selection — same shape as
   `sheet.cell.copy-api-url`.
2. Open the URL in a new browser tab/window with the
   ``noopener`` relationship (so the new tab can't navigate the
   opener).
3. Close the menu.

## Edge cases

- **Popup blocker active**: the new tab may not open; this is
  browser-controlled and not surfaced to the user.
- **Non-rectangular selection**: collapses to the bounding box.

## Visual feedback

- A new tab opens; the originating window stays where it is.

## Rationale

Most users want to *see* the API response, not just paste the URL
elsewhere. A direct open is one click instead of three (copy →
new-tab → paste). Pairs with the copy action so both common
follow-ups are available without touching the formula-bar dropdown.
