"""Creator grant on create + upgrade backfill (phase-08/03).

DECISIONS.md: default access on upgrade is CLOSED (owner-only). The backfill
seeds ONLY the creator a Manager grant; it does NOT auto-grant _signed_in / '*'.
Existing collaborators must be explicitly re-granted.
"""

import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_acl.grants import list_grants
from datasette_sheets.db import SheetDB
from datasette_sheets.migrations import backfill_workbook_acls
from datasette_sheets.permissions import (
    SHEETS_WORKBOOK_RESOURCE_TYPE,
    SheetsWorkbookResource,
)


def cookie(ds, actor_id):
    return {"ds_actor": ds.sign({"a": {"id": actor_id}}, "actor")}


async def make_datasette():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_name = os.path.basename(tmp.name).replace(".db", "")
    ds = Datasette(
        [tmp.name],
        config={"permissions": {"datasette-sheets-access": True}},
    )
    await ds.invoke_startup()
    return ds, db_name


# ---------------------------------------------------------------------------
# Create path: creator becomes Manager
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_seeds_manager_for_creator():
    ds, db_name = await make_datasette()
    r = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        json={"name": "Mine"},
        cookies=cookie(ds, "alice"),
    )
    assert r.status_code == 201, r.text
    wb_id = r.json()["workbook"]["id"]
    res = SheetsWorkbookResource(db_name, wb_id)

    # Creator can view/edit/manage.
    for action in ("sheets-view", "sheets-edit", "sheets-manage"):
        assert await ds.allowed(action=action, resource=res, actor={"id": "alice"}), (
            action
        )
    # A stranger cannot.
    assert not await ds.allowed(action="sheets-view", resource=res, actor={"id": "bob"})
    # The grant is a Manager grant for alice and nobody else.
    grants = await list_grants(ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(wb_id))
    actor_grants = {g["actor_id"]: g["actions"] for g in grants}
    assert actor_grants == {"alice": ["sheets-edit", "sheets-manage", "sheets-view"]}


@pytest.mark.asyncio
async def test_create_anonymous_seeds_no_grant():
    ds, db_name = await make_datasette()
    # No actor cookie -> anonymous create. (Coarse gate is granted to all.)
    r = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        json={"name": "Anon"},
    )
    assert r.status_code == 201, r.text
    wb_id = r.json()["workbook"]["id"]
    grants = await list_grants(ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(wb_id))
    assert grants == []


# ---------------------------------------------------------------------------
# Backfill: CLOSED (owner-only), idempotent
# ---------------------------------------------------------------------------


async def _seed_legacy_workbooks(ds, db_name):
    """Create pre-existing workbooks directly via the DB layer (no acl grants).

    Simulates the pre-upgrade state: workbooks exist with created_by but no acl
    grants. We bypass the HTTP create route so the create-path auto-seed doesn't
    run.
    """
    db = SheetDB(ds.get_database(db_name))
    await db.ensure_migrations()
    wb_alice = await db.create_workbook("A", actor_id="alice")
    wb_bob = await db.create_workbook("B", actor_id="bob")
    wb_anon = await db.create_workbook("C", actor_id=None)
    return wb_alice.id, wb_bob.id, wb_anon.id


@pytest.mark.asyncio
async def test_backfill_grants_creator_manager_only():
    ds, db_name = await make_datasette()
    a_id, b_id, anon_id = await _seed_legacy_workbooks(ds, db_name)

    stats = await backfill_workbook_acls(ds, force=True)
    assert stats["skipped"] is False
    assert stats["owners"] == 2  # alice + bob; anon skipped
    assert stats["databases"] == 1

    # alice owns A (Manager), bob owns B (Manager).
    assert await ds.allowed(
        action="sheets-manage",
        resource=SheetsWorkbookResource(db_name, a_id),
        actor={"id": "alice"},
    )
    assert await ds.allowed(
        action="sheets-manage",
        resource=SheetsWorkbookResource(db_name, b_id),
        actor={"id": "bob"},
    )

    # CLOSED: no cross-grants, no general access.
    assert not await ds.allowed(
        action="sheets-view",
        resource=SheetsWorkbookResource(db_name, a_id),
        actor={"id": "bob"},
    )
    # _signed_in was NOT granted -> a random signed-in user has no access.
    assert not await ds.allowed(
        action="sheets-view",
        resource=SheetsWorkbookResource(db_name, a_id),
        actor={"id": "carol"},
    )
    # '*' was NOT granted -> anonymous has no access.
    assert not await ds.allowed(
        action="sheets-view",
        resource=SheetsWorkbookResource(db_name, a_id),
        actor=None,
    )

    # Anonymous-created workbook gets no owner grant (stays closed).
    grants = await list_grants(ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(anon_id))
    assert grants == []


@pytest.mark.asyncio
async def test_backfill_marker_short_circuits():
    ds, db_name = await make_datasette()
    await _seed_legacy_workbooks(ds, db_name)

    first = await backfill_workbook_acls(ds)  # marker-guarded (not forced)
    assert first["owners"] == 2
    assert first["databases"] == 1

    # Second run without force: marker already set -> nothing re-processed.
    second = await backfill_workbook_acls(ds)
    assert second["owners"] == 0
    assert second["databases"] == 0


@pytest.mark.asyncio
async def test_backfill_idempotent_under_force():
    ds, db_name = await make_datasette()
    a_id, _b, _c = await _seed_legacy_workbooks(ds, db_name)

    await backfill_workbook_acls(ds, force=True)
    grants_first = await list_grants(
        ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(a_id)
    )
    # Forced re-run must not duplicate grants.
    await backfill_workbook_acls(ds, force=True)
    grants_second = await list_grants(
        ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(a_id)
    )
    assert grants_first == grants_second
    assert grants_first == [
        {
            "principal": "actor",
            "actor_id": "alice",
            "group_id": None,
            "group_name": None,
            "actions": ["sheets-edit", "sheets-manage", "sheets-view"],
        }
    ]


@pytest.mark.asyncio
async def test_backfill_noop_without_workbook_table():
    """A database with no sheets data is left untouched and unmarked."""
    ds, db_name = await make_datasette()
    # No workbooks created -> _datasette_sheets_workbook doesn't exist yet.
    stats = await backfill_workbook_acls(ds, force=True)
    assert stats["databases"] == 0
    assert stats["owners"] == 0


@pytest.mark.asyncio
async def test_startup_runs_backfill():
    """The startup hook backfills pre-existing workbooks automatically."""
    # Create a DB with legacy workbooks using a throwaway Datasette, then point
    # a fresh Datasette at the same file and let startup run the backfill.
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_name = os.path.basename(tmp.name).replace(".db", "")

    seed_ds = Datasette(
        [tmp.name], config={"permissions": {"datasette-sheets-access": True}}
    )
    await seed_ds.invoke_startup()
    db = SheetDB(seed_ds.get_database(db_name))
    await db.ensure_migrations()
    wb = await db.create_workbook("Legacy", actor_id="alice")

    # Fresh instance over the same file: startup() should backfill alice -> Manager.
    ds = Datasette(
        [tmp.name], config={"permissions": {"datasette-sheets-access": True}}
    )
    await ds.invoke_startup()
    assert await ds.allowed(
        action="sheets-manage",
        resource=SheetsWorkbookResource(db_name, wb.id),
        actor={"id": "alice"},
    )
