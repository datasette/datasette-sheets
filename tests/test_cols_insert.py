"""Integration tests for the column-insert endpoint.

Mirror of :mod:`tests.test_cols` (which covers delete). Same
make_datasette / create_sheet_with_cells / get_cells helpers would be
duplicated, so they're re-imported from there.
"""

from __future__ import annotations

import json

import pytest

from datasette_sheets.broadcast import get_channel_manager

from test_cols import (
    create_sheet_with_cells,
    get_cells,
    get_column_metadata,
    make_datasette,
)


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_single_column_shifts_right():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(4)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 2, "count": 1}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"inserted": [2]}

    # col 0,1 stay; col 2,3 (was 2,3) shift right to 3,4.
    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 3, "c2"),
        (0, 4, "c3"),
    ]


@pytest.mark.asyncio
async def test_insert_multiple_columns_at_same_index():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(4)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 1, "count": 3}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"inserted": [1, 2, 3]}

    # col 0 stays; col 1..3 (was 1,2,3) shift right by 3 to 4,5,6.
    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 0, "c0"),
        (0, 4, "c1"),
        (0, 5, "c2"),
        (0, 6, "c3"),
    ]


@pytest.mark.asyncio
async def test_insert_at_zero_shifts_everything():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 0, "count": 1}),
    )
    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 1, "c0"),
        (0, 2, "c1"),
        (0, 3, "c2"),
    ]


@pytest.mark.asyncio
async def test_insert_past_last_column_is_a_noop_shift():
    """Inserting at an index past the last occupied column still
    succeeds and still reports what it inserted — but the sheet is
    visually unchanged because there was nothing to shift right."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 10, "count": 2}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"inserted": [10, 11]}
    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 2, "c2"),
    ]


@pytest.mark.asyncio
async def test_insert_count_zero_returns_empty():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 1, "count": 0}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"inserted": []}
    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 2, "c2"),
    ]


@pytest.mark.asyncio
async def test_insert_negative_at_returns_empty():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, 0, "c0")]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": -1, "count": 1}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"inserted": []}


@pytest.mark.asyncio
async def test_insert_on_missing_sheet_returns_404():
    ds, db_name = make_datasette()
    wb_id, _ = await create_sheet_with_cells(ds, db_name, [])
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/does-not-exist/columns/insert",
        content=json.dumps({"at": 0, "count": 1}),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Column metadata (_datasette_sheets_column) shift
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_column_metadata_table_shifts_too():
    """Widths + names live in the per-column metadata table and must
    shift in lockstep with the cell table, otherwise the grid's
    widths would drift to the wrong columns after an insert."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns",
        content=json.dumps(
            {
                "columns": [
                    {"col_idx": 0, "width": 100},
                    {"col_idx": 1, "width": 111},
                    {"col_idx": 2, "width": 222},
                    {"col_idx": 3, "width": 333},
                ]
            }
        ),
    )

    # Insert 1 col at index 1: widths at 1,2,3 shift right by 1.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 1, "count": 1}),
    )
    after = dict(
        (c, w)
        for (c, _n, w) in await get_column_metadata(ds, db_name, sheet_id)
    )
    assert after[0] == 100
    assert after.get(1, 100) == 100  # new blank col — no row in the metadata table
    assert after[2] == 111
    assert after[3] == 222
    assert after[4] == 333


# ---------------------------------------------------------------------------
# Broadcast
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_broadcasts_columns_inserted_event():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")
    try:
        resp = await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
            content=json.dumps({"at": 1, "count": 2}),
        )
        assert resp.status_code == 200
        assert queue.qsize() == 1
        event = queue.get_nowait()
        assert event["type"] == "columns-inserted"
        assert event["col_indices"] == [1, 2]
    finally:
        channel.unsubscribe("listener")


@pytest.mark.asyncio
async def test_insert_excludes_sending_client_from_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds, db_name, [(0, c, f"c{c}") for c in range(3)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    sender_q = channel.subscribe("sender")
    other_q = channel.subscribe("other")
    try:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
            content=json.dumps(
                {"at": 0, "count": 1, "client_id": "sender"}
            ),
        )
        assert sender_q.qsize() == 0
        assert other_q.qsize() == 1
    finally:
        channel.unsubscribe("sender")
        channel.unsubscribe("other")


