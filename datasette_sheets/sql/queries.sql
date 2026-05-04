-- schema: ../../tmp.db
-- Named queries for datasette_sheets. Edit this file, then run
-- `just codegen-queries` to regenerate `datasette_sheets/_queries.py`.
--
-- Query annotations (solite-dev codegen syntax):
--     -- name: foo                     -- returns list[FooRow] (default)
--     -- name: foo :row                -- returns FooRow | None
--     -- name: foo :value              -- returns scalar | None
--     -- name: foo :list               -- returns list[scalar]
--     -- name: foo :rows -> Widget     -- row-class hint; same hint on
--     -- name: foo :row  -> Widget     --   multiple queries dedupes
--     --                                   them into one dataclass
--                                          (solite errors on shape mismatch).
--     -- name: foo                     -- INSERT/UPDATE/DELETE imply Void
--
-- Parameter annotations (sigil + optional type + optional trailing ``::``):
--     :foo                             -- legacy colon sigil, non-null Any
--     $foo                             -- untyped, non-null Any
--     $foo::                           -- untyped, nullable (Any | None)
--     $foo::text                       -- typed str, non-null
--     $foo::text::                     -- typed str, nullable (str | None)
--     (also ::integer ::real ::blob ::boolean, each with optional ::)

-- ============================================================================
-- Workbooks
-- ============================================================================

-- name: listWorkbooks :rows -> Workbook
select
    id,
    name,
    created_at,
    updated_at,
    created_by,
    sort_order
from _datasette_sheets_workbook
order by sort_order, created_at;

-- name: getWorkbook :row -> Workbook
select
    id,
    name,
    created_at,
    updated_at,
    created_by,
    sort_order
from _datasette_sheets_workbook
where id = $workbook_id::integer;

-- INSERT ... RETURNING lets the caller skip a follow-up SELECT to
-- fetch DB-defaulted columns (id, created_at, updated_at, sort_order).
-- ``id`` is an INTEGER PRIMARY KEY (rowid alias) so SQLite assigns
-- the next free integer; the caller never passes an id.
-- name: insertWorkbook :row -> Workbook
insert into _datasette_sheets_workbook (name, created_by)
values ($name::text, $created_by::text::)
returning id, name, created_at, updated_at, created_by, sort_order;

-- sqlc-style partial update: each mutable column has a companion
-- ``$<col>_do_update::boolean`` flag. When false, the CASE WHEN
-- evaluates ``ELSE <col>`` and the row's existing value wins;
-- when true, the accompanying ``$<col>`` value is written — None
-- included, so "update to NULL" and "leave alone" stay
-- distinguishable. Eliminates the read-modify-write dance db.py
-- used to do for partial patches, and RETURNING * skips the
-- trailing SELECT too.
-- name: updateWorkbook :row -> Workbook
update _datasette_sheets_workbook
set name = case when $name_do_update::boolean then $name::text else name end,
    sort_order = case
        when $sort_order_do_update::boolean then $sort_order::integer
        else sort_order
    end,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $workbook_id::integer
returning id, name, created_at, updated_at, created_by, sort_order;

-- The delete cascade is five statements because sqlite3 can't
-- parameterise ``executescript`` and we're not toggling
-- ``PRAGMA foreign_keys = ON`` per-connection just for this path.
-- Each query is a single DELETE with an ``IN (SELECT ...)`` subselect
-- — one statement per child table rather than the per-sheet Python
-- loop this replaces.
-- NOTE: _datasette_sheets_view rows are deliberately NOT cleaned up
-- here; the pre-refactor ``delete_workbook`` didn't either, so mirror
-- that behaviour. Separate bugfix.

-- name: deleteWorkbookCells
delete from _datasette_sheets_cell
where sheet_id in (
    select id from _datasette_sheets_sheet where workbook_id = $workbook_id::integer
);

-- name: deleteWorkbookColumns
delete from _datasette_sheets_column
where sheet_id in (
    select id from _datasette_sheets_sheet where workbook_id = $workbook_id::integer
);

