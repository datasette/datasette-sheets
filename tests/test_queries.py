"""Integration tests for the codegened ``datasette_sheets._queries``
module.

Unit tests in ``test_gen_queries.py`` prove the generator emits
well-shaped Python. These tests prove the emitted Python actually
round-trips real rows through SQLite with the real schema applied —
catching any mismatch between the IR solite-dev produces and the
actual column order / types the generated SELECT binds.

We apply ``migrations.py`` to a fresh in-memory connection (same way
``test_row_shift.py`` sets up its SQL fixtures) and exercise every
query in ``_queries.py`` directly, asserting on the dataclass fields.
"""

from __future__ import annotations

import sqlite3

import pytest
from sqlite_utils import Database

from datasette_sheets import _queries
from datasette_sheets.migrations import migrations


@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    migrations.apply(Database(c))
    yield c
    c.close()


def _insert_workbook(
    conn: sqlite3.Connection,
    wb_id: str,
    name: str,
    created_by: str | None = None,
    sort_order: int = 0,
) -> None:
    conn.execute(
        "INSERT INTO datasette_sheets_workbook "
        "(id, name, created_by, sort_order) VALUES (?, ?, ?, ?)",
        [wb_id, name, created_by, sort_order],
    )


# --- list_workbooks -----------------------------------------------------------


def test_list_workbooks_empty(conn):
    assert _queries.list_workbooks(conn) == []


def test_list_workbooks_returns_typed_rows(conn):
    _insert_workbook(conn, "wb1", "Budget")
    _insert_workbook(conn, "wb2", "Inventory", created_by="alex")

    rows = _queries.list_workbooks(conn)

    assert len(rows) == 2
    assert all(isinstance(r, _queries.Workbook) for r in rows)
    # Columns the generator typed non-null must never be None at runtime.
    for r in rows:
        assert isinstance(r.id, str) and r.id
        assert isinstance(r.name, str)
        assert isinstance(r.created_at, str)
        assert isinstance(r.updated_at, str)


def test_list_workbooks_preserves_null_created_by(conn):
    # ``created_by`` is the only nullable column exercised here; the
    # generator types it as ``str | None``. A missing value must round-trip
    # as Python ``None``, not the empty string.
    _insert_workbook(conn, "wb1", "Anon")
    (row,) = _queries.list_workbooks(conn)
    assert row.created_by is None


def test_list_workbooks_orders_by_sort_order_then_created_at(conn):
    # Insert out of display order; expected order: sort_order 0 first,
    # then sort_order 1.
    _insert_workbook(conn, "wb1", "Second", sort_order=1)
    _insert_workbook(conn, "wb2", "First", sort_order=0)
    names = [r.name for r in _queries.list_workbooks(conn)]
    assert names == ["First", "Second"]


# --- get_workbook -------------------------------------------------------------


def test_get_workbook_hit(conn):
    _insert_workbook(conn, "wb1", "Budget", created_by="alex")
    row = _queries.get_workbook(conn, "wb1")

    assert isinstance(row, _queries.Workbook)
    assert row.id == "wb1"
    assert row.name == "Budget"
    assert row.created_by == "alex"


def test_get_workbook_miss_returns_none(conn):
    assert _queries.get_workbook(conn, "does-not-exist") is None


def test_get_workbook_uses_typed_bind_key(conn):
    # Regression guard: sqlite3 keeps ``::text`` in the bind name even
    # though Python's arg is bare ``workbook_id``. If the bind dict
    # is ever generated with the wrong key we'd hit
    # ``ProgrammingError: You did not supply a value for binding parameter``
    # — assert we don't.
    _insert_workbook(conn, "wb1", "Budget")
    # Should not raise; exact value comparison already covered above.
    _queries.get_workbook(conn, "wb1")


def test_get_workbook_does_not_leak_across_ids(conn):
    _insert_workbook(conn, "wb1", "First")
    _insert_workbook(conn, "wb2", "Second")
    row = _queries.get_workbook(conn, "wb2")
    assert row is not None and row.name == "Second"


# --- insert_workbook ----------------------------------------------------------


def test_insert_workbook_returns_the_fresh_row(conn):
    # ``insertWorkbook :row`` uses INSERT ... RETURNING so the caller
    # doesn't need a follow-up SELECT. Verify the row it hands back
    # has DB-defaulted columns (timestamps, sort_order) populated.
    row = _queries.insert_workbook(
        conn, workbook_id="wb1", name="Budget", created_by="alex"
    )
    assert row is not None
    assert row.id == "wb1"
    assert row.name == "Budget"
    assert row.created_by == "alex"
    assert row.sort_order == 0
    assert row.created_at and row.updated_at


