"""Integration tests for dropdown-rule endpoints + the strict-mode
cell-write validator. Mirrors the named-range test surface.
"""

import json
import os
import tempfile

import pytest
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


async def make_workbook_and_sheet(ds, db_name):
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    return data["workbook"]["id"], data["sheet"]["id"]


async def create_rule(ds, db_name, wb_id, body):
    return await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/dropdown-rules/create",
        content=json.dumps(body),
    )


@pytest.mark.asyncio
async def test_create_list_update_delete_rule_round_trip():
    ds, db_name = make_datasette()
    wb_id, _ = await make_workbook_and_sheet(ds, db_name)

    # Create
    resp = await create_rule(
        ds,
        db_name,
        wb_id,
        {
            "name": "Status",
            "multi": False,
            "options": [
                {"value": "Todo", "color": "#cccccc"},
                {"value": "Doing", "color": "#fff2cc"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    rule = resp.json()["dropdown_rule"]
    assert rule["name"] == "Status"
    assert rule["multi"] is False
    assert rule["source"]["kind"] == "list"
    assert len(rule["source"]["options"]) == 2

    # List
    list_resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/dropdown-rules"
    )
    assert list_resp.status_code == 200
    rules = list_resp.json()["dropdown_rules"]
    assert len(rules) == 1
    assert rules[0]["id"] == rule["id"]

    # Update — flip multi + replace options
    upd = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/dropdown-rules/{rule['id']}/update",
        content=json.dumps(
            {
                "multi": True,
                "options": [{"value": "X", "color": "#ff0000"}],
            }
        ),
    )
    assert upd.status_code == 200, upd.text
    updated = upd.json()["dropdown_rule"]
    assert updated["multi"] is True
    assert [o["value"] for o in updated["source"]["options"]] == ["X"]

    # Delete
    delr = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/dropdown-rules/{rule['id']}/delete"
    )
    assert delr.status_code == 200
    list_after = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/dropdown-rules"
    )
    assert list_after.json()["dropdown_rules"] == []


@pytest.mark.asyncio
async def test_comma_in_option_value_rejected():
    ds, db_name = make_datasette()
    wb_id, _ = await make_workbook_and_sheet(ds, db_name)
    resp = await create_rule(
        ds,
        db_name,
        wb_id,
        {
            "multi": True,
            "options": [{"value": "a,b", "color": "#ccc"}],
        },
    )
    assert resp.status_code == 400
    assert "," in resp.json()["error"]


@pytest.mark.asyncio
async def test_empty_options_rejected():
    ds, db_name = make_datasette()
    wb_id, _ = await make_workbook_and_sheet(ds, db_name)
    resp = await create_rule(
        ds, db_name, wb_id, {"multi": False, "options": []}
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_strict_validator_rejects_value_not_in_list():
    """Cell write with controlType='dropdown' and a raw_value outside
    the rule's options is rejected at write time — strict mode."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_workbook_and_sheet(ds, db_name)
    rule_resp = await create_rule(
        ds,
        db_name,
        wb_id,
        {
            "multi": False,
            "options": [
                {"value": "Todo", "color": "#ccc"},
                {"value": "Done", "color": "#b6d7a8"},
            ],
        },
    )
    rule_id = rule_resp.json()["dropdown_rule"]["id"]
    fmt = json.dumps({"controlType": "dropdown", "dropdownRuleId": rule_id})

    # Valid value succeeds.
    ok = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "Todo",
                        "format_json": fmt,
                    }
                ]
            }
        ),
    )
    assert ok.status_code == 200, ok.text

    # Invalid value fails (the whole batch is rejected — that's the
    # contract: partial saves can't leave the sheet inconsistent).
    bad = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 1,
                        "col_idx": 0,
                        "raw_value": "Cancelled",
                        "format_json": fmt,
                    }
                ]
            }
        ),
    )
    assert bad.status_code >= 400


@pytest.mark.asyncio
async def test_strict_validator_multi_select_each_segment():
    """Multi-select cells: every comma-split segment must be a valid
    option. One bad segment fails the batch."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_workbook_and_sheet(ds, db_name)
    rule_resp = await create_rule(
        ds,
        db_name,
        wb_id,
        {
            "multi": True,
            "options": [
                {"value": "a", "color": "#ccc"},
                {"value": "b", "color": "#ccc"},
                {"value": "c", "color": "#ccc"},
            ],
        },
    )
    rule_id = rule_resp.json()["dropdown_rule"]["id"]
    fmt = json.dumps({"controlType": "dropdown", "dropdownRuleId": rule_id})

    ok = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "a,c",
                        "format_json": fmt,
                    }
                ]
            }
        ),
    )
    assert ok.status_code == 200, ok.text

    bad = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 1,
                        "col_idx": 0,
                        "raw_value": "a,d",
                        "format_json": fmt,
                    }
                ]
            }
        ),
    )
    assert bad.status_code >= 400


@pytest.mark.asyncio
async def test_strict_validator_blank_value_passes():
    """Blank value (cell delete) is always allowed regardless of rule."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_workbook_and_sheet(ds, db_name)
    rule_resp = await create_rule(
        ds,
        db_name,
        wb_id,
        {"multi": False, "options": [{"value": "X", "color": "#ccc"}]},
    )
    rule_id = rule_resp.json()["dropdown_rule"]["id"]
    fmt = json.dumps({"controlType": "dropdown", "dropdownRuleId": rule_id})

    ok = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "",
                        "format_json": fmt,
                    }
                ]
            }
        ),
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_workbook_delete_cleans_up_dropdown_rules():
    ds, db_name = make_datasette()
    wb_id, _ = await make_workbook_and_sheet(ds, db_name)
    await create_rule(
        ds,
        db_name,
        wb_id,
        {"multi": False, "options": [{"value": "X", "color": "#ccc"}]},
    )

    # Delete the workbook
    delr = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/delete"
    )
    assert delr.status_code == 200

    # Rule rows should be gone — query the table directly.
    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT count(*) FROM _datasette_sheets_dropdown_rule "
            "WHERE workbook_id = ?",
            [wb_id],
        )
    ).first()
    assert row[0] == 0
