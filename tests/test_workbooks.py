"""Tests for the workbook-based API (data in user DB)."""

import pytest
import json
import tempfile
import os
from datasette.app import Datasette


def make_datasette():
    """Create a Datasette with a writable temp database."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return Datasette(
        [tmp.name],
        config={"permissions": {"datasette-sheets-access": True}},
    ), os.path.basename(tmp.name).replace(".db", "")


@pytest.mark.asyncio
async def test_workbook_list_page():
    ds, db_name = make_datasette()
    resp = await ds.client.get(f"/{db_name}/-/sheets")
    assert resp.status_code == 200
    assert "Workbooks" in resp.text


@pytest.mark.asyncio
async def test_create_and_list_workbooks():
    ds, db_name = make_datasette()
    # Create
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "My Workbook"}),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["workbook"]["name"] == "My Workbook"
    wb_id = data["workbook"]["id"]
    # Auto-created first sheet
    assert data["sheet"]["name"] == "Sheet 1"

    # List
    resp = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks")
    assert resp.status_code == 200
    assert len(resp.json()["workbooks"]) == 1
    assert resp.json()["workbooks"][0]["id"] == wb_id


@pytest.mark.asyncio
async def test_get_workbook():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "Test"}),
    )
    wb_id = resp.json()["workbook"]["id"]

    resp = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}")
    assert resp.status_code == 200
    assert resp.json()["workbook"]["name"] == "Test"
    assert len(resp.json()["sheets"]) == 1


@pytest.mark.asyncio
async def test_workbook_page():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "Test"}),
    )
    wb_id = resp.json()["workbook"]["id"]

    resp = await ds.client.get(f"/{db_name}/-/sheets/workbook/{wb_id}")
    assert resp.status_code == 200
    assert "sheets-app" in resp.text
    assert f'data-workbook-id="{wb_id}"' in resp.text


@pytest.mark.asyncio
async def test_delete_workbook():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "Del"}),
    )
    wb_id = resp.json()["workbook"]["id"]

    resp = await ds.client.post(f"/{db_name}/-/sheets/api/workbooks/{wb_id}/delete")
    assert resp.status_code == 200

    resp = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_sheets_within_workbook():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "WB"}),
    )
    wb_id = resp.json()["workbook"]["id"]

    # List sheets (1 auto-created)
    resp = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets")
    assert len(resp.json()["sheets"]) == 1

    # Create another
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/create",
        content=json.dumps({"name": "Sheet 2", "color": "#4a7c59"}),
    )
    assert resp.status_code == 201
    assert resp.json()["sheet"]["name"] == "Sheet 2"
    assert len(resp.json()["columns"]) == 15

    # List again
    resp = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets")
    assert len(resp.json()["sheets"]) == 2


@pytest.mark.asyncio
async def test_cells_in_workbook_sheet():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "CellTest"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    sheet_id = resp.json()["sheet"]["id"]

    # Set cells
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 0, "raw_value": "10"},
                    {"row_idx": 0, "col_idx": 1, "raw_value": "20"},
                    {"row_idx": 0, "col_idx": 2, "raw_value": "=A1+B1"},
                ]
            }
        ),
    )
    assert resp.status_code == 200
    assert len(resp.json()["cells"]) == 3

    # Get sheet (cells + computed values)
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    )
    cells = resp.json()["cells"]
    assert len(cells) == 3


@pytest.mark.asyncio
async def test_reorder_sheets():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "WB"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    first_id = resp.json()["sheet"]["id"]

    async def add(name):
        r = await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/create",
            content=json.dumps({"name": name}),
        )
        return r.json()["sheet"]["id"]

    second_id = await add("Sheet 2")
    third_id = await add("Sheet 3")

    # Reverse the order.
    reversed_order = [third_id, second_id, first_id]
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/reorder",
        content=json.dumps({"sheet_ids": reversed_order}),
    )
    assert resp.status_code == 200
    returned_ids = [s["id"] for s in resp.json()["sheets"]]
    assert returned_ids == reversed_order
    # sort_order on the records mirrors position.
    for idx, s in enumerate(resp.json()["sheets"]):
        assert s["sort_order"] == idx

    # Subsequent list call preserves the new order.
    resp = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets")
    assert [s["id"] for s in resp.json()["sheets"]] == reversed_order

    # Missing ids are rejected — the full permutation must be provided.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/reorder",
        content=json.dumps({"sheet_ids": [first_id, second_id]}),
    )
    assert resp.status_code == 400

    # Duplicates are rejected.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/reorder",
        content=json.dumps({"sheet_ids": [first_id, first_id, second_id]}),
    )
    assert resp.status_code == 400

    # Unknown ids are rejected. Using a high integer that won't collide
    # with the autoincrement ids assigned to first/second/third — the
    # route's "ids don't match the workbook's sheets" branch fires
    # before any DB writes.
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/reorder",
        content=json.dumps({"sheet_ids": [first_id, second_id, 999_999]}),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_clearing_cell_format_persists():
    # Regression: an unbold followed by a refresh used to leave the
    # cell bold because the server UPSERT COALESCEd over the incoming
    # NULL format_json, preserving the stale JSON blob.
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "FormatClear"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    sheet_id = resp.json()["sheet"]["id"]
    base = f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"

    # 1) Bold the cell.
    await ds.client.post(
        f"{base}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "hi",
                        "format_json": json.dumps({"bold": True}),
                    }
                ]
            }
        ),
    )
    resp = await ds.client.get(base)
    saved = [
        c for c in resp.json()["cells"] if c["row_idx"] == 0 and c["col_idx"] == 0
    ][0]
    assert json.loads(saved["format_json"]) == {"bold": True}

    # 2) Unbold — client sends format_json: null, server should clear.
    await ds.client.post(
        f"{base}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "hi",
                        "format_json": None,
                    }
                ]
            }
        ),
    )
    resp = await ds.client.get(base)
    saved = [
        c for c in resp.json()["cells"] if c["row_idx"] == 0 and c["col_idx"] == 0
    ][0]
    assert saved["format_json"] is None


@pytest.mark.asyncio
async def test_data_api_with_workbook():
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "DataTest"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    sheet_id = resp.json()["sheet"]["id"]

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 0, "raw_value": "10"},
                    {"row_idx": 0, "col_idx": 1, "raw_value": "=A1*2"},
                ]
            }
        ),
    )

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data"
    )
    assert resp.status_code == 200
    # Numeric cells round-trip as JSON numbers via lotus.get_all_typed —
    # see TODO-liblotus-typed-accessor (now landed).
    assert resp.json()["rows"][0] == [10, 20]


@pytest.mark.asyncio
async def test_data_api_returns_typed_values():
    """Mixed int / float / string / formula-error / empty round-trip with the
    correct JSON types via the engine's typed accessors."""
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "TypeTest"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    sheet_id = resp.json()["sheet"]["id"]

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 0, "raw_value": "123"},
                    {"row_idx": 0, "col_idx": 1, "raw_value": "3.14"},
                    {"row_idx": 0, "col_idx": 2, "raw_value": "hello"},
                    {"row_idx": 0, "col_idx": 3, "raw_value": "=1/0"},
                    {"row_idx": 1, "col_idx": 0, "raw_value": "=A1+10"},
                ]
            }
        ),
    )

    # Sheet endpoint
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data"
    )
    rows = resp.json()["rows"]
    assert rows[0][:4] == [123, 3.14, "hello", "#DIV/0!"]
    assert rows[1][0] == 133  # =A1+10

    # Per-cell endpoint
    cell_resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data/A1"
    )
    assert cell_resp.json()["computed_value"] == 123

    cell_resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data/C1"
    )
    assert cell_resp.json()["computed_value"] == "hello"


