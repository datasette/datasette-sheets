---
id: sheet.clipboard.paste-fill-selection
title: Paste a single-cell source fills the entire selection
category: clipboard
status: draft
related:
  - sheet.clipboard.paste
  - sheet.clipboard.paste-formula-shift
  - sheet.clipboard.copy
---

## Trigger

- Paste shortcut (Cmd/Ctrl+V) or context-menu Paste.
- Preconditions:
  - The clipboard payload is exactly **1×1** (a single source cell).
  - The current selection contains **more than one cell**.
  - Standard paste preconditions hold (focus inside the sheet, no
    cell in edit mode).

## Effect

1. For every cell in the current selection (the literal `selectedCells`
   set — sparse selections built via Cmd-click are honoured, not just
   the bounding rectangle), write the source cell's value to that
   target.
2. If the source carries a formula and the payload's `sourceAnchor`
   is present (intra-app copy), the formula is rewritten **per-target**
   — each target gets its own `(dRow, dCol)` delta computed from
   `sourceAnchor`, and `shiftFormulaRefs` is applied with that delta.
   The same absolute / relative / `#REF!` rules from
   `sheet.clipboard.paste-formula-shift` apply.
3. If the source has bold formatting, every filled cell gains bold.
   (Bold is only set, never cleared — same rule as the standard
   paste.)
4. Cut handling is unchanged: if the clipboard mark is in `cut` mode,
   the source cell is cleared once after the fill (unless a target
   overlaps it), and the mark drops.

## Edge cases

- **Source is non-formula** (e.g. the literal `5`, or `hello`): every
  selected cell receives the same value — no per-target shift since
  there are no refs.
- **Source is an absolute-only formula** (`=$A$1*2`): every selected
  cell receives the identical formula, since `$A$1` doesn't shift.
- **Selection is sparse** (Cmd-click of A1, C3, E5): only those
  three cells are filled. Cells in the bounding box that aren't in
  the selection are untouched.
- **Selection includes the source cell**: the source is overwritten
  by its own (zero-delta) copy. No special-casing needed; the result
  is identical to the original.
- **Multi-cell payload pasted into a multi-cell selection**: this
  rule does **not** apply. Falls through to the standard paste at
  the anchor (`sheet.clipboard.paste`). Tiling a >1×1 source across
  a larger selection is intentionally out of scope for now.
- **External clipboard** (no `sourceAnchor`): the value is filled
  across the selection. Without an anchor we can't shift formulas,
  but external clipboards rarely carry formula text anyway — they
  carry the computed value as plain text (see `sheet.clipboard.copy`).

## Visual feedback

- No special animation. Each target cell updates to its (possibly
  shifted) value. Existing selection is not changed.
- If a fill consumes a cut mark, the dashed border disappears as
  the source clears.

## Rationale

Standard "drag-fill" UX expressed via paste rather than a fill
handle. The common workflow is "I have `=A2*2` in B2; I want the
same formula in B3:B100." Without this rule the user has to copy
B2 and then individually paste at every target row. Excel and
Google Sheets have used this convention for decades. Combined
with `sheet.clipboard.paste-formula-shift` it covers the bulk of
formula propagation use cases.

## Notes

**Web (JS/Svelte):** implemented in
`SheetsPage.svelte::applyClipboardGrid`. The branch fires when the
parsed clipboard grid is 1×1 and `$selectedCells.size > 1`.
