"""Integration tests for the row-delete endpoint.

Covers the end-to-end flow: seed a sheet via the cell-upsert API, hit
``POST /rows/delete``, verify the sheet's cell state through the data
API, and confirm SSE subscribers receive a ``rows-deleted`` event.
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


async def create_sheet_with_rows(ds, db_name, rows):
    """Create a workbook + sheet and seed the given (row_idx, col_idx, value)
    triples into it. Returns (workbook_id, sheet_id)."""
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    wb_id = data["workbook"]["id"]
    sheet_id = data["sheet"]["id"]
    if rows:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
            content=json.dumps(
                {
                    "changes": [
                        {"row_idx": r, "col_idx": c, "raw_value": v}
                        for (r, c, v) in rows
                    ]
                }
            ),
        )
    return wb_id, sheet_id


async def get_cells(ds, db_name, wb_id, sheet_id):
    """Return the sheet's cells as sorted (row_idx, col_idx, raw_value)
    triples — read directly from the underlying table so we verify the
    persisted state, not just what the API returns."""
    db = ds.get_database(db_name)
    rows = [
        (r["row_idx"], r["col_idx"], r["raw_value"])
        for r in await db.execute(
            "SELECT row_idx, col_idx, raw_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? ORDER BY row_idx, col_idx",
            [sheet_id],
        )
    ]
    return rows


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_single_row_returns_normalized_list():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(5)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [2]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [2]}

    assert await get_cells(ds, db_name, wb_id, sheet_id) == [
        (0, 0, "r0"),
        (1, 0, "r1"),
        (2, 0, "r3"),
        (3, 0, "r4"),
    ]


@pytest.mark.asyncio
async def test_delete_multiple_noncontiguous_rows():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds,
        db_name,
        [(r, c, f"{r}-{c}") for r in range(6) for c in range(2)],
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1, 4]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [1, 4]}

    # Surviving rows 0, 2, 3, 5 → new indices 0, 1, 2, 3
    assert await get_cells(ds, db_name, wb_id, sheet_id) == [
        (0, 0, "0-0"),
        (0, 1, "0-1"),
        (1, 0, "2-0"),
        (1, 1, "2-1"),
        (2, 0, "3-0"),
        (2, 1, "3-1"),
        (3, 0, "5-0"),
        (3, 1, "5-1"),
    ]


@pytest.mark.asyncio
async def test_delete_dedupes_and_sorts_input():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(4)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [3, 1, 1, 3]}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": [1, 3]}

    assert await get_cells(ds, db_name, wb_id, sheet_id) == [
        (0, 0, "r0"),
        (1, 0, "r2"),
    ]


@pytest.mark.asyncio
async def test_empty_indices_is_no_op():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(3)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": []}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": []}

    assert await get_cells(ds, db_name, wb_id, sheet_id) == [
        (0, 0, "r0"),
        (1, 0, "r1"),
        (2, 0, "r2"),
    ]


@pytest.mark.asyncio
async def test_negative_indices_rejected_silently():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(3)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [-1, -5]}),
    )
    assert resp.status_code == 200
    # Negatives filtered out during normalization; result is a no-op.
    assert resp.json() == {"deleted": []}
    assert await get_cells(ds, db_name, wb_id, sheet_id) == [
        (0, 0, "r0"),
        (1, 0, "r1"),
        (2, 0, "r2"),
    ]


@pytest.mark.asyncio
async def test_delete_on_missing_sheet_returns_404():
    ds, db_name = make_datasette()
    wb_id, _ = await create_sheet_with_rows(ds, db_name, [])
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/does-not-exist/rows/delete",
        content=json.dumps({"row_indices": [0]}),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Broadcast + cross-feature interaction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_broadcasts_rows_deleted_event():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(4)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")
    try:
        resp = await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
            content=json.dumps({"row_indices": [1, 2]}),
        )
        assert resp.status_code == 200
        assert queue.qsize() == 1
        event = queue.get_nowait()
        assert event["type"] == "rows-deleted"
        assert event["row_indices"] == [1, 2]
    finally:
        channel.unsubscribe("listener")


@pytest.mark.asyncio
async def test_delete_excludes_sending_client_from_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(4)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    sender_q = channel.subscribe("sender")
    other_q = channel.subscribe("other")
    try:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
            content=json.dumps({"row_indices": [1], "client_id": "sender"}),
        )
        assert sender_q.qsize() == 0
        assert other_q.qsize() == 1
    finally:
        channel.unsubscribe("sender")
        channel.unsubscribe("other")


@pytest.mark.asyncio
async def test_empty_delete_does_not_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(ds, db_name, [])

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")
    try:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
            content=json.dumps({"row_indices": []}),
        )
        assert queue.qsize() == 0
    finally:
        channel.unsubscribe("listener")


# ---------------------------------------------------------------------------
# Interaction with existing features (views, formula recalculation)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_view_reflects_row_delete():
    """Create a view over a range, delete a data row, and confirm the
    view query returns the shifted rows (no gap)."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds,
        db_name,
        [
            (0, 0, "Name"),
            (0, 1, "Age"),
            (1, 0, "Alex"),
            (1, 1, "10"),
            (2, 0, "Brian"),
            (2, 1, "20"),
            (3, 0, "Carol"),
            (3, 1, "30"),
        ],
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "people", "range": "A1:B", "use_headers": True}
        ),
    )
    assert resp.status_code == 201

    # Delete Brian's row (row 2). Carol should shift up to occupy row 2.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [2]}),
    )

    resp = await ds.client.get(f"/{db_name}/people.json?_shape=array")
    assert resp.status_code == 200
    assert resp.json() == [
        {"Name": "Alex", "Age": 10},
        {"Name": "Carol", "Age": 30},
    ]


