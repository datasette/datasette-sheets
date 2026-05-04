---
id: sheet.delete.refs-rewrite
title: Formulas referencing deleted rows/columns shift or become `#REF!`
category: delete
status: draft
related:
  - sheet.delete.row-confirm
  - sheet.delete.column-confirm
  - sheet.insert.refs-rewrite
  - sheet.column.drag-reorder
  - sheet.row.drag-reorder
---

## Trigger

- Row or column delete is applied (either optimistically in the
  client or authoritatively in the persistence layer).

## Effect

For every formula in any remaining cell:

1. **Refs entirely inside the deleted range:** replace the reference
   token with `#REF!`. The formula still exists but evaluates to
   an error referencing the broken ref.
2. **Refs past the deleted range** (higher row index, or further-
   right column, in the direction of the shift): shift the ref by
   the delete count so it continues to point at the same underlying
   data. E.g. delete row 3; a formula `=A5` becomes `=A4`.
3. **Range refs that straddle the deleted block** (e.g. `A1:A10`
   when rows 3–5 are deleted): trim the range. `=SUM(A1:A10)`
   becomes `=SUM(A1:A7)`.
4. **Whole-column / whole-row refs** (e.g. `A:A` or `1:1`): remain
   valid after shift; just re-letter / re-number if the whole
   column/row was deleted (the ref becomes `#REF!` in that case).

The rewrite must be identical whether performed client-side for
optimistic UI or server-side for persistence. A shared, deterministic
grammar for refs is required.

## Edge cases

- **Formula inside the deleted range itself:** the cell goes away
  with the range; no rewrite needed.
- **Named ranges pointing into the deleted area:** follow the same
  rules; fully-deleted named ranges become `#REF!`. Definitions
  starting with `=` go through the same engine rewrite; literal
  definitions (e.g. `0.05`) are untouched.
- **Persisted SQL views over the deleted range:** the registry's
  `min_row` / `max_row` / `min_col` / `max_col` bounds are
  recomputed as the bounding box of every surviving forward-mapped
  index. Views whose entire range is deleted have their bounds
  left stale (broken-view UX is a future follow-up).
- **Circular / self-referential refs:** rewrite is mechanical; any
  evaluation error is handled by the formula engine, not this spec.

## Visual feedback

- Cells whose formula now reads `#REF!` render in the error colour
  (see `sheet.format.error-color`).

## Rationale

Matches Excel / Google Sheets exactly. Users rely on formulas
"following" the data when columns or rows are removed; breakage is
signalled loudly via `#REF!` when it can't be avoided.

## Notes

**Implementation:** the rewrite grammar is complex enough that it
should live in a single shared library (e.g. a Rust formula engine
compiled to both a native binding and WASM) rather than being
re-implemented per platform. See the `datasette-sheets` approach of
delegating this to `lotus-core` via both pyo3 and wasm-bindgen.