def test_insert_workbook_accepts_null_creator(conn):
    # ``created_by`` is typed ``Any`` by the generator (bare `:` sigil)
    # specifically so None passes cleanly for anonymous creates.
    row = _queries.insert_workbook(
        conn, workbook_id="wb1", name="Anon", created_by=None
    )
    assert row is not None and row.created_by is None


# --- update_workbook (sqlc-style CASE WHEN partial update) -------------------


def _update_all(conn, workbook_id: str, name: str, sort_order: int):
    """Convenience: update every field in one shot."""
    return _queries.update_workbook(
        conn,
        workbook_id=workbook_id,
        name_do_update=True,
        name=name,
        sort_order_do_update=True,
        sort_order=sort_order,
    )


def test_update_workbook_writes_every_field(conn):
    _queries.insert_workbook(conn, workbook_id="wb1", name="Old", created_by=None)
    row = _update_all(conn, "wb1", name="New", sort_order=5)
    assert row is not None
    assert row.name == "New"
    assert row.sort_order == 5


def test_update_workbook_partial_leaves_untouched_fields_alone(conn):
    # The whole point of the CASE WHEN pattern: when
    # ``_do_update`` is False the column's pre-UPDATE value wins.
    # Pass a bogus value alongside the False flag to prove it's
    # ignored.
    _queries.insert_workbook(conn, workbook_id="wb1", name="Real", created_by=None)
    _update_all(conn, "wb1", name="Real", sort_order=7)  # seed sort_order=7

    row = _queries.update_workbook(
        conn,
        workbook_id="wb1",
        name_do_update=True,
        name="Renamed",
        sort_order_do_update=False,
        # Intentionally bogus — must NOT land because flag is False.
        sort_order=999,
    )
    assert row is not None
    assert row.name == "Renamed"
    assert row.sort_order == 7


def test_update_workbook_missing_id_returns_none(conn):
    # UPDATE ... RETURNING on a row that doesn't exist yields no rows.
    row = _update_all(conn, "missing", name="X", sort_order=0)
    assert row is None


def test_update_workbook_bumps_updated_at(conn):
    # ``updated_at = strftime(..., 'now')`` is unconditional in the
    # SQL (outside the CASE WHEN), so every UPDATE advances it —
    # even one that changes no user-visible fields.
    _queries.insert_workbook(conn, workbook_id="wb1", name="Name", created_by=None)
    before = _queries.get_workbook(conn, "wb1")
    assert before is not None
    import time

    time.sleep(0.005)  # strftime('%f') is ms-resolution
    after = _queries.update_workbook(
        conn,
        workbook_id="wb1",
        name_do_update=False,
        name="",
        sort_order_do_update=False,
        sort_order=0,
    )
    assert after is not None
    assert after.updated_at > before.updated_at


# --- delete cascade -----------------------------------------------------------


def _seed_sheet_with_children(conn, wb_id="wb1", sheet_id="s1"):
    _queries.insert_workbook(conn, workbook_id=wb_id, name="WB", created_by=None)
    conn.execute(
        "INSERT INTO datasette_sheets_sheet (id, workbook_id, name) VALUES (?, ?, ?)",
        [sheet_id, wb_id, "Sheet 1"],
    )
    conn.execute(
        "INSERT INTO datasette_sheets_cell "
        "(sheet_id, row_idx, col_idx, raw_value) VALUES (?, 0, 0, 'hi')",
        [sheet_id],
    )
    conn.execute(
        "INSERT INTO datasette_sheets_column "
        "(sheet_id, col_idx, name) VALUES (?, 0, 'A')",
        [sheet_id],
    )
    conn.execute(
        "INSERT INTO datasette_sheets_named_range "
        "(sheet_id, name, definition) VALUES (?, 'TaxRate', '=0.05')",
        [sheet_id],
    )


def _child_counts(conn, wb_id="wb1") -> dict[str, int]:
    q = (
        "SELECT COUNT(*) FROM datasette_sheets_{tbl} "
        "WHERE sheet_id IN (SELECT id FROM datasette_sheets_sheet WHERE workbook_id = ?)"
    )
    return {
        "cells": conn.execute(q.format(tbl="cell"), [wb_id]).fetchone()[0],
        "columns": conn.execute(q.format(tbl="column"), [wb_id]).fetchone()[0],
        "named_ranges": conn.execute(q.format(tbl="named_range"), [wb_id]).fetchone()[
            0
        ],
        "sheets": conn.execute(
            "SELECT COUNT(*) FROM datasette_sheets_sheet WHERE workbook_id = ?",
            [wb_id],
        ).fetchone()[0],
        "workbook": conn.execute(
            "SELECT COUNT(*) FROM datasette_sheets_workbook WHERE id = ?", [wb_id]
        ).fetchone()[0],
    }


