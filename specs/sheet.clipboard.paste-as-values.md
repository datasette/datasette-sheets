---
id: sheet.clipboard.paste-as-values
title: Paste calculated values only (Cmd/Ctrl+Shift+V)
category: clipboard
status: draft
related:
  - sheet.clipboard.paste
  - sheet.clipboard.paste-formula-shift
  - sheet.clipboard.copy
---

## Trigger

- The platform's "paste values only" shortcut: Cmd+Shift+V on
  macOS, Ctrl+Shift+V elsewhere.
- Preconditions: a cell is selected (the "anchor"), no cell is in
  edit mode, and focus is not inside a non-sheet text input.

## Effect

1. Read the OS clipboard via `navigator.clipboard.read()` and parse
   it the same way as a regular paste (HTML table → TSV → plain text).
2. For each parsed cell, ignore the `formula` marker and ignore any
   intra-app source-anchor: the cell's displayed text (i.e. the
   `value` field as seen in the clipboard html / plain text) is
   written verbatim to the target.
3. Format attributes (bold, italic, colors, alignment, font size,
   control type, dropdown rule) on the source are **not** carried
   over. The target cell's existing format is preserved unchanged.
4. Snapshot for undo, then write into target cells starting at the
   anchor — same anchor / clamping / single-source-fill rules as
   `sheet.clipboard.paste`.
5. If the current clipboard mark is in `cut` mode, source clearing
   and mark teardown follow the regular paste rules.

## Edge cases

- **Intra-app paste of a formula:** the formula is dropped; the
  computed value (as serialised in the html `<td>` text content
  and the plain-text TSV) is what lands. A cell whose source said
  `=URL_PATH_SEGMENT(F2,1)` displaying `mundaecoffee` pastes as
  the literal text `mundaecoffee`.
- **External paste from Google Sheets / Excel:** the
  `data-sheets-formula` attribute (which Google Sheets also emits)
  is ignored, so the destination receives the displayed text
  rather than a Google-Sheets-syntax formula that lotus-core may
  not implement.
- **Single-cell paste onto a multi-cell selection:** fills every
  cell with the source value. No formula re-shifting is performed
  because no formula is pasted.
- **No clipboard permission / empty clipboard:** silently no-ops,
  same as the menu-driven `pasteFromMenu` path.
- **Focus in an external text input:** do not intercept; let the
  platform handle the paste.

## Visual feedback

- No special animation. Target cells update to the new values;
  selection is unchanged. Cut-mode marks clear if a cut is
  consumed.

## Rationale

Matches Google Sheets' "Paste values only" behaviour. The most
common reason to reach for it is exactly the case demonstrated by
intra-app or external spreadsheet sources where the formula
references would not resolve at the destination (different sheet,
different workbook, function not implemented in lotus-core). It
also lets users escape style on rich pastes when they only want
the data.

## Notes

**Web (JS/Svelte):** browsers do not fire a `paste` event for
Cmd+Shift+V outside of contenteditable surfaces, so this binding
is implemented as a `keydown` handler that explicitly reads via
`navigator.clipboard.read()`. Implementation in
`sheetClipboard.ts::pasteValuesShortcut` and
`sheetKeyboard.ts::handleDocumentKeydown`.
