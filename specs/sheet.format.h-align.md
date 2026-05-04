---
id: sheet.format.h-align
title: Explicit horizontal alignment overrides the numeric auto-rule
category: format
status: draft
related:
  - sheet.format.numeric-align-right
  - sheet.format.v-align
---

## Trigger

- Click one of the three horizontal-alignment buttons in the toolbar
  (left / center / right) with a selection active.

## Effect

- Set `hAlign` on every selected cell to the chosen value.
- Pushes an undo snapshot and marks each cell dirty.
- The cell's text immediately re-renders with the chosen
  `text-align`.

## Edge cases

- **Numeric cell:** explicit alignment overrides the auto-right rule
  (see `sheet.format.numeric-align-right`). The accent colour also
  drops — the cell renders in the default text colour once the user
  has taken an explicit alignment decision.
- **No explicit alignment set:** falls back to the auto rule —
  numbers right (accent), strings left (text colour).
- **Multi-cell selection:** every cell in the selection gets the
  same alignment value.
- **No selection:** no-op.

## Visual feedback

- The active toolbar button is visually depressed (matches pattern
  on the bold / italic / underline / strikethrough toggles).
- Cell text re-aligns immediately.

## Rationale

Alignment is an authoring decision, not a derived one — once the
user picks it, their choice overrides the auto-by-type default. The
accent colour is dropped alongside the alignment because both
belong to the same "this is a number" cue; a user who aligned a
number left probably doesn't want it flagged as numeric.
