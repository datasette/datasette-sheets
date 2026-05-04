---
id: sheet.status-bar.count-only
title: Non-numeric multi-cell selection shows just the cell count
category: status-bar
status: draft
related:
  - sheet.status-bar.numeric-stats
---

## Trigger

- The selection contains more than one cell AND no cell in the
  selection has a numeric computed value.

## Effect

- Render "N cells selected" in a muted colour in the status bar.
  No aggregates.

## Edge cases

- **Single cell selection:** status bar hides entirely (no count
  needed).
- **Mixed selection that becomes all-non-numeric after an edit:**
  the status bar transitions smoothly from full stats to count-only
  as the numeric values are cleared.

## Visual feedback

- Muted-grey text; same row as the full-stats display.

## Rationale

Still gives users a "you have N cells selected" confirmation without
cluttering the status bar with meaningless zeros.
