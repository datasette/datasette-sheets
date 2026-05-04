"""Tests for SQL VIEW creation from spreadsheet ranges."""

import pytest
import json
import tempfile
import os
from datasette.app import Datasette


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


async def create_workbook_with_data(ds, db_name):
    """Create a workbook, sheet, and populate with name/age data."""
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "Test"}),
    )
    data = resp.json()
    wb_id = data["workbook"]["id"]
    sheet_id = data["sheet"]["id"]

    # F1=Name, G1=Age, F2=Alex, G2=10, F3=Brian, G3=20
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 5, "raw_value": "Name"},
                    {"row_idx": 0, "col_idx": 6, "raw_value": "Age"},
                    {"row_idx": 1, "col_idx": 5, "raw_value": "Alex"},
                    {"row_idx": 1, "col_idx": 6, "raw_value": "10"},
                    {"row_idx": 2, "col_idx": 5, "raw_value": "Brian"},
                    {"row_idx": 2, "col_idx": 6, "raw_value": "20"},
                ]
            }
        ),
    )
    return wb_id, sheet_id


@pytest.mark.asyncio
async def test_create_view_with_headers():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "students", "range": "F1:G3", "use_headers": True}
        ),
    )
    assert resp.status_code == 201
    view = resp.json()["view"]
    assert view["view_name"] == "students"
    assert view["range_str"] == "F1:G3"
    assert view["use_headers"] is True

    # Query the SQL VIEW via Datasette
    resp = await ds.client.get(f"/{db_name}/students.json?_shape=array")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2
    assert rows[0]["Name"] == "Alex"
    assert rows[0]["Age"] == 10
    assert rows[1]["Name"] == "Brian"


@pytest.mark.asyncio
async def test_create_view_without_headers():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "raw_data", "range": "F1:G3", "use_headers": False}
        ),
    )
    assert resp.status_code == 201

    resp = await ds.client.get(f"/{db_name}/raw_data.json?_shape=array")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 3  # all 3 rows are data (no header skip)
    assert rows[0]["F"] == "Name"
    assert rows[1]["F"] == "Alex"


@pytest.mark.asyncio
async def test_list_views():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps({"view_name": "v1", "range": "F1:G2", "use_headers": True}),
    )

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views"
    )
    assert resp.status_code == 200
    assert len(resp.json()["views"]) == 1
    assert resp.json()["views"][0]["view_name"] == "v1"


@pytest.mark.asyncio
async def test_delete_view():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "to_delete", "range": "F1:G2", "use_headers": True}
        ),
    )
    view_id = resp.json()["view"]["id"]

    # View exists
    resp = await ds.client.get(f"/{db_name}/to_delete.json?_shape=array")
    assert resp.status_code == 200

    # Delete it
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/{view_id}/delete"
    )
    assert resp.status_code == 200

    # View is gone
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views"
    )
    assert len(resp.json()["views"]) == 0


@pytest.mark.asyncio
async def test_invalid_view_name():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "drop table", "range": "F1:G2", "use_headers": True}
        ),
    )
    assert resp.status_code == 400
    assert "Invalid view name" in resp.json()["error"]


@pytest.mark.asyncio
async def test_duplicate_view_name():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps({"view_name": "dup", "range": "F1:G2", "use_headers": True}),
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps({"view_name": "dup", "range": "F1:G3", "use_headers": True}),
    )
    assert resp.status_code == 400
    assert "already exists" in resp.json()["error"]


@pytest.mark.asyncio
async def test_create_view_full_column_range():
    """A:G range should work (unbounded rows)."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "full_cols", "range": "F:G", "use_headers": False}
        ),
    )
    assert resp.status_code == 201
    view = resp.json()["view"]
    assert view["min_row"] == 0
    assert view["max_row"] == 99  # MAX_ROW

    # Query it — should have rows with data
    resp = await ds.client.get(f"/{db_name}/full_cols.json?_shape=array")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 3  # only 3 rows have data in F:G
    assert rows[0]["F"] == "Name"


@pytest.mark.asyncio
async def test_create_view_partial_range():
    """F1:G range (start row bound, open end) should work."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "partial", "range": "F1:G", "use_headers": True}
        ),
    )
    assert resp.status_code == 201

    resp = await ds.client.get(f"/{db_name}/partial.json?_shape=array")
    assert resp.status_code == 200
    rows = resp.json()
    # F1=Name/Age is header, F2=Alex/10, F3=Brian/20
    assert len(rows) == 2
    assert rows[0]["Name"] == "Alex"
    assert rows[1]["Name"] == "Brian"