@pytest.mark.asyncio
async def test_empty_insert_does_not_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")
    try:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
            content=json.dumps({"at": 0, "count": 0}),
        )
        assert queue.qsize() == 0
    finally:
        channel.unsubscribe("listener")


# ---------------------------------------------------------------------------
# Formula ref-rewrite on insert
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_formulas_recalculate_after_column_insert():
    """`=A1+B1` inserted-before-A should shift to `=B1+C1` and still
    evaluate to the same sum."""
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

    db = ds.get_database(db_name)
    pre = (
        await db.execute(
            "SELECT computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 2",
            [sheet_id],
        )
    ).first()["computed_value"]
    assert pre == 30

    # Insert 1 col at index 0 — every ref shifts right by 1.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 0, "count": 1}),
    )
    rows = [
        (r["col_idx"], r["raw_value"], r["computed_value"])
        for r in (
            await db.execute(
                "SELECT col_idx, raw_value, computed_value "
                "FROM _datasette_sheets_cell "
                "WHERE sheet_id = ? AND row_idx = 0 ORDER BY col_idx",
                [sheet_id],
            )
        ).rows
    ]
    assert rows == [
        (1, "10", 10),
        (2, "20", 20),
        (3, "=B1+C1", 30),
    ]


@pytest.mark.asyncio
async def test_insert_column_grows_straddled_range():
    """`=SUM(A1:C1)` with a blank col inserted at index 1 should grow
    to `=SUM(A1:D1)` — matches Google Sheets' "inserting inside a
    range expands the range" behaviour. Engine primitive owns the
    semantics; this test pins the end-to-end wiring."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(
        ds,
        db_name,
        [
            (0, 0, "1"),
            (0, 1, "2"),
            (0, 2, "3"),
            (1, 0, "=SUM(A1:C1)"),
        ],
    )

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 1, "count": 1}),
    )
    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value, computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 1 AND col_idx = 0",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=SUM(A1:D1)"
    # 1 + (blank) + 2 + 3 = 6 — the new blank col contributes 0.
    assert row["computed_value"] == 6


# ---------------------------------------------------------------------------
# Shift SQL: scrambled-insert order regression
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_survives_scrambled_insert_order():
    """SQLite's rowid-order scan can disagree with (sheet_id, row_idx,
    col_idx) PK order if rows were inserted out of order. A naive
    ``SET col_idx = col_idx + N`` would collide mid-statement; the
    two-pass negative-buffer shift avoids that. Mirror of the
    scrambled-insert regression for delete in test_col_shift.py."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # Post cells in scrambled col order via one bulk update so rowids
    # land in (col 5, col 1, col 3, col 0, col 4, col 2) order.
    scrambled = [5, 1, 3, 0, 4, 2]
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": c, "raw_value": f"c{c}"}
                    for c in scrambled
                ]
            }
        ),
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 2, "count": 1}),
    )
    assert resp.status_code == 200

    # Cols 0,1 stay; cols 2,3,4,5 shift right by 1 to 3,4,5,6.
    assert await get_cells(ds, db_name, sheet_id) == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 3, "c2"),
        (0, 4, "c3"),
        (0, 5, "c4"),
        (0, 6, "c5"),
    ]


# ---------------------------------------------------------------------------
# Named-range parity (att 1s3c2rpc) — column-insert rewrites named-range
# definitions in addition to cell formulas.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_col_insert_shifts_named_range_pointing_past_insertion():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # Single-cell named range pointing at column D (idx 3).
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Anchor", "definition": "=D5"}),
    )
    assert resp.status_code == 200, resp.text

    # Insert one column at index 1 (between A and B) — D should shift to E.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 1, "count": 1}),
    )

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT definition FROM _datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "Anchor"],
        )
    ).first()
    assert row["definition"] == "=E5"


@pytest.mark.asyncio
async def test_col_insert_grows_whole_col_named_range_straddling_insertion():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_cells(ds, db_name, [])

    # Whole-col named range over A:C — inserting at index 2 makes the
    # new blank col land in the middle, range grows to A:D.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Block", "definition": "=A:C"}),
    )

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 2, "count": 1}),
    )

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT definition FROM _datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "Block"],
        )
    ).first()
    assert row["definition"] == "=A:D"
