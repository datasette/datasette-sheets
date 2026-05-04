---
id: sheet.cell.force-text
title: Leading apostrophe forces a cell value to render as literal text
category: cell
related:
  - sheet.cell.custom
  - sheet.cell.boolean
---

## Trigger

- Typing a single leading `'` (apostrophe) into a cell editor and
  committing (Enter, Tab, or blur) — matches the Excel / Google Sheets
  convention.
- Pasting `'<text>` into a cell. (Future: clipboard.ts intra-app paste
  surfaces preserve the typed override even without the prefix.)

## Effect

- Strip the leading `'` from the input. The cell stores the rest as
  the raw value.
- Install a `typed_kind = "string"` override on the cell so the engine
  treats the value as a literal `String` and bypasses
  auto-classification on every recalc.
- Render the cell with its stripped raw text. No special class beyond
  the default `.cell-value` styling — force-text cells look like
  ordinary text cells, intentionally.
- Persist the override so reload (and remote SSE clients) install the
  same `typed_kind = "string"` on the cell.

## Edge cases

- `'2026-04-01` — without the prefix the engine classifies as
  `Custom(jdate)`. With the prefix the cell stays as the literal
  string `2026-04-01`. Useful when the user wants the date displayed
  verbatim and not reformatted.
- `'=SUM(A1:A3)` — escapes the leading `=`. Cell stores the literal
  text `=SUM(A1:A3)` instead of treating it as a formula.
- `''hello` — only the first `'` is consumed. Cell stores `'hello`.
  Matches Excel / Sheets.
- `'` alone — strips to `""`, which deletes the cell on commit.
- Re-editing a cell that already has `typed_kind = "string"`
  preserves the override, even if the user doesn't retype the
  prefix. The display value of a force-text cell shows the stripped
  text in the editor (no `'`); pressing Enter without changes keeps
  the override in place.
- Typing an empty value or a formula (`=…`) into a force-text cell
  clears the override — formulas need engine parsing, and an empty
  commit is a delete.
- The override is per-cell. Pasting a force-text cell to a new
  location should preserve the override (intra-app clipboard) — see
  related `sheet.cell.custom` spec for the broader typed-cell story.

## Why

Without this affordance the engine auto-classifies every input,
which is usually what users want — `2026-04-01` becomes a date,
`42.5` becomes a number — but breaks for inputs the user knows
should stay as text. The leading-apostrophe convention is universal
across desktop spreadsheets and has zero typing overhead. Server
persistence + SSE echo means the override survives reload and
multi-client collaboration without the user having to set a column
type.

## Producers

- `Cell.svelte::commitCellEdit` — parses the leading `'` and routes
  to `cells.setCellValueAsString` instead of `cells.setCellValue`.

## Server contract

- API write path: `POST /…/cells` with `{kind: "string", raw_value:
  "<stripped>"}`. The server stores `typed_kind = "string"`,
  `typed_data = NULL`, and the recalc loop reconstructs the cell as
  `set_cells_typed({"kind": "string", "value": raw_value})` on every
  pass so the override survives.
- SSE broadcast echoes `kind` so remote clients install the same
  override locally.
- A subsequent `POST /…/cells` with `{kind: "raw"}` (the default)
  on the same cell clears `typed_kind` / `typed_data` — opting back
  into engine auto-classification.
