---
id: sheet.formula-bar.dropdown
title: Formula bar label opens a menu of selection-related actions
category: formula-bar
status: draft
related:
  - sheet.formula-bar.label
  - sheet.view.triangle-indicator
---

## Trigger

- Click on the formula-bar label box (chevron indicates clickable).

## Effect

Toggle a dropdown menu. Contents depend on current state:

- **Named view mode active:**
  - "View in Datasette" — opens the view's URL in a new tab.
  - "Delete view" — after confirm, deletes the view definition.
- **Single-cell selection (no view):**
  - "Copy cell API URL" — writes a URL pointing at the cell's
    value API endpoint to the clipboard.
- **Range selection (no view):**
  - "Copy range API URL" — clipboard URL with `?range=A1:C3`.
  - "Create view…" — opens the view-creation dialog.

The menu dismisses on outside click or Escape.

## Edge cases

- **No selection:** menu items related to selection are hidden /
  disabled.
- **Platform has no URL concept** (e.g. native desktop without a
  server backend): "Copy API URL" items are omitted.

## Visual feedback

- Menu anchors below the label box.
- Copy actions may show a brief "copied!" confirmation.

## Rationale

Pulls platform-specific actions (URL-bearing, server-integrated) out
of the toolbar and into a contextual menu tied to the current
selection / view.

## Notes

Several actions here are Datasette-specific (URLs pointing at a
Datasette backend). A non-Datasette implementation may replace
these with its own "what can you do with this cell / range" actions
but should keep the menu anchored to the label.