async def create_writable_view(ds, db_name, wb_id, sheet_id, **flags):
    body = {
        "view_name": "people",
        "range": "F1:G",
        "use_headers": True,
        "enable_insert": flags.get("insert", False),
        "enable_update": flags.get("update", False),
        "enable_delete": flags.get("delete", False),
        "delete_mode": flags.get("delete_mode", "clear"),
    }
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(body),
    )
    assert resp.status_code == 201, resp.json()
    return resp.json()["view"]


@pytest.mark.asyncio
async def test_view_triggers_disabled_by_default():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    view = await create_writable_view(ds, db_name, wb_id, sheet_id)
    assert view["enable_insert"] is False
    assert view["enable_update"] is False
    assert view["enable_delete"] is False

    # No _sheet_row exposed, no triggers in schema
    db = ds.get_database(db_name)
    cols = [r["name"] for r in await db.execute("PRAGMA table_info(people)")]
    assert "_sheet_row" not in cols

    trigs = [
        r["name"]
        for r in await db.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='people'"
        )
    ]
    assert trigs == []


@pytest.mark.asyncio
async def test_view_update_trigger_writes_cells():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    await create_writable_view(ds, db_name, wb_id, sheet_id, update=True)

    db = ds.get_database(db_name)
    # _sheet_row must be exposed for UPDATE to identify the row
    cols = [r["name"] for r in await db.execute("PRAGMA table_info(people)")]
    assert "_sheet_row" in cols

    await db.execute_write("UPDATE people SET Age = '11' WHERE Name = 'Alex'")

    rows = [
        dict(r)
        for r in await db.execute("SELECT Name, Age FROM people ORDER BY _sheet_row")
    ]
    # Alex's Age came in via the SQL UPDATE trigger (writes '11' text
    # directly — engine is not re-run for view writes). Brian's Age was
    # set via the cells endpoint which routes through the engine, so
    # it's stored as the typed int 20.
    assert rows == [{"Name": "Alex", "Age": "11"}, {"Name": "Brian", "Age": 20}]

    # Verify the underlying cell was rewritten
    cell = (
        await db.execute(
            "SELECT raw_value FROM _datasette_sheets_cell WHERE sheet_id = ? AND row_idx = 1 AND col_idx = 6",
            [sheet_id],
        )
    ).first()
    assert cell["raw_value"] == "11"


@pytest.mark.asyncio
async def test_view_insert_trigger_appends_row():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    await create_writable_view(ds, db_name, wb_id, sheet_id, insert=True)

    db = ds.get_database(db_name)
    await db.execute_write("INSERT INTO people (Name, Age) VALUES ('Carol', '30')")

    rows = [
        dict(r)
        for r in await db.execute("SELECT Name, Age FROM people ORDER BY _sheet_row")
    ]
    assert rows[-1] == {"Name": "Carol", "Age": "30"}
    assert len(rows) == 3

    # New row landed at row_idx 3 (next after existing rows 1 and 2)
    cells = [
        dict(r)
        for r in await db.execute(
            "SELECT col_idx, raw_value FROM _datasette_sheets_cell WHERE sheet_id = ? AND row_idx = 3 ORDER BY col_idx",
            [sheet_id],
        )
    ]
    assert cells == [
        {"col_idx": 5, "raw_value": "Carol"},
        {"col_idx": 6, "raw_value": "30"},
    ]


@pytest.mark.asyncio
async def test_view_delete_trigger_removes_row():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    await create_writable_view(ds, db_name, wb_id, sheet_id, delete=True)

    db = ds.get_database(db_name)
    await db.execute_write("DELETE FROM people WHERE Name = 'Brian'")

    rows = [dict(r) for r in await db.execute("SELECT Name FROM people")]
    assert rows == [{"Name": "Alex"}]

    # Brian's cells are gone from the underlying table
    remaining = (
        await db.execute(
            "SELECT COUNT(*) AS n FROM _datasette_sheets_cell WHERE sheet_id = ? AND row_idx = 2",
            [sheet_id],
        )
    ).first()["n"]
    assert remaining == 0


