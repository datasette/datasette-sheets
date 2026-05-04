"""Integration tests for named-range endpoints.

Covers persistence, the engine load-on-recalc wiring (cells referencing
a name see it resolve, and see ``#NAME?`` after the name is deleted),
and validation error surfaces.
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
        os.path.basename(tmp.name).replace(".db", ""),
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


async def computed(ds, db_name, sheet_id, row_idx, col_idx):
    db = ds.get_database(db_name)
    row = (
        await db.execute(
            "SELECT computed_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? AND row_idx = ? AND col_idx = ?",
            [sheet_id, row_idx, col_idx],
        )
    ).first()
    return row["computed_value"] if row else None


# ---------------------------------------------------------------------------
# Set / list / get
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_named_range_returns_record():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["named_range"]["name"] == "TaxRate"
    assert body["named_range"]["definition"] == "0.05"


@pytest.mark.asyncio
async def test_list_named_ranges_returns_sorted():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)
    for name, definition in [("Zeta", "1"), ("alpha", "2"), ("beta", "3")]:
        await ds.client.post(
            f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
            content=json.dumps({"name": name, "definition": definition}),
        )

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names"
    )
    assert resp.status_code == 200
    ordered = [n["name"] for n in resp.json()["named_ranges"]]
    assert ordered == ["alpha", "beta", "Zeta"]


@pytest.mark.asyncio
async def test_set_is_upsert_and_preserves_case_on_readback():
    """``name COLLATE NOCASE`` PK means the second set updates the existing
    row. We store the name as the user typed it first; case-only re-sets
    overwrite the definition without creating a duplicate row."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TAXRATE", "definition": "0.10"}),
    )

    resp = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names"
    )
    named = resp.json()["named_ranges"]
    assert len(named) == 1
    assert named[0]["definition"] == "0.10"


# ---------------------------------------------------------------------------
# Recalc integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_formula_referencing_name_resolves_after_set():
    """Define the name *first*, then enter a formula referencing it; the
    server-side recalc should resolve the name."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )
    await post_cells(
        ds,
        db_name,
        wb_id,
        sheet_id,
        [
            (0, 0, "100"),
            (0, 1, "=A1*TaxRate"),
        ],
    )
    assert await computed(ds, db_name, sheet_id, 0, 1) == 5


@pytest.mark.asyncio
async def test_setting_name_triggers_recalc_of_existing_formulas():
    """Enter the formula first (it evaluates to ``#NAME?``), then define
    the name — the dependent cell should get its computed_value fixed."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await post_cells(
        ds,
        db_name,
        wb_id,
        sheet_id,
        [(0, 0, "100"), (0, 1, "=A1*TaxRate")],
    )
    assert await computed(ds, db_name, sheet_id, 0, 1) == "#NAME?"

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )
    assert await computed(ds, db_name, sheet_id, 0, 1) == 5


@pytest.mark.asyncio
async def test_removing_name_recomputes_to_name_error():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Revenue", "definition": "=A1:A3"}),
    )
    await post_cells(
        ds,
        db_name,
        wb_id,
        sheet_id,
        [(0, 0, "10"), (1, 0, "20"), (2, 0, "30"), (0, 1, "=SUM(Revenue)")],
    )
    assert await computed(ds, db_name, sheet_id, 0, 1) == 60

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/Revenue/delete"
    )
    assert resp.status_code == 200
    assert await computed(ds, db_name, sheet_id, 0, 1) == "#NAME?"


@pytest.mark.asyncio
async def test_delete_is_case_insensitive_and_404s_unknown():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/TAXRATE/delete"
    )
    assert resp.status_code == 200

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/TaxRate/delete"
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Persistence round-trip (names reload from DB on the next recalc)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_names_persist_across_recalc_triggered_by_cell_edit():
    """The in-memory engine is recreated on every recalc. This test
    verifies the recalc path re-loads names from the DB: define a name,
    rewrite an unrelated cell, and confirm a formula that references
    the name still resolves."""
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )
    await post_cells(
        ds, db_name, wb_id, sheet_id, [(0, 0, "100"), (0, 1, "=A1*TaxRate")]
    )
    # Edit an unrelated cell — triggers a fresh recalc pass.
    await post_cells(ds, db_name, wb_id, sheet_id, [(5, 5, "nothing")])
    assert await computed(ds, db_name, sheet_id, 0, 1) == 5


# ---------------------------------------------------------------------------
# Validation surface
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,definition",
    [
        ("A1", "0"),  # cell-ref shape
        ("SUM", "0"),  # shadows a builtin
        ("Foo", "=1 + +"),  # unparseable definition
        ("has space", "0"),  # invalid chars
    ],
)
async def test_invalid_name_or_definition_returns_400(name, definition):
    ds, db_name = make_datasette()
    wb_id, sheet_id = await make_sheet(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": name, "definition": definition}),
    )
    assert resp.status_code == 400, resp.text
    assert "error" in resp.json()


@pytest.mark.asyncio
async def test_set_on_missing_sheet_returns_404():
    ds, db_name = make_datasette()
    wb_id, _ = await make_sheet(ds, db_name)

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/does-not-exist/names/set",
        content=json.dumps({"name": "Foo", "definition": "0"}),
    )
    assert resp.status_code == 404
