---
id: sheet.insert.refs-rewrite
title: Formulas referencing inserted rows/columns shift outward; straddled ranges grow
category: column
status: draft
related:
  - sheet.delete.refs-rewrite
  - sheet.column.insert-left-right
  - sheet.column.drag-reorder
  - sheet.row.drag-reorder
---

## Trigger

- Row or column insert is applied (either optimistically in the
  client or authoritatively in the persistence layer).

## Effect

For every formula in any remaining cell:

1. **Refs before every insertion point:** unchanged.
2. **Refs at or past an insertion point** (higher row/col index):
   shift outward by the count of insertions at-or-before their
   index. E.g. insert one row at row 3; a formula `=A5` becomes
   `=A6`. Inserting two rows at the same index shifts by two.
3. **Range refs whose endpoints straddle an insertion point**: grow
   to include the new blank row/col. `=SUM(A1:C1)` after inserting
   one blank column at index 1 becomes `=SUM(A1:D1)`. The engine
   treats the new blank as part of the pre-existing range because
   that's what the user expects — the range continues to mean "the
   same underlying data plus whatever the user now puts in the
   gap."
4. **Absolute components (`$`-prefixed)**: keep their markers but
   still shift positionally — `$B$2` with one column inserted at
   index 0 becomes `$C$2`. The `$` pins the ref to a cell, not to
   a literal index.
5. **Whole-column / whole-row refs** (e.g. `A:A`, `1:1`): shift the
   bounded axis if the insertion sits at-or-before its index; leave
   the unbounded axis alone.

No `#REF!` case: insertion only shifts refs forward, never off the
end of the addressable space.

The rewrite must be identical whether performed client-side for
optimistic UI or server-side for persistence — same determinism
requirement as the delete rewrite.

## Edge cases

- **Cell whose formula references the cell about to be occupied by
  the insertion**: still valid — the ref shifts with the data, and
  the newly-blank cell will contribute `0` / empty to sums,
  `""` to concatenations, etc., just like any empty cell would.
- **Named ranges pointing past an insertion**: follow the same
  rules; named-range definitions get rewritten in lockstep so
  formulas resolving through a name see the shifted underlying
  refs.
- **Persisted SQL views**: the registry's bounds shift the same
  way refs do — `min_col` / `max_col` (or row equivalents) move
  outward by the insertion count.

## Visual feedback

- None unique to this rule. Cells whose formulas changed are
  recomputed; any resulting error would render via the normal
  error colour rule.

## Rationale

Mirror of `sheet.delete.refs-rewrite` in the opposite direction.
Users rely on formulas "following" the data on both axes — whether
they delete a column or insert one, their formulas should continue
to point at the same underlying values, and ranges should grow to
include newly inserted space. Matches Google Sheets and Excel.

## Notes

**Implementation:** the rewrite grammar is owned by the Rust engine
(`lotus-core`). The primitives exposed to the two implementations
are `lotus.adjust_refs_for_insertion` (pyo3) and
`WasmSheet.adjust_refs_for_insertion` (wasm-bindgen). Callers pass
`inserted_cols=[at]*N, inserted_rows=[]` (or vice versa) — the
shape `[at, at, …]` encodes an N-wide insert at `at`.
