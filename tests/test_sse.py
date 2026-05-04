"""Tests for SSE events endpoint and presence."""

import pytest
import json
import tempfile
import os
from datasette.app import Datasette
from datasette_sheets.broadcast import get_channel_manager


def make_datasette():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return Datasette(
        [tmp.name],
        config={"permissions": {"datasette-sheets-access": True}},
    ), os.path.basename(tmp.name).replace(".db", "")


async def create_workbook_and_sheet(ds, db_name):
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "Test"}),
    )
    data = resp.json()
    return data["workbook"]["id"], data["sheet"]["id"]


@pytest.mark.asyncio
async def test_cell_update_broadcasts():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    listener_queue = channel.subscribe("listener-client")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "client_id": "writer-client",
                "changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "Hello"}],
            }
        ),
    )
    assert resp.status_code == 200
    assert listener_queue.qsize() == 1
    event = listener_queue.get_nowait()
    assert event["type"] == "cell-update"
    assert event["changes"][0]["raw_value"] == "Hello"

    channel.unsubscribe("listener-client")
    manager.cleanup(sheet_id)


@pytest.mark.asyncio
async def test_cell_update_excludes_sender():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    sender_queue = channel.subscribe("my-client")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "client_id": "my-client",
                "changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "Hello"}],
            }
        ),
    )
    assert resp.status_code == 200
    assert sender_queue.qsize() == 0

    channel.unsubscribe("my-client")
    manager.cleanup(sheet_id)


@pytest.mark.asyncio
async def test_sheet_meta_update_broadcasts():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/update",
        content=json.dumps({"name": "Renamed!", "color": "#ff0000"}),
    )
    assert resp.status_code == 200
    assert queue.qsize() == 1
    event = queue.get_nowait()
    assert event["type"] == "sheet-meta"
    assert event["name"] == "Renamed!"

    channel.unsubscribe("listener")
    manager.cleanup(sheet_id)


@pytest.mark.asyncio
async def test_presence_broadcasts():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe("listener")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/presence",
        content=json.dumps(
            {"client_id": "user-a", "cursor": {"row": 3, "col": 2}, "selection": ["C4"]}
        ),
    )
    assert resp.status_code == 200
    assert queue.qsize() == 1
    event = queue.get_nowait()
    assert event["type"] == "presence"
    assert event["cursor"] == {"row": 3, "col": 2}

    channel.unsubscribe("listener")
    manager.cleanup(sheet_id)


@pytest.mark.asyncio
async def test_presence_excludes_sender():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    sender_queue = channel.subscribe("my-client")

    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/presence",
        content=json.dumps({"client_id": "my-client", "cursor": {"row": 0, "col": 0}}),
    )
    assert resp.status_code == 200
    assert sender_queue.qsize() == 0

    channel.unsubscribe("my-client")
    manager.cleanup(sheet_id)


@pytest.mark.asyncio
async def test_multi_client_broadcast():
    ds, db_name = make_datasette()
    wb_id, sheet_id = await create_workbook_and_sheet(ds, db_name)

    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    q_a = channel.subscribe("client-a")
    q_b = channel.subscribe("client-b")
    q_c = channel.subscribe("client-c")

    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "client_id": "client-a",
                "changes": [{"row_idx": 0, "col_idx": 0, "raw_value": "from A"}],
            }
        ),
    )

    assert q_a.qsize() == 0
    assert q_b.qsize() == 1
    assert q_c.qsize() == 1

    for cid in ["client-a", "client-b", "client-c"]:
        channel.unsubscribe(cid)
    manager.cleanup(sheet_id)
