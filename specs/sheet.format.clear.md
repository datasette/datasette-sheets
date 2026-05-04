---
id: sheet.format.clear
title: Toolbar clear-format button resets to general format
category: format
status: draft
related:
  - sheet.format.currency
  - sheet.format.percentage
  - sheet.format.number
---

## Trigger

- Click the eraser icon in the toolbar, or press Cmd+\ / Ctrl+\ on a
  focused cell not in edit mode.

## Effect

- Reset **every** format field on each selected cell to its default:
  `type=general`, `bold=false`, `italic=false`, `underline=false`,
  `strikethrough=false`, and `textColor / fillColor / hAlign /
  vAlign / wrap / fontSize / borders` all unset.
- Recalculate so type-driven display (currency, percentage) reverts.
- Display reverts to:
  - Integers render without decimals.
  - Floats render with up to ~12 characters of precision; beyond
    that, switch to a `toPrecision(10)`-style abbreviation.
  - Strings render verbatim.
  - No weight / style / color / alignment overrides remain.

## Edge cases

- **Applied to a cell whose format is already default:** still
  pushes an undo snapshot but is otherwise a visual no-op.
- **Multi-cell selection:** clears every cell in the selection.
- **In edit mode:** Cmd+\ is not claimed — any native handler sees
  it. The button can still be clicked while editing because the
  toolbar buttons don't steal focus.

## Visual feedback

- Selected cells snap back to default rendering immediately.

## Rationale

Fast escape hatch for any combination of format overrides. Matches
Google Sheets' Cmd+\ which clears all format attributes, not just
the number-format type.

## Notes — history

Originally this action only reset `type` to `general`, leaving bold
and other flags intact. It was extended to clear every format field
when the formatting surface grew beyond number formats — see
`TODO-styling.md` §12.
