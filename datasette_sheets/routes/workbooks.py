from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..router import router, check_permission
from .helpers import ensure_db, actor_id, read_json_body
from .schemas import UpdateWorkbookBody, WorkbookResponse

DB = r"/(?P<database>[^/]+)/-/sheets/api/workbooks"
WB = DB + r"/(?P<workbook_id>\d+)"


@router.GET(DB + r"$")
@check_permission()
async def list_workbooks(datasette, request, database: str):
    db = await ensure_db(datasette, database)
    workbooks = await db.list_workbooks()
    return Response.json(
        {
            "workbooks": [
                {
                    "id": w.id,
                    "name": w.name,
                    "created_at": w.created_at,
                    "updated_at": w.updated_at,
                    "sort_order": w.sort_order,
                }
                for w in workbooks
            ]
        }
    )


@router.POST(DB + r"/create" + r"$")
@check_permission()
async def create_workbook(datasette, request, database: str):
    db = await ensure_db(datasette, database)
    body = await read_json_body(request)
    workbook = await db.create_workbook(
        body.get("name", "Untitled Workbook"), actor_id=actor_id(request)
    )
    sheet = await db.create_sheet(workbook.id, "Sheet 1")
    return Response.json(
        {
            "workbook": {
                "id": workbook.id,
                "name": workbook.name,
                "created_at": workbook.created_at,
                "updated_at": workbook.updated_at,
            },
            "sheet": {"id": sheet.id, "name": sheet.name, "color": sheet.color},
        },
        status=201,
    )


@router.GET(WB + r"$")
@check_permission()
async def get_workbook(datasette, request, database: str, workbook_id: int):
    db = await ensure_db(datasette, database)
    workbook = await db.get_workbook(workbook_id)
    if not workbook:
        return Response.json({"error": "Workbook not found"}, status=404)
    sheets = await db.list_sheets(workbook_id)
    return Response.json(
        {
            "workbook": {
                "id": workbook.id,
                "name": workbook.name,
                "created_at": workbook.created_at,
                "updated_at": workbook.updated_at,
            },
            "sheets": [
                {
                    "id": s.id,
                    "name": s.name,
                    "color": s.color,
                    "sort_order": s.sort_order,
                }
                for s in sheets
            ],
        }
    )


# TODO: migrate to PATCH/DELETE when datasette-plugin-router adds support
@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/update$",
    output=WorkbookResponse,
)
@check_permission()
async def update_workbook(
    datasette,
    request,
    database: str,
    workbook_id: int,
    body: Annotated[UpdateWorkbookBody, Body()],
):
    db = await ensure_db(datasette, database)
    workbook = await db.get_workbook(workbook_id)
    if not workbook:
        return Response.json({"error": "Workbook not found"}, status=404)
    kwargs = body.model_dump(exclude_none=True)
    updated = await db.update_workbook(workbook_id, **kwargs)
    return Response.json(
        {
            "workbook": {
                "id": updated.id,
                "name": updated.name,
                "created_at": updated.created_at,
                "updated_at": updated.updated_at,
            }
        }
    )


@router.POST(WB + r"/delete" + r"$")
@check_permission()
async def delete_workbook(datasette, request, database: str, workbook_id: int):
    db = await ensure_db(datasette, database)
    workbook = await db.get_workbook(workbook_id)
    if not workbook:
        return Response.json({"error": "Workbook not found"}, status=404)
    await db.delete_workbook(workbook_id)
    return Response.json({"ok": True})