@pytest.mark.asyncio
async def test_formulas_recalculate_after_delete():
    """A SUM referencing a shifted range still returns the correct total
    after a row delete — ``_recalculate_sheet`` feeds the post-shift cell
    ids to the Rust engine so formulas pick up the new positions."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds,
        db_name,
        [
            (0, 0, "10"),
            (1, 0, "20"),
            (2, 0, "30"),
            (3, 0, "=SUM(A1:A3)"),  # = 10 + 20 + 30 = 60
        ],
    )

    # Pre-delete: the SUM should already be computed as 60. Stored
    # typed (BLOB-affinity column), not as a string.
    db = ds.get_database(db_name)
    precheck = (
        await db.execute(
            "SELECT computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 3 AND col_idx = 0",
            [sheet_id],
        )
    ).first()["computed_value"]
    assert precheck == 60

    # Delete row 1 (value 20). Remaining values: 10, 30. SUM(A1:A3) now
    # sees A1=10, A2=30, A3=<the shifted formula itself> — so the formula
    # self-references. Better to test a formula that references a range
    # untouched by the delete. Reset with a different scenario:
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 0, "raw_value": "10"},
                    {"row_idx": 1, "col_idx": 0, "raw_value": "20"},
                    {"row_idx": 2, "col_idx": 0, "raw_value": "30"},
                    {"row_idx": 3, "col_idx": 0, "raw_value": "40"},
                    {"row_idx": 4, "col_idx": 0, "raw_value": "=SUM(A1:A2)"},
                ]
            }
        ),
    )
    # Delete row 2 (value 30). Row 3 (value 40) shifts to row 2; the
    # formula at row 4 shifts to row 3 and now reads =SUM(A1:A2) which
    # should be 10 + 20 = 30.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [2]}),
    )
    formula = (
        await db.execute(
            "SELECT row_idx, raw_value, computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND col_idx = 0 ORDER BY row_idx",
            [sheet_id],
        )
    ).rows
    assert [tuple(r) for r in formula] == [
        (0, "10", 10),
        (1, "20", 20),
        (2, "40", 40),
        (3, "=SUM(A1:A2)", 30),
    ]


@pytest.mark.asyncio
async def test_delete_row_rewrites_whole_row_ref_to_ref():
    """`=SUM(1:1)` after deleting row 1 → `=SUM(#REF!)`."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds,
        db_name,
        [
            (0, 0, "10"),
            (0, 1, "20"),
            (2, 0, "=SUM(1:1)"),
        ],
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [0]}),
    )
    assert resp.status_code == 200, resp.text

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND col_idx = 0 ORDER BY row_idx DESC LIMIT 1",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=SUM(#REF!)"


@pytest.mark.asyncio
async def test_delete_row_shifts_surviving_refs_upward():
    """`=A5` after deleting row 2 → `=A4`. The cell A5 is still there,
    just at row_idx 3 now."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds,
        db_name,
        [
            (0, 0, "a"),
            (1, 0, "drop"),
            (2, 0, "c"),
            (3, 0, "d"),
            (4, 0, "42"),  # A5
            (0, 1, "=A5"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1]}),
    )
    assert resp.status_code == 200, resp.text

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value, computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 1",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=A4"
    assert row["computed_value"] == 42


@pytest.mark.asyncio
async def test_delete_row_trims_ranges_that_span_deletion():
    """`=SUM(A1:A3)` after deleting row 2 → `=SUM(A1:A2)`.
    Values: 10 + 30 = 40."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds,
        db_name,
        [
            (0, 0, "10"),
            (1, 0, "99"),
            (2, 0, "30"),
            (0, 1, "=SUM(A1:A3)"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1]}),
    )
    assert resp.status_code == 200, resp.text

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT raw_value, computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 1",
            [sheet_id],
        )
    ).first()
    assert row["raw_value"] == "=SUM(A1:A2)"
    assert row["computed_value"] == 40


