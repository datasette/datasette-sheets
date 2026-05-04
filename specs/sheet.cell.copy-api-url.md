---
id: sheet.cell.copy-api-url
title: "\"Copy API URL\" copies the data-API URL for the current selection"
category: cell
status: draft
related:
  - sheet.cell.context-menu
  - sheet.cell.open-api-url
  - sheet.formula-bar.dropdown
---

## Trigger

- Click **Copy API URL** in the cell context menu (see
  `sheet.cell.context-menu`).

## Effect

1. Build the data-API URL for the current selection:
   - **Single cell**: path-style — `…/data/A1`
   - **Range**: query-style — `…/data?range=A1:B5`
2. Write the URL to the OS clipboard as plain text.
3. Close the menu.

## Edge cases

- **No active sheet** (shouldn't happen in normal use): no-op.
- **Clipboard write fails** (permissions, insecure context): surface
  the error in a native alert; the menu is still closed.
- **Non-rectangular selection**: the range collapses to its bounding
  box (same rule as elsewhere — see `sheet.formula-bar.label`).

## Visual feedback

- None besides the menu closing. (No "Copied!" toast yet.)

## Rationale

Right-click is where users go for "what can I do with this thing?",
and the data-API URL is one of the most common things users want for
the selection. Mirrors the formula-bar dropdown's existing
"Copy cell/range API URL" item so both surfaces produce the same
URL.