def test_delete_cascade_clears_every_child_table(conn):
    _seed_sheet_with_children(conn)
    # Sanity: everything is populated.
    assert _child_counts(conn) == {
        "cells": 1,
        "columns": 1,
        "named_ranges": 1,
        "sheets": 1,
        "workbook": 1,
    }

    # Run the cascade in the order db.py::delete_workbook does.
    _queries.delete_workbook_cells(conn, workbook_id="wb1")
    _queries.delete_workbook_columns(conn, workbook_id="wb1")
    _queries.delete_workbook_named_ranges(conn, workbook_id="wb1")
    _queries.delete_workbook_sheets(conn, workbook_id="wb1")
    _queries.delete_workbook_row(conn, workbook_id="wb1")

    assert _child_counts(conn) == {
        "cells": 0,
        "columns": 0,
        "named_ranges": 0,
        "sheets": 0,
        "workbook": 0,
    }


def test_delete_cascade_leaves_other_workbooks_alone(conn):
    _seed_sheet_with_children(conn, wb_id="wb1", sheet_id="s1")
    _seed_sheet_with_children(conn, wb_id="wb2", sheet_id="s2")

    _queries.delete_workbook_cells(conn, workbook_id="wb1")
    _queries.delete_workbook_columns(conn, workbook_id="wb1")
    _queries.delete_workbook_named_ranges(conn, workbook_id="wb1")
    _queries.delete_workbook_sheets(conn, workbook_id="wb1")
    _queries.delete_workbook_row(conn, workbook_id="wb1")

    # wb2 and all its children survive.
    assert _child_counts(conn, wb_id="wb2") == {
        "cells": 1,
        "columns": 1,
        "named_ranges": 1,
        "sheets": 1,
        "workbook": 1,
    }


def test_delete_workbook_row_is_a_noop_for_missing_id(conn):
    # SQLite treats a zero-row DELETE as success; our caller relies on
    # that (``delete_workbook`` doesn't check existence before calling).
    _queries.delete_workbook_row(conn, workbook_id="nope")
    # No exception; nothing changed.
    assert _queries.list_workbooks(conn) == []


# ============================================================================
# Sheets
# ============================================================================


def _insert_sheet(
    conn: sqlite3.Connection,
    sheet_id: str = "s1",
    workbook_id: str = "wb1",
    name: str = "Sheet 1",
    color: str = "#8b774f",
) -> _queries.Sheet:
    # Ensure parent workbook exists. Cheap idempotent guard so tests
    # don't all have to repeat the ``insert_workbook`` call.
    if _queries.get_workbook(conn, workbook_id=workbook_id) is None:
        _queries.insert_workbook(
            conn, workbook_id=workbook_id, name="WB", created_by=None
        )
    row = _queries.insert_sheet(
        conn,
        sheet_id=sheet_id,
        workbook_id=workbook_id,
        name=name,
        color=color,
    )
    assert row is not None
    return row


# --- list_sheets / get_sheet --------------------------------------------------


def test_list_sheets_scopes_to_workbook(conn):
    _insert_sheet(conn, sheet_id="s1", workbook_id="wb1", name="A")
    _insert_sheet(conn, sheet_id="s2", workbook_id="wb2", name="B")

    wb1_sheets = _queries.list_sheets(conn, workbook_id="wb1")
    assert [s.id for s in wb1_sheets] == ["s1"]

    wb2_sheets = _queries.list_sheets(conn, workbook_id="wb2")
    assert [s.id for s in wb2_sheets] == ["s2"]


def test_list_sheets_orders_by_sort_order_then_created_at(conn):
    _insert_sheet(conn, sheet_id="s1", name="First")
    _insert_sheet(conn, sheet_id="s2", name="Second")
    # Reverse their sort_order so s2 should come first.
    _queries.reorder_sheet(conn, sort_order=0, sheet_id="s2", workbook_id="wb1")
    _queries.reorder_sheet(conn, sort_order=1, sheet_id="s1", workbook_id="wb1")
    names = [s.name for s in _queries.list_sheets(conn, workbook_id="wb1")]
    assert names == ["Second", "First"]


def test_get_sheet_hit_and_miss(conn):
    _insert_sheet(conn, sheet_id="s1", name="Real")
    hit = _queries.get_sheet(conn, sheet_id="s1")
    assert hit is not None and hit.name == "Real"
    assert _queries.get_sheet(conn, sheet_id="missing") is None


