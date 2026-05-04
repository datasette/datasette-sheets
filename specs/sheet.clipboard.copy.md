---
id: sheet.clipboard.copy
title: Copy selection to clipboard
category: clipboard
status: draft
related:
  - sheet.clipboard.cut
  - sheet.clipboard.paste
  - sheet.clipboard.mark-visual
  - sheet.clipboard.escape-cancels-mark
---

## Trigger

- The platform's copy shortcut (Cmd+C on macOS, Ctrl+C elsewhere), or
  the system "Copy" menu command.
- Preconditions: at least one cell is selected, no cell is in edit
  mode, and focus is inside the sheet surface (or on no other text
  input).

## Effect

1. Determine the bounding rectangle of the current selection. Selections
   are treated as rectangular even when built up via `cmd-click`
   toggles — iterate the full box and treat cells that aren't in the
   selection as empty.
2. For each cell in the rectangle, produce:
   - `value` — the **displayed** value, not the raw formula. A cell
     holding `=1+1` contributes `2`. A cell holding a formula error
     contributes its error string (e.g. `#REF!`).
   - `bold` — true if the cell is formatted bold.
   - `numeric` — true if the displayed value is a number.
3. Write the grid to the OS clipboard in **at least** two formats:
   - A rich tabular format (HTML `<table>` on web; NSAttributedString
     or similar on native) that preserves bold and numeric hints so
     round-trips into other spreadsheets keep formatting.
   - A plain-text TSV (tab between columns, newline between rows, no
     trailing newline).
4. The rich format additionally carries an **app-private**
   formula-round-trip channel (see `sheet.clipboard.paste-formula-shift`):
   - The container element gets a source-anchor marker identifying the
     top-left cell of the copied range (e.g.
     `data-sheets-source-anchor="B2"` on the `<table>`).
   - Any cell whose source had a formula carries the raw formula text
     as a per-cell marker (e.g. `data-sheets-formula="=A2*B1*4"`).
   - External apps ignore unknown attributes — the visible value /
     bold / numeric formatting are unchanged, and the plain-text TSV
     stays computed values. Paste back into datasette-sheets uses the
     markers; paste into Excel / Sheets / docs / email behaves
     identically to before.
5. Mark the copied range with a visible clipboard mark in `copy` mode.
   See `sheet.clipboard.mark-visual`.

## Edge cases

- **Single cell:** the grid is 1×1; TSV is a single value with no
  tabs and no newline.
- **Formula error in a cell:** the error string is copied as the
  cell's value.
- **Empty holes in a non-rectangular selection:** contribute empty
  strings to the grid, not sparse gaps.
- **Focus in a text widget outside the sheet** (e.g. a rename input,
  the URL bar): do not intercept the copy; let the platform handle
  it. The sheet's clipboard mark does not change.
- **Nothing selected:** no-op. Do not clear the existing clipboard
  mark.

## Visual feedback

- Immediately on copy, the source range receives the clipboard mark
  (a dashed outline in the accent colour). The mark persists after
  subsequent pastes — the user can paste again — and is only cleared
  by Escape, a fresh copy/cut, or a sheet change.

## Rationale

Matches the standard Excel / Google Sheets behaviour. Copying computed
values (not formulas) gives the user "what they see is what they
copy"; writing both rich and plain formats keeps round-trips with
other apps lossless. The persistent mark after paste is Google
Sheets' convention and supports repeat-paste workflows.

## Notes

**Web (JS/Svelte):** implemented on the `copy` DOM event; write
`text/html` and `text/plain` via `ClipboardEvent.clipboardData`,
then call `preventDefault()` to suppress the browser's default
(which would serialise selected DOM text, not grid values).

**Swift (AppKit):** write `NSPasteboard.PasteboardType.html` and
`.string`.

**TUI:** the rich format may not apply; fall back to TSV only, but
still paint the clipboard mark so the user sees that a copy
happened.
