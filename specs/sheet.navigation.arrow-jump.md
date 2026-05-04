---
id: sheet.navigation.arrow-jump
title: Cmd/Ctrl+Arrow jumps to content boundary or grid edge
category: navigation
status: draft
related:
  - sheet.navigation.arrow
  - sheet.navigation.shift-arrow-jump-extend
---

## Trigger

- Cmd+Arrow on macOS, Ctrl+Arrow elsewhere. One of the four
  directions: up, down, left, right.
- Precondition: a cell has focus and no cell is in edit mode.

## Effect

Move focus from the current cell to a target determined by the
"content-aware jump" rules. Define:

- A cell is **filled** if its raw value (formula text or literal) is
  a non-empty string after trimming whitespace.
- A cell is **empty** otherwise.
- The **neighbour** is the next cell in the direction of the arrow.

Rules, evaluated in order:

1. **At the grid edge** in the direction of the arrow: stay put.
2. **Current filled AND neighbour filled:** walk forward while the
   next cell is also filled; stop on the last filled cell in the
   contiguous run. (Jump to end-of-block.)
3. **Otherwise** (current empty, or current filled but neighbour
   empty): skip past all empty cells to the first filled one. If no
   filled cell exists in that direction, snap to the grid edge.

After the target is determined, move focus and solo-select it (the
previous selection is discarded, same as a plain arrow key). The
selection anchor moves to the target as well.

## Edge cases

- **Entire column/row empty in the direction of travel:** land on
  the grid edge (last row / last column).
- **Two adjacent filled cells at the very edge:** rule 1 fires
  first (already at edge) and the key is a no-op. The jump-to-end
  rule never tries to walk off the grid.
- **Mixed filled / empty values with formatting but no content:**
  formatting alone does not make a cell "filled" — only a non-empty
  raw value counts.
- **Read-only or protected cells:** treated like any other cell for
  the purpose of the jump.

## Visual feedback

- Previous cell loses its selection highlight; target cell gains it.
- No scroll animation is required, but the viewport must scroll to
  keep the target cell visible if it lands off-screen.

## Rationale

Matches Google Sheets and Excel ("jump to end of data"). Users rely
on this for fast traversal of wide tables; the content-awareness
differentiates it from `home` / `end`, which go to the absolute
row/column edge regardless of content.

## Notes

**Performance:** on very large grids the implementation should
short-circuit rather than scan the full axis. The three rules above
visit each cell at most once along the path — worst case is the
snap-to-edge on an empty grid, which is O(N) cells in that
direction. Treat this as the expected upper bound; implementations
should not pre-scan the whole grid on each keypress.

**Shift modifier:** combining Shift with Cmd/Ctrl+Arrow extends the
current selection to the same target rather than just moving focus —
see `sheet.navigation.shift-arrow-jump-extend`.