# --- insert_sheet -------------------------------------------------------------


def test_insert_sheet_returns_fresh_row_with_defaults(conn):
    row = _insert_sheet(conn, sheet_id="s1", name="New", color="#abcdef")
    assert row.id == "s1"
    assert row.workbook_id == "wb1"
    assert row.name == "New"
    assert row.color == "#abcdef"
    assert row.sort_order == 0  # schema default
    assert row.created_at and row.updated_at


# --- update_sheet (CASE WHEN partial patch) -----------------------------------


def test_update_sheet_partial_leaves_untouched_fields_alone(conn):
    _insert_sheet(conn, sheet_id="s1", name="Before", color="#111111")

    row = _queries.update_sheet(
        conn,
        sheet_id="s1",
        name_do_update=True,
        name="After",
        # Pass bogus values with False flags — these must NOT land.
        color_do_update=False,
        color="#999999",
        sort_order_do_update=False,
        sort_order=42,
    )
    assert row is not None
    assert row.name == "After"
    assert row.color == "#111111"
    assert row.sort_order == 0


def test_update_sheet_missing_id_returns_none(conn):
    row = _queries.update_sheet(
        conn,
        sheet_id="nope",
        name_do_update=True,
        name="X",
        color_do_update=False,
        color="",
        sort_order_do_update=False,
        sort_order=0,
    )
    assert row is None


def test_update_sheet_bumps_updated_at_even_with_all_flags_false(conn):
    # ``updated_at = strftime(..., 'now')`` sits outside every
    # CASE WHEN so it bumps unconditionally — a UPDATE that changes
    # nothing user-visible still advances the timestamp.
    _insert_sheet(conn, sheet_id="s1")
    before = _queries.get_sheet(conn, sheet_id="s1")
    assert before is not None
    import time

    time.sleep(0.005)
    after = _queries.update_sheet(
        conn,
        sheet_id="s1",
        name_do_update=False,
        name="",
        color_do_update=False,
        color="",
        sort_order_do_update=False,
        sort_order=0,
    )
    assert after is not None
    assert after.updated_at > before.updated_at


# --- insert_default_column ----------------------------------------------------


def test_insert_default_column_writes_a_row(conn):
    _insert_sheet(conn, sheet_id="s1")
    _queries.insert_default_column(conn, sheet_id="s1", col_idx=0, name="A", width=100)
    rows = conn.execute(
        "SELECT col_idx, name, width FROM datasette_sheets_column WHERE sheet_id = ?",
        ["s1"],
    ).fetchall()
    assert rows == [(0, "A", 100)]


# --- delete sheet cascade -----------------------------------------------------


def _seed_sheet_with_children_only(conn, sheet_id="s1", workbook_id="wb1"):
    _insert_sheet(conn, sheet_id=sheet_id, workbook_id=workbook_id)
    conn.execute(
        "INSERT INTO datasette_sheets_cell "
        "(sheet_id, row_idx, col_idx, raw_value) VALUES (?, 0, 0, 'hi')",
        [sheet_id],
    )
    conn.execute(
        "INSERT INTO datasette_sheets_column "
        "(sheet_id, col_idx, name) VALUES (?, 0, 'A')",
        [sheet_id],
    )
    conn.execute(
        "INSERT INTO datasette_sheets_named_range "
        "(sheet_id, name, definition) VALUES (?, 'TaxRate', '=0.05')",
        [sheet_id],
    )


def _sheet_child_counts(conn, sheet_id="s1") -> dict[str, int]:
    tables = ("cell", "column", "named_range")
    counts = {
        t: conn.execute(
            f"SELECT COUNT(*) FROM datasette_sheets_{t} WHERE sheet_id = ?",
            [sheet_id],
        ).fetchone()[0]
        for t in tables
    }
    counts["sheet"] = conn.execute(
        "SELECT COUNT(*) FROM datasette_sheets_sheet WHERE id = ?", [sheet_id]
    ).fetchone()[0]
    return counts


def test_delete_sheet_cascade_clears_every_child_table(conn):
    _seed_sheet_with_children_only(conn)
    assert _sheet_child_counts(conn) == {
        "cell": 1,
        "column": 1,
        "named_range": 1,
        "sheet": 1,
    }
    _queries.delete_sheet_cells(conn, sheet_id="s1")
    _queries.delete_sheet_columns(conn, sheet_id="s1")
    _queries.delete_sheet_named_ranges(conn, sheet_id="s1")
    _queries.delete_sheet_row(conn, sheet_id="s1")
    assert _sheet_child_counts(conn) == {
        "cell": 0,
        "column": 0,
        "named_range": 0,
        "sheet": 0,
    }


