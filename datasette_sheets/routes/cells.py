from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..router import router, check_permission
from ..broadcast import get_channel_manager
from ..db import CellChange
from .helpers import ensure_db, actor_id, emit_filter_change_if_any
from .schemas import (
    DeleteColumnsBody,
    DeleteColumnsResponse,
    DeleteRowsBody,
    DeleteRowsResponse,
    InsertColumnsBody,
    InsertColumnsResponse,
    MoveColumnsBody,
    MoveColumnsResponse,
    MoveRowsBody,
    MoveRowsResponse,
    OkResponse,
    PresenceBody,
    UpdateCellsBody,
    UpdateCellsResponse,
    UpdateColumnsBody,
    UpdateColumnsResponse,
)


PRESENCE_COLORS = [
    "#e74c3c",
    "#3498db",
    "#2ecc71",
    "#f39c12",
    "#9b59b6",
    "#1abc9c",
    "#e67e22",
    "#e91e63",
    "#00bcd4",
    "#8bc34a",
]


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/cells$",
    output=UpdateCellsResponse,
)
@check_permission()
async def update_cells(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[UpdateCellsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    # Broadcast before DB write for low latency
    manager = get_channel_manager()
    manager.get_channel(sheet_id).publish(
        {
            "type": "cell-update",
            "changes": [
                {
                    "row_idx": c.row_idx,
                    "col_idx": c.col_idx,
                    "raw_value": c.raw_value,
                    "format_json": c.format_json,
                    # Echo the kind discriminator so other clients can
                    # apply the typed override locally — without it,
                    # a force-text cell would auto-classify on the
                    # remote side. [sheet.cell.force-text]
                    "kind": c.kind,
                }
                for c in body.changes
            ],
            "actor": actor_id(request),
        },
        exclude_client=body.client_id,
    )
    changes = [
        CellChange(
            row_idx=c.row_idx,
            col_idx=c.col_idx,
            raw_value=c.raw_value,
            format_json=c.format_json,
            kind=c.kind,
        )
        for c in body.changes
    ]
    # [sheet.filter.auto-expand] Read filter state before set_cells
    # so the helper can detect a max_row bump as a delta.
    filter_before = await db.get_filter(sheet_id)
    cells = await db.set_cells(sheet_id, changes, actor_id=actor_id(request))
    await emit_filter_change_if_any(
        db, sheet_id, filter_before, client_id=body.client_id
    )
    return Response.json(
        {
            "cells": [
                {
                    "row_idx": c.row_idx,
                    "col_idx": c.col_idx,
                    "raw_value": c.raw_value,
                    "format_json": c.format_json,
                    "typed_kind": c.typed_kind,
                }
                for c in cells
            ]
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/columns$",
    output=UpdateColumnsResponse,
)
@check_permission()
async def update_columns(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[UpdateColumnsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    for col in body.columns:
        await db.set_column(
            sheet_id,
            col_idx=col.col_idx,
            name=col.name,
            width=col.width,
        )
    columns = await db.get_columns(sheet_id)
    return Response.json(
        {
            "columns": [
                {"col_idx": c.col_idx, "name": c.name, "width": c.width}
                for c in columns
            ]
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/rows/delete$",
    output=DeleteRowsResponse,
)
@check_permission()
async def delete_rows(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[DeleteRowsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    filter_before = await db.get_filter(sheet_id)
    deleted = await db.delete_rows(sheet_id, body.row_indices)
    if deleted:
        # Tell every other client to apply the same shift locally.
        get_channel_manager().get_channel(sheet_id).publish(
            {
                "type": "rows-deleted",
                "row_indices": deleted,
                "actor": actor_id(request),
            },
            exclude_client=body.client_id,
        )
        await emit_filter_change_if_any(
            db, sheet_id, filter_before, client_id=body.client_id
        )
    return Response.json({"deleted": deleted})


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/columns/delete$",
    output=DeleteColumnsResponse,
)
@check_permission()
async def delete_columns(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[DeleteColumnsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    filter_before = await db.get_filter(sheet_id)
    deleted = await db.delete_columns(sheet_id, body.col_indices)
    if deleted:
        get_channel_manager().get_channel(sheet_id).publish(
            {
                "type": "columns-deleted",
                "col_indices": deleted,
                "actor": actor_id(request),
            },
            exclude_client=body.client_id,
        )
        await emit_filter_change_if_any(
            db, sheet_id, filter_before, client_id=body.client_id
        )
    return Response.json({"deleted": deleted})


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/columns/insert$",
    output=InsertColumnsResponse,
)
@check_permission()
async def insert_columns(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[InsertColumnsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    filter_before = await db.get_filter(sheet_id)
    inserted = await db.insert_columns(sheet_id, body.at, body.count)
    if inserted:
        get_channel_manager().get_channel(sheet_id).publish(
            {
                "type": "columns-inserted",
                "col_indices": inserted,
                "actor": actor_id(request),
            },
            exclude_client=body.client_id,
        )
        await emit_filter_change_if_any(
            db, sheet_id, filter_before, client_id=body.client_id
        )
    return Response.json({"inserted": inserted})


# [sheet.column.drag-reorder]
@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/columns/move$",
    output=MoveColumnsResponse,
)
@check_permission()
async def move_columns(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[MoveColumnsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    filter_before = await db.get_filter(sheet_id)
    try:
        moved = await db.move_columns(
            sheet_id, body.src_start, body.src_end, body.dest_gap
        )
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    if moved is not None:
        get_channel_manager().get_channel(sheet_id).publish(
            {
                "type": "columns-moved",
                "src_start": moved["src_start"],
                "src_end": moved["src_end"],
                "final_start": moved["final_start"],
                "width": moved["width"],
                "actor": actor_id(request),
            },
            exclude_client=body.client_id,
        )
        await emit_filter_change_if_any(
            db, sheet_id, filter_before, client_id=body.client_id
        )
    return Response.json({"moved": moved})


# [sheet.row.drag-reorder]
@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/rows/move$",
    output=MoveRowsResponse,
)
@check_permission()
async def move_rows(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[MoveRowsBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    filter_before = await db.get_filter(sheet_id)
    try:
        moved = await db.move_rows(
            sheet_id, body.src_start, body.src_end, body.dest_gap
        )
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    if moved is not None:
        get_channel_manager().get_channel(sheet_id).publish(
            {
                "type": "rows-moved",
                "src_start": moved["src_start"],
                "src_end": moved["src_end"],
                "final_start": moved["final_start"],
                "width": moved["width"],
                "actor": actor_id(request),
            },
            exclude_client=body.client_id,
        )
        await emit_filter_change_if_any(
            db, sheet_id, filter_before, client_id=body.client_id
        )
    return Response.json({"moved": moved})


async def _resolve_actor_info(datasette, request) -> dict:
    actor = request.actor or {}
    aid = actor.get("id", "anonymous")
    display_name = actor.get("name") or aid
    pfp = actor.get("profile_picture_url")
    try:
        from datasette_user_profiles.routes.pages import get_profile

        profile = await get_profile(datasette, aid)
        if profile.display_name:
            display_name = profile.display_name
        if not pfp and profile.has_photo:
            pfp = datasette.urls.path(f"/-/profile/pic/{aid}")
    except (ImportError, Exception):
        pass
    return {
        "actor_id": aid,
        "display_name": display_name,
        "profile_picture_url": pfp,
        "color": PRESENCE_COLORS[hash(aid) % len(PRESENCE_COLORS)],
    }


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/presence$",
    output=OkResponse,
)
@check_permission()
async def presence(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[PresenceBody, Body()],
):
    info = await _resolve_actor_info(datasette, request)
    manager = get_channel_manager()
    manager.get_channel(sheet_id).publish(
        {
            "type": "presence",
            "actor": info["actor_id"],
            "display_name": info["display_name"],
            "profile_picture_url": info["profile_picture_url"],
            "cursor": body.cursor.model_dump() if body.cursor else None,
            "selection": body.selection,
            "color": info["color"],
        },
        exclude_client=body.client_id,
    )
    return Response.json({"ok": True})
