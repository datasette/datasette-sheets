"""Tests for the per-sheet basic filter (Phase A: read-only API).

Phase B–E will extend this file with create / delete / update /
sort coverage. For now we exercise:

- ``GET /filter`` returns ``{"filter": null}`` for a sheet with
  no filter row.
- A direct ``_queries.insert_filter`` followed by ``GET /filter``
  round-trips the bounds + predicates JSON.
- ``UNIQUE(sheet_id)`` is enforced — second insert raises.
- ``delete_filter_by_sheet`` cleans up.
- The sheet-delete cascade in ``db.py::delete_sheet`` removes the
  filter row alongside cells / columns / named ranges.
"""

from __future__ import annotations

import json
import os
import sqlite3
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


async def create_workbook_and_sheet(ds, db_name):
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "Test"}),
    )
    data = resp.json()
    return data["workbook"]["id"], data["sheet"]["id"]


@pytest.mark.asyncio
async def test_get_filter_returns_null_when_unset():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter"
    )
    assert resp.status_code == 200
    assert resp.json() == {"filter": None}


@pytest.mark.asyncio
async def test_insert_and_get_round_trip():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    db_obj = ds.get_database(db_name)

    def insert(conn):
        return _queries.insert_filter(
            conn,
            filter_id="01HZZZTEST0000000000000001",
            sheet_id=sheet_id,
            min_row=1,
            min_col=1,
            max_row=3,
            max_col=3,
            sort_col_idx=2,
            sort_direction="asc",
            predicates_json=json.dumps({"3": {"hidden": ["closed"]}}),
        )

    row = await db_obj.execute_write_fn(insert)
    assert row is not None
    assert row.id == "01HZZZTEST0000000000000001"

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter"
    )
    assert resp.status_code == 200
    body = resp.json()["filter"]
    assert body is not None
    assert body["min_row"] == 1
    assert body["min_col"] == 1
    assert body["max_row"] == 3
    assert body["max_col"] == 3
    assert body["sort_col_idx"] == 2
    assert body["sort_direction"] == "asc"
    # Predicates round-trip as the typed shape, not raw JSON text.
    assert body["predicates"] == {"3": {"hidden": ["closed"]}}


@pytest.mark.asyncio
async def test_unique_sheet_id_constraint():
    ds, db_name = make_datasette()
    _, sheet_id = await create_workbook_and_sheet(ds, db_name)
    db_obj = ds.get_database(db_name)

    def insert(filter_id):
        def _do(conn):
            return _queries.insert_filter(
                conn,
                filter_id=filter_id,
                sheet_id=sheet_id,
                min_row=0,
                min_col=0,
                max_row=5,
                max_col=5,
                sort_col_idx=None,
                sort_direction=None,
                predicates_json="{}",
            )

        return _do

    await db_obj.execute_write_fn(insert("01HZZZUNIQ00000000000000A1"))
    with pytest.raises(sqlite3.IntegrityError):
        await db_obj.execute_write_fn(insert("01HZZZUNIQ00000000000000A2"))


@pytest.mark.asyncio
async def test_sheet_delete_cascades_filter():
    """``delete_sheet`` must clear the sheet's filter alongside the
    other child rows. Without the cascade entry the UNIQUE(sheet_id)
    would survive into a freshly recreated sheet under the same id —
    extremely unlikely in practice (sheets are ULIDs) but the cascade
    is the right shape regardless.
    """
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    db_obj = ds.get_database(db_name)

    def insert(conn):
        return _queries.insert_filter(
            conn,
            filter_id="01HZZZCASC000000000000000A",
            sheet_id=sheet_id,
            min_row=0,
            min_col=0,
            max_row=4,
            max_col=4,
            sort_col_idx=None,
            sort_direction=None,
            predicates_json="{}",
        )

    await db_obj.execute_write_fn(insert)

    # Sanity check the row exists.
    def count(conn):
        return conn.execute(
            "select count(*) from datasette_sheets_filter where sheet_id = ?",
            [sheet_id],
        ).fetchone()[0]

    assert await db_obj.execute_write_fn(count) == 1

    # Deleting the sheet via the API path runs the cascade.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/delete",
    )
    assert resp.status_code == 200
    assert await db_obj.execute_write_fn(count) == 0


