---
id: sheet.clipboard.paste-formula-shift
title: Paste shifts relative formula refs by the source→target delta
category: clipboard
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.paste
---

## Trigger

- Paste at an anchor cell when the clipboard payload originated
  from a datasette-sheets copy in the same browser tab — i.e. the
  payload carries an app-private source-anchor marker (see
  `sheet.clipboard.copy`) and per-cell formula markers.

## Effect

1. Compute the delta from the copy's source anchor (top-left of
   the copied range) to the paste anchor:
   `(dRow, dCol) = paste_anchor - source_anchor`.
2. For each pasted cell that carries a formula marker, rewrite
   the formula by shifting every relative cell/range reference
   by `(dRow, dCol)`. Absolute components (`$A$1`) stay put.
   Mixed-absolute (`$A1`, `A$1`) shift only the relative axis.
3. References that would land outside the grid become `#REF!`
   (literal `#REF!` text in the formula). For ranges, an
   off-grid endpoint collapses the range to `#REF!`.
4. Cells without a formula marker (computed values, plain text,
   external paste) are pasted as values exactly as before.

## Edge cases

- **Cross-tab paste of an intra-app copy:** the markers are HTML
  attributes that survive the OS clipboard, so this works between
  tabs of the same browser. Cross-browser-profile or cross-machine
  paste falls through to value-only paste (no markers present).
- **External clipboard sources** (Google Sheets, Excel, copied
  from a docs table): no source-anchor marker → fall through to
  the existing value-paste path. We do not attempt to rewrite
  external formula syntax — different apps disagree on relative
  vs. R1C1 vs. cross-sheet semantics, and the plaintext clipboard
  carries computed values anyway.
- **Same-cell paste** (paste at the same anchor as the copy):
  delta is `(0, 0)`; refs are unchanged. Functionally identical
  to "duplicate the cell and its formula in place."
- **Off-grid shift:** a copy of `=A1` pasted in a way that would
  shift the ref to `=A0` puts `#REF!` in the formula's place,
  not the original `A1`.
- **Absolute-only formula** (`=$A$1*2`): pastes unchanged
  regardless of delta.
- **Named-range references** (`=my_range + 1`): never shift.
  Named ranges resolve in their own coordinate space; shifting
  them would break the abstraction.
- **Whole-column / whole-row refs** (`=SUM(A:A)`): shift by the
  column delta only; row delta is ignored. Symmetric for `1:1`.
- **Spill refs** (`=A1#`): the anchor cell shifts per its own
  `$` markers; the `#` suffix is preserved.
- **Cut + paste:** delta-shifting still applies. Cut semantics
  for clearing the source range are unchanged
  (`sheet.clipboard.paste`).

## Visual feedback

- No additional visual feedback. Pasted formulas display their
  freshly-computed values like any other formula commit. `#REF!`
  refs render in the standard error colour
  (`sheet.format.error-color`).

## Rationale

This is the standard relative-reference behaviour every
spreadsheet ships. Absolute markers (`$`) exist precisely so
users can opt out per axis. Doing the shift inside the WASM
engine (via `shiftFormulaRefs` → `WasmSheet.shift_formula_refs`)
keeps the rewrite consistent with how the engine itself parses
refs — JS or Python regex would drift from the grammar over
time.

## Notes

**Web (JS/Svelte):** the source-anchor marker travels as a
`data-sheets-source-anchor` attribute on the `<table>` element,
and per-cell formulas as `data-sheets-formula` attributes on the
`<td>`s. Other attributes / values / styling are unchanged so
external paste is unaffected. Implementation in
`SheetsPage.svelte::applyClipboardGrid` and the WASM wrapper in
`engine.ts::shiftFormulaRefs`.
