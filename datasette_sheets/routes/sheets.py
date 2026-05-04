from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..router import router, check_permission
from ..broadcast import get_channel_manager
from .helpers import ensure_db
from .schemas import (
    CreateSheetBody,
    GetSheetResponse,
    ListSheetsResponse,
    OkResponse,
    ReorderSheetsBody,
    ReorderSheetsResponse,
    SheetResponse,
    SheetWithColumnsResponse,
    UpdateSheetBody,
)


@router.GET(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets$",
    output=ListSheetsResponse,
)
@check_permission()
async def list_sheets(datasette, request, database: str, workbook_id: int):
    db = await ensure_db(datasette, database)
    sheets = await db.list_sheets(workbook_id)
    return Response.json(
        {
            "sheets": [
                {
                    "id": s.id,
                    "name": s.name,
                    "color": s.color,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                    "sort_order": s.sort_order,
                }
                for s in sheets
            ]
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/create$",
    output=SheetWithColumnsResponse,
)
@check_permission()
async def create_sheet(
    datasette,
    request,
    database: str,
    workbook_id: int,
    body: Annotated[CreateSheetBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.create_sheet(workbook_id, body.name, body.color)
    columns = await db.get_columns(sheet.id)
    return Response.json(
        {
            "sheet": {
                "id": sheet.id,
                "name": sheet.name,
                "color": sheet.color,
                "created_at": sheet.created_at,
                "updated_at": sheet.updated_at,
                "sort_order": sheet.sort_order,
            },
            "columns": [
                {"col_idx": c.col_idx, "name": c.name, "width": c.width}
                for c in columns
            ],
        },
        status=201,
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/reorder$",
    output=ReorderSheetsResponse,
)
@check_permission()
async def reorder_sheets(
    datasette,
    request,
    database: str,
    workbook_id: int,
    body: Annotated[ReorderSheetsBody, Body()],
):
    # Must be registered BEFORE the `/sheets/{sheet_id}$` GET below —
    # the router doesn't method-dispatch, so that regex would otherwise
    # match POST /sheets/reorder with sheet_id="reorder" and 404.
    db = await ensure_db(datasette, database)
    try:
        sheets = await db.reorder_sheets(workbook_id, body.sheet_ids)
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    return Response.json(
        {
            "sheets": [
                {
                    "id": s.id,
                    "name": s.name,
                    "color": s.color,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                    "sort_order": s.sort_order,
                }
                for s in sheets
            ]
        }
    )


@router.GET(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)$",
    output=GetSheetResponse,
)
@check_permission()
async def get_sheet(datasette, request, database: str, workbook_id: int, sheet_id: int):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    columns = await db.get_columns(sheet_id)
    cells = await db.get_cells(sheet_id)
    return Response.json(
        {
            "sheet": {
                "id": sheet.id,
                "name": sheet.name,
                "color": sheet.color,
                "created_at": sheet.created_at,
                "updated_at": sheet.updated_at,
                "sort_order": sheet.sort_order,
            },
            "columns": [
                {"col_idx": c.col_idx, "name": c.name, "width": c.width}
                for c in columns
            ],
            "cells": [
                {
                    "row_idx": c.row_idx,
                    "col_idx": c.col_idx,
                    "raw_value": c.raw_value,
                    "format_json": c.format_json,
                    # Surface typed_kind so reload can reconstruct the
                    # typed override on the local engine and the cell
                    # doesn't auto-classify back. typed_data isn't sent
                    # over the wire today — only force-text (typed_kind=
                    # 'string') is reachable from the API and that
                    # variant doesn't carry data. [sheet.cell.force-text]
                    "typed_kind": c.typed_kind,
                }
                for c in cells
            ],
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)/update$",
    output=SheetResponse,
)
@check_permission()
async def update_sheet(
    datasette,
    request,
    database: str,
    workbook_id: int,
    sheet_id: int,
    body: Annotated[UpdateSheetBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    kwargs = body.model_dump(exclude_none=True)
    updated = await db.update_sheet(sheet_id, **kwargs)
    manager = get_channel_manager()
    manager.get_channel(sheet_id).publish(
        {"type": "sheet-meta", "name": updated.name, "color": updated.color}
    )
    return Response.json(
        {
            "sheet": {
                "id": updated.id,
                "name": updated.name,
                "color": updated.color,
                "created_at": updated.created_at,
                "updated_at": updated.updated_at,
                "sort_order": updated.sort_order,
            }
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)/delete$",
    output=OkResponse,
)
@check_permission()
async def delete_sheet(
    datasette, request, database: str, workbook_id: int, sheet_id: int
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    await db.delete_sheet(sheet_id)
    return Response.json({"ok": True})