@pytest.mark.asyncio
async def test_workbook_delete_cascades_filter():
    """Same as the sheet cascade — workbook-level delete fans out to
    every sheet's filter row."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    db_obj = ds.get_database(db_name)

    def insert(conn):
        _queries.insert_filter(
            conn,
            filter_id="01HZZZWBCASC0000000000000A",
            sheet_id=sheet_id,
            min_row=0,
            min_col=0,
            max_row=2,
            max_col=2,
            sort_col_idx=None,
            sort_direction=None,
            predicates_json="{}",
        )

    await db_obj.execute_write_fn(insert)
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/delete",
    )
    assert resp.status_code == 200

    def count(conn):
        return conn.execute("select count(*) from datasette_sheets_filter").fetchone()[
            0
        ]

    assert await db_obj.execute_write_fn(count) == 0


@pytest.mark.asyncio
async def test_create_filter_and_get_round_trip():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter/create",
        content=json.dumps({"range": "B2:D5"}),
    )
    assert resp.status_code == 201
    f = resp.json()["filter"]
    assert f["min_row"] == 1
    assert f["min_col"] == 1
    assert f["max_row"] == 4
    assert f["max_col"] == 3
    assert f["sort_col_idx"] is None
    assert f["predicates"] == {}

    # Round-trip via GET.
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter"
    )
    assert resp.status_code == 200
    assert resp.json()["filter"]["id"] == f["id"]


@pytest.mark.asyncio
async def test_create_filter_conflict_when_already_exists():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    base_url = (
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter/create"
    )
    resp = await ds.client.post(base_url, content=json.dumps({"range": "B2:D5"}))
    assert resp.status_code == 201
    resp = await ds.client.post(base_url, content=json.dumps({"range": "B2:D5"}))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_filter_invalid_range():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter/create",
        content=json.dumps({"range": "not-a-range"}),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_filter_round_trip():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    resp = await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    assert resp.status_code == 201

    resp = await ds.client.post(base + "/filter/delete")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # Subsequent GET returns null.
    resp = await ds.client.get(base + "/filter")
    assert resp.json()["filter"] is None

    # Deleting again returns 404 (nothing to remove).
    resp = await ds.client.post(base + "/filter/delete")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_filter_predicate_round_trip():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )

    # Set predicate hiding "closed" on col D (col_idx=3).
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_predicate": True,
                "predicate_col_idx": 3,
                "predicate_hidden": ["closed"],
            }
        ),
    )
    assert resp.status_code == 200
    f = resp.json()["filter"]
    assert f["predicates"] == {"3": {"hidden": ["closed"]}}

    # GET round-trip.
    resp = await ds.client.get(base + "/filter")
    assert resp.json()["filter"]["predicates"] == {"3": {"hidden": ["closed"]}}

    # Updating the same column replaces the hidden list.
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_predicate": True,
                "predicate_col_idx": 3,
                "predicate_hidden": ["closed", "pending"],
            }
        ),
    )
    assert resp.json()["filter"]["predicates"] == {
        "3": {"hidden": ["closed", "pending"]}
    }

    # ``predicate_hidden = None`` removes the predicate entirely.
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_predicate": True,
                "predicate_col_idx": 3,
                "predicate_hidden": None,
            }
        ),
    )
    assert resp.json()["filter"]["predicates"] == {}


@pytest.mark.asyncio
async def test_update_filter_rejects_out_of_range_col():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    # Col 5 is outside the rectangle (B..D = 1..3).
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_predicate": True,
                "predicate_col_idx": 5,
                "predicate_hidden": ["x"],
            }
        ),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_filter_no_filter_is_400():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter/update",
        content=json.dumps(
            {
                "set_predicate": True,
                "predicate_col_idx": 1,
                "predicate_hidden": ["x"],
            }
        ),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_filter_rejects_no_flags():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    resp = await ds.client.post(base + "/filter/update", content=json.dumps({}))
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_filter_sort_asc_reorders_rows():
    """Sort col B asc when values are [3, 1, 2] (rows 2..4) ⇒
    rows reorder so values become [1, 2, 3]."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    # Seed values in B2 (header), B3=3, B4=1, B5=2.
    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 1, "col_idx": 1, "raw_value": "n"},
                    {"row_idx": 2, "col_idx": 1, "raw_value": "3"},
                    {"row_idx": 3, "col_idx": 1, "raw_value": "1"},
                    {"row_idx": 4, "col_idx": 1, "raw_value": "2"},
                ]
            }
        ),
    )
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:B5"})
    )
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_sort": True,
                "sort_col_idx": 1,
                "sort_direction": "asc",
            }
        ),
    )
    assert resp.status_code == 200
    f = resp.json()["filter"]
    assert f["sort_col_idx"] == 1
    assert f["sort_direction"] == "asc"

    # Read cells back.
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    )
    cells = resp.json()["cells"]
    by_row = {c["row_idx"]: c["raw_value"] for c in cells if c["col_idx"] == 1}
    assert by_row[1] == "n"  # header preserved
    assert by_row[2] == "1"
    assert by_row[3] == "2"
    assert by_row[4] == "3"


