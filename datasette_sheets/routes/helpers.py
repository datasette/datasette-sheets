from __future__ import annotations
import json
from ..broadcast import get_channel_manager
from ..db import SheetDB


def get_db(datasette, database_name: str) -> SheetDB:
    return SheetDB(datasette.get_database(database_name))


async def ensure_db(datasette, database_name: str) -> SheetDB:
    db = get_db(datasette, database_name)
    await db.ensure_migrations()
    return db


def actor_id(request) -> str | None:
    return request.actor.get("id") if request.actor else None


async def read_json_body(request) -> dict:
    return json.loads(await request.post_body())


async def emit_filter_change_if_any(
    db: SheetDB,
    sheet_id: str,
    before,
    *,
    client_id: str | None = None,
) -> None:
    """Compare the sheet's filter before / after a structural op
    and broadcast the matching SSE event:

    - filter present before, absent after  ⇒ ``filter-delete``
    - filter present in both, dict differs ⇒ ``filter-update``
    - no change                            ⇒ no event

    No-op when the sheet had no filter and still has none. Used by
    delete_rows / delete_columns / insert_columns / move_columns /
    move_rows so other clients pick up the bound shift without a
    refetch. ``client_id`` is the originating client — excluded
    from the broadcast so it doesn't echo its own change.
    """
    after = await db.get_filter(sheet_id)
    channel = get_channel_manager().get_channel(sheet_id)
    if before is None and after is None:
        return
    if before is not None and after is None:
        channel.publish(
            {"type": "filter-delete", "sheet_id": sheet_id},
            exclude_client=client_id,
        )
        return
    if after is None:
        return
    # Either before was None (filter newly visible — extremely rare,
    # would only happen if a concurrent client ran POST /filter/create
    # in the same window) OR before exists and the dict differs.
    if before is None or before.model_dump() != after.model_dump():
        channel.publish(
            {"type": "filter-update", "filter": after.model_dump()},
            exclude_client=client_id,
        )
