"""Per-route permission enforcement (phase-08/02).

These tests exercise the *route guards* directly over HTTP, with realistic
acl grants (no blanket ``sheets-view``/``sheets-edit`` config). They verify:

- the coarse ``datasette-sheets-access`` instance gate still gates everything,
- a Viewer can read a workbook's routes but not write them,
- an Editor can read and write,
- a non-grantee is denied both,
- a grant on workbook A does not leak to workbook B (cross-workbook isolation),
- the raw-ASGI SSE endpoint enforces ``sheets-view``.

Workbooks are created by an authenticated owner whose Manager grant is seeded
by hand here (the create-path auto-seed lands in phase-08/03); these tests
write grants explicitly via acl's ``grant`` helper so the guards are tested in
isolation from the create path.
"""

import json
import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_acl.grants import grant, Principal
from datasette_sheets.permissions import SHEETS_WORKBOOK_RESOURCE_TYPE


async def make_datasette():
    """Datasette with only the coarse gate granted (no blanket per-workbook)."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_name = os.path.basename(tmp.name).replace(".db", "")
    ds = Datasette(
        [tmp.name],
        config={"permissions": {"datasette-sheets-access": True}},
    )
    await ds.invoke_startup()
    return ds, db_name


def cookie(ds, actor_id):
    return {"ds_actor": ds.sign({"a": {"id": actor_id}}, "actor")}


async def create_workbook(ds, db_name, owner="owner", name="WB"):
    """Create a workbook + first sheet via the DB layer, seed the owner Manager.

    Created through ``SheetDB`` directly (not the HTTP create route) so these
    route-guard tests don't depend on phase-08/03's create-path auto-seed: we
    write the owner's Manager grant explicitly after creating.
    """
    from datasette_sheets.db import SheetDB

    db = SheetDB(ds.get_database(db_name))
    await db.ensure_migrations()
    wb = await db.create_workbook(name, actor_id=owner)
    await db.create_sheet(wb.id, "Sheet 1")
    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb.id),
        principal=Principal.actor(owner),
        role="Manager",
        by_actor=owner,
    )
    return wb.id


async def first_sheet_id(ds, db_name, wb_id, owner="owner"):
    r = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets",
        cookies=cookie(ds, owner),
    )
    assert r.status_code == 200, r.text
    return r.json()["sheets"][0]["id"]


# ---------------------------------------------------------------------------
# Coarse instance gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_coarse_gate_blocks_when_unset():
    # No datasette-sheets-access at all -> even listing is forbidden.
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_name = os.path.basename(tmp.name).replace(".db", "")
    ds = Datasette([tmp.name])
    await ds.invoke_startup()
    r = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks")
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Viewer / Editor / non-grantee on read + write routes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_viewer_can_read_not_write():
    ds, db_name = await make_datasette()
    wb_id = await create_workbook(ds, db_name)
    sheet_id = await first_sheet_id(ds, db_name, wb_id)

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("vic"),
        role="Viewer",
        by_actor="owner",
    )
    vic = cookie(ds, "vic")

    # Read routes: allowed.
    r = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}", cookies=vic)
    assert r.status_code == 200, r.text
    r = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/data",
        cookies=vic,
    )
    assert r.status_code == 200, r.text

    # Write route: forbidden.
    r = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        json={"changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "x"}]},
        cookies=vic,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_editor_can_read_and_write():
    ds, db_name = await make_datasette()
    wb_id = await create_workbook(ds, db_name)
    sheet_id = await first_sheet_id(ds, db_name, wb_id)

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("ed"),
        role="Editor",
        by_actor="owner",
    )
    ed = cookie(ds, "ed")

    r = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}", cookies=ed)
    assert r.status_code == 200, r.text

    r = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        json={"changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "42"}]},
        cookies=ed,
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_non_grantee_denied():
    ds, db_name = await make_datasette()
    wb_id = await create_workbook(ds, db_name)
    sheet_id = await first_sheet_id(ds, db_name, wb_id)

    stranger = cookie(ds, "stranger")
    # Read denied.
    r = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}", cookies=stranger
    )
    assert r.status_code == 403
    # Write denied.
    r = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        json={"changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "x"}]},
        cookies=stranger,
    )
    assert r.status_code == 403
    # HTML workbook page denied.
    r = await ds.client.get(f"/{db_name}/-/sheets/workbook/{wb_id}", cookies=stranger)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_owner_can_read_and_write():
    ds, db_name = await make_datasette()
    wb_id = await create_workbook(ds, db_name)
    sheet_id = await first_sheet_id(ds, db_name, wb_id)
    owner = cookie(ds, "owner")
    r = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_id}", cookies=owner)
    assert r.status_code == 200
    r = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        json={"changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "1"}]},
        cookies=owner,
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Cross-workbook isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grant_on_a_does_not_open_b():
    ds, db_name = await make_datasette()
    wb_a = await create_workbook(ds, db_name, name="A")
    wb_b = await create_workbook(ds, db_name, name="B")

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_a),
        principal=Principal.actor("ed"),
        role="Editor",
        by_actor="owner",
    )
    ed = cookie(ds, "ed")

    # ed can read A...
    r = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_a}", cookies=ed)
    assert r.status_code == 200
    # ...but not B.
    r = await ds.client.get(f"/{db_name}/-/sheets/api/workbooks/{wb_b}", cookies=ed)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# SSE endpoint enforces sheets-view
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sse_requires_view():
    ds, db_name = await make_datasette()
    wb_id = await create_workbook(ds, db_name)
    sheet_id = await first_sheet_id(ds, db_name, wb_id)

    # Stranger: SSE denied.
    r = await ds.client.get(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/events",
        cookies=cookie(ds, "stranger"),
    )
    assert r.status_code == 403
