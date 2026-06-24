"""Share button + dialog wiring and presence-via-profiles (phase-08/04).

The frontend Share button / <datasette-acl-share-dialog> embed is exercised in the
Svelte build; here we cover the server-side wiring that feeds it:

- the workbook page passes can-manage / self-actor / csrftoken into the page so
  the Share button (managers only) and the dialog can render,
- the datasette-acl-share JS/CSS bundle is included on the workbook page only,
- a round-trip grant through acl persists for the workbook resource,
- the presence builder resolves display/avatar via datasette.actors_from_ids
  (the single profiles directory), and shows a 🤖 badge for agents.
"""

import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_acl.grants import grant, list_grants, Principal
from datasette_sheets.db import SheetDB
from datasette_sheets.permissions import (
    SHEETS_WORKBOOK_RESOURCE_TYPE,
    SheetsWorkbookResource,
)
from datasette_sheets.routes.cells import _resolve_actor_info


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


async def make_workbook(ds, db_name, owner="owner"):
    db = SheetDB(ds.get_database(db_name))
    await db.ensure_migrations()
    wb = await db.create_workbook("WB", actor_id=owner)
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


# ---------------------------------------------------------------------------
# Workbook page wiring
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manager_page_exposes_share_wiring():
    ds, db_name = await make_datasette()
    wb_id = await make_workbook(ds, db_name, owner="owner")
    r = await ds.client.get(
        f"/{db_name}/-/sheets/workbook/{wb_id}", cookies=cookie(ds, "owner")
    )
    assert r.status_code == 200, r.text
    # Manager -> can-manage 1, self-actor present, csrftoken emitted.
    assert 'data-can-manage="1"' in r.text
    assert 'data-self-actor="owner"' in r.text
    assert "data-csrftoken=" in r.text


@pytest.mark.asyncio
async def test_viewer_page_hides_share():
    ds, db_name = await make_datasette()
    wb_id = await make_workbook(ds, db_name, owner="owner")
    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("vic"),
        role="Viewer",
        by_actor="owner",
    )
    r = await ds.client.get(
        f"/{db_name}/-/sheets/workbook/{wb_id}", cookies=cookie(ds, "vic")
    )
    assert r.status_code == 200, r.text
    # Viewer -> can-manage 0 (the Share button is hidden client-side).
    assert 'data-can-manage="0"' in r.text


@pytest.mark.asyncio
async def test_share_bundle_included_on_workbook_page_only():
    ds, db_name = await make_datasette()
    wb_id = await make_workbook(ds, db_name, owner="owner")

    # On the workbook page: the datasette-acl-share bundle is referenced.
    page = await ds.client.get(
        f"/{db_name}/-/sheets/workbook/{wb_id}", cookies=cookie(ds, "owner")
    )
    assert "datasette_acl_share" in page.text or "datasette-acl-share" in page.text

    # On the workbook *list* page: the bundle is NOT included.
    listing = await ds.client.get(f"/{db_name}/-/sheets", cookies=cookie(ds, "owner"))
    assert "datasette_acl_share" not in listing.text
    assert "datasette-acl-share" not in listing.text


# ---------------------------------------------------------------------------
# Round-trip grant persists for the workbook resource
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grant_roundtrip_persists():
    ds, db_name = await make_datasette()
    wb_id = await make_workbook(ds, db_name, owner="owner")

    # Simulate the dialog granting Editor to bob.
    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("bob"),
        role="Editor",
        by_actor="owner",
    )
    grants = await list_grants(ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(wb_id))
    by_actor = {g["actor_id"]: g["actions"] for g in grants}
    assert by_actor["bob"] == ["sheets-edit", "sheets-view"]
    # And it resolves through datasette.allowed for the workbook.
    assert await ds.allowed(
        action="sheets-edit",
        resource=SheetsWorkbookResource(db_name, wb_id),
        actor={"id": "bob"},
    )


