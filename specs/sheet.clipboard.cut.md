---
id: sheet.clipboard.cut
title: Cut selection to clipboard
category: clipboard
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.paste
  - sheet.clipboard.mark-visual
---

## Trigger

- Platform cut shortcut (Cmd+X / Ctrl+X) or system "Cut" menu command.
- Same preconditions as copy: at least one cell selected, no cell in
  edit mode, focus not in an external text input.

## Effect

1. Write the selection to the OS clipboard in the same formats as
   `sheet.clipboard.copy` — HTML table + TSV.
2. Mark the source range with the clipboard mark in **`cut` mode**.
3. Do **not** remove or clear the source cells yet. They remain
   intact until a paste consumes the mark (at which point
   `sheet.clipboard.paste` clears non-overlapping sources) or the
   user cancels the mark (Escape, new copy/cut, sheet switch).

## Edge cases

- **Cut same as copy except mark mode:** the visual dashed border is
  identical to copy; only the subsequent paste behaviour differs.
- **Cut then Escape then paste:** paste behaves as copy did (sources
  stay) because the cut mark was cancelled. See
  `sheet.clipboard.escape-cancels-mark`.
- **Cut then another cut/copy:** the new mark replaces the old one;
  the old sources are never consumed.

## Visual feedback

- Dashed outline in the accent colour around the source range —
  indistinguishable from copy at this stage.

## Rationale

Matches Google Sheets' "cut is deferred until paste" model. This
avoids the "paste failed, my data is gone" footgun of immediate-
cut implementations.