@pytest.mark.asyncio
async def test_data_api_round_trips_booleans_as_json_true_false():
    """Comparison ops produce CellValue::Boolean — the data API has
    to surface them as JSON true/false, not the INTEGER 0/1 they
    flatten to in the SQLite round-trip. The discriminator column
    ``computed_value_kind`` is what makes this possible."""
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "BoolTest"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    sheet_id = resp.json()["sheet"]["id"]

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 0, "raw_value": "500"},
                    # =A1<501 → Boolean(true); =A1>501 → Boolean(false)
                    {"row_idx": 0, "col_idx": 1, "raw_value": "=A1<501"},
                    {"row_idx": 0, "col_idx": 2, "raw_value": "=A1>501"},
                ]
            }
        ),
    )

    # Range endpoint — booleans appear as JSON true/false alongside
    # the integer they were emitted with.
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data"
    )
    rows = resp.json()["rows"]
    assert rows[0] == [500, True, False]
    # Distinguish bool from int 1/0 explicitly — Python's truthiness
    # would let isinstance(True, int) hide a regression.
    assert rows[0][1] is True
    assert rows[0][2] is False

    # Per-cell endpoint — same round-trip.
    cell_resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data/B1"
    )
    assert cell_resp.json()["computed_value"] is True
    cell_resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data/C1"
    )
    assert cell_resp.json()["computed_value"] is False


@pytest.mark.asyncio
async def test_data_api_treats_typed_TRUE_FALSE_as_boolean_literals():
    """User-typed ``TRUE`` / ``FALSE`` (case-insensitive, exact match
    only) flow through the engine's literal evaluator as
    ``CellValue::Boolean`` and surface as JSON ``true`` / ``false`` —
    matching Excel and Google Sheets. ``TRUE `` with a trailing space
    stays a string."""
    ds, db_name = make_datasette()
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "BoolLiteral"}),
    )
    wb_id = resp.json()["workbook"]["id"]
    sheet_id = resp.json()["sheet"]["id"]

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": 0, "col_idx": 0, "raw_value": "TRUE"},
                    {"row_idx": 0, "col_idx": 1, "raw_value": "false"},
                    {"row_idx": 0, "col_idx": 2, "raw_value": "True"},
                    {
                        "row_idx": 0,
                        "col_idx": 3,
                        "raw_value": "TRUE ",
                    },  # trailing space
                ]
            }
        ),
    )

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data"
    )
    rows = resp.json()["rows"]
    assert rows[0][0] is True
    assert rows[0][1] is False
    assert rows[0][2] is True
    # Trailing whitespace defeats the literal — engine returns String.
    assert rows[0][3] == "TRUE "