-- name: deleteWorkbookNamedRanges
delete from _datasette_sheets_named_range
where sheet_id in (
    select id from _datasette_sheets_sheet where workbook_id = $workbook_id::integer
);

-- name: deleteWorkbookSheets
delete from _datasette_sheets_sheet where workbook_id = $workbook_id::integer;

-- name: deleteWorkbookRow
delete from _datasette_sheets_workbook where id = $workbook_id::integer;

-- ============================================================================
-- Sheets
-- ============================================================================

-- name: listSheets :rows -> Sheet
select id, workbook_id, name, color, sort_order, created_at, updated_at
from _datasette_sheets_sheet
where workbook_id = $workbook_id::integer
order by sort_order, created_at;

-- name: getSheet :row -> Sheet
select id, workbook_id, name, color, sort_order, created_at, updated_at
from _datasette_sheets_sheet
where id = $sheet_id::integer;

-- ``id`` is an INTEGER PRIMARY KEY autoincrement; SQLite assigns it.
-- name: insertSheet :row -> Sheet
insert into _datasette_sheets_sheet (workbook_id, name, color)
values ($workbook_id::integer, $name::text, $color::text)
returning id, workbook_id, name, color, sort_order, created_at, updated_at;

-- sqlc-style partial update — see updateWorkbook for the pattern.
-- name: updateSheet :row -> Sheet
update _datasette_sheets_sheet
set name = case when $name_do_update::boolean then $name::text else name end,
    color = case when $color_do_update::boolean then $color::text else color end,
    sort_order = case
        when $sort_order_do_update::boolean then $sort_order::integer
        else sort_order
    end,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $sheet_id::integer
returning id, workbook_id, name, color, sort_order, created_at, updated_at;

-- Called 15x from ``create_sheet`` to seed the DEFAULT_COLUMNS list.
-- One query per column keeps the shape simple; the A1 labels / widths
-- still live in Python (``db.DEFAULT_COLUMNS``).
-- name: insertDefaultColumn
insert into _datasette_sheets_column (sheet_id, col_idx, name, width)
values ($sheet_id::integer, $col_idx::integer, $name::text, $width::integer);

-- Delete cascade. Mirrors the workbook pattern: FK cascade isn't on,
-- executescript can't bind params, so each child table is its own
-- parameterised DELETE called in sequence by db.py::delete_sheet.
-- NOTE: _datasette_sheets_view rows are NOT cleared — pre-existing
-- parity with the old delete_sheet; see deleteWorkbook* comment.

-- name: deleteSheetCells
delete from _datasette_sheets_cell where sheet_id = $sheet_id::integer;

-- name: deleteSheetColumns
delete from _datasette_sheets_column where sheet_id = $sheet_id::integer;

-- name: deleteSheetNamedRanges
delete from _datasette_sheets_named_range where sheet_id = $sheet_id::integer;

-- name: deleteSheetRow
delete from _datasette_sheets_sheet where id = $sheet_id::integer;

-- Used inside db.py::reorder_sheets' Python loop after the
-- permutation has been validated. Touches updated_at so any watcher
-- sees the reorder as a change.
-- name: reorderSheet
update _datasette_sheets_sheet
set sort_order = $sort_order::integer,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $sheet_id::integer
  and workbook_id = $workbook_id::integer;

-- Shared helper: bump a sheet's updated_at. Called from set_cells /
-- delete_rows / delete_columns / insert_columns / set_named_range /
-- delete_named_range — anywhere a descendant row changes and watchers
-- need to see a fresh updated_at on the parent sheet.
-- name: touchSheet
update _datasette_sheets_sheet
set updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $sheet_id::integer;

-- ============================================================================
-- Columns
-- ============================================================================

-- name: listColumns :rows -> Column
select sheet_id, col_idx, name, width, format_json
from _datasette_sheets_column
where sheet_id = $sheet_id::integer
order by col_idx;