# ---------------------------------------------------------------------------
# Share dialog read API (the data the <datasette-acl-share-dialog> fetches)
#
# Regression: workbooks live in *user* DBs, so SheetsWorkbookResource.resources_sql
# enumerates from acl's internal ``acl_resources`` table. If it returns nothing
# (the old stub), ``resource_exists`` is always False and acl's read endpoint
# 403s for everyone — the dialog can never load its people list. These exercise
# the endpoint end-to-end, which the rest of this module's grant-level tests
# didn't.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_workbook_resource_exists_after_grant():
    from datasette_acl.utils import resource_exists

    ds, db_name = await make_datasette()
    wb_id = await make_workbook(ds, db_name, owner="owner")
    # The owner Manager grant seeded an acl_resources row → the workbook "exists".
    assert await resource_exists(
        ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, str(wb_id)
    )
    # A made-up id does not.
    assert not await resource_exists(
        ds, SHEETS_WORKBOOK_RESOURCE_TYPE, db_name, "999999"
    )


async def make_workbook_with_collaborators():
    ds, db_name = await make_datasette()
    wb_id = await make_workbook(ds, db_name, owner="owner")
    await grant(
        ds,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        db_name,
        str(wb_id),
        principal=Principal.actor("bob"),
        role="Editor",
        by_actor="owner",
    )
    return ds, db_name, wb_id


@pytest.mark.asyncio
async def test_share_dialog_read_api_manager_sees_grants():
    ds, db_name, wb_id = await make_workbook_with_collaborators()
    r = await ds.client.get(
        f"/-/acl/api/resource/sheets-workbook/{db_name}/{wb_id}",
        cookies=cookie(ds, "owner"),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["can_manage"] is True
    actor_ids = {g.get("id") for g in data["grants"] if g["principal"] == "actor"}
    assert {"owner", "bob"} <= actor_ids


@pytest.mark.asyncio
async def test_share_dialog_read_api_forbidden_for_non_manager():
    ds, db_name, wb_id = await make_workbook_with_collaborators()
    # bob is an Editor, not a Manager — the read API gates on manage.
    r = await ds.client.get(
        f"/-/acl/api/resource/sheets-workbook/{db_name}/{wb_id}",
        cookies=cookie(ds, "bob"),
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Presence resolves via actors_from_ids
# ---------------------------------------------------------------------------


class _FakeRequest:
    def __init__(self, actor):
        self.actor = actor


@pytest.mark.asyncio
async def test_presence_uses_actors_from_ids(monkeypatch):
    ds, _ = await make_datasette()

    async def fake_actors_from_ids(actor_ids):
        return {
            "alice": {
                "id": "alice",
                "name": "Alice Liddell",
                "profile_picture_url": "/-/profile/pic/alice",
            }
        }

    monkeypatch.setattr(ds, "actors_from_ids", fake_actors_from_ids)
    info = await _resolve_actor_info(ds, _FakeRequest({"id": "alice"}))
    assert info["actor_id"] == "alice"
    assert info["display_name"] == "Alice Liddell"
    assert info["profile_picture_url"] == "/-/profile/pic/alice"


@pytest.mark.asyncio
async def test_presence_agent_gets_robot_badge(monkeypatch):
    ds, _ = await make_datasette()

    async def fake_actors_from_ids(actor_ids):
        return {
            "agent/bot7": {"id": "agent/bot7", "name": "Research Bot", "kind": "agent"}
        }

    monkeypatch.setattr(ds, "actors_from_ids", fake_actors_from_ids)
    info = await _resolve_actor_info(ds, _FakeRequest({"id": "agent/bot7"}))
    assert info["display_name"] == "🤖 Research Bot"


@pytest.mark.asyncio
async def test_presence_falls_back_to_actor_when_directory_empty(monkeypatch):
    ds, _ = await make_datasette()

    async def fake_actors_from_ids(actor_ids):
        # Default hook behaviour: just echoes {id: {"id": id}} with no name.
        return {aid: {"id": aid} for aid in actor_ids}

    monkeypatch.setattr(ds, "actors_from_ids", fake_actors_from_ids)
    info = await _resolve_actor_info(
        ds, _FakeRequest({"id": "carol", "name": "Carol from auth"})
    )
    # Falls back to the auth actor's name, then id.
    assert info["display_name"] == "Carol from auth"
    assert info["profile_picture_url"] is None
