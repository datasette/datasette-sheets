"""Tests for the acl-backed sheets-workbook resource model (phase-08/01).

Covers the new per-workbook resource / actions / roles added on top of the
coarse ``datasette-sheets-access`` instance gate (kept as Option A). These
exercise the path the route guards (task 02) switch onto:
``datasette.allowed(action="sheets-edit", resource=SheetsWorkbookResource(db,
workbook_id), ...)`` resolving against datasette-acl grants written via acl's
``datasette_acl.grants.grant`` helper.
"""

import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_sheets.permissions import (
    GLOBAL_PERMISSION_NAME,
    SHEETS_WORKBOOK_ACTIONS,
    SHEETS_WORKBOOK_RESOURCE_TYPE,
    SheetsWorkbookResource,
)


async def make_datasette():
    """Datasette with a writable temp DB + the coarse gate granted, acl loaded."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_name = os.path.basename(tmp.name).replace(".db", "")
    ds = Datasette(
        [tmp.name],
        config={"permissions": {GLOBAL_PERMISSION_NAME: True}},
    )
    await ds.invoke_startup()
    return ds, db_name


async def _create_workbook(ds, db_name, name="WB"):
    import json

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": name}),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["workbook"]["id"]


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_actions_registered():
    ds, _ = await make_datasette()
    # The coarse instance gate is still present (Option A).
    assert GLOBAL_PERMISSION_NAME in ds.actions
    assert ds.actions[GLOBAL_PERMISSION_NAME].resource_class is None
    # The per-workbook actions are registered against the resource.
    for action in SHEETS_WORKBOOK_ACTIONS:
        assert action in ds.actions, f"{action} not registered"
        assert ds.actions[action].resource_class is SheetsWorkbookResource


@pytest.mark.asyncio
async def test_roles_registered():
    ds, _ = await make_datasette()
    from datasette_acl.roles import build_roles_registry

    registry = build_roles_registry(ds)
    roles = registry.get(SHEETS_WORKBOOK_RESOURCE_TYPE)
    assert roles, "sheets-workbook roles not in acl registry"
    by_name = {r.name: r for r in roles}
    assert set(by_name) == {"Viewer", "Editor", "Manager"}
    assert by_name["Viewer"].actions == ["sheets-view"]
    assert by_name["Editor"].actions == ["sheets-view", "sheets-edit"]
    assert by_name["Manager"].actions == [
        "sheets-view",
        "sheets-edit",
        "sheets-manage",
    ]
    assert (
        by_name["Viewer"].rank,
        by_name["Editor"].rank,
        by_name["Manager"].rank,
    ) == (1, 2, 3)
    assert by_name["Manager"].manage is True
    assert by_name["Viewer"].manage is False
    assert by_name["Editor"].manage is False


# ---------------------------------------------------------------------------
# Resource construction + build_resource roundtrip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resource_construction_parent_child():
    res = SheetsWorkbookResource("mydb", 42)
    assert res.parent == "mydb"
    assert res.child == "42"


@pytest.mark.asyncio
async def test_build_resource_roundtrips_via_acl():
    from datasette_acl.utils import build_resource

    ds, _ = await make_datasette()
    res = build_resource(ds, SHEETS_WORKBOOK_RESOURCE_TYPE, "mydb", "7")
    assert isinstance(res, SheetsWorkbookResource)
    assert res.parent == "mydb"
    assert res.child == "7"


# ---------------------------------------------------------------------------
# Grants resolve via datasette.allowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_editor_grant_allows_view_and_edit():
    from datasette_acl.grants import grant, Principal

    ds, db_name = await make_datasette()
    wb_id = await _create_workbook(ds, db_name)
    res = SheetsWorkbookResource(db_name, wb_id)

    # Before any grant, bob has nothing.
    assert not await ds.allowed(action="sheets-view", resource=res, actor={"id": "bob"})
    assert not await ds.allowed(action="sheets-edit", resource=res, actor={"id": "bob"})

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("bob"),
        role="Editor",
        by_actor="alice",
    )

    assert await ds.allowed(action="sheets-view", resource=res, actor={"id": "bob"})
    assert await ds.allowed(action="sheets-edit", resource=res, actor={"id": "bob"})
    # Editor does not grant manage.
    assert not await ds.allowed(
        action="sheets-manage", resource=res, actor={"id": "bob"}
    )


@pytest.mark.asyncio
async def test_viewer_grant_allows_view_not_edit():
    from datasette_acl.grants import grant, Principal

    ds, db_name = await make_datasette()
    wb_id = await _create_workbook(ds, db_name)
    res = SheetsWorkbookResource(db_name, wb_id)

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("carol"),
        role="Viewer",
        by_actor="alice",
    )

    assert await ds.allowed(action="sheets-view", resource=res, actor={"id": "carol"})
    assert not await ds.allowed(
        action="sheets-edit", resource=res, actor={"id": "carol"}
    )


@pytest.mark.asyncio
async def test_manager_grant_allows_all_three():
    from datasette_acl.grants import grant, Principal

    ds, db_name = await make_datasette()
    wb_id = await _create_workbook(ds, db_name)
    res = SheetsWorkbookResource(db_name, wb_id)

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("dave"),
        role="Manager",
        by_actor="alice",
    )

    for action in ("sheets-view", "sheets-edit", "sheets-manage"):
        assert await ds.allowed(action=action, resource=res, actor={"id": "dave"}), (
            action
        )


@pytest.mark.asyncio
async def test_grant_scoped_to_specific_workbook():
    """A grant on one workbook must not leak to another workbook."""
    from datasette_acl.grants import grant, Principal

    ds, db_name = await make_datasette()
    wb_a = await _create_workbook(ds, db_name, name="A")
    wb_b = await _create_workbook(ds, db_name, name="B")

    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_a),
        principal=Principal.actor("bob"),
        role="Editor",
        by_actor="alice",
    )

    assert await ds.allowed(
        action="sheets-edit",
        resource=SheetsWorkbookResource(db_name, wb_a),
        actor={"id": "bob"},
    )
    assert not await ds.allowed(
        action="sheets-edit",
        resource=SheetsWorkbookResource(db_name, wb_b),
        actor={"id": "bob"},
    )
