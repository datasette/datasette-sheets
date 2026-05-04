"""Integration tests for the column-delete endpoint.

Sibling of :mod:`tests.test_rows`. Covers the HTTP plumbing, SSE
broadcast, column-metadata table shift, view round-trip, and formula
recalculation after column removal.
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_sheets.broadcast import get_channel_manager


def make_datasette():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return (
        Datasette(
            [tmp.name],
            config={"permissions": {"datasette-sheets-access": True}},
        ),
        os.path.basename(tmp.name).replace(".db", ""),
    )


async def create_sheet_with_cells(ds, db_name, cells):
    """Create a workbook + sheet and seed the given (row_idx, col_idx, value)
    triples. Returns (workbook_id, sheet_id)."""
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    wb_id = data["workbook"]["id"]
    sheet_id = data["sheet"]["id"]
    if cells:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
            content=json.dumps(
                {
                    "changes": [
                        {"row_idx": r, "col_idx": c, "raw_value": v}
                        for (r, c, v) in cells
                    ]
                }
            ),
        )
    return wb_id, sheet_id


async def get_cells(ds, db_name, sheet_id):
    db = ds.get_database(db_name)
    return [
        (r["row_idx"], r["col_idx"], r["raw_value"])
        for r in await db.execute(
            "SELECT row_idx, col_idx, raw_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? ORDER BY col_idx, row_idx",
            [sheet_id],
        )
    ]


async def get_column_metadata(ds, db_name, sheet_id):
    db = ds.get_database(db_name)
    return [
        (r["col_idx"], r["name"], r["width"])
        for r in await db.execute(
            "SELECT col_idx, name, width FROM datasette_sheets_column "
            "WHERE sheet_id = ? ORDER BY col_idx",
            [sheet_id],
        )
    ]


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_single_column():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(5)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [2]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [2]}

    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 2, "c3"),
        (0, 3, "c4"),
    ]


@pytest.mark.asyncio
async def test_delete_multiple_noncontiguous_columns():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [(r, c, f"{r}-{c}") for r in range(2) for c in range(6)],
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1, 4]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [1, 4]}

    # Surviving cols 0, 2, 3, 5 → new indices 0, 1, 2, 3
    expected = []
    for c_new, c_old in [(0, 0), (1, 2), (2, 3), (3, 5)]:
        for r in range(2):
            expected.append((r, c_new, f"{r}-{c_old}"))
    expected.sort(key=lambda x: (x[1], x[0]))
    assert await get_cells(ds, db_name, sheet_id) == expected


@pytest.mark.asyncio
async def test_delete_dedupes_and_sorts_input():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(4)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [3, 1, 1, 3]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [1, 3]}


@pytest.mark.asyncio
async def test_empty_indices_is_no_op():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": []}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": []}


@pytest.mark.asyncio
async def test_negative_indices_rejected_silently():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [-1, -5]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": []}


@pytest.mark.asyncio
async def test_delete_on_missing_sheet_returns_404():
    ds, db_name = make_datasette()
    wb_id, _ = await create_sheet_with_cells(ds, db_name, [])
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/does-not-exist/columns/delete",
        content=json.dumps({"col_indices": [0]}),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Column metadata (datasette_sheets_column) shift
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_column_metadata_table_shifts_too():
    """Column widths + names are persisted separately and must shift in
    lockstep with the cell table, otherwise the grid's widths would drift
    to the wrong columns after a delete."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # Set distinct widths so we can detect a wrong-direction shift.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns",
        content=json.dumps(
            {
                "columns": [
                    {"col_idx": 0, "width": 100},
                    {"col_idx": 1, "width": 111},
                    {"col_idx": 2, "width": 222},
                    {"col_idx": 3, "width": 333},
                    {"col_idx": 4, "width": 444},
                ]
            }
        ),
    )

    before = dict(
        (c, w)
        for (c, _n, w) in await get_column_metadata(ds, db_name, sheet_id)
    )
    assert before[1] == 111 and before[2] == 222 and before[3] == 333

    # Delete col 2 — 333 (was col 3) should land at col 2, 444 at col 3.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [2]}),
    )
    after = dict(
        (c, w)
        for (c, _n, w) in await get_column_metadata(ds, db_name, sheet_id)
    )
    # Original 0, 1 → unchanged. Original 3, 4 → shifted to 2, 3. Cols
    # 5..14 carry the defaults from sheet creation (width=100) and shift
    # to 4..13 — those aren't the focus of this test.
    assert after[0] == 100
    assert after[1] == 111
    assert after[2] == 333
    assert after[3] == 444


