"""Integration tests for filter bound-shift under structural ops.

The filter rectangle, sort_col_idx and predicate keys all shift in
lockstep with row/col delete / insert / move via
``_update_filter_for_*`` helpers in ``db.py``. This file exercises
the matrix end-to-end through the HTTP routes — the helpers
themselves are private but their effect is observable via
``GET /filter``.

Test fixtures use a 5-col / 6-row filter rectangle (B2:E6 ⇒
``min_row=1, min_col=1, max_row=5, max_col=4``) so we have room to
hit each corner case (delete inside, before, after; move across
the rectangle; insert at various points).
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_sheets import _queries


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


async def setup_filter(
    ds,
    db_name,
    *,
    min_row=1,
    min_col=1,
    max_row=5,
    max_col=4,
    sort_col_idx=None,
    sort_direction=None,
    predicates=None,
):
    """Spin up a workbook + sheet, then create a filter directly via
    ``_queries`` (the route's ``parse_range`` only handles symmetric
    A1 strings, so going through ``_queries`` is faster + lets us
    pre-populate sort + predicates).
    """
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    wb_id = data["workbook"]["id"]
    sheet_id = data["sheet"]["id"]
    db_obj = ds.get_database(db_name)

    def insert(conn):
        return _queries.insert_filter(
            conn,
            filter_id="01HZZZSHIFT00000000000000A",
            sheet_id=sheet_id,
            min_row=min_row,
            min_col=min_col,
            max_row=max_row,
            max_col=max_col,
            sort_col_idx=sort_col_idx,
            sort_direction=sort_direction,
            predicates_json=json.dumps(predicates or {}),
        )

    await db_obj.execute_write_fn(insert)
    return wb_id, sheet_id


async def get_filter(ds, db_name, wb_id, sheet_id):
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter"
    )
    assert resp.status_code == 200
    return resp.json()["filter"]


# ---- Row deletion --------------------------------------------------------


@pytest.mark.asyncio
async def test_row_delete_inside_filter_shrinks_max_row():
    """Filter B2:E6 (rows 1..5). Delete row 3 ⇒ filter becomes B2:E5
    (rows 1..4). Bounds collapse, predicates unaffected (row delete
    doesn't change col_idx)."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [3]}),
    )
    assert resp.status_code == 200

    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert (f["min_row"], f["max_row"]) == (1, 4)
    assert (f["min_col"], f["max_col"]) == (1, 4)


@pytest.mark.asyncio
async def test_row_delete_above_filter_shifts_filter_up():
    """Delete row 0 (above the filter). Filter shifts up by 1."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [0]}),
    )
    assert resp.status_code == 200

    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert (f["min_row"], f["max_row"]) == (0, 4)


@pytest.mark.asyncio
async def test_row_delete_erases_entire_filter():
    """Delete every row in the rectangle ⇒ filter row dropped."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1, 2, 3, 4, 5]}),
    )
    assert resp.status_code == 200

    assert await get_filter(ds, db_name, wb_id, sheet_id) is None


# ---- Column deletion -----------------------------------------------------


@pytest.mark.asyncio
async def test_col_delete_inside_filter_shrinks_max_col():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [3]}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    # Cols 1..4 minus 3 ⇒ surviving fwd-mapped indices [1, 2, 3] (the
    # old col 4 maps to 3 after the shift). New range: 1..3.
    assert (f["min_col"], f["max_col"]) == (1, 3)


