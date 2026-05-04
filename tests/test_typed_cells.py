"""Integration tests for engine-typed Custom cell values.

The recalc loop in db.py constructs a fresh ``lotus.Sheet`` per call
and registers the ``lotus-datetime`` handler so ISO date strings
classify as ``Custom(jdate)`` and date arithmetic resolves to
``Custom(jspan)``. ``_split_typed`` / ``reconstruct_typed`` move the
``{type_tag, data}`` dict through the BLOB-affinity ``computed_value``
column under ``computed_value_kind = 'custom'``.

These tests prove the round-trip end-to-end through the HTTP cell-write
endpoint.
"""

from __future__ import annotations

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
        os.path.basename(tmp.name).replace(".db", "")
    )


async def make_sheet(ds, db_name):
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    return data["workbook"]["id"], data["sheet"]["id"]


async def post_cells(ds, db_name, wb_id, sheet_id, cells):
    return await ds.client.post(
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


async def cell_row(ds, db_name, sheet_id, row_idx, col_idx):
    """Return ``(computed_value, computed_value_kind)`` for one cell."""
    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT computed_value, computed_value_kind "
            "FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = ? AND col_idx = ?",
            [sheet_id, row_idx, col_idx],
        )
    ).first()
    if row is None:
        return None
    return (row["computed_value"], row["computed_value_kind"])


@pytest.mark.asyncio
async def test_iso_date_classifies_as_jdate():
    """Typing an ISO date in a cell stores a Custom(jdate) computed value."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    resp = await post_cells(ds, db_name, wb_id, sheet_id, [(0, 0, "2026-04-01")])
    assert resp.status_code == 200

    stored, kind = await cell_row(ds, db_name, sheet_id, 0, 0)
    assert kind == "custom"
    assert json.loads(stored) == {"type_tag": "jdate", "data": "2026-04-01"}


@pytest.mark.asyncio
async def test_date_subtraction_yields_jspan():
    """The end-goal demo: A1 - B1 = a span the engine renders as ISO duration."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    resp = await post_cells(
        ds,
        db_name,
        wb_id,
        sheet_id,
        [
            (0, 0, "2026-04-01"),
            (0, 1, "1990-01-01"),
            (0, 2, "=A1-B1"),
        ],
    )
    assert resp.status_code == 200

    a_stored, a_kind = await cell_row(ds, db_name, sheet_id, 0, 0)
    b_stored, b_kind = await cell_row(ds, db_name, sheet_id, 0, 1)
    c_stored, c_kind = await cell_row(ds, db_name, sheet_id, 0, 2)

    assert a_kind == "custom"
    assert json.loads(a_stored) == {"type_tag": "jdate", "data": "2026-04-01"}
    assert b_kind == "custom"
    assert json.loads(b_stored) == {"type_tag": "jdate", "data": "1990-01-01"}
    assert c_kind == "custom"
    parsed = json.loads(c_stored)
    assert parsed["type_tag"] == "jspan"
    # The engine returns ISO 8601 duration syntax. Don't assert the exact
    # string — `Pyears Mmonths Ddays` style — just that it carries days.
    assert parsed["data"].endswith("D")


@pytest.mark.asyncio
async def test_typed_value_roundtrips_through_recalc_unchanged():
    """A Custom cell that hasn't changed shouldn't trigger a needless write
    on a follow-up recalc. The (value, kind) change-detection short-circuit
    should treat ('"{...json...}"', 'custom') as equal across recalc passes.
    """
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await post_cells(ds, db_name, wb_id, sheet_id, [(0, 0, "2026-04-01")])
    first = await cell_row(ds, db_name, sheet_id, 0, 0)

    # Edit an unrelated cell — triggers a fresh recalc that re-reads A1.
    await post_cells(ds, db_name, wb_id, sheet_id, [(5, 5, "hello")])
    second = await cell_row(ds, db_name, sheet_id, 0, 0)

    assert first == second


@pytest.mark.asyncio
async def test_overwriting_date_with_plain_string_clears_kind():
    """Writing plain text over a date cell drops the 'custom' kind."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await post_cells(ds, db_name, wb_id, sheet_id, [(0, 0, "2026-04-01")])
    _stored, kind = await cell_row(ds, db_name, sheet_id, 0, 0)
    assert kind == "custom"

    await post_cells(ds, db_name, wb_id, sheet_id, [(0, 0, "not a date")])
    stored, kind = await cell_row(ds, db_name, sheet_id, 0, 0)
    assert kind is None
    assert stored == "not a date"


@pytest.mark.asyncio
async def test_force_string_write_survives_recalc():
    """A kind='string' write installs a typed override so the engine
    keeps the cell as a literal String even when raw_value would
    auto-classify as something else (here: a date)."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "2026-04-01",
                        "kind": "string",
                    }
                ]
            }
        ),
    )
    assert resp.status_code == 200

    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT typed_kind, typed_data, computed_value, computed_value_kind "
            "FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 0",
            [sheet_id],
        )
    ).first()
    assert row["typed_kind"] == "string"
    assert row["typed_data"] is None
    # Engine stored the typed value as a String, so computed_value is
    # the literal text — NOT a Custom(jdate, ...) dict.
    assert row["computed_value_kind"] is None
    assert row["computed_value"] == "2026-04-01"


@pytest.mark.asyncio
async def test_string_override_cleared_by_subsequent_raw_write():
    """A kind='raw' write opts back into auto-classification by
    clearing typed_kind/typed_data."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    # First: force as string.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "2026-04-01",
                        "kind": "string",
                    }
                ]
            }
        ),
    )

    # Second: same cell, kind='raw' (default). Engine should
    # auto-classify back to Custom(jdate).
    await post_cells(ds, db_name, wb_id, sheet_id, [(0, 0, "2026-04-01")])

    _stored, kind = await cell_row(ds, db_name, sheet_id, 0, 0)
    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT typed_kind, typed_data FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = 0 AND col_idx = 0",
            [sheet_id],
        )
    ).first()
    assert row["typed_kind"] is None
    assert row["typed_data"] is None
    # And the engine reclassified.
    assert kind == "custom"


@pytest.mark.asyncio
async def test_get_sheet_returns_typed_kind():
    """The sheet-load endpoint surfaces typed_kind so the frontend
    loadIntoEngine can reconstruct the typed override and the cell
    doesn't auto-classify back after reload."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 0,
                        "col_idx": 0,
                        "raw_value": "2026-04-01",
                        "kind": "string",
                    },
                    {
                        "row_idx": 0,
                        "col_idx": 1,
                        "raw_value": "2026-04-01",
                        "kind": "raw",
                    },
                ]
            }
        ),
    )

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}"
    )
    assert resp.status_code == 200
    body = resp.json()
    cells_by_col = {c["col_idx"]: c for c in body["cells"]}
    assert cells_by_col[0]["typed_kind"] == "string"
    assert cells_by_col[1]["typed_kind"] is None


@pytest.mark.asyncio
async def test_data_api_returns_custom_as_dict():
    """The /data endpoint runs computed_value through reconstruct_typed,
    so a Custom cell surfaces as a JSON object {type_tag, data} instead
    of the wire-stored JSON string."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, wb_id, sheet_id, [(0, 0, "2026-04-01")])

    # Range form
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data?range=A1:A1"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["rows"][0][0] == {"type_tag": "jdate", "data": "2026-04-01"}

    # Cell-by-id form
    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data/A1"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["computed_value"] == {"type_tag": "jdate", "data": "2026-04-01"}
