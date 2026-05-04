---
id: sheet.column.resize-drag
title: Drag the right edge of a column header to resize the column
category: column
status: draft
related:
  - sheet.column.auto-fit-double-click
---

## Trigger

- Mousedown on the resize handle — a narrow region (~4–6px) at the
  right edge of a column header. The handle overlaps the edge
  slightly (a few px into each side) for easier targeting.
- User drags the pointer left or right before releasing.

## Effect

1. Record the starting pointer x, starting column width, and target
   column.
2. During drag (mousemove): `new_width = start_width + (current_x -
   start_x)`. Clamp at the minimum width (e.g. 40px). No maximum.
3. Release (mouseup): end the drag, persist the new width.

## Edge cases

- **Drag past the left edge of the column:** width clamps at the
  minimum; pointer can continue left but width stops.
- **Release outside the window:** window-level mouseup ends the drag.
- **Multi-column selection when drag starts:** does not extend the
  resize to the other selected columns (per-column resize only).
  Future work: option-drag to resize all selected.

## Visual feedback

- The pointer cursor becomes a horizontal resize cursor (e.g.
  `col-resize`) while over the handle and during the drag.
- The handle has a subtle hover indication when the pointer is over
  it (e.g. a dim vertical line) to reveal its existence.
- The column re-renders live at each mousemove — no "ghost line"
  preview.

## Rationale

Matches Excel / Google Sheets / Finder columns. Live resize is
preferred over ghost-line + commit because it lets users see
truncation in real time.