@pytest.mark.asyncio
async def test_view_all_triggers_together():
    """Enabling all three flags creates all three triggers and they each work."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    view = await create_writable_view(
        ds, db_name, wb_id, sheet_id, insert=True, update=True, delete=True
    )
    assert view["enable_insert"] and view["enable_update"] and view["enable_delete"]

    db = ds.get_database(db_name)
    trig_names = sorted(
        r["name"]
        for r in await db.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='people'"
        )
    )
    assert trig_names == ["people_delete", "people_insert", "people_update"]

    # Round-trip: insert, update, delete
    await db.execute_write("INSERT INTO people (Name, Age) VALUES ('Carol', '30')")
    await db.execute_write("UPDATE people SET Age = '31' WHERE Name = 'Carol'")
    await db.execute_write("DELETE FROM people WHERE Name = 'Alex'")

    rows = [
        dict(r)
        for r in await db.execute("SELECT Name, Age FROM people ORDER BY _sheet_row")
    ]
    # Brian came in via the engine → int 20. Carol's Age was written
    # via the INSERT / UPDATE triggers which bypass the engine — the
    # SQL literal '31' stays a string.
    assert rows == [{"Name": "Brian", "Age": 20}, {"Name": "Carol", "Age": "31"}]


@pytest.mark.asyncio
async def test_view_delete_mode_clear_leaves_gap():
    """Default delete mode just removes the row's cells, leaving a gap."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    view = await create_writable_view(
        ds, db_name, wb_id, sheet_id, delete=True, delete_mode="clear"
    )
    assert view["delete_mode"] == "clear"

    db = ds.get_database(db_name)
    # Delete Alex (the first data row, at sheet row_idx=1)
    await db.execute_write("DELETE FROM people WHERE Name = 'Alex'")

    # Alex's cells are gone, Brian's cells still at row_idx=2 (not shifted).
    rows = [
        dict(r)
        for r in await db.execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx >= 1 ORDER BY row_idx, col_idx",
            [sheet_id],
        )
    ]
    assert rows == [
        {"row_idx": 2, "col_idx": 5, "raw_value": "Brian"},
        {"row_idx": 2, "col_idx": 6, "raw_value": "20"},
    ]


@pytest.mark.asyncio
async def test_view_delete_mode_shift_closes_gap():
    """delete_mode=shift moves subsequent rows up by 1 so there's no gap."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    # Add a third data row at row_idx=3 so there's something to shift.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 3, "col_idx": 5, "raw_value": "Carol"},
                    {"row_idx": 3, "col_idx": 6, "raw_value": "30"},
                ]
            }
        ),
    )
    view = await create_writable_view(
        ds, db_name, wb_id, sheet_id, delete=True, delete_mode="shift"
    )
    assert view["delete_mode"] == "shift"

    db = ds.get_database(db_name)
    # Delete Alex (at sheet row_idx=1); Brian (row 2) and Carol (row 3) should shift up.
    await db.execute_write("DELETE FROM people WHERE Name = 'Alex'")

    rows = [
        dict(r)
        for r in await db.execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx >= 1 ORDER BY row_idx, col_idx",
            [sheet_id],
        )
    ]
    assert rows == [
        {"row_idx": 1, "col_idx": 5, "raw_value": "Brian"},
        {"row_idx": 1, "col_idx": 6, "raw_value": "20"},
        {"row_idx": 2, "col_idx": 5, "raw_value": "Carol"},
        {"row_idx": 2, "col_idx": 6, "raw_value": "30"},
    ]

    # View query also reflects the shifted rows.
    view_rows = [
        dict(r)
        for r in await db.execute("SELECT Name, Age FROM people ORDER BY _sheet_row")
    ]
    # Age values were set via the cells endpoint → engine → typed int.
    assert view_rows == [
        {"Name": "Brian", "Age": 20},
        {"Name": "Carol", "Age": 30},
    ]


# NOTE: ``test_view_rejects_malformed_sheet_id`` was dropped when
# sheet ids flipped from ULID to int. The route regex (``\d+``)
# now rejects non-int sheet_ids at the URL-routing layer with a 404,
# so the validator's role here is defense-in-depth only — it's
# exercised directly in ``test_view_sql.py::TestValidateSheetId``.


@pytest.mark.asyncio
async def test_view_update_trigger_survives_weird_column_headers():
    """Column names with SQL metacharacters must round-trip safely."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    # Overwrite headers with hostile strings
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 5, "raw_value": "'); DROP TABLE x; --"},
                    {"row_idx": 0, "col_idx": 6, "raw_value": "a]b"},
                ]
            }
        ),
    )

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {
                "view_name": "hostile",
                "range": "F1:G3",
                "use_headers": True,
                "enable_update": True,
            }
        ),
    )
    assert resp.status_code == 201, resp.text

    db = ds.get_database(db_name)
    # Must have sanitized the column aliases
    cols = [r["name"] for r in await db.execute("PRAGMA table_info(hostile)")]
    for c in cols:
        assert "'" not in c and "]" not in c and ";" not in c

    # Underlying cell table still intact
    assert (
        await db.execute("SELECT COUNT(*) AS n FROM _datasette_sheets_cell")
    ).first()["n"] > 0