# ---------------------------------------------------------------------------
# Broadcast + cross-feature interaction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_broadcasts_columns_deleted_event():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(4)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")
    try:
        resp = await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
            content=json.dumps({"col_indices": [1, 2]}),
        )
        assert resp.status_code == 200
        assert queue.qsize() == 1
        event = queue.get_nowait()
        assert event["type"] == "columns-deleted"
        assert event["col_indices"] == [1, 2]
    finally:
        channel.unsubscribe("listener")


@pytest.mark.asyncio
async def test_delete_excludes_sending_client_from_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(4)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    sender_q = channel.subscribe("sender")
    other_q = channel.subscribe("other")
    try:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
            content=json.dumps({"col_indices": [1], "client_id": "sender"}),
        )
        assert sender_q.qsize() == 0
        assert other_q.qsize() == 1
    finally:
        channel.unsubscribe("sender")
        channel.unsubscribe("other")


@pytest.mark.asyncio
async def test_empty_delete_does_not_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")
    try:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
            content=json.dumps({"col_indices": []}),
        )
        assert queue.qsize() == 0
    finally:
        channel.unsubscribe("listener")


# ---------------------------------------------------------------------------
# Interaction with views + formulas
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_view_reflects_column_delete():
    """Views read column data by position, so after a column-delete the
    cells below the old col 2 shift into col 1 and are visible through
    the view. Header aliases are frozen at view-creation time (they're
    snapshotted into the SELECT alias list), so the NEW data ends up
    exposed under the ORIGINAL header — a known tradeoff: we don't
    re-alias existing views on schema changes."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "Name"), (0, 1, "Drop"), (0, 2, "Age"),
            (1, 0, "Alex"), (1, 1, "x"), (1, 2, "10"),
            (2, 0, "Brian"), (2, 1, "y"), (2, 2, "20"),
        ],
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "people", "range": "A1:B", "use_headers": True}
        ),
    )
    assert resp.status_code == 201

    # Drop the middle column.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )

    # Age (was col 2) now sits at col 1. The view's col-1 alias is still
    # "Drop" (frozen at creation), so the Age values surface under that
    # alias. What matters for the user is that the DATA shifts and the
    # view keeps producing rows — re-creating the view regenerates the
    # aliases.
    resp = await ds.client.get(f"/{db_name}/people.json?_shape=array")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2
    assert rows[0]["Name"] == "Alex"
    assert rows[0]["Drop"] == 10  # Age's value, under the frozen alias
    assert rows[1]["Name"] == "Brian"
    assert rows[1]["Drop"] == 20


@pytest.mark.asyncio
async def test_formulas_recalculate_after_column_delete():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "10"), (0, 1, "99"), (0, 2, "20"), (0, 3, "=A1+B1"),
        ],
    )

    # Pre-delete: =A1+B1 → 10 + 99 = 109.
    db = ds.get_database(db_name)
    pre = (
        await db.execute(
            "SELECT computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 3",
            [sheet_id],
        )
    ).first()["computed_value"]
    assert pre == 109

    # Delete col 1 (the 99). The B1 ref in the formula is now broken →
    # rewritten to #REF!. A1 stays as-is. Google Sheets would display
    # #REF! in the cell; our engine surfaces the tokenization error
    # string, which is fine — the point is the formula text no longer
    # silently evaluates against drifted data.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    rows = [
        (r["col_idx"], r["raw_value"])
        for r in (
            await db.execute(
                "SELECT col_idx, raw_value FROM datasette_sheets_cell "
                "WHERE sheet_id = ? AND row_idx = 0 ORDER BY col_idx",
                [sheet_id],
            )
        ).rows
    ]
    assert rows == [
        (0, "10"),
        (1, "20"),
        (2, "=A1+#REF!"),
    ]


@pytest.mark.asyncio
async def test_delete_column_rewrites_whole_column_ref_to_ref():
    """`=SUM(B:B)` after deleting column B → `=SUM(#REF!)`. The
    formula text is rewritten via the Rust engine's
    ``adjust_refs_for_deletion`` before the DB shift runs, so the
    cell doesn't keep crashing on recalc (originally this case 500'd
    with ``#CIRCULAR!``)."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 1, "1"),
            (1, 1, "2"),
            (2, 1, "3"),
            (0, 2, "=SUM(B:B)"),
        ],
    )
    # Pre-delete sanity.
    db = ds.get_database(db_name)
    pre = (
        await db.execute(
            "SELECT computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 2",
            [sheet_id],
        )
    ).first()["computed_value"]
    assert pre == 6

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200, resp.text

    # The formula (was C1, now B1) has its B:B ref rewritten.
    row = (
        await db.execute(
            "SELECT raw_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 1",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=SUM(#REF!)"


@pytest.mark.asyncio
async def test_delete_column_single_cell_ref_becomes_ref():
    """`=A1+B1` after deleting column B → `=A1+#REF!`. The A1 half is
    untouched; the B1 half is broken."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "10"),
            (0, 1, "20"),
            (0, 2, "=A1+B1"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200, resp.text

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 1",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=A1+#REF!"


@pytest.mark.asyncio
async def test_delete_column_shifts_surviving_refs_leftward():
    """`=D1` after deleting column B → `=C1`. Refs PAST the deletion
    point shift down so they still point to the same data."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "a"),
            (0, 1, "drop"),
            (0, 2, "c"),
            (0, 3, "42"),
            (0, 4, "=D1"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200, resp.text

    db = ds.get_database(db_name)
    # Formula shifted to col 3 (was col 4). Its text is now `=C1`,
    # which points to what used to be D1 (value 42).
    row = (
        await db.execute(
            "SELECT raw_value, computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 3",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=C1"
    assert row["computed_value"] == 42


@pytest.mark.asyncio
async def test_delete_column_trims_ranges_that_span_deletion():
    """`=SUM(A1:C1)` after deleting B → `=SUM(A1:B1)` (range trims).
    Values preserved: 10 + 30 = 40."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "10"),
            (0, 1, "99"),
            (0, 2, "30"),
            (0, 3, "=SUM(A1:C1)"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200, resp.text

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value, computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 2",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=SUM(A1:B1)"
    assert row["computed_value"] == 40


@pytest.mark.asyncio
async def test_delete_column_leaves_untouched_refs_alone():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "10"),
            (0, 1, "drop"),
            (0, 2, "=A1*2"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value, computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 1",
            [sheet_id],
        )
    ).first()
    # A1 wasn't touched; formula text is unchanged.
    assert row["raw_value"] == "=A1*2"
    assert row["computed_value"] == 20


@pytest.mark.asyncio
async def test_sheet_updated_at_advances_on_delete():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )
    db = ds.get_database(db_name)
    before = (
        await db.execute(
            "SELECT updated_at FROM datasette_sheets_sheet WHERE id = ?",
            [sheet_id],
        )
    ).first()["updated_at"]

    import asyncio as _asyncio

    await _asyncio.sleep(0.002)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    after = (
        await db.execute(
            "SELECT updated_at FROM datasette_sheets_sheet WHERE id = ?",
            [sheet_id],
        )
    ).first()["updated_at"]
    assert after > before

# ---------------------------------------------------------------------------
# Column move endpoint (POST /columns/move)
# ---------------------------------------------------------------------------


# [sheet.column.drag-reorder]
@pytest.mark.asyncio
async def test_move_column_endpoint_basic():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(5)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 2}),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "moved": {
            "src_start": 3,
            "src_end": 3,
            "final_start": 2,
            "width": 1,
        }
    }

    cells = await get_cells(ds, db_name, sheet_id)
    assert cells == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 2, "c3"),
        (0, 3, "c2"),
        (0, 4, "c4"),
    ]


@pytest.mark.asyncio
async def test_move_column_block_endpoint():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(7)]
    )

    # Move B:D (cols 1..3) to start at 4. dest_gap = 7 (after last col).
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 1, "src_end": 3, "dest_gap": 7}),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["moved"]["final_start"] == 4
    assert body["moved"]["width"] == 3


@pytest.mark.asyncio
async def test_move_column_noop_returns_null():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(5)]
    )

    # Drop on the source position.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 3}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"moved": None}

    # Drop just past source range.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 4}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"moved": None}

    # Sheet unchanged.
    cells = await get_cells(ds, db_name, sheet_id)
    assert cells == [(0, c, f"c{c}") for c in range(5)]


@pytest.mark.asyncio
async def test_move_column_invalid_400():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # src_end < src_start.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 1, "dest_gap": 0}),
    )
    assert resp.status_code == 400

    # Negative src.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": -1, "src_end": 3, "dest_gap": 0}),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_move_column_missing_sheet_404():
    ds, db_name = make_datasette()
    wb_id, _ = await create_sheet_with_cells(ds, db_name, [])

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/does-not-exist/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 2}),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_move_column_broadcasts_sse():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(5)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 2}),
    )
    assert resp.status_code == 200

    assert queue.qsize() == 1
    event = queue.get_nowait()
    assert event["type"] == "columns-moved"
    assert event["src_start"] == 3
    assert event["src_end"] == 3
    assert event["final_start"] == 2
    assert event["width"] == 1


@pytest.mark.asyncio
async def test_move_column_excludes_originator():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(5)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    listener_q = channel.subscribe("listener")
    originator_q = channel.subscribe("originator")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps(
            {"src_start": 3, "src_end": 3, "dest_gap": 2, "client_id": "originator"}
        ),
    )
    assert resp.status_code == 200

    assert listener_q.qsize() == 1
    assert originator_q.qsize() == 0


@pytest.mark.asyncio
async def test_move_column_noop_does_not_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(5)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 3}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"moved": None}

    assert queue.qsize() == 0



# ---------------------------------------------------------------------------
# Named-range parity (att 1s3c2rpc) — column-delete rewrites named-range
# definitions in addition to cell formulas.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_col_delete_rewrites_named_range_pointing_at_deleted_col():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # Single-cell named range pointing at column D (idx 3).
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Anchor", "definition": "=D5"}),
    )
    assert resp.status_code == 200, resp.text

    # Delete column D → engine stamps #REF! for refs inside the deletion.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [3]}),
    )
    assert resp.status_code == 200

    db = ds.get_database(db_name)
    rows = list(
        await db.execute(
            "SELECT name, definition FROM datasette_sheets_named_range "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    )
    defs = {r["name"]: r["definition"] for r in rows}
    assert defs["Anchor"] == "=#REF!"


@pytest.mark.asyncio
async def test_col_delete_rewrites_whole_col_named_range_to_shift_left():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # Whole-col named range over E:E — should shift to D:D after we
    # delete col B.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Prices", "definition": "=E:E"}),
    )

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT definition FROM datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "Prices"],
        )
    ).first()
    assert row["definition"] == "=D:D"


@pytest.mark.asyncio
async def test_col_delete_leaves_literal_named_range_untouched():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [0]}),
    )

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT definition FROM datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "TaxRate"],
        )
    ).first()
    assert row["definition"] == "0.05"
