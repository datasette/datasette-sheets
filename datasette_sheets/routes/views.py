from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..router import router, check_permission
from .data import parse_range
from .helpers import ensure_db
from .schemas import (
    CreateViewBody,
    CreateViewResponse,
    ListViewsResponse,
    OkResponse,
)


@router.GET(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/views$",
    output=ListViewsResponse,
)
@check_permission()
async def list_views(
    datasette, request, database: str, workbook_id: str, sheet_id: str
):
    db = await ensure_db(datasette, database)
    views = await db.list_views(sheet_id)
    return Response.json(
        {
            "views": [
                {
                    "id": v.id,
                    "view_name": v.view_name,
                    "range_str": v.range_str,
                    "min_row": v.min_row,
                    "min_col": v.min_col,
                    "max_row": v.max_row,
                    "max_col": v.max_col,
                    "use_headers": bool(v.use_headers),
                    "color": v.color,
                    "enable_insert": bool(v.enable_insert),
                    "enable_update": bool(v.enable_update),
                    "enable_delete": bool(v.enable_delete),
                    "delete_mode": v.delete_mode,
                }
                for v in views
            ]
        }
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/views/create$",
    output=CreateViewResponse,
)
@check_permission()
async def create_view(
    datasette,
    request,
    database: str,
    workbook_id: str,
    sheet_id: str,
    body: Annotated[CreateViewBody, Body()],
):
    db = await ensure_db(datasette, database)
    bounds = parse_range(body.range)
    if not bounds:
        return Response.json({"error": f"Invalid range: {body.range}"}, status=400)
    min_row, min_col, max_row, max_col = bounds
    try:
        view = await db.create_view(
            sheet_id=sheet_id,
            view_name=body.view_name.strip(),
            range_str=body.range.upper(),
            min_row=min_row,
            min_col=min_col,
            max_row=max_row,
            max_col=max_col,
            use_headers=body.use_headers,
            enable_insert=body.enable_insert,
            enable_update=body.enable_update,
            enable_delete=body.enable_delete,
            delete_mode=body.delete_mode,
        )
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    return Response.json(
        {
            "view": {
                "id": view.id,
                "view_name": view.view_name,
                "range_str": view.range_str,
                "min_row": view.min_row,
                "min_col": view.min_col,
                "max_row": view.max_row,
                "max_col": view.max_col,
                "use_headers": bool(view.use_headers),
                "color": view.color,
                "enable_insert": bool(view.enable_insert),
                "enable_update": bool(view.enable_update),
                "enable_delete": bool(view.enable_delete),
                "delete_mode": view.delete_mode,
            }
        },
        status=201,
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>[^/]+)/sheets/(?P<sheet_id>[^/]+)/views/(?P<view_id>[^/]+)/delete$",
    output=OkResponse,
)
@check_permission()
async def delete_view(
    datasette, request, database: str, workbook_id: str, sheet_id: str, view_id: str
):
    db = await ensure_db(datasette, database)
    await db.delete_view(view_id)
    return Response.json({"ok": True})