def test_delete_sheet_cascade_leaves_sibling_sheets_alone(conn):
    _seed_sheet_with_children_only(conn, sheet_id="s1")
    _seed_sheet_with_children_only(conn, sheet_id="s2")

    _queries.delete_sheet_cells(conn, sheet_id="s1")
    _queries.delete_sheet_columns(conn, sheet_id="s1")
    _queries.delete_sheet_named_ranges(conn, sheet_id="s1")
    _queries.delete_sheet_row(conn, sheet_id="s1")

    assert _sheet_child_counts(conn, sheet_id="s2") == {
        "cell": 1,
        "column": 1,
        "named_range": 1,
        "sheet": 1,
    }


# --- reorder_sheet ------------------------------------------------------------


def test_reorder_sheet_writes_new_sort_order(conn):
    _insert_sheet(conn, sheet_id="s1")
    _queries.reorder_sheet(conn, sort_order=7, sheet_id="s1", workbook_id="wb1")
    row = _queries.get_sheet(conn, sheet_id="s1")
    assert row is not None and row.sort_order == 7


def test_reorder_sheet_scoped_by_workbook(conn):
    # ``reorderSheet`` has ``AND workbook_id = ...`` in its WHERE so a
    # caller that got the workbook wrong silently no-ops instead of
    # moving a sheet across workbooks.
    _insert_sheet(conn, sheet_id="s1", workbook_id="wb1")
    _queries.reorder_sheet(conn, sort_order=9, sheet_id="s1", workbook_id="wb2")
    row = _queries.get_sheet(conn, sheet_id="s1")
    assert row is not None and row.sort_order == 0  # unchanged


def test_touch_sheet_bumps_updated_at(conn):
    _insert_sheet(conn, sheet_id="s1")
    before = _queries.get_sheet(conn, sheet_id="s1")
    assert before is not None
    import time

    time.sleep(0.005)
    _queries.touch_sheet(conn, sheet_id="s1")
    after = _queries.get_sheet(conn, sheet_id="s1")
    assert after is not None
    assert after.updated_at > before.updated_at


# ============================================================================
# Columns
# ============================================================================


def _insert_column(conn, sheet_id="s1", col_idx=0, name="A", width=100):
    if _queries.get_sheet(conn, sheet_id=sheet_id) is None:
        _insert_sheet(conn, sheet_id=sheet_id)
    _queries.insert_default_column(
        conn, sheet_id=sheet_id, col_idx=col_idx, name=name, width=width
    )


def test_list_columns_scoped_and_ordered(conn):
    _insert_column(conn, sheet_id="s1", col_idx=2, name="C")
    _insert_column(conn, sheet_id="s1", col_idx=0, name="A")
    _insert_column(conn, sheet_id="s1", col_idx=1, name="B")
    _insert_column(conn, sheet_id="s2", col_idx=0, name="Z")

    s1_cols = _queries.list_columns(conn, sheet_id="s1")
    assert [c.col_idx for c in s1_cols] == [0, 1, 2]
    assert [c.name for c in s1_cols] == ["A", "B", "C"]

    s2_cols = _queries.list_columns(conn, sheet_id="s2")
    assert [c.name for c in s2_cols] == ["Z"]


def test_set_column_partial_update_name_only(conn):
    _insert_column(conn, sheet_id="s1", col_idx=0, name="Orig", width=100)
    row = _queries.set_column(
        conn,
        sheet_id="s1",
        col_idx=0,
        name_do_update=True,
        name="Renamed",
        # Bogus width alongside False flag — must not land.
        width_do_update=False,
        width=9999,
    )
    assert row is not None
    assert row.name == "Renamed"
    assert row.width == 100


def test_set_column_partial_update_width_only(conn):
    _insert_column(conn, sheet_id="s1", col_idx=0, name="A", width=100)
    row = _queries.set_column(
        conn,
        sheet_id="s1",
        col_idx=0,
        name_do_update=False,
        name="",
        width_do_update=True,
        width=250,
    )
    assert row is not None
    assert row.name == "A"
    assert row.width == 250


def test_set_column_missing_returns_none(conn):
    # No row to update; UPDATE ... RETURNING yields zero rows.
    _insert_sheet(conn, sheet_id="s1")
    row = _queries.set_column(
        conn,
        sheet_id="s1",
        col_idx=99,
        name_do_update=True,
        name="Ghost",
        width_do_update=False,
        width=0,
    )
    assert row is None


# ============================================================================
# Cells
# ============================================================================


