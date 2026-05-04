---
id: sheet.clipboard.paste
title: Paste clipboard contents at selection anchor
category: clipboard
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.cut
  - sheet.clipboard.mark-visual
  - sheet.clipboard.paste-formula-shift
  - sheet.clipboard.paste-fill-selection
  - sheet.undo.scope
---

## Trigger

- The platform's paste shortcut (Cmd+V / Ctrl+V) or system paste
  command.
- Preconditions: a cell is selected (the "anchor"), no cell is in
  edit mode, and focus is not inside a non-sheet text input
  (otherwise the platform's default text paste wins).

## Effect

1. Parse the clipboard payload into a 2-D `grid` of format-aware
   entries. Priority order:
   1. A rich tabular format if present (HTML `<table>`, etc.). Extract
      `value` from the cell's text content. Detect formatting from
      inline styles and semantic tags:
      - **bold** (`font-weight:bold`, `<b>`, `<strong>`, `<th>`)
      - **italic** (`font-style:italic`, `<i>`, `<em>`)
      - **underline** (`text-decoration:underline`, `<u>`)
      - **strikethrough** (`text-decoration:line-through`, `<s>`,
        `<strike>`, `<del>`)
      - **textColor** (`color:`)
      - **fillColor** (`background-color:` / `background:`)
      - **hAlign** (`text-align: left | center | right`)
      - **fontSize** (`font-size:` in pt / px / em)
   2. Plain text. If the first line contains a tab, treat as TSV.
      Otherwise if the first line contains a `|`, treat as a Markdown
      table (strip separator rows, split on `|`, trim cells). Else
      treat the full trimmed string as a single-cell paste.
2. Snapshot for undo.
3. Starting at the anchor's coordinates, write each `grid[r][c]` to
   the corresponding target cell. Any format attributes present on the
   source are **additively** applied to the target (the target's other
   format fields are preserved). If the payload originated from an
   intra-app copy and the cell carries a formula marker, the formula
   is rewritten to shift relative refs by the source→target delta —
   see `sheet.clipboard.paste-formula-shift`.
4. If the current clipboard mark is in `cut` mode: clear every cell
   in the marked source range that wasn't overwritten by the paste
   itself (self-overlap keeps the new value), then drop the mark.
   If the mark is in `copy` mode or there is no mark: sources are
   untouched, mark stays.

## Edge cases

- **Paste larger than remaining grid:** clamp to the grid edge. Cells
  that would land past the last column or last row are silently
  dropped.
- **Single-cell paste onto a multi-cell selection:** fills the entire
  selection with the source value, re-shifting any formula per-target.
  See `sheet.clipboard.paste-fill-selection`. Multi-cell paste onto a
  multi-cell selection still starts at the anchor and ignores the
  rest of the selection (no tiling yet).
- **Overlapping cut + paste:** cells in the intersection keep their
  new value; only source-exclusive cells are cleared.
- **Clipboard contains a single cell of pure text with no tabs / no
  pipes:** treat as a 1×1 paste; the anchor cell receives the string.
- **Focus in an external text input:** do not intercept; let the
  platform handle the paste.

## Visual feedback

- No special paste animation. Target cells simply update to the new
  values; existing selection does not change.
- If the paste consumed a cut mark, the dashed border disappears as
  the source cells clear.

## Rationale

Matches Excel / Google Sheets. Rich-format-first parsing gives
high-fidelity round-trips with those apps; Markdown-table support
is a quality-of-life affordance for pasting from docs / chat /
issue trackers.

## Notes

**Web (JS/Svelte):** handled on the document-level `paste` event so
it fires regardless of which element inside the sheet has focus.
Call `preventDefault()` on the event once the payload is parsed so
the browser doesn't also attempt a default text paste.

**Swift:** `NSPasteboard.general` — read `.html` first, fall back
to `.string`.

**TUI:** most terminals deliver paste as a single chunk of text;
parse TSV / markdown-pipes only (no HTML).