-- sqlc-style partial update — see updateWorkbook for the pattern.
-- No RETURNING row-id since the PK is composite; returns the full
-- post-update row so callers can skip a follow-up SELECT.
-- name: setColumn :row -> Column
update _datasette_sheets_column
set name = case when $name_do_update::boolean then $name::text else name end,
    width = case
        when $width_do_update::boolean then $width::integer
        else width
    end
where sheet_id = $sheet_id::integer
  and col_idx = $col_idx::integer
returning sheet_id, col_idx, name, width, format_json;

-- ============================================================================
-- Cells
-- ============================================================================

-- name: listCells :rows -> Cell
select sheet_id, row_idx, col_idx, raw_value, computed_value,
       computed_value_kind, typed_kind, typed_data, format_json,
       updated_at, updated_by
from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
order by row_idx, col_idx;

-- name: deleteCell
delete from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
  and row_idx = $row_idx::integer
  and col_idx = $col_idx::integer;

-- upsertCell uses ``excluded.<col>`` (NOT
-- ``COALESCE(excluded.<col>, <col>)``) on every nullable column —
-- ``format_json``, ``typed_kind``, ``typed_data``: the client sends
-- NULL to explicitly clear that override. COALESCE would preserve a
-- stale value across the upsert (e.g. a ``raw`` write would leave
-- a prior force-text override in place, and the cell would still
-- auto-classify-bypassed).
-- name: upsertCell
insert into _datasette_sheets_cell
    (sheet_id, row_idx, col_idx, raw_value, format_json,
     typed_kind, typed_data, updated_by, updated_at)
