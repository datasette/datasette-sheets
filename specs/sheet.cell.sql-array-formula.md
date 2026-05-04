---
id: sheet.cell.sql-array-formula
title: =SQL(…) runs a Datasette query and spills the result
category: cell
status: draft
related:
  - sheet.cell.spill
  - sheet.cell.pin
---

## Trigger

- A cell's committed formula matches either form (case-insensitive
  on the function name, whitespace tolerated):
  - `=SQL("select …")` — single-arg form. Runs against the active
    workbook's Datasette database.
  - `=SQL("dbname", "select …")` — two-arg form. Runs against the
    named database.
- Both forms require **string-literal** arguments. Cell references
  or expressions (`=SQL(A1)`, `=SQL("x" & A1)`) are rejected — the
  formula has to be self-contained so the fetch key is stable.

## Effect

1. On commit, the cell is pinned to `#LOADING!` via the engine's
   pin API so any dependents referencing the cell see a loading
   state immediately.
2. The frontend fires a `GET` against
   `/{dbname}.json?sql={urlencoded}&_shape=array` and parses the
   JSON response.
3. On success, the cell's pin is replaced with a 2-D array:
   - Row 0 holds the column headers (the query's output columns).
   - Subsequent rows hold the returned data rows, null cells
     rendered as empty strings.
   The engine places it like a native spill — the anchor cell gets
   the top-left value, neighbouring cells fill in the rest and
   register as spill members. The standard spill affordances apply
   (accent-coloured left edge, italic/muted members, `#SPILL!` if a
   neighbour is user-authored, `A1#` reads the whole region).
4. On HTTP failure or a response the parser can't handle, the pin
   flips to a single-cell `#SQL! <message>` value; the message
   includes the HTTP status or a parser description.

## Cache

- Results are cached in memory keyed on the **derived fetch URL**
  so single-arg and two-arg forms dedupe once resolved.
- The cache survives sheet switches but not page reloads.
- Duplicate calls with the same URL pinned on multiple cells share
  a single fetch; all registered anchors re-pin together when the
  fetch lands.
- There's no automatic invalidation. Overwriting the cell with a
  non-`=SQL(…)` value unpins it; editing the formula to change the
  dbname or SQL text triggers a new fetch.
- **Manual refresh**: right-click a SQL cell and pick **Refresh
  data**. Drops the URL's cache entry and re-fires the fetch
  (keeping the pin's `#LOADING!` placeholder visible until the
  new result lands).

## Edge cases

- **No database loaded yet**: the formula is committed but the
  default database isn't known → pin shows `#SQL!`. Re-committing
  after workbook init kicks off the real fetch.
- **Result rows exceeds 10,000**: silently truncated to the cap,
  headers retained. The cell still spills what arrived.
- **Spill blocked** (a user-authored cell sits inside the result's
  rectangle): the anchor flips to `#SPILL!` — same behaviour as
  any other array formula.
- **Sheet switch**: all pins drop; the SQL cache (URL-keyed) stays
  warm. The loader re-issues `syncSqlCell` for any SQL formulas in
  the newly-loaded sheet — cached queries re-pin without another
  fetch.
- **Composition** (`=SUM(SQL("…"))`): not supported. The engine
  doesn't know `SQL` as a real function; this shim only runs when
  `=SQL(…)` is the whole committed formula. Split into two cells
  and read via `A1#` instead.
- **SSE remote edit**: a peer committing a SQL formula triggers the
  same sync path; the fetch runs locally (Datasette's own
  per-client cache at HTTP layer handles repeat queries).

## Visual feedback

- While fetching: cell reads `#LOADING!` in the error colour.
- On success: spill anchor + members render per
  [`sheet.cell.spill`](sheet.cell.spill.md).
- On error: `#SQL! <reason>` in the error colour; the full message
  is visible on mouseover via the cell's `title` attribute.

## Rationale

Datasette's whole pitch is that every query is a URL — this feature
makes that URL reachable from inside a spreadsheet cell without the
user having to copy-paste JSON. Keeping the implementation as a pin
overlay (rather than a native engine function) means the engine
stays pure Rust / synchronous and the async data source is
frontend-only. The TODO for engine-side custom function
registration (`TODO-liblotus-host-spills.md` → Tier 2) is the path
to composition; not needed for the 80% use case.
