from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..router import router, check_permission
from .helpers import ensure_db
from .schemas import (
    ListNamedRangesResponse,
    OkResponse,
    SetNamedRangeBody,
    SetNamedRangeResponse,
)


@router.GET(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/names$",
    output=ListNamedRangesResponse,
)
@check_permission()
async def list_named_ranges(
    datasette, request, database: str, workbook_id: str, sheet_id: str
):
    db = await ensure_db(datasette, database)
    names = await db.list_named_ranges(sheet_id)
    return Response.json(
        {
            "named_ranges": [
                {
                    "name": n.name,
                    "definition": n.definition,
                    "updated_at": n.updated_at,
                }
                for n in names
            ]
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/names/set$",
    output=SetNamedRangeResponse,
)
@check_permission()
async def set_named_range(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[SetNamedRangeBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    try:
        nr = await db.set_named_range(sheet_id, body.name, body.definition)
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    return Response.json(
        {
            "named_range": {
                "name": nr.name,
                "definition": nr.definition,
                "updated_at": nr.updated_at,
            }
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/names/(?P<name>[^/]+)/delete$",
    output=OkResponse,
)
@check_permission()
async def delete_named_range(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    name: str,
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    removed = await db.delete_named_range(sheet_id, name)
    if not removed:
        return Response.json({"error": "Named range not found"}, status=404)
    return Response.json({"ok": True})