def test_upsert_cell_inserts_fresh_row(conn):
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="hello",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by="alex",
    )
    cells = _queries.list_cells(conn, sheet_id="s1")
    assert len(cells) == 1
    assert cells[0].raw_value == "hello"
    assert cells[0].updated_by == "alex"
    assert cells[0].format_json is None


def test_upsert_cell_updates_on_conflict(conn):
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="first",
        format_json='{"bold":true}',
        typed_kind=None,
        typed_data=None,
        updated_by=None,
    )
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="second",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by="alex",
    )
    cells = _queries.list_cells(conn, sheet_id="s1")
    assert len(cells) == 1
    assert cells[0].raw_value == "second"
    assert cells[0].updated_by == "alex"
    # Critical: format_json is REPLACED (not COALESCE'd) on conflict so
    # the client can revert a cell's format by upserting NULL. If this
    # ever regresses, unbold-after-bold stays bold across refresh.
    assert cells[0].format_json is None


def test_upsert_cell_round_trips_typed_override(conn):
    """typed_kind / typed_data carry the force-text / typed-input
    override into the cell row and survive a list_cells round-trip."""
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="2/4",
        format_json=None,
        typed_kind="string",
        typed_data=None,
        updated_by=None,
    )
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=1,
        raw_value="2026-04-02",
        format_json=None,
        typed_kind="custom",
        typed_data='{"type_tag":"jdate","data":"2026-04-02"}',
        updated_by=None,
    )
    cells = {c.col_idx: c for c in _queries.list_cells(conn, sheet_id="s1")}
    assert cells[0].typed_kind == "string"
    assert cells[0].typed_data is None
    assert cells[1].typed_kind == "custom"
    assert cells[1].typed_data == '{"type_tag":"jdate","data":"2026-04-02"}'


def test_upsert_cell_clears_prior_typed_override_on_raw_write(conn):
    """A subsequent upsert with NULL typed_kind clears any prior
    override — load-bearing for the kind='raw' opt-back-into-auto-
    classify rule. upsertCell uses ``excluded.typed_*`` (NOT
    COALESCE) for exactly this reason."""
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="2/4",
        format_json=None,
        typed_kind="string",
        typed_data=None,
        updated_by=None,
    )
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="42",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by=None,
    )
    [cell] = _queries.list_cells(conn, sheet_id="s1")
    assert cell.raw_value == "42"
    assert cell.typed_kind is None
    assert cell.typed_data is None


def test_delete_cell_removes_one_and_leaves_others(conn):
    _insert_sheet(conn, sheet_id="s1")
    for row in range(3):
        _queries.upsert_cell(
            conn,
            sheet_id="s1",
            row_idx=row,
            col_idx=0,
            raw_value=f"r{row}",
            format_json=None,
            typed_kind=None,
            typed_data=None,
            updated_by=None,
        )
    _queries.delete_cell(conn, sheet_id="s1", row_idx=1, col_idx=0)
    remaining = [c.raw_value for c in _queries.list_cells(conn, sheet_id="s1")]
    assert remaining == ["r0", "r2"]


# --- recalc helpers -----------------------------------------------------------


def test_update_cell_computed_round_trips_typed_values(conn):
    # ``computed_value`` has no declared type (BLOB affinity) so SQLite
    # preserves the storage class. Exercise int / float / str to prove
    # no coercion happens along the way. ``computed_value_kind``
    # carries ``'bool'`` for booleans (which would otherwise be
    # indistinguishable from INTEGER 0/1 on the way back out).
    _insert_sheet(conn, sheet_id="s1")
    cases = [(42, None), (3.14, None), ("text", None), (1, "bool"), (0, "bool")]
    for col_idx, (value, kind) in enumerate(cases):
        _queries.upsert_cell(
            conn,
            sheet_id="s1",
            row_idx=0,
            col_idx=col_idx,
            raw_value="placeholder",
            format_json=None,
            typed_kind=None,
            typed_data=None,
            updated_by=None,
        )
        _queries.update_cell_computed(
            conn,
            value=value,
            kind=kind,
            sheet_id="s1",
            row_idx=0,
            col_idx=col_idx,
        )

    rows = _queries.list_cells_for_recalc(conn, sheet_id="s1")
    rows_by_col = {r.col_idx: r for r in rows}
    assert rows_by_col[0].computed_value == 42
    assert isinstance(rows_by_col[0].computed_value, int)
    assert rows_by_col[0].computed_value_kind is None
    assert rows_by_col[1].computed_value == 3.14
    assert isinstance(rows_by_col[1].computed_value, float)
    assert rows_by_col[1].computed_value_kind is None
    assert rows_by_col[2].computed_value == "text"
    assert rows_by_col[2].computed_value_kind is None
    assert rows_by_col[3].computed_value == 1
    assert rows_by_col[3].computed_value_kind == "bool"
    assert rows_by_col[4].computed_value == 0
    assert rows_by_col[4].computed_value_kind == "bool"


