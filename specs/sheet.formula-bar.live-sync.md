---
id: sheet.formula-bar.live-sync
title: Formula bar and in-cell editor mirror each other in real time
category: formula-bar
status: draft
related:
  - sheet.editing.formula-bar
  - sheet.editing.double-click
---

## Trigger

- Cell is in edit mode.

## Effect

- When the edited cell matches the active cell, the formula bar's
  input and the cell's in-place input share the same edit-value
  state:
  - Typing in either updates the other immediately.
  - The caret position in the non-focused editor is unspecified;
    only the content syncs.
  - When edit mode is not active, the bar shows the active cell's
    raw value (formula text, not displayed value).

## Edge cases

- **Edit mode on a cell that is not the active cell:** should not
  occur under normal operation (activating a cell for edit also
  makes it active), but implementations should be defensive —
  display the raw value of the edited cell in the bar.
- **Formula-ref pointing active:** pointing moves the reference in
  the edit value; the bar's display updates live (the coloured-
  token overlay may or may not render in the bar — optional).
- **Paste into the bar:** identical effect to paste into the cell
  input.

## Visual feedback

- Both inputs show the same text at all times while edit mode is
  active.

## Rationale

Users expect parity — it's one value, two surfaces.