@pytest.mark.asyncio
async def test_col_delete_rekeys_predicate():
    """Predicate on col 3 (col D in our B:E filter). Delete col 1
    (col B) ⇒ everything left shifts by 1 ⇒ predicate re-keys to 2.
    """
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(
        ds,
        db_name,
        predicates={"3": {"hidden": ["closed"]}},
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert f["predicates"] == {"2": {"hidden": ["closed"]}}


@pytest.mark.asyncio
async def test_col_delete_drops_predicate_for_deleted_col():
    """Predicate on col 3. Delete col 3 ⇒ predicate drops entirely."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(
        ds,
        db_name,
        predicates={
            "3": {"hidden": ["x"]},
            "4": {"hidden": ["y"]},
        },
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [3]}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    # Col 3's predicate drops; col 4's predicate re-keys to 3.
    assert f["predicates"] == {"3": {"hidden": ["y"]}}


@pytest.mark.asyncio
async def test_col_delete_clears_sort_when_sort_col_deleted():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(
        ds, db_name, sort_col_idx=3, sort_direction="asc"
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [3]}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert f["sort_col_idx"] is None
    assert f["sort_direction"] is None


@pytest.mark.asyncio
async def test_col_delete_shifts_sort_col_idx():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(
        ds, db_name, sort_col_idx=3, sort_direction="asc"
    )
    # Delete col 1 — col 3 shifts to col 2.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [1]}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert f["sort_col_idx"] == 2
    assert f["sort_direction"] == "asc"


# ---- Column insertion ----------------------------------------------------


@pytest.mark.asyncio
async def test_col_insert_inside_filter_extends_max_col():
    """Insert one column at index 2 (inside B2:E6). Filter cols 1..4
    become 1..5 (rectangle widens by 1)."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 2, "count": 1}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert (f["min_col"], f["max_col"]) == (1, 5)


@pytest.mark.asyncio
async def test_col_insert_before_filter_shifts_filter_right():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 0, "count": 2}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert (f["min_col"], f["max_col"]) == (3, 6)


# ---- Column move ---------------------------------------------------------


@pytest.mark.asyncio
async def test_col_move_inside_filter_re_keys_predicate():
    """Filter B2:E6, predicate on col 3 (D). Move col 1 (B) to gap
    5 (between current cols 4 and 5) — col 1 goes to position 4.
    Cols 2/3/4 shift left to positions 1/2/3. Predicate on old col
    3 re-keys to col 2.
    """
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(
        ds, db_name, predicates={"3": {"hidden": ["x"]}}
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/move",
        content=json.dumps({"src_start": 1, "src_end": 1, "dest_gap": 5}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    # Old cols 2/3/4 become 1/2/3; old col 1 becomes 4. Filter
    # min_col was 1 ⇒ now 1 (smallest surviving fwd-mapped is 1).
    # max_col was 4 ⇒ now 4 (largest surviving fwd-mapped is 4).
    # Bounds unchanged but predicate re-keyed.
    assert f["predicates"] == {"2": {"hidden": ["x"]}}
    assert (f["min_col"], f["max_col"]) == (1, 4)


# ---- Row move ------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_move_inside_filter_leaves_bounds_alone():
    """Row move inside the filter is a permutation — bounds and
    predicates (which are by col, not row) stay put."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(
        ds, db_name, predicates={"3": {"hidden": ["x"]}}
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/move",
        content=json.dumps({"src_start": 2, "src_end": 2, "dest_gap": 5}),
    )
    assert resp.status_code == 200
    f = await get_filter(ds, db_name, wb_id, sheet_id)
    assert (f["min_row"], f["max_row"]) == (1, 5)
    assert f["predicates"] == {"3": {"hidden": ["x"]}}


# ---- SSE smoke -----------------------------------------------------------


@pytest.mark.asyncio
async def test_row_delete_broadcasts_filter_update():
    """When a structural op mutates the filter, the route emits a
    ``filter-update`` event so other clients pick up the new
    bounds. Confirms the route helper actually fires."""
    from datasette_sheets.broadcast import get_channel_manager

    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)

    channel = get_channel_manager().get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [3]}),
    )
    assert resp.status_code == 200

    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    types = [e["type"] for e in events]
    assert "rows-deleted" in types
    assert "filter-update" in types
    filter_event = next(e for e in events if e["type"] == "filter-update")
    assert filter_event["filter"]["max_row"] == 4

    channel.unsubscribe("listener")


@pytest.mark.asyncio
async def test_row_delete_full_erase_broadcasts_filter_delete():
    from datasette_sheets.broadcast import get_channel_manager

    ds, db_name = make_datasette()
    wb_id, sheet_id = await setup_filter(ds, db_name)
    channel = get_channel_manager().get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [1, 2, 3, 4, 5]}),
    )
    assert resp.status_code == 200

    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    assert any(e["type"] == "filter-delete" for e in events)

    channel.unsubscribe("listener")