def test_m002_adds_computed_value_kind_to_pre_m002_db():
    # Simulate a database that was created before m002 landed: build
    # a fresh ``Migrations`` set that only carries m001, apply it,
    # confirm the column is absent, insert a pre-m002 row, then
    # apply the *full* migration set — m002 runs now and adds the
    # column. Existing rows get NULL kind (the next recalc will
    # populate it if the engine type actually changed).
    from sqlite_migrate import Migrations
    from datasette_sheets.migrations import m001_schema

    c = sqlite3.connect(":memory:")
    db = Database(c)

    only_m001 = Migrations("datasette-sheets-only-m001")
    only_m001()(m001_schema)
    only_m001.apply(db)

    cols_before = {
        row[1] for row in c.execute("PRAGMA table_info(datasette_sheets_cell)")
    }
    assert "computed_value" in cols_before
    assert "computed_value_kind" not in cols_before

    # Pre-m002 row.
    c.execute("INSERT INTO datasette_sheets_workbook (id, name) VALUES ('w1', 'WB')")
    c.execute(
        "INSERT INTO datasette_sheets_sheet (id, workbook_id, name) "
        "VALUES ('s1', 'w1', 'S1')"
    )
    c.execute(
        "INSERT INTO datasette_sheets_cell "
        "(sheet_id, row_idx, col_idx, raw_value, computed_value) "
        "VALUES ('s1', 0, 0, '1', 1)"
    )

    # Apply the full migration set — m002 runs now.
    migrations.apply(db)

    cols_after = {
        row[1] for row in c.execute("PRAGMA table_info(datasette_sheets_cell)")
    }
    assert "computed_value_kind" in cols_after

    (kind,) = c.execute(
        "SELECT computed_value_kind FROM datasette_sheets_cell "
        "WHERE sheet_id='s1' AND row_idx=0 AND col_idx=0"
    ).fetchone()
    assert kind is None

    c.close()


def test_list_cells_for_recalc_returns_minimal_tuple(conn):
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="=1+1",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by=None,
    )
    rows = _queries.list_cells_for_recalc(conn, sheet_id="s1")
    assert len(rows) == 1
    (r,) = rows
    # The recalc query pulls the minimal tuple: raw_value (input),
    # typed_kind / typed_data (so a force-text override survives
    # recalc), computed_value + computed_value_kind (so the recalc
    # can compare on (value, kind) without a bool/int-collision: a
    # Boolean(true) and a Number(1.0) both adapt to INTEGER 1, so
    # equality on value alone is wrong).
    assert {f for f in r.__dataclass_fields__} == {
        "row_idx",
        "col_idx",
        "raw_value",
        "typed_kind",
        "typed_data",
        "computed_value",
        "computed_value_kind",
    }


def test_list_named_ranges_for_recalc(conn):
    _insert_sheet(conn, sheet_id="s1")
    conn.execute(
        "INSERT INTO datasette_sheets_named_range "
        "(sheet_id, name, definition) VALUES (?, ?, ?)",
        ["s1", "TaxRate", "=0.05"],
    )
    conn.execute(
        "INSERT INTO datasette_sheets_named_range "
        "(sheet_id, name, definition) VALUES (?, ?, ?)",
        ["s1", "Region", "=A1:A10"],
    )
    rows = _queries.list_named_ranges_for_recalc(conn, sheet_id="s1")
    names = {r.name: r.definition for r in rows}
    assert names == {"TaxRate": "=0.05", "Region": "=A1:A10"}


# --- formula rewrite (listFormulaCells / updateCellRaw) ----------------------


def test_list_formula_cells_filters_non_formula_rows(conn):
    # The ``LIKE '=%'`` filter keeps _rewrite_formulas* off plain-value
    # cells. If the prefix filter ever regresses the rewrite pass
    # still produces correct results (adjust_refs is idempotent for
    # non-formulas), but pays the cost for every cell — not acceptable
    # for a 10k-cell sheet. Guard the optimisation.
    _insert_sheet(conn, sheet_id="s1")

    def put(row_idx, raw):
        _queries.upsert_cell(
            conn,
            sheet_id="s1",
            row_idx=row_idx,
            col_idx=0,
            raw_value=raw,
            format_json=None,
            typed_kind=None,
            typed_data=None,
            updated_by=None,
        )

    put(0, "=A1+B1")  # formula, should match
    put(1, "plain text")  # not a formula
    put(2, "42")  # numeric literal
    put(3, "=SUM(A1:A10)")  # formula
    put(4, "=equals prefix")  # edge: starts with '=' so it matches — engine
    #                         handles garbage gracefully; the filter can't
    #                         tell parseable from not without a parse.

    rows = _queries.list_formula_cells(conn, sheet_id="s1")
    raws = sorted(r.raw_value for r in rows)
    assert raws == ["=A1+B1", "=SUM(A1:A10)", "=equals prefix"]


