---
id: sheet.cell.spill
title: Array formulas spill their result into adjacent cells
category: cell
status: draft
---

## Trigger

- A user-authored formula evaluates to a >1×1 array. Sources:
  - An array-returning function: `SEQUENCE`, `TRANSPOSE`, `FILTER`,
    `SORT`, `UNIQUE`.
  - A broadcast over a range: `=A1:A5 * 2`.
  - An inline array literal: `={1,2;3,4}`.
  - A spill-operator read: `=A1#` where `A1` is already an anchor.

## Effect

1. The cell holding the formula becomes the **spill anchor** — its
   own value is the top-left of the result array.
2. The engine fills the rest of the rectangle into adjacent cells
   (**spill members**). Spill members carry the computed value but
   no user-authored `rawValue` — they're not persisted by the save
   layer.
3. Anchors render with a subtle coloured left edge; members
   render in italic, muted text. The distinction reads at a glance
   as "authored" vs "filled by an authored formula".
4. When another cell references the anchor's full region via the
   `A1#` operator (e.g. `=SUM(A1#)`), the formula-ref highlighter
   paints the entire live region by consulting the engine's
   `spillAt(anchor)` on each keystroke.
5. When the user edits the anchor and the result array shrinks,
   the previously-filled cells drop back to empty on the next
   recalc — the engine omits them from `get_all()` and the store
   clears their computed value.

## Edge cases

- **Spill blocked by an existing value**: if any cell in the target
  rectangle (other than the anchor) is already user-authored or
  owned by another spill, the anchor renders `#SPILL!` and no
  overflow cells are filled. Existing values are untouched.
- **1×1 result**: stays scalar — no anchor / member classification,
  no left-edge indicator.
- **Editing a spill member**: allowed today. The user's input wins
  on the next recalc, which then blocks the anchor and flips it to
  `#SPILL!`. Matches Excel / Google Sheets — the user who authors
  last is the authority.
- **`A1#` referencing a non-anchor**: the spill-ref expander falls
  back to highlighting the anchor cell only (safer than painting
  the anchor's stale prior region).

## Visual feedback

- Anchor: `inset 2px 0 0 var(--sheet-accent)` (left edge).
- Member: italic text in the secondary text colour.
- `#SPILL!` follows the existing error styling — red cell text.

## Rationale

Array formulas in Excel 365 / Google Sheets (dynamic arrays) let a
single authored formula populate a grid of cells. Surfacing this as
an explicit anchor + member split — instead of silently treating
every filled cell as authored — prevents the classic "I can't
delete this cell" confusion: the member is clearly a downstream
render, and users who want to remove the region edit the anchor,
not each member.

The engine (liblotus `lotus-core`) owns placement, blockers,
and fixed-point recalculation; the frontend only visualises its
`spill_at` / `owned_by` / `get_array` queries.