values
    ($sheet_id::integer, $row_idx::integer, $col_idx::integer,
     $raw_value::text, $format_json::text::,
     $typed_kind::text::, $typed_data::text::,
     $updated_by::text::, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
on conflict(sheet_id, row_idx, col_idx) do update set
    raw_value = excluded.raw_value,
    format_json = excluded.format_json,
    typed_kind = excluded.typed_kind,
    typed_data = excluded.typed_data,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

-- Pulls the minimal tuple _recalculate_sheet needs — raw_value for
-- parsing, typed_kind + typed_data so a force-text / typed override
-- survives the recalc, and computed_value + computed_value_kind so
-- it can compare the (value, kind) pair before writing back. Without
-- the kind, bool→int(1) collisions would convince the recalc that
-- nothing changed when in fact a Number(1.0) became a Boolean(true).
-- name: listCellsForRecalc
select row_idx, col_idx, raw_value, typed_kind, typed_data,
       computed_value, computed_value_kind
from _datasette_sheets_cell
where sheet_id = $sheet_id::integer;

-- name: listNamedRangesForRecalc
select name, definition
from _datasette_sheets_named_range
where sheet_id = $sheet_id::integer;

-- ``computed_value`` has no declared type (BLOB affinity so the
-- engine's int/float/str classification survives round-tripping);
-- ``$value::`` is untyped + nullable so the Python type is ``Any``
-- (which already covers None) and the engine can pass int / float
-- / str / None through transparently. ``$kind::text::`` carries the
-- type discriminator (e.g. ``'bool'`` for booleans stored as
-- INTEGER 0/1) — see the column comment in migrations.py.
-- name: updateCellComputed
update _datasette_sheets_cell
set computed_value = $value::,
    computed_value_kind = $kind::text::
where sheet_id = $sheet_id::integer
  and row_idx = $row_idx::integer
  and col_idx = $col_idx::integer;

-- Formula-rewrite pass: feeds ``_rewrite_formulas_for_{deletion,insertion}``.
-- The ``raw_value LIKE '=%'`` filter is load-bearing — it's the cheap
-- way to skip plain-value cells so the Python-side loop only pays the
-- cost of ``lotus.adjust_refs_*`` for rows that could actually contain
-- a ref.
-- name: listFormulaCells
select row_idx, col_idx, raw_value
from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
  and raw_value like '=%';

-- Writes the post-rewrite raw_value back. Deliberately does NOT touch
-- ``updated_at``: ref rewrites are automatic book-keeping triggered
-- by structural changes (row/col insert/delete), not user edits, so
-- the last-edited timestamp should still reflect the last human
-- mutation of the cell. The parent sheet's ``touch_sheet`` already
-- covers the "something changed" signal for watchers.
-- name: updateCellRaw
update _datasette_sheets_cell
set raw_value = $raw_value::text
where sheet_id = $sheet_id::integer
  and row_idx = $row_idx::integer
  and col_idx = $col_idx::integer;

-- ============================================================================
-- Row / column shift
-- ============================================================================
--
-- Two-pass shift through a negative "buffer" namespace.
--
-- A naive in-place ``SET row_idx = row_idx - N`` hits
-- ``UNIQUE(sheet_id, row_idx, col_idx)`` mid-statement: SQLite iterates
-- by rowid (not PK order), so if a user's cells were inserted in
-- scrambled order the scan can process row 5 before row 4 and try to
-- write (row 5 → 4) while row 4 still exists.
--
-- Pass 1: move every surviving row above MIN(deleted) into a unique
-- negative namespace via x → -(x + 1). Injective; no deleted rows are
-- negative so there's no collision with them.
-- Pass 2: move them back to positive with the shift applied. Each
-- (old row_idx, col_idx) maps to a unique destination by construction,
-- so this pass can't collide either.
--
-- Regression tests: tests/test_row_shift.py, test_col_shift.py,
-- test_cols_insert.py — all exercise scrambled-insert ordering to
-- reproduce the original collision.
--
-- ``$<x>_indices_json`` params are JSON arrays of integers, built by
-- db.py via ``json.dumps(sorted({int(i) for i in xs if int(i) >= 0}))``.
-- ``json_each`` + ``CAST(value AS INTEGER)`` unpacks them inside SQL.

-- --- delete rows (cell table only: _datasette_sheets_column has no row_idx)

-- name: deleteCellsInRows
delete from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
  and row_idx in (
    select cast(value as integer) from json_each($row_indices_json::text)
  );

-- name: shiftCellRowsToBuffer
update _datasette_sheets_cell
set row_idx = -(row_idx + 1)
where sheet_id = $sheet_id::integer
  and row_idx > (
    select min(cast(value as integer)) from json_each($row_indices_json::text)
  );

-- name: shiftCellRowsFromBuffer
update _datasette_sheets_cell
set row_idx = (-row_idx - 1) - (
    select count(*) from json_each($row_indices_json::text)
    where cast(value as integer) < (-_datasette_sheets_cell.row_idx - 1)
)
where sheet_id = $sheet_id::integer
  and row_idx < 0;

-- --- delete columns (both cell + column tables get shifted)

-- name: deleteCellsInCols
delete from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
  and col_idx in (
    select cast(value as integer) from json_each($col_indices_json::text)
  );

-- name: deleteColumnsInCols
delete from _datasette_sheets_column
where sheet_id = $sheet_id::integer
  and col_idx in (
    select cast(value as integer) from json_each($col_indices_json::text)
  );

-- name: shiftCellColsToBuffer
update _datasette_sheets_cell
set col_idx = -(col_idx + 1)
where sheet_id = $sheet_id::integer
  and col_idx > (
    select min(cast(value as integer)) from json_each($col_indices_json::text)
  );

-- name: shiftCellColsFromBuffer
update _datasette_sheets_cell
set col_idx = (-col_idx - 1) - (
    select count(*) from json_each($col_indices_json::text)
    where cast(value as integer) < (-_datasette_sheets_cell.col_idx - 1)
)
where sheet_id = $sheet_id::integer
  and col_idx < 0;

-- name: shiftColumnColsToBuffer
update _datasette_sheets_column
set col_idx = -(col_idx + 1)
where sheet_id = $sheet_id::integer
  and col_idx > (
    select min(cast(value as integer)) from json_each($col_indices_json::text)
  );

-- name: shiftColumnColsFromBuffer
update _datasette_sheets_column
set col_idx = (-col_idx - 1) - (
    select count(*) from json_each($col_indices_json::text)
    where cast(value as integer) < (-_datasette_sheets_column.col_idx - 1)
)
where sheet_id = $sheet_id::integer
  and col_idx < 0;

-- --- insert columns (shift outward by ``$count`` starting at ``$at``)
-- Insertion is pure shift, no DELETE — blank columns materialise by
-- their absence from the tables. Mechanism: each surviving col_idx
-- >= at is injectively mapped to a negative buffer (pass 1), then
-- flipped back with ``+ count`` applied (pass 2).

-- name: insertShiftCellColsToBuffer
update _datasette_sheets_cell
set col_idx = -(col_idx + 1)
where sheet_id = $sheet_id::integer
  and col_idx >= $at::integer;

-- name: insertShiftCellColsFromBuffer
update _datasette_sheets_cell
set col_idx = (-col_idx - 1) + $count::integer
where sheet_id = $sheet_id::integer
  and col_idx < 0;

-- name: insertShiftColumnColsToBuffer
update _datasette_sheets_column
set col_idx = -(col_idx + 1)
where sheet_id = $sheet_id::integer
  and col_idx >= $at::integer;

-- name: insertShiftColumnColsFromBuffer
update _datasette_sheets_column
set col_idx = (-col_idx - 1) + $count::integer
where sheet_id = $sheet_id::integer
  and col_idx < 0;

-- --- block-move columns (src_start..src_end → final_start)
-- Two-pass negative-buffer same as the rest. Pass 1 negates every
-- col in the affected band [low, high]; pass 2 flips back, applying
-- the forward map.
--
-- The CASE expression is uniform across both directions
-- (final_start < src_start AND final_start > src_end). Width and
-- band are computed in Python and passed as scalars. Single-column
-- v1 just sets src_start == src_end and width == 1; multi-col v2
-- needs zero SQL change.
--
-- Forward map (applied to the post-buffer-flip ``-col_idx - 1``
-- value which is the original col_idx):
--   c in [src_start, src_end]      → c - src_start + final_start
--   c < src_start (band edge)      → c + width  (final_start < src_start case)
--   c > src_end   (band edge)      → c - width  (final_start > src_end case)

-- name: moveCellColsToBuffer
update _datasette_sheets_cell
set col_idx = -(col_idx + 1)
where sheet_id = $sheet_id::integer
  and col_idx between $low::integer and $high::integer;

-- name: moveCellColsFromBuffer
update _datasette_sheets_cell
set col_idx = case
  when (-col_idx - 1) between $src_start::integer and $src_end::integer
    then (-col_idx - 1) - $src_start::integer + $final_start::integer
  when (-col_idx - 1) < $src_start::integer
    then (-col_idx - 1) + $width::integer
  else (-col_idx - 1) - $width::integer
end
where sheet_id = $sheet_id::integer
  and col_idx < 0;

-- name: moveColumnMetaToBuffer
update _datasette_sheets_column
set col_idx = -(col_idx + 1)
where sheet_id = $sheet_id::integer
  and col_idx between $low::integer and $high::integer;

-- name: moveColumnMetaFromBuffer
update _datasette_sheets_column
set col_idx = case
  when (-col_idx - 1) between $src_start::integer and $src_end::integer
    then (-col_idx - 1) - $src_start::integer + $final_start::integer
  when (-col_idx - 1) < $src_start::integer
    then (-col_idx - 1) + $width::integer
  else (-col_idx - 1) - $width::integer
end
where sheet_id = $sheet_id::integer
  and col_idx < 0;

-- --- block-move rows (src_start..src_end → final_start)
-- Row-axis sibling of moveCellCols*. ONE shift pair (cell table
-- only) — there's no datasette_sheets_row metadata table to mirror.
-- Same uniform CASE expression handling both directions
-- (final_start < src_start AND final_start > src_end). Single-row
-- v1 sets src_start == src_end and width == 1; multi-row drag
-- needs zero SQL change.

-- name: moveCellRowsToBuffer
update _datasette_sheets_cell
set row_idx = -(row_idx + 1)
where sheet_id = $sheet_id::integer
  and row_idx between $low::integer and $high::integer;

-- name: moveCellRowsFromBuffer
update _datasette_sheets_cell
set row_idx = case
  when (-row_idx - 1) between $src_start::integer and $src_end::integer
    then (-row_idx - 1) - $src_start::integer + $final_start::integer
  when (-row_idx - 1) < $src_start::integer
    then (-row_idx - 1) + $width::integer
  else (-row_idx - 1) - $width::integer
end
where sheet_id = $sheet_id::integer
  and row_idx < 0;

-- ============================================================================
-- Named ranges
-- ============================================================================
-- PK is ``(sheet_id, name COLLATE NOCASE)`` — case-insensitive by
-- design so lookups match the engine's case-folding semantics.
-- ``ON CONFLICT(sheet_id, name)`` is the right clause even though the
-- stored PK uses COLLATE NOCASE; SQLite matches the conflict target
-- to the underlying unique index (which carries the collation).

-- name: listNamedRanges :rows -> NamedRange
select sheet_id, name, definition, updated_at
from _datasette_sheets_named_range
where sheet_id = $sheet_id::integer
order by name collate nocase;

-- name: upsertNamedRange :row -> NamedRange
insert into _datasette_sheets_named_range
    (sheet_id, name, definition, updated_at)
values
    ($sheet_id::integer, $name::text, $definition::text,
     strftime('%Y-%m-%dT%H:%M:%f', 'now'))
on conflict(sheet_id, name) do update set
    definition = excluded.definition,
    updated_at = excluded.updated_at
returning sheet_id, name, definition, updated_at;

-- RETURNING the name so the caller can distinguish "deleted" from
-- "no such name" in a single round-trip. db.py's
-- ``delete_named_range`` returns ``bool``; None from this query
-- means "nothing matched".
-- name: deleteNamedRange :row
delete from _datasette_sheets_named_range
where sheet_id = $sheet_id::integer
  and name = $name::text collate nocase
returning name;

-- Used by ``_rewrite_named_ranges_for_move`` (and the parity-fix
-- cross-cut for delete/insert) to update a named-range definition
-- in place. ``updated_at`` IS bumped here because — unlike the
-- cell-formula rewrite — named ranges are workbook-scoped and
-- watchers downstream key off this timestamp. Caller passes the
-- new definition text already validated by the engine.
-- name: updateNamedRangeDefinition
update _datasette_sheets_named_range
set definition = $definition::text,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where sheet_id = $sheet_id::integer
  and name = $name::text collate nocase;

-- ============================================================================
-- Dropdown rules (workbook-scoped data validation)
-- ============================================================================

-- name: listDropdownRules :rows -> DropdownRule
select id, workbook_id, name, multi, options_json, updated_at
from _datasette_sheets_dropdown_rule
where workbook_id = $workbook_id::integer
order by coalesce(name, ''), id;

-- name: getDropdownRule :row -> DropdownRule
select id, workbook_id, name, multi, options_json, updated_at
from _datasette_sheets_dropdown_rule
where id = $rule_id::integer
  and workbook_id = $workbook_id::integer;

-- ``id`` is an INTEGER PRIMARY KEY autoincrement; SQLite assigns it.
-- name: insertDropdownRule :row -> DropdownRule
insert into _datasette_sheets_dropdown_rule
    (workbook_id, name, multi, options_json, updated_at)
values
    ($workbook_id::integer, $name::text::,
     $multi::integer, $options_json::text,
     strftime('%Y-%m-%dT%H:%M:%f', 'now'))
returning id, workbook_id, name, multi, options_json, updated_at;

-- sqlc-style partial update — see updateWorkbook for the pattern.
-- name: updateDropdownRule :row -> DropdownRule
update _datasette_sheets_dropdown_rule
set name = case
        when $name_do_update::boolean then $name::text::
        else name
    end,
    multi = case
        when $multi_do_update::boolean then $multi::integer
        else multi
    end,
    options_json = case
        when $options_do_update::boolean then $options_json::text
        else options_json
    end,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $rule_id::integer
  and workbook_id = $workbook_id::integer
returning id, workbook_id, name, multi, options_json, updated_at;

-- name: deleteDropdownRule :row
delete from _datasette_sheets_dropdown_rule
where id = $rule_id::integer
  and workbook_id = $workbook_id::integer
returning id;

-- Cascade hook for workbook delete — mirrors deleteWorkbookNamedRanges.
-- name: deleteWorkbookDropdownRules
delete from _datasette_sheets_dropdown_rule
where workbook_id = $workbook_id::integer;

-- ============================================================================
-- Views (the _datasette_sheets_view registry — the SQL views themselves
-- and their INSTEAD OF triggers are built dynamically by view_sql.py and
-- executed directly from db.py::create_view / delete_view.)
-- ============================================================================

-- name: listViews :rows -> View
select id, sheet_id, view_name, range_str, min_row, min_col, max_row, max_col,
       use_headers, color, created_at, enable_insert, enable_update,
       enable_delete, delete_mode
from _datasette_sheets_view
where sheet_id = $sheet_id::integer
order by created_at;

-- getView is used by db.py::delete_view to look up the view_name before
-- issuing ``DROP VIEW``. The view_name is validated at create time so
-- the subsequent DROP is safe to f-string-interpolate.
-- name: getView :row -> View
select id, sheet_id, view_name, range_str, min_row, min_col, max_row, max_col,
       use_headers, color, created_at, enable_insert, enable_update,
       enable_delete, delete_mode
from _datasette_sheets_view
where id = $view_id::integer;

-- ``id`` is an INTEGER PRIMARY KEY autoincrement; SQLite assigns it.
-- name: insertView :row -> View
insert into _datasette_sheets_view
    (sheet_id, view_name, range_str, min_row, min_col, max_row, max_col,
     use_headers, color, enable_insert, enable_update, enable_delete, delete_mode)
values
    ($sheet_id::integer, $view_name::text, $range_str::text,
     $min_row::integer, $min_col::integer, $max_row::integer, $max_col::integer,
     $use_headers::integer, $color::text,
     $enable_insert::integer, $enable_update::integer, $enable_delete::integer,
     $delete_mode::text)
returning id, sheet_id, view_name, range_str, min_row, min_col, max_row, max_col,
          use_headers, color, created_at, enable_insert, enable_update,
          enable_delete, delete_mode;

-- name: deleteView
delete from _datasette_sheets_view where id = $view_id::integer;

-- Update view-registry column bounds after a structural op (col
-- move / col delete / col insert). The actual SQL VIEW DDL keeps
-- its original cell coordinates — DDL regeneration on bound
-- changes is a future follow-up; in v1 this just keeps the
-- registry's [min_col, max_col] honest so subsequent edits land
-- in the right place.
-- name: updateViewColBounds
update _datasette_sheets_view
set min_col = $min_col::integer,
    max_col = $max_col::integer
where id = $view_id::integer;

-- Sibling for the row axis — used by row-delete to keep the
-- registry's [min_row, max_row] in sync. Same caveats as above.
-- name: updateViewRowBounds
update _datasette_sheets_view
set min_row = $min_row::integer,
    max_row = $max_row::integer
where id = $view_id::integer;

-- Pre-check for view creation: we refuse to shadow an existing table /
-- view name in the schema. sqlite_master is SQLite's internal catalog.
-- name: checkNameExists :value
select name from sqlite_master
where type in ('table', 'view') and name = $name::text;

-- Fetch every cell in a single row within a column range. Used by
-- create_view for header sniffing — replaces N point-lookups with one
-- range scan. computed_value is BLOB-affinity so it could be int /
-- float / str / None; caller coerces to str for display.
-- name: listCellsInRow
select col_idx, computed_value
from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
  and row_idx = $row_idx::integer
  and col_idx between $min_col::integer and $max_col::integer;

-- ============================================================================
-- Filters
-- ============================================================================
--
-- One filter row per sheet (UNIQUE(sheet_id)). Bounds + sort + per-
-- column predicates live in the same row; predicates are JSON-encoded
-- to keep the wire shape variable-length without a join. Mirrors
-- the structural-shift pattern used by _datasette_sheets_view —
-- bounds are kept in sync via update_filter_*_bounds during row /
-- col delete / insert / move.

-- name: getFilterBySheet :row -> Filter
select id, sheet_id, min_row, min_col, max_row, max_col,
       sort_col_idx, sort_direction, predicates_json,
       created_at, updated_at
from _datasette_sheets_filter
where sheet_id = $sheet_id::integer;

-- ``id`` is an INTEGER PRIMARY KEY autoincrement; SQLite assigns it.
-- name: insertFilter :row -> Filter
insert into _datasette_sheets_filter
    (sheet_id, min_row, min_col, max_row, max_col,
     sort_col_idx, sort_direction, predicates_json)
values
    ($sheet_id::integer,
     $min_row::integer, $min_col::integer,
     $max_row::integer, $max_col::integer,
     $sort_col_idx::, $sort_direction::,
     $predicates_json::text)
returning id, sheet_id, min_row, min_col, max_row, max_col,
          sort_col_idx, sort_direction, predicates_json,
          created_at, updated_at;

-- Bound-shift helpers, mirror of updateView{Col,Row}Bounds.
-- name: updateFilterColBounds
update _datasette_sheets_filter
set min_col = $min_col::integer,
    max_col = $max_col::integer,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $filter_id::integer;

-- name: updateFilterRowBounds
update _datasette_sheets_filter
set min_row = $min_row::integer,
    max_row = $max_row::integer,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $filter_id::integer;

-- Sort + predicate setters. Both nullable: setting sort_col_idx to
-- NULL clears the active sort; setting predicates_json to '{}' is the
-- "no predicates" state.
-- name: updateFilterSort
update _datasette_sheets_filter
set sort_col_idx = $sort_col_idx::,
    sort_direction = $sort_direction::,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $filter_id::integer;

-- name: updateFilterPredicates
update _datasette_sheets_filter
set predicates_json = $predicates_json::text,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
where id = $filter_id::integer;

-- Used by both the explicit ``DELETE /filter`` route AND the
-- sheet-delete cascade in db.py::delete_sheet — at most one filter
-- per sheet, so a single sheet_id is the unique-row key for both.
-- name: deleteFilterBySheet
delete from _datasette_sheets_filter where sheet_id = $sheet_id::integer;

-- Workbook-delete cascade. FK cascade isn't on per-conn (see the
-- deleteWorkbook* block above) so this child table needs its own
-- explicit DELETE called from db.py::delete_workbook.
-- name: deleteWorkbookFilters
delete from _datasette_sheets_filter
where sheet_id in (
    select id from _datasette_sheets_sheet where workbook_id = $workbook_id::integer
);

-- Read the (row_idx, computed_value, computed_value_kind) tuples
-- in a single column over a row range. Drives the sort key
-- collection in db.sort_filter — we iterate the pairs in Python
-- + classify by ``computed_value_kind`` to apply the precedence
-- rule (numbers / strings / booleans / empty). Rows with no cell
-- in this column are surfaced via the LEFT-JOIN-style absence
-- (caller fills in empty for those).
-- name: listCellsInColRange
select row_idx, computed_value, computed_value_kind
from _datasette_sheets_cell
where sheet_id = $sheet_id::integer
  and col_idx = $col_idx::integer
  and row_idx between $min_row::integer and $max_row::integer
order by row_idx;
