---
id: sheet.selection.header-range-tint
title: Row / column headers tint when a cell range intersects them
category: selection
status: draft
related:
  - sheet.selection.drag
  - sheet.selection.shift-click
  - sheet.selection.column-header-click
  - sheet.selection.row-header-click
---

## Trigger

- A cell selection spanning one or more rows and columns is active,
  and it was **not** initiated from a column or row header (no
  whole-column / whole-row selection is in effect).

## Effect

- Every column whose index appears in the selection gets a tinted
  header: lighter than the full-column-selected accent, heavier
  than the idle header style.
- Every row whose number appears in the selection gets the same
  tint on its row header.
- Text colour on tinted headers shifts to the accent for extra
  distinctness.

The tint is a purely visual cue — it does not change selection
state, focus, or any store.

## Edge cases

- **Whole-column selection active** (`sheet.selection.column-header-click`
  and friends): the clicked column gets the stronger
  "header-selected" style; the perpendicular axis (row headers)
  does **not** also light up. Same for whole-row selections. This
  keeps the visual scannable when a single-column click would
  otherwise tint all ~100 row headers.
- **Header already in the header-selected state:** the stronger
  style wins — the tint rule must not downgrade it.
- **Single-cell selection:** only the one column and the one row
  tint, highlighting the crosshair around the active cell.

## Visual feedback

- Header background: the subtle "highlight" fill (a step between
  the idle header colour and the full-select accent).
- Header text: accent colour.
- No animation; the tint appears and disappears with selection
  changes instantly.

## Rationale

Matches Google Sheets, where selecting `D4:E10` tints the D / E
column headers and the 4..10 row headers. Makes "where does my
selection start and end" readable at a glance without having to
count cells.
