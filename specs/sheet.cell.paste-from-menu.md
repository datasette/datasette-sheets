---
id: sheet.cell.paste-from-menu
title: "\"Paste\" in the cell context menu pastes from the OS clipboard"
category: cell
status: draft
related:
  - sheet.cell.context-menu
  - sheet.clipboard.paste
---

## Trigger

- Click "Paste" in the cell context menu.

## Effect

- Read the OS clipboard (rich `text/html` first, falling back to
  `text/plain`) and apply it at the active cell. Behaviour
  thereafter matches `sheet.clipboard.paste`: a TSV / table grid
  expands rightwards and downwards from the active cell, and a
  pending "cut" marker is consumed (its source cells are cleared).

## Edge cases

- **Browser denies clipboard read**: the menu action is a no-op; no
  alert is shown (the user can fall back to Cmd/Ctrl+V which uses
  the standard OS-permitted path).
- **No active cell**: no-op.
- **Clipboard is empty**: no-op.

## Visual feedback

- Same as `sheet.clipboard.paste`: cells light up with the pasted
  content; the dashed source border drops if the marker was a cut.

## Rationale

Right-click Paste is what users expect, even though Cmd/Ctrl+V is
more reliable cross-browser. Best-effort here keeps the menu
complete without breaking the existing keyboard path.