@pytest.mark.asyncio
async def test_sheet_updated_at_advances_on_delete():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(3)]
    )
    db = ds.get_database(db_name)
    before = (
        await db.execute(
            "SELECT updated_at FROM datasette_sheets_sheet WHERE id = ?",
            [sheet_id],
        )
    ).first()["updated_at"]

    # Small sleep so strftime('%f') actually moves (millisecond resolution).
    import asyncio as _asyncio

    await _asyncio.sleep(0.002)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1]}),
    )
    after = (
        await db.execute(
            "SELECT updated_at FROM datasette_sheets_sheet WHERE id = ?",
            [sheet_id],
        )
    ).first()["updated_at"]
    assert after > before


# ---------------------------------------------------------------------------
# Named-range parity (att 1s3c2rpc) — row-delete rewrites named-range
# definitions in addition to cell formulas.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_delete_rewrites_named_range_pointing_at_deleted_row():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(ds, db_name, [])

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Header", "definition": "=A1"}),
    )

    # Delete row 0 (1-based 1) → ref to A1 is inside the deletion.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [0]}),
    )

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT definition FROM datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "Header"],
        )
    ).first()
    assert row["definition"] == "=#REF!"


@pytest.mark.asyncio
async def test_row_delete_shifts_named_range_below_deletion():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(ds, db_name, [])

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "DataRow", "definition": "=A5"}),
    )

    # Delete row 1 (1-based 2) → A5 shifts up to A4.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1]}),
    )

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT definition FROM datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "DataRow"],
        )
    ).first()
    assert row["definition"] == "=A4"


# ---------------------------------------------------------------------------
# Row move endpoint (POST /rows/move) — att eu1tfy2o
# ---------------------------------------------------------------------------


# [sheet.row.drag-reorder]
@pytest.mark.asyncio
async def test_move_row_endpoint_basic():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(5)]
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 1}),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "moved": {
            "src_start": 3,
            "src_end": 3,
            "final_start": 1,
            "width": 1,
        }
    }


@pytest.mark.asyncio
async def test_move_row_block_endpoint():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(7)]
    )

    # Move rows 1..3 to start at 4. dest_gap = 7.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 1, "src_end": 3, "dest_gap": 7}),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["moved"]["final_start"] == 4
    assert body["moved"]["width"] == 3


@pytest.mark.asyncio
async def test_move_row_noop_returns_null():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(5)]
    )

    # Drop on the source position.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 3}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"moved": None}

    # Drop just past source range.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 4}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"moved": None}


@pytest.mark.asyncio
async def test_move_row_invalid_400():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(ds, db_name, [])

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 1, "dest_gap": 0}),
    )
    assert resp.status_code == 400

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": -1, "src_end": 3, "dest_gap": 0}),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_move_row_missing_sheet_404():
    ds, db_name = make_datasette()
    wb_id, _ = await create_sheet_with_rows(ds, db_name, [])

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/does-not-exist/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 1}),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_move_row_broadcasts_sse():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(5)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 1}),
    )
    assert resp.status_code == 200

    assert queue.qsize() == 1
    event = queue.get_nowait()
    assert event["type"] == "rows-moved"
    assert event["src_start"] == 3
    assert event["src_end"] == 3
    assert event["final_start"] == 1
    assert event["width"] == 1


@pytest.mark.asyncio
async def test_move_row_excludes_originator():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(5)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    listener_q = channel.subscribe("listener")
    originator_q = channel.subscribe("originator")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps(
            {"src_start": 3, "src_end": 3, "dest_gap": 1, "client_id": "originator"}
        ),
    )
    assert resp.status_code == 200

    assert listener_q.qsize() == 1
    assert originator_q.qsize() == 0


@pytest.mark.asyncio
async def test_move_row_noop_does_not_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_sheet_with_rows(
        ds, db_name, [(r, 0, f"r{r}") for r in range(5)]
    )

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 3, "src_end": 3, "dest_gap": 3}),
    )
    assert resp.status_code == 200
    assert resp.json() == {"moved": None}

    assert queue.qsize() == 0