@pytest.mark.asyncio
async def test_filter_sort_desc_reverses():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 1, "col_idx": 1, "raw_value": "n"},
                    {"row_idx": 2, "col_idx": 1, "raw_value": "alex"},
                    {"row_idx": 3, "col_idx": 1, "raw_value": "brian"},
                    {"row_idx": 4, "col_idx": 1, "raw_value": "craig"},
                ]
            }
        ),
    )
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:B5"})
    )
    await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_sort": True,
                "sort_col_idx": 1,
                "sort_direction": "desc",
            }
        ),
    )
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    )
    cells = resp.json()["cells"]
    by_row = {c["row_idx"]: c["raw_value"] for c in cells if c["col_idx"] == 1}
    assert by_row[2] == "craig"
    assert by_row[3] == "brian"
    assert by_row[4] == "alex"


@pytest.mark.asyncio
async def test_filter_sort_persists_metadata():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_sort": True,
                "sort_col_idx": 2,
                "sort_direction": "desc",
            }
        ),
    )
    f = (await ds.client.get(base + "/filter")).json()["filter"]
    assert f["sort_col_idx"] == 2
    assert f["sort_direction"] == "desc"


@pytest.mark.asyncio
async def test_filter_sort_clear_via_null_col_idx():
    """Setting sort_col_idx=null clears the active sort metadata
    without re-ordering rows."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    # First apply a sort.
    await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {"set_sort": True, "sort_col_idx": 1, "sort_direction": "asc"}
        ),
    )
    # Now clear it.
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps({"set_sort": True, "sort_col_idx": None}),
    )
    assert resp.status_code == 200
    f = resp.json()["filter"]
    assert f["sort_col_idx"] is None
    assert f["sort_direction"] is None


@pytest.mark.asyncio
async def test_filter_sort_rejects_out_of_range_col():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    resp = await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {"set_sort": True, "sort_col_idx": 9, "sort_direction": "asc"}
        ),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_filter_sort_rewrites_formulas_following_data():
    """Cell outside the filter referencing one of the moved cells
    follows the data through the sort. Confirms the formula rewrite
    path runs correctly across N row-block-moves."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    # Header B2; data B3=alex, B4=brian; F1 = =B3 (refers to the
    # row that's currently 'alex' — should follow it after sort).
    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 1, "col_idx": 1, "raw_value": "n"},
                    {"row_idx": 2, "col_idx": 1, "raw_value": "alex"},
                    {"row_idx": 3, "col_idx": 1, "raw_value": "brian"},
                    {"row_idx": 0, "col_idx": 5, "raw_value": "=B3"},
                ]
            }
        ),
    )
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:B4"})
    )
    # Sort desc — rows reorder to [brian, alex]; the cell that was
    # at B3 ('alex') is now at B4. The formula in F1 should rewrite
    # to =B4 so it still resolves to 'alex'.
    await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {"set_sort": True, "sort_col_idx": 1, "sort_direction": "desc"}
        ),
    )
    # Read back F1's raw value — confirm the formula rewrote.
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    )
    cells = resp.json()["cells"]
    f1 = next(c for c in cells if c["row_idx"] == 0 and c["col_idx"] == 5)
    assert f1["raw_value"] == "=B4"