def test_list_formula_cells_scoped_by_sheet(conn):
    _insert_sheet(conn, sheet_id="s1")
    _insert_sheet(conn, sheet_id="s2")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="=A1",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by=None,
    )
    _queries.upsert_cell(
        conn,
        sheet_id="s2",
        row_idx=0,
        col_idx=0,
        raw_value="=B1",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by=None,
    )
    s1 = [r.raw_value for r in _queries.list_formula_cells(conn, sheet_id="s1")]
    s2 = [r.raw_value for r in _queries.list_formula_cells(conn, sheet_id="s2")]
    assert s1 == ["=A1"]
    assert s2 == ["=B1"]


def test_update_cell_raw_writes_and_leaves_updated_at_alone(conn):
    # The rewrite path deliberately doesn't touch updated_at — it's
    # book-keeping, not a user edit. Assert we don't regress that.
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_cell(
        conn,
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
        raw_value="=A1",
        format_json=None,
        typed_kind=None,
        typed_data=None,
        updated_by="alex",
    )
    before = _queries.list_cells(conn, sheet_id="s1")[0]
    import time

    time.sleep(0.005)
    _queries.update_cell_raw(
        conn,
        raw_value="=A2",
        sheet_id="s1",
        row_idx=0,
        col_idx=0,
    )
    after = _queries.list_cells(conn, sheet_id="s1")[0]
    assert after.raw_value == "=A2"
    assert after.updated_at == before.updated_at
    # updated_by also untouched — rewrite isn't attributed to anyone.
    assert after.updated_by == "alex"


# ============================================================================
# Named ranges
# ============================================================================


def test_upsert_named_range_inserts_then_updates_on_conflict(conn):
    _insert_sheet(conn, sheet_id="s1")

    first = _queries.upsert_named_range(
        conn, sheet_id="s1", name="TaxRate", definition="=0.05"
    )
    assert first is not None and first.definition == "=0.05"

    # Same name (exact case) → conflict → UPDATE, not INSERT.
    second = _queries.upsert_named_range(
        conn, sheet_id="s1", name="TaxRate", definition="=0.07"
    )
    assert second is not None and second.definition == "=0.07"

    # Still one row.
    assert len(_queries.list_named_ranges(conn, sheet_id="s1")) == 1


def test_upsert_named_range_is_case_insensitive(conn):
    # PK ``(sheet_id, name COLLATE NOCASE)`` means "TaxRate" and
    # "taxrate" collide — there's only ever one row per name regardless
    # of case.
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_named_range(conn, sheet_id="s1", name="TaxRate", definition="=0.05")
    _queries.upsert_named_range(conn, sheet_id="s1", name="TAXRATE", definition="=0.07")
    rows = _queries.list_named_ranges(conn, sheet_id="s1")
    assert len(rows) == 1
    assert rows[0].definition == "=0.07"


def test_list_named_ranges_sorts_case_insensitively(conn):
    _insert_sheet(conn, sheet_id="s1")
    for name in ["zebra", "Apple", "mango"]:
        _queries.upsert_named_range(conn, sheet_id="s1", name=name, definition="=1")
    names = [r.name for r in _queries.list_named_ranges(conn, sheet_id="s1")]
    # ORDER BY ... COLLATE NOCASE puts Apple, mango, zebra regardless
    # of the stored case.
    assert [n.lower() for n in names] == ["apple", "mango", "zebra"]


def test_delete_named_range_returns_row_when_removed(conn):
    _insert_sheet(conn, sheet_id="s1")
    _queries.upsert_named_range(conn, sheet_id="s1", name="TaxRate", definition="=0.05")
    deleted = _queries.delete_named_range(conn, sheet_id="s1", name="taxrate")
    # Case-insensitive match hits the PK; RETURNING echoes the stored
    # name (preserving the original casing).
    assert deleted is not None
    assert deleted.name == "TaxRate"
    assert _queries.list_named_ranges(conn, sheet_id="s1") == []


def test_delete_named_range_returns_none_for_missing(conn):
    _insert_sheet(conn, sheet_id="s1")
    deleted = _queries.delete_named_range(conn, sheet_id="s1", name="ghost")
    assert deleted is None
