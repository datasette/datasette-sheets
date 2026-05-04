---
id: sheet.cell.custom
title: Engine-typed Custom values render via per-tag display rules
category: cell
related:
  - sheet.cell.boolean
  - sheet.cell.force-text
---

## Trigger

- Automatic, based on a cell's computed value type. Fires whenever
  the Rust engine returns a `CellValue::Custom({type_tag, data})` for
  the cell — typically:
  - ISO date strings (`2026-04-01`) auto-classify as `jdate`
  - ISO time strings (`14:30:00`) auto-classify as `jtime`
  - Date arithmetic between two `jdate` cells produces a `jspan`
  - Future host-registered handlers can extend the type set

## Effect

- Render the cell's displayed text via per-tag rules in
  `formatter.ts::formatCustom`:
  - `jdate` → `toLocaleDateString("en-US", {year:"numeric", month:"short", day:"numeric"})` — `"Apr 1, 2026"`. ISO date strings are parsed manually with `new Date(year, month-1, day)` (no timezone shift).
  - `jtime` → `toLocaleTimeString("en-US", {hour, minute, second})`.
  - `jdatetime` / `jzoned` → `toLocaleString("en-US", {…})`.
  - `jspan` → ISO 8601 duration parsed into compact units (`13239d`,
    `1y 2mo 3d 4h 5m`). Negative spans use the typographic minus
    (U+2212) — `−13239d` — so a hyphen doesn't read as a unit suffix.
  - Unknown `type_tag` → fall back to `data` verbatim.
- Right-align the cell with the sheet accent colour — same "type
  signal" treatment as `numeric`, since most custom types behave
  numerically (date math produces spans).
- Explicit `hAlign` on the cell still wins via document-order CSS
  specificity.

## Edge cases

- An invalid date string that the engine still classified as
  `jdate` (shouldn't happen, but defensive): `formatJDate`'s ISO
  regex returns the raw `data` verbatim instead of throwing.
- A `jspan` data string that doesn't match the ISO 8601 duration
  regex falls back to the raw string.
- The frontend formatter doesn't try to invert the engine's
  `display()` — what the engine emits IS the canonical display
  text; locale formatting on top is purely presentational.

## Why

Without this surface, Custom values would stringify defensively as
`"[object Object]"` (the prior behaviour of
`engine.ts::coerceTypedValue`). Per-tag display rules let users see
useful values for the bundled `lotus-datetime` types and give
embedders a place to plug in display logic for their own handlers.

## Producers

- `engine.ts::coerceTypedValue` — passes the `{type_tag, data}` shape
  through unchanged; doesn't stringify.
- `formatter.ts::formatValue` — branches on `typeof === 'object' &&
  'type_tag' in value` before number-format dispatch.
- `Cell.svelte` — `let isCustom = $derived(...)` + `class:custom` +
  `.cell-value.custom` CSS rule.

## Server contract

- The server-side recalc loop (`db.py::_recalculate_sheet`) persists
  Custom values via `_split_typed`: JSON-encodes `{type_tag, data}`
  into `computed_value` with `computed_value_kind = 'custom'`. The
  data API and `GET /sheets/{id}` calls reconstruct the dict via
  `reconstruct_typed` so the JSON wire shape mirrors what
  `engine.get_all_typed()` returns from wasm.
