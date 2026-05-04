---
id: sheet.cell.pin
title: Host-injected spill values (pin overlay)
category: cell
status: draft
related:
  - sheet.cell.spill
  - sheet.cell.sql-array-formula
---

## Trigger

- A frontend feature (today: `=SQL(…)`; later: `=IMPORTJSON(…)`,
  etc.) has an async or external data source and needs to surface
  its result as cell values without the engine owning the fetch.

## Effect

1. The host calls `pinValue(cellId, rows)` with a 2-D string array.
2. The engine treats the pin as if the cell's formula had returned
   that array: 1×1 is a scalar, anything larger spills into
   neighbouring cells with the same blocker / `#SPILL!` rules as a
   native array formula.
3. Precedence: **pin > native spill > formula eval > empty**. If
   the cell also has a raw formula, the formula is skipped on
   every recalc while the pin is active.
4. Dependency tracking is identical to a native spill. A cell
   doing `=SUM(A1#)` sees the pinned array; re-pinning with new
   data invalidates and re-runs the dependent on next recalc.
5. `unpinValue(cellId)` drops the overlay. On the next recalc the
   cell falls back to evaluating its own formula (or empty if it
   has none).

## Edge cases

- **Pin region overlaps an authored cell**: pin is accepted but
  the anchor flips to `#SPILL!`; no member cells are written.
  Matches native spill semantics.
- **Sheet switch**: all pins are dropped. Pins are scoped to a
  sheet because they share the cell-id namespace — otherwise a
  pin at `B2` on Sheet 1 would apply to `B2` on Sheet 2.
- **Engine rebuild on recalc**: the host-side pin map is
  reapplied to every fresh `WasmSheet` inside `loadIntoEngine`,
  so pins survive the many recalc cycles a single user action
  triggers.
- **Persistence**: pins are session-only. Nothing is saved; the
  host re-installs pins (e.g. by re-issuing the `=SQL(…)` fetch)
  on the next page load.

## Visual feedback

- Pinned cells take the same `spill-anchor` / `spill-member`
  styling as native array formulas; the source of the array isn't
  distinguished in UI today.

## Rationale

Keeps the Rust engine synchronous, plugin-free, and single-language
— fetch/credentials/HTTP stay in the frontend where they belong.
Dependency graph and spill placement stay engine-owned so features
that layer on top of pins (`=SQL`, `=IMPORTJSON`, anything else
async) don't re-implement that machinery. See
`TODO-liblotus-host-spills.md` for the engine-side design.
