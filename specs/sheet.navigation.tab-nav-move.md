---
id: sheet.navigation.tab-nav-move
title: Tab in nav mode moves focus one column right (Shift+Tab left)
category: navigation
status: draft
related:
  - sheet.navigation.arrow
  - sheet.navigation.tab-commit-right
---

## Trigger

- Tab or Shift+Tab.
- Preconditions: a cell has keyboard focus, no cell is in edit mode.

## Effect

1. Move focus one cell to the right (Tab) or left (Shift+Tab).
2. Solo-select the target cell — the previous selection (including
   any multi-cell rectangle) is discarded.
3. Set the selection anchor to the target cell.
4. Scroll the viewport to keep the target visible if needed.

## Edge cases

- **At the grid edge in the direction of travel:** no-op. Focus and
  selection stay put.
- **In edit mode:** Tab commits and moves right as specified by
  `sheet.navigation.tab-commit-right`; this rule does not apply.
- **Focus not on a cell** (toolbar button, formula bar, rename input,
  etc.): Tab has its default focus-traversal behaviour.

## Visual feedback

- Previous cell loses the selected inner border; target cell gains
  it. Matches the arrow-key navigation feedback exactly.

## Rationale

Row-major keyboard navigation, paired with arrow keys for the four
axes. Without this rule the browser's default Tab moves DOM focus
between `tabindex="0"` cells but leaves the selection store stale,
so the selected outline and the focused cell disagree until the
next store-touching keystroke.