@pytest.mark.asyncio
async def test_view_delete_drops_triggers():
    """Dropping the view should also drop its INSTEAD OF triggers."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)
    view = await create_writable_view(
        ds, db_name, wb_id, sheet_id, insert=True, update=True, delete=True
    )

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/{view['id']}/delete"
    )

    db = ds.get_database(db_name)
    remaining = [
        r["name"]
        for r in await db.execute(
            "SELECT name FROM sqlite_master WHERE name IN ('people', 'people_insert', 'people_update', 'people_delete')"
        )
    ]
    assert remaining == []


# ---------------------------------------------------------------------------
# View-bound parity (att c85nqtm3) — col/row delete + insert update the
# _datasette_sheets_view registry's [min_col, max_col] / [min_row, max_row]
# the same way move_columns already does.
# ---------------------------------------------------------------------------


async def _view_bounds(ds, db_name, sheet_id, view_name):
    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT min_row, min_col, max_row, max_col FROM _datasette_sheets_view "
            "WHERE sheet_id = ? AND view_name = ?",
            [sheet_id, view_name],
        )
    ).first()
    return (row["min_row"], row["min_col"], row["max_row"], row["max_col"])


@pytest.mark.asyncio
async def test_col_delete_shifts_view_bounds_left():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    # View over F1:G3 (cols 5..6).
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "v_shift", "range": "F1:G3", "use_headers": True}
        ),
    )
    assert resp.status_code in (200, 201)

    # Delete column A (idx 0). Cols 1..6 shift left by 1; the view's
    # registry bounds should follow to E1:F3 (cols 4..5).
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [0]}),
    )

    bounds = await _view_bounds(ds, db_name, sheet_id, "v_shift")
    assert bounds == (0, 4, 2, 5)


@pytest.mark.asyncio
async def test_col_insert_shifts_view_bounds_right():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "v_grow", "range": "F1:G3", "use_headers": True}
        ),
    )

    # Insert one col at idx 0. Cols 5..6 (the view) shift to 6..7.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/insert",
        content=json.dumps({"at": 0, "count": 1}),
    )

    bounds = await _view_bounds(ds, db_name, sheet_id, "v_grow")
    assert bounds == (0, 6, 2, 7)


@pytest.mark.asyncio
async def test_col_delete_inside_view_shrinks_bounds():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "v_inner", "range": "F1:G3", "use_headers": True}
        ),
    )

    # Delete column F (idx 5) — inside the view. Surviving col is G
    # (idx 6), which shifts left to idx 5 → bounds collapse to F:F
    # (5..5).
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [5]}),
    )

    bounds = await _view_bounds(ds, db_name, sheet_id, "v_inner")
    assert bounds == (0, 5, 2, 5)


@pytest.mark.asyncio
async def test_row_delete_shifts_view_bounds_up():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "v_rowshift", "range": "F2:G3", "use_headers": False}
        ),
    )
    bounds_before = await _view_bounds(ds, db_name, sheet_id, "v_rowshift")
    assert bounds_before == (1, 5, 2, 6)

    # Delete row 0 (1-based 1). Rows 1..2 shift up to 0..1.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/rows/delete",
        content=json.dumps({"row_indices": [0]}),
    )

    bounds = await _view_bounds(ds, db_name, sheet_id, "v_rowshift")
    assert bounds == (0, 5, 1, 6)


@pytest.mark.asyncio
async def test_view_with_all_cols_deleted_left_alone():
    """When every col in a view's range is deleted, v1 leaves the
    registry bounds stale — broken-view UX is a future follow-up.
    Pin the current behavior so a future change is intentional."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_with_data(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/views/create",
        content=json.dumps(
            {"view_name": "v_doomed", "range": "F1:G3", "use_headers": True}
        ),
    )

    # Delete F + G — both cols in the view's range.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/columns/delete",
        content=json.dumps({"col_indices": [5, 6]}),
    )

    # Bounds untouched (5..6). The view's logical content is gone
    # but the registry row survives — same as the pre-existing
    # delete_workbook / delete_sheet view-cleanup gap.
    bounds = await _view_bounds(ds, db_name, sheet_id, "v_doomed")
    assert bounds == (0, 5, 2, 6)