@pytest.mark.asyncio
async def test_update_filter_broadcasts_filter_update():
    from datasette_sheets.broadcast import get_channel_manager

    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    channel = get_channel_manager().get_channel(sheet_id)
    queue = channel.subscribe("listener")

    await ds.client.post(
        base + "/filter/update",
        content=json.dumps(
            {
                "set_predicate": True,
                "predicate_col_idx": 1,
                "predicate_hidden": ["x"],
            }
        ),
    )
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    assert any(e["type"] == "filter-update" for e in events)
    channel.unsubscribe("listener")


@pytest.mark.asyncio
async def test_auto_expand_extends_max_row_on_write_below():
    """Filter B2:D5. Writing into B6 (row 5, col 1 — both 0-based)
    bumps max_row from 4 to 5."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    f = (await ds.client.get(base + "/filter")).json()["filter"]
    assert f["max_row"] == 4

    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {"changes": [{"row_idx": 5, "col_idx": 1, "raw_value": "alex"}]}
        ),
    )
    f = (await ds.client.get(base + "/filter")).json()["filter"]
    assert f["max_row"] == 5


@pytest.mark.asyncio
async def test_auto_expand_does_not_fire_for_empty_write():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {"changes": [{"row_idx": 5, "col_idx": 1, "raw_value": ""}]}
        ),
    )
    f = (await ds.client.get(base + "/filter")).json()["filter"]
    assert f["max_row"] == 4


@pytest.mark.asyncio
async def test_auto_expand_does_not_fire_for_write_more_than_one_row_below():
    """Skipping over the boundary row (B6) and writing to B7 should
    NOT extend the filter — would be a multi-row jump and is
    deliberately excluded."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    # Row 6 (display row 7) is two rows below max_row=4.
    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {"changes": [{"row_idx": 6, "col_idx": 1, "raw_value": "x"}]}
        ),
    )
    f = (await ds.client.get(base + "/filter")).json()["filter"]
    assert f["max_row"] == 4


@pytest.mark.asyncio
async def test_auto_expand_does_not_fire_for_write_outside_col_range():
    """Writing into a cell directly below the rectangle but in a
    column outside [min_col..max_col] should not extend."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    # F6 — col 5, outside the B..D range (col_idx 1..3).
    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {"changes": [{"row_idx": 5, "col_idx": 5, "raw_value": "x"}]}
        ),
    )
    f = (await ds.client.get(base + "/filter")).json()["filter"]
    assert f["max_row"] == 4


@pytest.mark.asyncio
async def test_auto_expand_broadcasts_filter_update():
    from datasette_sheets.broadcast import get_channel_manager

    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    await ds.client.post(
        base + "/filter/create", content=json.dumps({"range": "B2:D5"})
    )
    channel = get_channel_manager().get_channel(sheet_id)
    queue = channel.subscribe("listener")

    await ds.client.post(
        base + "/cells",
        content=json.dumps(
            {"changes": [{"row_idx": 5, "col_idx": 1, "raw_value": "x"}]}
        ),
    )
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    types = [e["type"] for e in events]
    assert "cell-update" in types
    assert "filter-update" in types
    fu = next(e for e in events if e["type"] == "filter-update")
    assert fu["filter"]["max_row"] == 5
    channel.unsubscribe("listener")


@pytest.mark.asyncio
async def test_get_filter_with_malformed_predicates_json_falls_back():
    """Defensive: if a hand-edited DB has malformed predicates JSON,
    the GET handler returns an empty predicates map rather than
    500ing. Stops a single broken row from making the whole sheet
    unloadable."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)
    db_obj = ds.get_database(db_name)

    def insert(conn):
        return _queries.insert_filter(
            conn,
            filter_id="01HZZZMALF0000000000000001",
            sheet_id=sheet_id,
            min_row=0,
            min_col=0,
            max_row=1,
            max_col=1,
            sort_col_idx=None,
            sort_direction=None,
            predicates_json="not-json",
        )

    await db_obj.execute_write_fn(insert)
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/filter"
    )
    assert resp.status_code == 200
    assert resp.json()["filter"]["predicates"] == {}
