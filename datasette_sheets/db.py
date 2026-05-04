"""Database operations for datasette-sheets.

All operations run on the USER's database (not internal).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
import lotus

from . import _queries

# Workbook rows come straight from the codegen module — the shape
# matches what ``SheetDB`` used to return via the hand-rolled
# ``Workbook`` dataclass. ``GetWorkbookRow`` is the canonical
# single-row shape; ``ListWorkbooksRow`` has the same fields in the
# same order, so callers that just read attributes don't care which
# one they got back.


@dataclass
class CellChange:
    row_idx: int
    col_idx: int
    raw_value: str
    format_json: str | None = None
    # ``"raw"`` — auto-classify (engine decides number / string /
    # boolean / Custom from raw_value).
    # ``"string"`` — store raw_value as a literal String, bypassing
    # auto-classification. Used for leading-' force-text writes
    # ([sheet.cell.force-text]).
    # Future kinds (number / boolean / custom) plug into the same
    # discriminator when their UX surfaces land.
    kind: str = "raw"


DEFAULT_COLUMNS = [
    {"col_idx": i, "name": name, "width": 100}
    for i, name in enumerate(
        ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"]
    )
]


class FilterAlreadyExists(Exception):
    """Raised by ``SheetDB.create_filter`` when the sheet already has a
    filter row. Distinct from ``ValueError`` so the route layer can
    map it to ``409 Conflict`` without string-matching the message.
    """


class SheetDB:
    """Database operations wrapper. Operates on a user's database."""

    def __init__(self, database):
        self.database = database

    async def ensure_migrations(self):
        """Run migrations on this database if needed."""
        from sqlite_utils import Database as SqliteUtilsDatabase
        from .migrations import migrations

        def migrate(connection):
            db = SqliteUtilsDatabase(connection)
            migrations.apply(db)

        await self.database.execute_write_fn(migrate)

    # --- Workbooks ---

    async def create_workbook(
        self, name: str, actor_id: str | None = None
    ) -> _queries.Workbook:
        def write(conn):
            row = _queries.insert_workbook(conn, name=name, created_by=actor_id)
            assert row is not None  # INSERT ... RETURNING on a fresh id
            return row

        return await self.database.execute_write_fn(write)

    async def list_workbooks(self) -> list[_queries.Workbook]:
        return await self.database.execute_write_fn(_queries.list_workbooks)

    async def get_workbook(self, workbook_id: int) -> _queries.Workbook | None:
        def read(conn):
            return _queries.get_workbook(conn, workbook_id=workbook_id)

        return await self.database.execute_write_fn(read)

    async def update_workbook(
        self, workbook_id: int, **kwargs
    ) -> _queries.Workbook | None:
        # Partial patch: only fields present in ``kwargs`` get
        # overwritten. The codegened SQL uses sqlc-style
        # ``CASE WHEN :<col>_do_update THEN :<col> ELSE <col> END``
        # per column, so we pack a (do_update, value) pair per field
        # and let SQL pick the right branch. The UPDATE has a
        # RETURNING clause, so no follow-up SELECT is needed.
        name_do_update = "name" in kwargs
        sort_order_do_update = "sort_order" in kwargs
        if not (name_do_update or sort_order_do_update):
            return None

        def write(conn):
            return _queries.update_workbook(
                conn,
                workbook_id=workbook_id,
                name_do_update=name_do_update,
                # When ``_do_update`` is False, the ``$<col>``
                # binding is ignored by SQL — pass a type-correct
                # sentinel rather than None (the column is NOT NULL).
                name=kwargs.get("name", "") if name_do_update else "",
                sort_order_do_update=sort_order_do_update,
                sort_order=kwargs.get("sort_order", 0) if sort_order_do_update else 0,
            )

        return await self.database.execute_write_fn(write)

    async def delete_workbook(self, workbook_id: int) -> None:
        # Six-step cascade — see queries.sql::deleteWorkbook* for
        # why this isn't a single DELETE with FK cascade. Each child
        # DELETE is one statement with ``IN (SELECT ...)`` rather than
        # the per-sheet Python loop this replaces.
        def write(conn):
            _queries.delete_workbook_cells(conn, workbook_id=workbook_id)
            _queries.delete_workbook_columns(conn, workbook_id=workbook_id)
            _queries.delete_workbook_named_ranges(conn, workbook_id=workbook_id)
            _queries.delete_workbook_dropdown_rules(conn, workbook_id=workbook_id)
            _queries.delete_workbook_filters(conn, workbook_id=workbook_id)
            _queries.delete_workbook_sheets(conn, workbook_id=workbook_id)
            _queries.delete_workbook_row(conn, workbook_id=workbook_id)

        await self.database.execute_write_fn(write)

    # --- Sheets (within a workbook) ---

    async def create_sheet(
        self, workbook_id: int, name: str, color: str = "#8b774f"
    ) -> _queries.Sheet:
        def write(conn):
            row = _queries.insert_sheet(
                conn,
                workbook_id=workbook_id,
                name=name,
                color=color,
            )
            assert row is not None  # INSERT ... RETURNING on a fresh id
            # Seed the default A–O columns. One query per column keeps
            # the codegened shape simple; 15 round-trips only happens
            # at sheet-create time, so it's not a hot path.
            for col in DEFAULT_COLUMNS:
                _queries.insert_default_column(
                    conn,
                    sheet_id=row.id,
                    col_idx=col["col_idx"],
                    name=col["name"],
                    width=col["width"],
                )
            return row

        return await self.database.execute_write_fn(write)

    async def list_sheets(self, workbook_id: int) -> list[_queries.Sheet]:
        def read(conn):
            return _queries.list_sheets(conn, workbook_id=workbook_id)

        return await self.database.execute_write_fn(read)

    async def get_sheet(self, sheet_id: int) -> _queries.Sheet | None:
        def read(conn):
            return _queries.get_sheet(conn, sheet_id=sheet_id)

        return await self.database.execute_write_fn(read)

    async def update_sheet(self, sheet_id: int, **kwargs) -> _queries.Sheet | None:
        name_do_update = "name" in kwargs
        color_do_update = "color" in kwargs
        sort_order_do_update = "sort_order" in kwargs
        if not (name_do_update or color_do_update or sort_order_do_update):
            return None

        def write(conn):
            return _queries.update_sheet(
                conn,
                sheet_id=sheet_id,
                name_do_update=name_do_update,
                # Sentinels for skipped fields — SQL's CASE WHEN
                # discards them when ``_do_update`` is False. Column
                # is NOT NULL, so pass a type-correct placeholder.
                name=kwargs.get("name", "") if name_do_update else "",
                color_do_update=color_do_update,
                color=kwargs.get("color", "") if color_do_update else "",
                sort_order_do_update=sort_order_do_update,
                sort_order=kwargs.get("sort_order", 0) if sort_order_do_update else 0,
            )

        return await self.database.execute_write_fn(write)

    async def delete_sheet(self, sheet_id: int) -> None:
        # Five-step cascade — FK cascade isn't on; see deleteWorkbook*
        # for the rationale. Also see queries.sql's note that view
        # records are deliberately NOT cleaned up (pre-existing parity).
        def write(conn):
            _queries.delete_sheet_cells(conn, sheet_id=sheet_id)
            _queries.delete_sheet_columns(conn, sheet_id=sheet_id)
            _queries.delete_sheet_named_ranges(conn, sheet_id=sheet_id)
            _queries.delete_filter_by_sheet(conn, sheet_id=sheet_id)
            _queries.delete_sheet_row(conn, sheet_id=sheet_id)

        await self.database.execute_write_fn(write)

    async def reorder_sheets(
        self, workbook_id: int, sheet_ids: list[int]
    ) -> list[_queries.Sheet]:
        """Assign sort_order 0..N-1 to the given sheet ids in order.

        The list must be a permutation of every sheet currently belonging
        to the workbook — reordering is all-or-nothing, so partial lists
        would silently leave stale sort_order values on the omitted
        sheets. Raises ValueError on mismatch.
        """
        requested = set(sheet_ids)
        if len(sheet_ids) != len(requested):
            raise ValueError("reorder_sheets: duplicate id in list")

        def write(conn):
            existing = {
                s.id for s in _queries.list_sheets(conn, workbook_id=workbook_id)
            }
            if requested != existing:
                raise ValueError("reorder_sheets: ids don't match workbook sheets")
            for idx, sid in enumerate(sheet_ids):
                _queries.reorder_sheet(
                    conn,
                    sort_order=idx,
                    sheet_id=sid,
                    workbook_id=workbook_id,
                )
            return _queries.list_sheets(conn, workbook_id=workbook_id)

        return await self.database.execute_write_fn(write)

    # --- Columns ---

    async def get_columns(self, sheet_id: int) -> list[_queries.Column]:
        def read(conn):
            return _queries.list_columns(conn, sheet_id=sheet_id)

        return await self.database.execute_write_fn(read)

    async def set_column(
        self,
        sheet_id: int,
        col_idx: int,
        name: str | None = None,
        width: int | None = None,
    ) -> _queries.Column | None:
        # Same partial-patch pattern as update_sheet: (do_update, value)
        # pair per mutable column. The SQL's CASE WHEN discards the
        # value when the flag is False.
        name_do_update = name is not None
        width_do_update = width is not None
        if not (name_do_update or width_do_update):
            return None

        def write(conn):
            return _queries.set_column(
                conn,
                sheet_id=sheet_id,
                col_idx=col_idx,
                name_do_update=name_do_update,
                name=name if name_do_update else "",
                width_do_update=width_do_update,
                width=width if width_do_update else 0,
            )

        return await self.database.execute_write_fn(write)

    # --- Cells ---

    async def get_cells(self, sheet_id: int) -> list[_queries.Cell]:
        def read(conn):
            return _queries.list_cells(conn, sheet_id=sheet_id)

        return await self.database.execute_write_fn(read)

    async def set_cells(
        self, sheet_id: int, changes: list[CellChange], actor_id: str | None = None
    ) -> list[_queries.Cell]:
        def write(conn):
            # Strict-mode dropdown validation runs *before* any
            # writes — a single bad value rejects the whole batch
            # so partial saves can't leave the sheet in a state
            # that disagrees with the rule. Two clients clicking
            # the popover concurrently are still safe: each batch
            # validates its own value list against the current
            # rule. [sheet.data.dropdown]
            _validate_dropdown_changes(conn, changes)
            for change in changes:
                if change.raw_value == "":
                    _queries.delete_cell(
                        conn,
                        sheet_id=sheet_id,
                        row_idx=change.row_idx,
                        col_idx=change.col_idx,
                    )
                else:
                    # Map the kind discriminator to the typed_kind
                    # column. ``raw`` writes leave both override
                    # columns NULL, which clears any prior override on
                    # the cell (upsertCell uses ``excluded.typed_*``,
                    # not COALESCE). ``string`` writes install a
                    # force-text override that survives recalc — see
                    # _recalculate_sheet's set_cells_typed dispatch.
                    if change.kind == "raw":
                        typed_kind, typed_data = None, None
                    elif change.kind == "string":
                        typed_kind, typed_data = "string", None
                    else:
                        raise ValueError(f"Unknown cell-write kind: {change.kind!r}")
                    _queries.upsert_cell(
                        conn,
                        sheet_id=sheet_id,
                        row_idx=change.row_idx,
                        col_idx=change.col_idx,
                        raw_value=change.raw_value,
                        format_json=change.format_json,
                        typed_kind=typed_kind,
                        typed_data=typed_data,
                        updated_by=actor_id,
                    )
            # [sheet.filter.auto-expand] If any non-empty write
            # landed at row=max_row+1 within [min_col..max_col], bump
            # the filter's max_row to include the new row. Runs in
            # the same transaction as the cell upserts so the
            # broadcast layer's get_filter() snapshot reflects the
            # post-bump state.
            _maybe_expand_filter(conn, sheet_id, changes)
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return _queries.list_cells(conn, sheet_id=sheet_id)

        return await self.database.execute_write_fn(write)

    async def delete_rows(self, sheet_id: int, row_indices: list[int]) -> list[int]:
        """Delete whole rows and shift every subsequent row up so there's no gap.

        The shift is a single ``UPDATE``: each surviving row's new
        ``row_idx`` is its old ``row_idx`` minus the count of deleted rows
        that were above it. Non-contiguous deletions work the same way.

        Returns the normalized, sorted, deduplicated list of indices that
        were targeted (may include indices that had no cells).
        """
        import json as _json

        normalized = sorted({int(i) for i in row_indices if int(i) >= 0})
        if not normalized:
            return []
        indices_json = _json.dumps(normalized)

        def write(conn):
            # First, rewrite every formula so any ref that pointed into
            # the deleted rows is handled the Google-Sheets way: refs
            # below the deletion shift up, refs inside become #REF!.
            # Must happen on pre-shift coordinates.
            _rewrite_formulas_for_deletion(conn, sheet_id, deleted_rows=normalized)
            _rewrite_named_ranges_for_deletion(conn, sheet_id, deleted_rows=normalized)
            _update_views_for_deletion(conn, sheet_id, deleted_rows=normalized)
            # Filter rectangle shifts in lockstep with views. Bounds
            # collapse, predicate keys re-key (no col change here, so
            # this path is row-axis only — predicates unaffected),
            # filter row erased if every row in [min_row..max_row]
            # was deleted.
            _update_filter_for_deletion(conn, sheet_id, deleted_rows=normalized)
            _queries.delete_cells_in_rows(
                conn, sheet_id=sheet_id, row_indices_json=indices_json
            )
            # Two-pass negative-buffer shift — see the block comment
            # above ``shiftCellRowsToBuffer`` in queries.sql for why
            # this isn't a single ``SET row_idx = row_idx - N``.
            _queries.shift_cell_rows_to_buffer(
                conn, sheet_id=sheet_id, row_indices_json=indices_json
            )
            _queries.shift_cell_rows_from_buffer(
                conn, row_indices_json=indices_json, sheet_id=sheet_id
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return normalized

        return await self.database.execute_write_fn(write)

    async def delete_columns(self, sheet_id: int, col_indices: list[int]) -> list[int]:
        """Delete whole columns and shift every subsequent column left.

        Mirrors :meth:`delete_rows` but operates on ``col_idx``. Two tables
        are affected: ``datasette_sheets_cell`` (per-cell data) and
        ``datasette_sheets_column`` (per-column UI metadata — widths,
        names, formats). Both get the same two-pass negative-buffer shift
        so scrambled rowid scan order can't trip
        ``UNIQUE(sheet_id, row_idx, col_idx)`` /
        ``UNIQUE(sheet_id, col_idx)`` mid-statement.

        Returns the normalized, sorted, deduplicated list of targeted
        indices (may include indices that had no data).
        """
        import json as _json

        normalized = sorted({int(i) for i in col_indices if int(i) >= 0})
        if not normalized:
            return []
        indices_json = _json.dumps(normalized)

        def write(conn):
            # Rewrite every formula for the deletion before we touch the
            # physical cell data (see delete_rows for the rationale).
            _rewrite_formulas_for_deletion(conn, sheet_id, deleted_cols=normalized)
            _rewrite_named_ranges_for_deletion(conn, sheet_id, deleted_cols=normalized)
            _update_views_for_deletion(conn, sheet_id, deleted_cols=normalized)
            _update_filter_for_deletion(conn, sheet_id, deleted_cols=normalized)
            # Delete targeted columns from both tables.
            _queries.delete_cells_in_cols(
                conn, sheet_id=sheet_id, col_indices_json=indices_json
            )
            _queries.delete_columns_in_cols(
                conn, sheet_id=sheet_id, col_indices_json=indices_json
            )
            # Two-pass negative-buffer shift applied to both tables.
            # See shift* comments in queries.sql.
            _queries.shift_cell_cols_to_buffer(
                conn, sheet_id=sheet_id, col_indices_json=indices_json
            )
            _queries.shift_column_cols_to_buffer(
                conn, sheet_id=sheet_id, col_indices_json=indices_json
            )
            _queries.shift_cell_cols_from_buffer(
                conn, col_indices_json=indices_json, sheet_id=sheet_id
            )
            _queries.shift_column_cols_from_buffer(
                conn, col_indices_json=indices_json, sheet_id=sheet_id
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return normalized

        return await self.database.execute_write_fn(write)

    async def move_columns(
        self,
        sheet_id: int,
        src_start: int,
        src_end: int,
        dest_gap: int,
    ) -> dict | None:
        """Move column block ``[src_start, src_end]`` to gap ``dest_gap``.

        ``dest_gap`` is in gap notation: gap ``k`` = "before column ``k``".
        Gap ``0`` is before column A; gap ``N`` is after the last column.
        Single-column drag passes ``src_start == src_end``; multi-column
        drag (att ``ortkjljr``) sets the contiguous selection range.

        Returns ``{"src_start", "src_end", "final_start", "width"}`` on
        success, or ``None`` for a no-op (drop in place, drop on either
        edge of the source range, or drop inside the source range).

        Implementation:
          1. Rewrite every cell formula via the engine's
             ``adjust_refs_for_column_block_move`` (pre-shift coords).
          2. Rewrite named-range definitions the same way.
          3. Update view-registry ``min_col`` / ``max_col`` for any view
             whose range intersects the affected band.
          4. Two-pass negative-buffer shift on cells.
          5. Same shift on ``datasette_sheets_column`` metadata so
             names/widths/formats follow the data.

        Raises ``ValueError`` on invalid input
        (``src_end < src_start``, negative indices). Out-of-range
        ``dest_gap`` snaps to the nearest no-op edge by returning
        ``None``.
        """
        if src_start < 0 or src_end < src_start or dest_gap < 0:
            raise ValueError("invalid src_start / src_end / dest_gap")

        width = src_end - src_start + 1
        # Drops on the source range itself, on either source edge, or
        # inside the source range are all no-ops — the column block
        # would land where it already is.
        if dest_gap >= src_start and dest_gap <= src_end + 1:
            return None

        if dest_gap <= src_start:
            final_start = dest_gap
        else:  # dest_gap > src_end + 1
            final_start = dest_gap - width

        if final_start == src_start:
            return None  # extra belt-and-braces; the gap-edge check above covers this

        low = min(src_start, final_start)
        high = max(src_end, final_start + width - 1)

        def write(conn):
            # Rewrite every formula for the move BEFORE we touch the
            # physical cell data — the engine expects pre-shift
            # coords. Same ordering invariant as delete / insert.
            _rewrite_formulas_for_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _rewrite_named_ranges_for_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _update_views_for_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _update_filter_for_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            # Two-pass negative-buffer shift on cells.
            _queries.move_cell_cols_to_buffer(
                conn, sheet_id=sheet_id, low=low, high=high
            )
            _queries.move_cell_cols_from_buffer(
                conn,
                sheet_id=sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
                width=width,
            )
            # Same shift on column metadata.
            _queries.move_column_meta_to_buffer(
                conn, sheet_id=sheet_id, low=low, high=high
            )
            _queries.move_column_meta_from_buffer(
                conn,
                sheet_id=sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
                width=width,
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return {
                "src_start": src_start,
                "src_end": src_end,
                "final_start": final_start,
                "width": width,
            }

        return await self.database.execute_write_fn(write)

    # [sheet.row.drag-reorder]
    async def move_rows(
        self,
        sheet_id: int,
        src_start: int,
        src_end: int,
        dest_gap: int,
    ) -> dict | None:
        """Move row block ``[src_start, src_end]`` to gap ``dest_gap``.

        Mirror of :meth:`move_columns` on the row axis. Single-row
        drag passes ``src_start == src_end``; multi-row drag (a
        3:7 header selection) sets the contiguous selection range.

        Returns ``{"src_start", "src_end", "final_start", "width"}``
        on success, or ``None`` for a no-op (drop in place, drop on
        either edge of the source range, drop inside the source
        range).

        Implementation:
          1. Rewrite cell formulas via the engine's
             ``adjust_refs_for_row_block_move`` (positional variant —
             bounded ranges in cell formulas stay put).
          2. Rewrite named-range definitions via the data-following
             variant — bounded named ranges denote *named cells*,
             not rectangles.
          3. Update view-registry ``min_row`` / ``max_row`` for any
             view whose row range intersects the affected band.
          4. Two-pass negative-buffer shift on cells. NO row-meta
             table to shift (datasette_sheets_cell is the only
             persisted-per-row state).

        Raises ``ValueError`` on invalid input.
        """
        if src_start < 0 or src_end < src_start or dest_gap < 0:
            raise ValueError("invalid src_start / src_end / dest_gap")

        width = src_end - src_start + 1
        if dest_gap >= src_start and dest_gap <= src_end + 1:
            return None

        if dest_gap <= src_start:
            final_start = dest_gap
        else:
            final_start = dest_gap - width

        if final_start == src_start:
            return None

        low = min(src_start, final_start)
        high = max(src_end, final_start + width - 1)

        def write(conn):
            _rewrite_formulas_for_row_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _rewrite_named_ranges_for_row_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _update_views_for_row_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _update_filter_for_row_move(
                conn,
                sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
            )
            _queries.move_cell_rows_to_buffer(
                conn, sheet_id=sheet_id, low=low, high=high
            )
            _queries.move_cell_rows_from_buffer(
                conn,
                sheet_id=sheet_id,
                src_start=src_start,
                src_end=src_end,
                final_start=final_start,
                width=width,
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return {
                "src_start": src_start,
                "src_end": src_end,
                "final_start": final_start,
                "width": width,
            }

        return await self.database.execute_write_fn(write)

    async def insert_columns(self, sheet_id: int, at: int, count: int = 1) -> list[int]:
        """Insert ``count`` blank columns at index ``at``, shifting every
        column at or past ``at`` right by ``count``.

        Mirrors :meth:`delete_columns` but without the DELETE phase —
        blank columns materialise by their absence from the tables.
        Uses the same two-pass negative-buffer ``col_idx`` shift on
        both ``datasette_sheets_cell`` and ``datasette_sheets_column``
        to dodge ``UNIQUE(sheet_id, row_idx, col_idx)`` /
        ``UNIQUE(sheet_id, col_idx)`` collisions mid-statement when
        SQLite's rowid scan order disagrees with the PK order.

        Returns the zero-based indices the newly blank columns occupy
        in the post-shift sheet — ``[at, at+1, …, at+count-1]``.
        """
        if count <= 0 or at < 0:
            return []

        def write(conn):
            # Rewrite every formula for the insertion before we touch
            # the physical cell data — same pre-shift rationale as the
            # delete path.
            _rewrite_formulas_for_insertion(conn, sheet_id, inserted_cols=[at] * count)
            _rewrite_named_ranges_for_insertion(
                conn, sheet_id, inserted_cols=[at] * count
            )
            _update_views_for_insertion(conn, sheet_id, inserted_cols=[at] * count)
            _update_filter_for_insertion(conn, sheet_id, inserted_cols=[at] * count)
            # Two-pass negative-buffer shift on both tables — see
            # insertShift* comments in queries.sql.
            _queries.insert_shift_cell_cols_to_buffer(conn, sheet_id=sheet_id, at=at)
            _queries.insert_shift_column_cols_to_buffer(conn, sheet_id=sheet_id, at=at)
            _queries.insert_shift_cell_cols_from_buffer(
                conn, count=count, sheet_id=sheet_id
            )
            _queries.insert_shift_column_cols_from_buffer(
                conn, count=count, sheet_id=sheet_id
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return list(range(at, at + count))

        return await self.database.execute_write_fn(write)

    # --- Named ranges ---

    async def list_named_ranges(self, sheet_id: int) -> list[_queries.NamedRange]:
        def read(conn):
            return _queries.list_named_ranges(conn, sheet_id=sheet_id)

        return await self.database.execute_write_fn(read)

    async def set_named_range(
        self, sheet_id: int, name: str, definition: str
    ) -> _queries.NamedRange:
        """Define or overwrite a named range. Validates the definition via the
        Rust engine (which raises ValueError on invalid name or definition)
        before persisting, then recalculates so dependent formulas pick up
        the change."""
        lotus.Sheet().set_name(name, definition)

        def write(conn):
            row = _queries.upsert_named_range(
                conn, sheet_id=sheet_id, name=name, definition=definition
            )
            assert row is not None  # INSERT ... ON CONFLICT ... RETURNING
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return row

        return await self.database.execute_write_fn(write)

    async def delete_named_range(self, sheet_id: int, name: str) -> bool:
        # DELETE ... RETURNING tells us "was anything removed" without a
        # pre-SELECT; the row count used to come from ``cursor.rowcount``
        # but codegened helpers don't expose that, so ``deleteNamedRange``
        # returns the deleted name (or None) instead.
        def write(conn):
            deleted = _queries.delete_named_range(conn, sheet_id=sheet_id, name=name)
            if deleted is None:
                return False
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            _recalculate_sheet(conn, sheet_id)
            return True

        return await self.database.execute_write_fn(write)

    # --- Dropdown rules ---

    async def list_dropdown_rules(
        self, workbook_id: int
    ) -> list[_queries.DropdownRule]:
        def read(conn):
            return _queries.list_dropdown_rules(conn, workbook_id=workbook_id)

        return await self.database.execute_write_fn(read)

    async def create_dropdown_rule(
        self,
        workbook_id: int,
        name: str | None,
        multi: bool,
        options: list[dict],
    ) -> _queries.DropdownRule:
        """Create a workbook-scoped dropdown rule.

        ``options`` is a list of ``{"value": str, "color": str}`` dicts.
        ``value`` is what gets written into a cell's ``raw_value`` when
        the option is selected, so it can't contain ``,`` (multi-select
        rules join on that delimiter). Validation lives in
        :func:`_validate_dropdown_options`; raises ``ValueError`` on
        any bad option.
        """
        _validate_dropdown_options(options)
        options_json = json.dumps(_normalise_dropdown_options(options))

        def write(conn):
            row = _queries.insert_dropdown_rule(
                conn,
                workbook_id=workbook_id,
                name=name,
                multi=1 if multi else 0,
                options_json=options_json,
            )
            assert row is not None  # INSERT ... RETURNING
            return row

        return await self.database.execute_write_fn(write)

    async def update_dropdown_rule(
        self,
        workbook_id: int,
        rule_id: int,
        *,
        name: str | None = None,
        name_set: bool = False,
        multi: bool | None = None,
        options: list[dict] | None = None,
    ) -> _queries.DropdownRule | None:
        """Patch fields on an existing rule. ``name_set=True`` lets the
        caller distinguish "clear name to NULL" from "leave name
        alone"; the standard kwargs-pop pattern doesn't work because
        ``name`` is also a meaningful value.
        """
        if options is not None:
            _validate_dropdown_options(options)

        multi_do_update = multi is not None
        options_do_update = options is not None
        if not (name_set or multi_do_update or options_do_update):
            return None

        options_json = (
            json.dumps(_normalise_dropdown_options(options))
            if options is not None
            else ""
        )

        def write(conn):
            return _queries.update_dropdown_rule(
                conn,
                rule_id=rule_id,
                workbook_id=workbook_id,
                name_do_update=name_set,
                name=name if name_set else None,
                multi_do_update=multi_do_update,
                multi=(1 if multi else 0) if multi_do_update else 0,
                options_do_update=options_do_update,
                options_json=options_json if options_do_update else "",
            )

        return await self.database.execute_write_fn(write)

    async def delete_dropdown_rule(self, workbook_id: int, rule_id: int) -> bool:
        def write(conn):
            deleted = _queries.delete_dropdown_rule(
                conn, rule_id=rule_id, workbook_id=workbook_id
            )
            return deleted is not None

        return await self.database.execute_write_fn(write)

    # --- Filters ---
    #
    # The filter is one row per sheet (``UNIQUE(sheet_id)``);
    # bounds + sort + per-column predicates all live on that row.
    # Bounds shift in lockstep with structural ops via
    # ``_update_filter_for_*`` helpers that mirror the
    # ``_update_views_for_*`` shape — see the bottom of this file.
    #
    # ``get_filter`` returns a Pydantic ``FilterRecord`` so the
    # route layer can hand it back via ``model_dump()``.

    async def get_filter(self, sheet_id: int):
        """Return the sheet's filter as a ``FilterRecord``, or
        ``None`` if no filter is configured. Decodes
        ``predicates_json`` into the typed ``FilterPredicate`` shape
        so callers don't re-do the JSON ⇄ dict dance.
        """
        # Lazy import to avoid a circular: routes/schemas imports
        # this module via routes/helpers → db.
        from .routes.schemas import FilterPredicate, FilterRecord

        def read(conn):
            row = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
            if row is None:
                return None
            try:
                raw = json.loads(row.predicates_json or "{}")
            except json.JSONDecodeError:
                # Defensive: if a hand-edited DB has malformed JSON,
                # treat it as "no predicates" rather than 500ing.
                raw = {}
            predicates = {str(k): FilterPredicate(**v) for k, v in raw.items()}
            return FilterRecord(
                id=row.id,
                min_row=row.min_row,
                min_col=row.min_col,
                max_row=row.max_row,
                max_col=row.max_col,
                sort_col_idx=row.sort_col_idx,
                sort_direction=row.sort_direction,
                predicates=predicates,
            )

        return await self.database.execute_write_fn(read)

    async def create_filter(
        self,
        sheet_id: int,
        *,
        min_row: int,
        min_col: int,
        max_row: int,
        max_col: int,
    ):
        """Create the sheet's filter. Raises ``FilterAlreadyExists``
        if one is already configured (UNIQUE(sheet_id) at the SQL
        level — we do an explicit pre-check so the route can return
        409 without inspecting an IntegrityError message).
        """
        from .routes.schemas import FilterRecord

        # Validate bounds — same shape as create_view's argument
        # checks. ``min_row > max_row`` would be a non-rectangle.
        if min_row < 0 or min_col < 0 or max_row < min_row or max_col < min_col:
            raise ValueError("invalid filter bounds")

        def write(conn):
            existing = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
            if existing is not None:
                raise FilterAlreadyExists(f"sheet {sheet_id} already has a filter")
            row = _queries.insert_filter(
                conn,
                sheet_id=sheet_id,
                min_row=min_row,
                min_col=min_col,
                max_row=max_row,
                max_col=max_col,
                sort_col_idx=None,
                sort_direction=None,
                predicates_json="{}",
            )
            assert row is not None  # INSERT ... RETURNING on a fresh id
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            return FilterRecord(
                id=row.id,
                min_row=row.min_row,
                min_col=row.min_col,
                max_row=row.max_row,
                max_col=row.max_col,
                sort_col_idx=row.sort_col_idx,
                sort_direction=row.sort_direction,
                predicates={},
            )

        return await self.database.execute_write_fn(write)

    async def update_filter_predicate(
        self,
        sheet_id: int,
        col_idx: int,
        hidden: list[str] | None,
    ):
        """Set or remove the predicate for one column inside the
        filter. ``hidden=None`` deletes the column's entry entirely;
        ``hidden=[]`` keeps the entry with an empty list. Out-of-
        range ``col_idx`` raises ``ValueError`` so the route can
        return 400.
        """
        from .routes.schemas import FilterPredicate, FilterRecord

        def write(conn):
            f = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
            if f is None:
                raise ValueError("No filter on this sheet")
            if not (f.min_col <= col_idx <= f.max_col):
                raise ValueError(
                    f"col_idx {col_idx} outside filter range [{f.min_col}..{f.max_col}]"
                )
            try:
                predicates = json.loads(f.predicates_json or "{}")
            except json.JSONDecodeError:
                predicates = {}
            key = str(col_idx)
            if hidden is None:
                predicates.pop(key, None)
            else:
                predicates[key] = {"hidden": list(hidden)}
            _queries.update_filter_predicates(
                conn,
                filter_id=f.id,
                predicates_json=json.dumps(predicates),
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            updated = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
            assert updated is not None
            decoded = json.loads(updated.predicates_json or "{}")
            return FilterRecord(
                id=updated.id,
                min_row=updated.min_row,
                min_col=updated.min_col,
                max_row=updated.max_row,
                max_col=updated.max_col,
                sort_col_idx=updated.sort_col_idx,
                sort_direction=updated.sort_direction,
                predicates={k: FilterPredicate(**v) for k, v in decoded.items()},
            )

        return await self.database.execute_write_fn(write)

    async def sort_filter(
        self,
        sheet_id: int,
        col_idx: int,
        direction: str,
    ):
        """Physically sort the filter's data range by the given column.
        Mutates row positions globally — formulas referencing those
        rows rewrite via the existing ``adjust_refs_for_row_block_move``
        primitive. Persists ``sort_col_idx`` + ``sort_direction`` on
        the filter row.

        Implementation: insertion-sort using ``move_rows`` per
        misplaced row. For v1 this is N round-trips through the
        engine's row-move primitive — fine for the typical
        100-row sheet, would benefit from a one-shot
        ``adjust_refs_for_row_permutation`` primitive if we hit
        perf issues. See PLAN-filter §6.

        [sheet.filter.sort-asc] [sheet.filter.sort-desc]
        """
        from .routes.schemas import FilterPredicate, FilterRecord

        if direction not in ("asc", "desc"):
            raise ValueError(f"sort_direction must be 'asc' or 'desc'")

        f = await self.get_filter(sheet_id)
        if f is None:
            raise ValueError("No filter on this sheet")
        if not (f.min_col <= col_idx <= f.max_col):
            raise ValueError(
                f"col_idx {col_idx} outside filter range [{f.min_col}..{f.max_col}]"
            )
        # Single-row data range: nothing to sort. Still persist sort
        # metadata so the chevron renders the indicator.
        if f.max_row <= f.min_row:
            await self._set_filter_sort_metadata(sheet_id, col_idx, direction)
            return await self.get_filter(sheet_id)

        # Collect (row_idx, key) pairs from the data range. Read
        # directly from the cell table — computed_value carries the
        # last-recalc result with BLOB-affinity so int/float/str/None
        # round-trip correctly. computed_value_kind discriminates
        # boolean (stored as INTEGER 0/1) and Custom (JSON-encoded).
        def read_keys(conn):
            rows = list(
                _queries.list_cells_in_col_range(
                    conn,
                    sheet_id=sheet_id,
                    col_idx=col_idx,
                    min_row=f.min_row + 1,
                    max_row=f.max_row,
                )
            )
            present_at = {
                r.row_idx: (r.computed_value, r.computed_value_kind) for r in rows
            }
            data_rows = list(range(f.min_row + 1, f.max_row + 1))
            return [(r, *present_at.get(r, (None, None))) for r in data_rows]

        pairs = await self.database.execute_write_fn(read_keys)

        def sort_key(entry):
            _, value, kind = entry
            return _filter_sort_key(value, kind)

        sorted_pairs = sorted(pairs, key=sort_key, reverse=(direction == "desc"))
        # ``desired[i]`` = original row_idx that should now sit at
        # position ``f.min_row + 1 + i``.
        desired = [p[0] for p in sorted_pairs]

        # Insertion-sort via repeated move_rows. ``id_to_pos`` tracks
        # the live position of each "row identity" (the original
        # row_idx) as we apply each move.
        id_to_pos = {r: r for r in range(f.min_row + 1, f.max_row + 1)}
        for i, target_id in enumerate(desired):
            target_pos = f.min_row + 1 + i
            current_pos = id_to_pos[target_id]
            if current_pos == target_pos:
                continue
            # move_rows uses gap notation: gap k = "before row k".
            # Moving a single row from current_pos to gap target_pos
            # means it lands at target_pos when current_pos > target_pos
            # (we move up), and at target_pos when current_pos < target_pos
            # (we move down — gap is target_pos+1 in that direction).
            # Use the same logic the existing UX uses: dest_gap clamps
            # to the right value via move_rows' internal computation.
            if current_pos > target_pos:
                dest_gap = target_pos
            else:
                dest_gap = target_pos + 1
            await self.move_rows(
                sheet_id,
                src_start=current_pos,
                src_end=current_pos,
                dest_gap=dest_gap,
            )
            # Update id_to_pos: the moved row is now at target_pos;
            # rows in (target_pos..current_pos-1) shifted by +1
            # (when current_pos > target_pos), or (current_pos+1..target_pos)
            # shifted by -1 (when current_pos < target_pos).
            if current_pos > target_pos:
                for ident, pos in list(id_to_pos.items()):
                    if target_pos <= pos < current_pos:
                        id_to_pos[ident] = pos + 1
            else:
                for ident, pos in list(id_to_pos.items()):
                    if current_pos < pos <= target_pos:
                        id_to_pos[ident] = pos - 1
            id_to_pos[target_id] = target_pos

        # Persist sort metadata.
        await self._set_filter_sort_metadata(sheet_id, col_idx, direction)
        return await self.get_filter(sheet_id)

    async def _set_filter_sort_metadata(
        self, sheet_id: int, col_idx: int | None, direction: str | None
    ):
        def write(conn):
            f = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
            if f is None:
                return
            _queries.update_filter_sort(
                conn,
                filter_id=f.id,
                sort_col_idx=col_idx,
                sort_direction=direction,
            )
            _queries.touch_sheet(conn, sheet_id=sheet_id)

        await self.database.execute_write_fn(write)

    async def delete_filter(self, sheet_id: int) -> bool:
        """Delete the sheet's filter. Returns True if a filter row
        was removed, False if there was nothing to remove."""

        def write(conn):
            existing = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
            if existing is None:
                return False
            _queries.delete_filter_by_sheet(conn, sheet_id=sheet_id)
            _queries.touch_sheet(conn, sheet_id=sheet_id)
            return True

        return await self.database.execute_write_fn(write)

    # --- Views ---

    async def create_view(
        self,
        sheet_id: int,
        view_name: str,
        range_str: str,
        min_row: int,
        min_col: int,
        max_row: int,
        max_col: int,
        use_headers: bool = True,
        enable_insert: bool = False,
        enable_update: bool = False,
        enable_delete: bool = False,
        delete_mode: str = "clear",
    ) -> _queries.View:
        from . import view_sql

        # Validate untrusted inputs up front, before touching the DB.
        view_sql.validate_view_name(view_name)
        view_sql.validate_sheet_id(sheet_id)

        color = "#6366f1"
        writable = enable_insert or enable_update or enable_delete
        data_start_row = min_row + 1 if use_headers else min_row

        def write(conn):
            if _queries.check_name_exists(conn, name=view_name) is not None:
                raise ValueError(f"Name '{view_name}' already exists in database")

            # Fetch raw header strings (from cells or from A/B/C defaults).
            raw_names: list[str] = []
            if use_headers:
                # One range query replaces per-column point lookups.
                by_col = {
                    row.col_idx: row.computed_value
                    for row in _queries.list_cells_in_row(
                        conn,
                        sheet_id=sheet_id,
                        row_idx=min_row,
                        min_col=min_col,
                        max_col=max_col,
                    )
                }
                for c in range(min_col, max_col + 1):
                    # ``computed_value`` may be int / float / str now —
                    # column names are user text, so coerce to str.
                    val = by_col.get(c)
                    raw_names.append(
                        str(val).strip()
                        if val not in (None, "")
                        else lotus.index_to_col(c)
                    )
            else:
                for c in range(min_col, max_col + 1):
                    raw_names.append(lotus.index_to_col(c))

            reserved = (view_sql.ROW_COL,) if writable else ()
            aliases = view_sql.sanitize_column_names(raw_names, reserved=reserved)

            spec = view_sql.ViewSpec(
                view_name=view_name,
                sheet_id=sheet_id,
                min_row=min_row,
                min_col=min_col,
                max_row=max_row,
                max_col=max_col,
                data_start_row=data_start_row,
                column_aliases=aliases,
                enable_insert=enable_insert,
                enable_update=enable_update,
                enable_delete=enable_delete,
                delete_mode=delete_mode,
            )

            # DDL for the actual SQL view + INSTEAD OF triggers stays
            # as direct ``conn.execute`` — it's dynamically built from
            # validated identifiers in view_sql.py and doesn't fit the
            # named-query codegen shape.
            conn.execute(view_sql.build_view_sql(spec))
            for trig in view_sql.build_trigger_sql_list(spec):
                conn.execute(trig)

            row = _queries.insert_view(
                conn,
                sheet_id=sheet_id,
                view_name=view_name,
                range_str=range_str,
                min_row=min_row,
                min_col=min_col,
                max_row=max_row,
                max_col=max_col,
                use_headers=int(use_headers),
                color=color,
                enable_insert=int(enable_insert),
                enable_update=int(enable_update),
                enable_delete=int(enable_delete),
                delete_mode=delete_mode,
            )
            assert row is not None  # INSERT ... RETURNING
            return row

        return await self.database.execute_write_fn(write)

    async def list_views(self, sheet_id: int) -> list[_queries.View]:
        def read(conn):
            return _queries.list_views(conn, sheet_id=sheet_id)

        return await self.database.execute_write_fn(read)

    async def delete_view(self, view_id: int) -> None:
        def write(conn):
            view = _queries.get_view(conn, view_id=view_id)
            if view is not None:
                # view_name was validated at create time via
                # view_sql.validate_view_name, so the f-string DROP
                # is safe. Brackets are SQLite identifier quoting.
                conn.execute(f"DROP VIEW IF EXISTS [{view.view_name}]")
                _queries.delete_view(conn, view_id=view_id)

        await self.database.execute_write_fn(write)


def _normalise_dropdown_options(options: list[dict]) -> list[dict]:
    """Strip to the canonical ``{"value", "color"}`` shape so we don't
    persist client-side junk fields. Caller already validated the
    contents via :func:`_validate_dropdown_options`."""
    return [{"value": str(o["value"]), "color": str(o["color"])} for o in options]


def _validate_dropdown_options(options: list[dict]) -> None:
    """Reject malformed option lists. Comma in ``value`` is rejected
    here (not escaped) — multi-select cells join values with ``,``,
    so allowing the delimiter would force an escape grammar across
    the engine, the popover renderer, and the clipboard layer.
    """
    if not isinstance(options, list):
        raise ValueError("options must be a list")
    if len(options) == 0:
        raise ValueError("a dropdown rule needs at least one option")
    seen: set[str] = set()
    for o in options:
        if not isinstance(o, dict):
            raise ValueError("each option must be an object")
        value = o.get("value")
        color = o.get("color")
        if not isinstance(value, str) or value == "":
            raise ValueError("option value must be a non-empty string")
        if "," in value:
            raise ValueError(f"option value cannot contain ',': {value!r}")
        if not isinstance(color, str) or color == "":
            raise ValueError("option color must be a non-empty string")
        if value in seen:
            raise ValueError(f"duplicate option value: {value!r}")
        seen.add(value)


def _validate_dropdown_changes(conn, changes: list[CellChange]) -> None:
    """Strict-mode dropdown enforcement — rejects the whole batch when
    any cell's ``raw_value`` doesn't fit its rule. Single SELECT per
    distinct rule_id; rules without a ``controlType === "dropdown"``
    flag are skipped (the cell is a plain text cell that happens to
    carry a stale rule reference)."""
    rule_ids: dict[int, dict] = {}  # rule_id → parsed rule (lazy fetched)
    for change in changes:
        if change.format_json is None:
            continue
        try:
            fmt = json.loads(change.format_json)
        except (json.JSONDecodeError, TypeError):
            continue
        if fmt.get("controlType") != "dropdown":
            continue
        rule_id = fmt.get("dropdownRuleId")
        # ``isinstance(True, int)`` is true (bool is an int subclass), so
        # the explicit ``not isinstance(rule_id, bool)`` excludes it.
        if (
            not isinstance(rule_id, int)
            or isinstance(rule_id, bool)
            or rule_id < 1
        ):
            raise ValueError("controlType='dropdown' requires a dropdownRuleId")
        if rule_id not in rule_ids:
            row = _lookup_rule_anywhere(conn, rule_id)
            if row is None:
                raise ValueError(f"dropdown rule not found: {rule_id}")
            multi_raw, options_json = row
            try:
                opts = json.loads(options_json)
            except (json.JSONDecodeError, TypeError) as e:
                raise ValueError(
                    f"dropdown rule {rule_id} has malformed options"
                ) from e
            rule_ids[rule_id] = {
                "multi": bool(multi_raw),
                "values": {str(o.get("value")) for o in opts},
            }
        rule = rule_ids[rule_id]
        if change.raw_value == "":
            continue  # blank is always allowed (clears the cell)
        if rule["multi"]:
            picked = [s.strip() for s in change.raw_value.split(",")]
            picked = [s for s in picked if s]
            for v in picked:
                if v not in rule["values"]:
                    raise ValueError(f"value not in dropdown rule {rule_id}: {v!r}")
        else:
            if change.raw_value not in rule["values"]:
                raise ValueError(
                    f"value not in dropdown rule {rule_id}: {change.raw_value!r}"
                )


def _lookup_rule_anywhere(conn, rule_id: int) -> tuple[int, str] | None:
    """Lookup a rule's ``(multi, options_json)`` by id alone. The cell's
    ``format_json`` carries only the rule id; the rule's parent
    workbook is implied by the cell's sheet → workbook chain, but
    walking that chain per-validation is more SQL than necessary.

    Returns ``None`` when no rule exists (caller raises so the cell
    write is rejected — a stale ``dropdownRuleId`` against a
    just-deleted rule is the most common cause)."""
    row = conn.execute(
        "select multi, options_json from datasette_sheets_dropdown_rule where id = ?",
        [rule_id],
    ).fetchone()
    return row


# Coordinate helpers live in the engine: ``lotus.index_to_col`` /
# ``col_to_index`` / ``cell_id`` / ``parse_cell_id`` — the A1 grammar
# is owned in one place (``lotus-core``) instead of redefined per
# language. ``parse_cell_id`` returns ``{"row": int, "col": int}``;
# ``cell_id`` takes ``(row, col)`` in that order.


def reconstruct_typed(stored, kind):
    """Inverse of :func:`_split_typed` for read paths (data API).

    ``kind='bool'`` rebuilds a Python ``bool`` from the INTEGER 0/1 the
    column actually holds; ``kind='custom'`` parses the JSON-encoded
    ``{type_tag, data}`` dict back out. Everything else passes through.
    Centralised here so route handlers don't reimplement the
    discriminator semantics.
    """
    if kind == "bool":
        return bool(stored)
    if kind == "custom":
        return json.loads(stored) if stored is not None else None
    return stored


def _split_typed(value):
    """Split an engine-typed value into ``(stored, kind)`` for SQLite.

    SQLite has no boolean storage class — Python ``True``/``False`` adapt
    to INTEGER ``1``/``0`` and read back indistinguishable from a real
    ``Number(1.0)`` cell. Tag booleans with ``kind='bool'`` so the data
    API can round-trip them as JSON ``true``/``false``.

    Custom values from ``get_all_typed`` arrive as ``{type_tag, data}``
    dicts. Encode as JSON and tag ``kind='custom'`` so the BLOB-affinity
    column carries them as TEXT and ``reconstruct_typed`` can decode
    them back. The (value, kind) pair stays comparable for the recalc
    change-detection short-circuit.

    Everything else rides the column's BLOB affinity unchanged
    (``int``, ``float``, ``str``, ``None``).

    Order matters: ``isinstance(True, int)`` is true (bool is an int
    subclass), so the bool branch comes first.
    """
    if isinstance(value, bool):
        return (1 if value else 0, "bool")
    if isinstance(value, dict) and "type_tag" in value and "data" in value:
        return (json.dumps(value, sort_keys=True), "custom")
    return (value, None)


def _build_cell_input(row) -> dict:
    """Translate a recalc-row's (raw_value, typed_kind, typed_data)
    triple into the kind-discriminated dict that
    ``lotus.Sheet.set_cells_typed`` expects.

    typed_kind=NULL → ``{"kind":"raw", "value": raw_value}`` (engine
    auto-classifies). Otherwise the typed override determines the
    payload shape; the raw_value is ignored for typed kinds because
    the engine reconstructs its display from the typed value.
    """
    if row.typed_kind is None:
        return {"kind": "raw", "value": row.raw_value}
    if row.typed_kind == "string":
        return {"kind": "string", "value": row.raw_value}
    if row.typed_kind == "number":
        return {"kind": "number", "value": float(row.raw_value)}
    if row.typed_kind == "boolean":
        return {"kind": "boolean", "value": row.raw_value.upper() == "TRUE"}
    if row.typed_kind == "custom":
        # typed_data carries '{"type_tag": ..., "data": ...}'.
        payload = json.loads(row.typed_data)
        return {"kind": "custom", **payload}
    # Unknown override → fall back to raw so a stray bad row can't
    # crash the recalc; the override was set in error.
    return {"kind": "raw", "value": row.raw_value}


def _recalculate_sheet(conn, sheet_id: int) -> None:
    rows = _queries.list_cells_for_recalc(conn, sheet_id=sheet_id)
    if not rows:
        return
    engine = lotus.Sheet()
    # Register the datetime + url handlers so ISO date / time strings
    # auto-classify as jdate / jtime / jdatetime / jzoned (date
    # arithmetic resolves to jspan) and URL strings auto-classify as
    # jurl. Must run on every fresh engine — _recalculate_sheet
    # builds a new lotus.Sheet() per call.
    engine.register_datetime()
    engine.register_url()
    # Named ranges resolve workbook-globally — feed them in before
    # set_cells so any formula that references a name sees the
    # definition during its first evaluation.
    for nr in _queries.list_named_ranges_for_recalc(conn, sheet_id=sheet_id):
        engine.set_name(nr.name, nr.definition)
    # Build kind-discriminated set_cells_typed input: cells with no
    # typed override (typed_kind IS NULL) flow through as ``kind:"raw"``
    # exactly like the old set_cells path; cells with an override
    # bypass auto-classification on every recalc, so a force-text
    # cell stays string regardless of how its raw_value would be
    # auto-classified. [sheet.cell.force-text]
    cell_inputs = [
        (lotus.cell_id(r.row_idx, r.col_idx), _build_cell_input(r)) for r in rows
    ]
    engine.set_cells_typed(cell_inputs)
    # `get_all_typed` preserves the engine's int / float / str / bool
    # classification — paired with the BLOB-affinity computed_value
    # column + the computed_value_kind discriminator, every variant
    # survives the SQLite round-trip.
    computed = engine.get_all_typed()

    # Only write back cells whose ``(value, kind)`` pair actually
    # changed. Comparing on the pair is load-bearing: a Boolean(true)
    # and a Number(1.0) both adapt to INTEGER 1, so equality on value
    # alone would convince the recalc that nothing changed when in
    # fact the type discriminator did.
    old_pairs = {
        lotus.cell_id(r.row_idx, r.col_idx): (r.computed_value, r.computed_value_kind)
        for r in rows
    }
    for cid, value in computed.items():
        stored, kind = _split_typed(value)
        if old_pairs.get(cid) != (stored, kind):
            coord = lotus.parse_cell_id(cid)
            _queries.update_cell_computed(
                conn,
                value=stored,
                kind=kind,
                sheet_id=sheet_id,
                row_idx=coord["row"],
                col_idx=coord["col"],
            )


def _rewrite_formulas_for_deletion(
    conn,
    sheet_id: int,
    *,
    deleted_cols: list[int] | None = None,
    deleted_rows: list[int] | None = None,
) -> None:
    """Rewrite every formula in this sheet to account for the deletion.

    Must run *before* the DELETE + shift SQL so the rewrite sees the
    pre-shift coordinates. Uses the Rust engine's
    ``adjust_refs_for_deletion``: surviving refs shift past the
    deletion point, ranges trim, refs that fall entirely in the
    deletion become ``#REF!``. Matches Google Sheets' behavior.

    See TODO-liblotus-ref-rewrite.md for the engine-side design.
    """
    if not deleted_cols and not deleted_rows:
        return
    _rewrite_formulas(
        conn,
        sheet_id,
        lotus.adjust_refs_for_deletion,
        deleted_cols=list(deleted_cols or []),
        deleted_rows=list(deleted_rows or []),
    )


def _rewrite_formulas_for_insertion(
    conn,
    sheet_id: int,
    *,
    inserted_cols: list[int] | None = None,
    inserted_rows: list[int] | None = None,
) -> None:
    """Mirror of :func:`_rewrite_formulas_for_deletion` for insertion.

    Must run *before* the physical shift so the engine sees pre-shift
    coordinates. Uses ``lotus.adjust_refs_for_insertion``:
    refs at or past each insertion point shift outward, ranges
    straddling an insertion grow to include the new blank row/col,
    absolute components (``$``) keep their markers but still shift
    positionally.
    """
    if not inserted_cols and not inserted_rows:
        return
    _rewrite_formulas(
        conn,
        sheet_id,
        lotus.adjust_refs_for_insertion,
        inserted_cols=list(inserted_cols or []),
        inserted_rows=list(inserted_rows or []),
    )


def _rewrite_formulas(conn, sheet_id: int, adjust_fn, **adjust_kwargs) -> None:
    """Shared inner loop for the deletion / insertion rewrite passes.

    ``list_formula_cells`` filters to ``raw_value LIKE '=%'`` so only
    formula rows make it to the engine; we re-check equality after
    each ``adjust_fn`` call to skip the UPDATE when nothing changed.
    """
    for cell in _queries.list_formula_cells(conn, sheet_id=sheet_id):
        new_raw = adjust_fn(cell.raw_value, **adjust_kwargs)
        if new_raw != cell.raw_value:
            _queries.update_cell_raw(
                conn,
                raw_value=new_raw,
                sheet_id=sheet_id,
                row_idx=cell.row_idx,
                col_idx=cell.col_idx,
            )


def _rewrite_named_ranges(conn, sheet_id: int, adjust_fn, **adjust_kwargs) -> None:
    """Shared inner loop for named-range definition rewrites under
    structural ops. Mirrors :func:`_rewrite_formulas` but iterates
    named-range definitions instead of cell formulas.

    Definitions that don't start with ``=`` are literals (e.g.
    ``0.05``) and are passed through unchanged — the engine's
    ``adjust_refs_*`` primitives also pass non-formula input through
    untouched, so this filter is belt-and-braces. Skipping locally
    avoids the engine call overhead.

    Used by :func:`_rewrite_named_ranges_for_deletion`,
    :func:`_rewrite_named_ranges_for_insertion`, and
    :func:`_rewrite_named_ranges_for_move`.
    """
    for nr in _queries.list_named_ranges_for_recalc(conn, sheet_id=sheet_id):
        if not nr.definition.startswith("="):
            continue
        new_def = adjust_fn(nr.definition, **adjust_kwargs)
        if new_def != nr.definition:
            _queries.update_named_range_definition(
                conn,
                sheet_id=sheet_id,
                name=nr.name,
                definition=new_def,
            )


def _rewrite_named_ranges_for_deletion(
    conn,
    sheet_id: int,
    *,
    deleted_cols: list[int] | None = None,
    deleted_rows: list[int] | None = None,
) -> None:
    """Rewrite named-range definitions for a row/col deletion. Closes
    parity with :func:`_rewrite_formulas_for_deletion` — without this
    a named range like ``=D1:D10`` would survive a column-D delete
    with a definition pointing at the wrong (post-shift) cells.
    """
    if not deleted_cols and not deleted_rows:
        return
    _rewrite_named_ranges(
        conn,
        sheet_id,
        lotus.adjust_refs_for_deletion,
        deleted_cols=list(deleted_cols or []),
        deleted_rows=list(deleted_rows or []),
    )


def _rewrite_named_ranges_for_insertion(
    conn,
    sheet_id: int,
    *,
    inserted_cols: list[int] | None = None,
    inserted_rows: list[int] | None = None,
) -> None:
    """Mirror of :func:`_rewrite_named_ranges_for_deletion` for the
    insertion direction. Definitions referencing cols at-or-past an
    inserted index shift outward.
    """
    if not inserted_cols and not inserted_rows:
        return
    _rewrite_named_ranges(
        conn,
        sheet_id,
        lotus.adjust_refs_for_insertion,
        inserted_cols=list(inserted_cols or []),
        inserted_rows=list(inserted_rows or []),
    )


def _rewrite_formulas_for_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> None:
    """Rewrite every cell formula to reflect a column block move.

    Mirror of :func:`_rewrite_formulas_for_deletion` /
    :func:`…_for_insertion`. Uses the engine primitive
    ``adjust_refs_for_column_block_move`` (liblotus 573e2d5+) which
    handles single-cell refs, whole-column ranges (with interior-bbox
    semantics — see TODO-liblotus-column-block-move.md), spill
    anchors, and absolute markers. Bounded ranges (``A1:D5``) are
    intentionally left positional.

    Must run *before* the physical SQL shift so the engine sees
    pre-shift coordinates.
    """
    _rewrite_formulas(
        conn,
        sheet_id,
        lotus.adjust_refs_for_column_block_move,
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
    )


def _rewrite_named_ranges_for_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> None:
    """Rewrite named-range definitions for a column block move.
    See :func:`_rewrite_named_ranges` for the shared loop.

    Uses the *data-following* variant of the engine primitive
    (liblotus ``cbdd41b+``): bounded ranges in named-range
    definitions follow the data via interior-bbox semantics, the
    same way whole-col ranges already do. This differs from the
    cell-formula path (:func:`_rewrite_formulas_for_move`) which
    uses the positional variant — bounded ranges in cell formulas
    denote rectangles, not named cells, so they stay put.
    """
    _rewrite_named_ranges(
        conn,
        sheet_id,
        lotus.adjust_refs_for_column_block_move_data_following,
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
    )


def _update_views(
    conn,
    sheet_id: int,
    fwd_col,
    fwd_row,
) -> None:
    """Shared inner loop for view-registry bound updates under
    structural ops. ``fwd_col`` / ``fwd_row`` are functions
    ``int -> int | None`` where ``None`` signals "this index was
    deleted" (relevant for the deletion path; move + insertion
    never return None — they're total maps).

    Each view's bounds are recomputed as the bounding box of every
    *surviving* forward-mapped index in the view's old range. If
    every index along an axis maps to None (entire view erased),
    the view is left alone — the parity v1 doesn't add a broken-
    view status column; that's a UX question deferred to a future
    follow-up.

    Caveat shared by every caller: the underlying SQL VIEW DDL
    (built by ``view_sql.build_view_sql``) uses absolute cell
    coords; those cells moved with the data so SELECTs still
    resolve to the same logical columns IF the structural op
    didn't straddle the view's range. Cross-straddle DDL
    regeneration is documented as a known follow-up.
    """
    for view in _queries.list_views(conn, sheet_id=sheet_id):
        # Column axis.
        new_cols_raw = [fwd_col(c) for c in range(view.min_col, view.max_col + 1)]
        surviving_cols = [c for c in new_cols_raw if c is not None]
        if not surviving_cols:
            # Every col in the view's range was deleted. Leave the
            # registry row alone — a future broken-view UX will
            # surface this state explicitly.
            continue
        new_col_min, new_col_max = min(surviving_cols), max(surviving_cols)

        # Row axis — same shape.
        new_rows_raw = [fwd_row(r) for r in range(view.min_row, view.max_row + 1)]
        surviving_rows = [r for r in new_rows_raw if r is not None]
        if not surviving_rows:
            continue
        new_row_min, new_row_max = min(surviving_rows), max(surviving_rows)

        if (new_col_min, new_col_max) != (view.min_col, view.max_col):
            _queries.update_view_col_bounds(
                conn,
                view_id=view.id,
                min_col=new_col_min,
                max_col=new_col_max,
            )
        if (new_row_min, new_row_max) != (view.min_row, view.max_row):
            _queries.update_view_row_bounds(
                conn,
                view_id=view.id,
                min_row=new_row_min,
                max_row=new_row_max,
            )


def _update_views_for_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> None:
    """Update view-registry bounds for a column block move.
    Move is a permutation — no None returns. See :func:`_update_views`
    for the shared loop."""
    width = src_end - src_start + 1

    def fwd_col(c: int) -> int:
        if src_start <= c <= src_end:
            return c - src_start + final_start
        if final_start < src_start:
            if final_start <= c < src_start:
                return c + width
            return c
        # final_start > src_end
        if src_end < c < final_start + width:
            return c - width
        return c

    _update_views(conn, sheet_id, fwd_col, lambda r: r)


# [sheet.row.drag-reorder]
def _rewrite_formulas_for_row_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> None:
    """Cell-formula rewrite for a row block move. Bounded ranges
    stay positional — that's the engine's positional variant.
    Mirror of :func:`_rewrite_formulas_for_move` on the row axis.
    """
    _rewrite_formulas(
        conn,
        sheet_id,
        lotus.adjust_refs_for_row_block_move,
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
    )


# [sheet.row.drag-reorder]
def _rewrite_named_ranges_for_row_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> None:
    """Named-range definition rewrite for a row block move. Uses
    the data-following variant: bounded named ranges follow the
    cells they were named over via interior-bbox semantics. Same
    asymmetry as :func:`_rewrite_named_ranges_for_move` on the
    column axis.
    """
    _rewrite_named_ranges(
        conn,
        sheet_id,
        lotus.adjust_refs_for_row_block_move_data_following,
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
    )


# [sheet.row.drag-reorder]
def _update_views_for_row_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> None:
    """Update view-registry [min_row, max_row] bounds for a row
    block move. Reuses the shared :func:`_update_views` loop with
    a pass-through ``fwd_col`` and the row forward map.
    """
    width = src_end - src_start + 1

    def fwd_row(r: int) -> int:
        if src_start <= r <= src_end:
            return r - src_start + final_start
        if final_start < src_start:
            if final_start <= r < src_start:
                return r + width
            return r
        # final_start > src_end
        if src_end < r < final_start + width:
            return r - width
        return r

    _update_views(conn, sheet_id, lambda c: c, fwd_row)


def _update_views_for_deletion(
    conn,
    sheet_id: int,
    *,
    deleted_cols: list[int] | None = None,
    deleted_rows: list[int] | None = None,
) -> None:
    """Update view-registry bounds after a row/col deletion.
    Indices in ``deleted_cols`` / ``deleted_rows`` map to None;
    surviving indices shift left/up by the count of deletions
    before them. Closes parity with the col-move path (att
    ``c85nqtm3``)."""
    if not deleted_cols and not deleted_rows:
        return
    deleted_col_set = set(deleted_cols or [])
    deleted_row_set = set(deleted_rows or [])

    def fwd_col(c: int) -> int | None:
        if c in deleted_col_set:
            return None
        shift = sum(1 for d in deleted_col_set if d < c)
        return c - shift

    def fwd_row(r: int) -> int | None:
        if r in deleted_row_set:
            return None
        shift = sum(1 for d in deleted_row_set if d < r)
        return r - shift

    _update_views(conn, sheet_id, fwd_col, fwd_row)


def _update_views_for_insertion(
    conn,
    sheet_id: int,
    *,
    inserted_cols: list[int] | None = None,
    inserted_rows: list[int] | None = None,
) -> None:
    """Update view-registry bounds after a row/col insertion.
    Indices at-or-past each insertion point shift outward by the
    count of insertions at-or-before them. Total map (no None)."""
    if not inserted_cols and not inserted_rows:
        return
    cols = list(inserted_cols or [])
    rows = list(inserted_rows or [])

    def fwd_col(c: int) -> int:
        shift = sum(1 for i in cols if i <= c)
        return c + shift

    def fwd_row(r: int) -> int:
        shift = sum(1 for i in rows if i <= r)
        return r + shift

    _update_views(conn, sheet_id, fwd_col, fwd_row)


# --- Filter bound-shift helpers ---------------------------------------------
#
# Mirror of the ``_update_views_*`` family above, with three
# differences:
#
#   1. Filter fully erased ⇒ DELETE the filter row outright.
#      Views leave a stale registry row behind because they hold
#      DDL the user might want to revive; filters don't, so
#      cleanup is the kind thing to do.
#   2. Predicate keys (string col_idx) re-key under ``fwd_col``.
#      Predicates on a fully-deleted column drop; predicates on a
#      moved column shift to the new index.
#   3. ``sort_col_idx`` shifts under ``fwd_col``; mapping to
#      ``None`` clears the active sort.
#
# Each ``_update_filter_for_*`` returns a bool indicating whether
# the filter row was modified (or deleted) — callers use it to
# gate a ``filter-update`` / ``filter-delete`` SSE broadcast.


def _update_filter(conn, sheet_id: int, fwd_col, fwd_row) -> str | None:
    """Inner loop. Returns:

    - ``"deleted"`` if the filter was fully erased and dropped.
    - ``"updated"`` if any field changed.
    - ``None`` if no change.
    """
    f = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
    if f is None:
        return None

    new_cols_raw = [fwd_col(c) for c in range(f.min_col, f.max_col + 1)]
    surviving_cols = [c for c in new_cols_raw if c is not None]
    new_rows_raw = [fwd_row(r) for r in range(f.min_row, f.max_row + 1)]
    surviving_rows = [r for r in new_rows_raw if r is not None]
    if not surviving_cols or not surviving_rows:
        _queries.delete_filter_by_sheet(conn, sheet_id=sheet_id)
        return "deleted"

    new_col_min, new_col_max = min(surviving_cols), max(surviving_cols)
    new_row_min, new_row_max = min(surviving_rows), max(surviving_rows)

    changed = False
    if (new_col_min, new_col_max) != (f.min_col, f.max_col):
        _queries.update_filter_col_bounds(
            conn,
            filter_id=f.id,
            min_col=new_col_min,
            max_col=new_col_max,
        )
        changed = True
    if (new_row_min, new_row_max) != (f.min_row, f.max_row):
        _queries.update_filter_row_bounds(
            conn,
            filter_id=f.id,
            min_row=new_row_min,
            max_row=new_row_max,
        )
        changed = True

    # Re-key predicates_json. Predicate keys are stringified
    # col_idx values (JSON object keys are always strings).
    try:
        old_predicates = json.loads(f.predicates_json or "{}")
    except json.JSONDecodeError:
        old_predicates = {}
    new_predicates: dict[str, dict] = {}
    for k, v in old_predicates.items():
        try:
            old_idx = int(k)
        except (ValueError, TypeError):
            continue  # malformed key — drop it on the rewrite
        new_idx = fwd_col(old_idx)
        if new_idx is not None:
            new_predicates[str(new_idx)] = v
    new_predicates_json = json.dumps(new_predicates)
    if new_predicates_json != (f.predicates_json or "{}"):
        _queries.update_filter_predicates(
            conn,
            filter_id=f.id,
            predicates_json=new_predicates_json,
        )
        changed = True

    # Shift sort_col_idx — clear the sort when its column is
    # erased (fwd_col(...) == None).
    if f.sort_col_idx is not None:
        new_sort = fwd_col(f.sort_col_idx)
        if new_sort != f.sort_col_idx:
            if new_sort is None:
                _queries.update_filter_sort(
                    conn,
                    filter_id=f.id,
                    sort_col_idx=None,
                    sort_direction=None,
                )
            else:
                _queries.update_filter_sort(
                    conn,
                    filter_id=f.id,
                    sort_col_idx=new_sort,
                    sort_direction=f.sort_direction,
                )
            changed = True

    return "updated" if changed else None


def _update_filter_for_deletion(
    conn,
    sheet_id: int,
    *,
    deleted_cols: list[int] | None = None,
    deleted_rows: list[int] | None = None,
) -> str | None:
    if not deleted_cols and not deleted_rows:
        return None
    deleted_col_set = set(deleted_cols or [])
    deleted_row_set = set(deleted_rows or [])

    def fwd_col(c):
        if c in deleted_col_set:
            return None
        shift = sum(1 for d in deleted_col_set if d < c)
        return c - shift

    def fwd_row(r):
        if r in deleted_row_set:
            return None
        shift = sum(1 for d in deleted_row_set if d < r)
        return r - shift

    return _update_filter(conn, sheet_id, fwd_col, fwd_row)


def _update_filter_for_insertion(
    conn,
    sheet_id: int,
    *,
    inserted_cols: list[int] | None = None,
    inserted_rows: list[int] | None = None,
) -> str | None:
    if not inserted_cols and not inserted_rows:
        return None
    cols = list(inserted_cols or [])
    rows = list(inserted_rows or [])

    def fwd_col(c):
        shift = sum(1 for i in cols if i <= c)
        return c + shift

    def fwd_row(r):
        shift = sum(1 for i in rows if i <= r)
        return r + shift

    return _update_filter(conn, sheet_id, fwd_col, fwd_row)


def _update_filter_for_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> str | None:
    """Column-axis block move."""
    width = src_end - src_start + 1

    def fwd_col(c):
        if src_start <= c <= src_end:
            return c - src_start + final_start
        if final_start < src_start:
            if final_start <= c < src_start:
                return c + width
            return c
        if src_end < c < final_start + width:
            return c - width
        return c

    return _update_filter(conn, sheet_id, fwd_col, lambda r: r)


def _filter_sort_key(value, kind):
    """Type-aware sort key for filter sort. Precedence (asc):

        numbers  <  strings  <  booleans  <  empty / null

    Mirror of the JS-side comparison the picker uses, and matches
    Google Sheets ordering. ``kind`` is the discriminator from
    ``computed_value_kind`` ('bool' for booleans, 'custom' for
    engine-typed Custom values; NULL means use the natural Python
    type of ``computed_value``).

    Custom values fall into the strings bucket so cross-type
    comparison is well-defined; v1 doesn't try to compare j-spans
    or j-dates structurally.
    """
    if value is None or value == "":
        return (3, 0)
    if kind == "bool":
        # Bool stored as INTEGER 0/1 — promote 1.0 ⇒ True etc.
        return (2, bool(value))
    if isinstance(value, bool):
        return (2, value)
    if isinstance(value, (int, float)):
        return (0, float(value))
    if isinstance(value, str):
        return (1, value.lower())
    # Custom or unexpected: stringify for stable ordering.
    return (1, str(value).lower())


def _maybe_expand_filter(
    conn,
    sheet_id: int,
    changes: list[CellChange],
) -> bool:
    """Bump the filter's ``max_row`` when a non-empty write lands
    at row=max_row+1 within ``[min_col..max_col]``. Mirrors Google
    Sheets' "type below to extend" behavior.

    Idempotent — multiple writes in the same batch only bump once
    (to the highest matching target row, since we walk every change
    and pick the max). Empty writes (``raw_value == ""``) don't
    extend.

    [sheet.filter.auto-expand]
    """
    f = _queries.get_filter_by_sheet(conn, sheet_id=sheet_id)
    if f is None:
        return False
    target_row = f.max_row + 1
    extended_to = f.max_row
    for c in changes:
        if (
            c.raw_value
            and c.row_idx == target_row
            and f.min_col <= c.col_idx <= f.max_col
        ):
            extended_to = max(extended_to, target_row)
    if extended_to == f.max_row:
        return False
    _queries.update_filter_row_bounds(
        conn,
        filter_id=f.id,
        min_row=f.min_row,
        max_row=extended_to,
    )
    return True


def _update_filter_for_row_move(
    conn,
    sheet_id: int,
    *,
    src_start: int,
    src_end: int,
    final_start: int,
) -> str | None:
    """Row-axis block move."""
    width = src_end - src_start + 1

    def fwd_row(r):
        if src_start <= r <= src_end:
            return r - src_start + final_start
        if final_start < src_start:
            if final_start <= r < src_start:
                return r + width
            return r
        if src_end < r < final_start + width:
            return r - width
        return r

    return _update_filter(conn, sheet_id, lambda c: c, fwd_row)
