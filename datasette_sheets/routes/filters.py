"""HTTP routes for the per-sheet basic filter.

Phase A shipped read-only — `GET /filter` returns the current
filter or `null`. Phase B adds `/filter/create` + `/filter/delete`,
each broadcasting a matching SSE event so other clients pick up
the change without a refetch. Phase D will add `/filter/update`
(predicate writes), Phase E adds `/filter/sort`.
"""

from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..broadcast import get_channel_manager
from ..db import FilterAlreadyExists
from ..router import router, check_permission
from .data import parse_range
from .helpers import ensure_db
from .schemas import (
    CreateFilterBody,
    FilterResponse,
    GetFilterResponse,
    OkResponse,
    UpdateFilterBody,
)


@router.GET(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)/filter$",
    output=GetFilterResponse,
)
@check_permission()
async def get_filter(
    datasette, request, database: str, workbook_id: int, sheet_id: int
):
    db = await ensure_db(datasette, database)
    f = await db.get_filter(sheet_id)
    return Response.json({"filter": f.model_dump() if f else None})


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)/filter/create$",
    output=FilterResponse,
)
@check_permission()
async def create_filter(
    datasette,
    request,
    database: str,
    workbook_id: int,
    sheet_id: int,
    body: Annotated[CreateFilterBody, Body()],
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    bounds = parse_range(body.range)
    if not bounds:
        return Response.json({"error": f"Invalid range: {body.range}"}, status=400)
    min_row, min_col, max_row, max_col = bounds
    try:
        f = await db.create_filter(
            sheet_id,
            min_row=min_row,
            min_col=min_col,
            max_row=max_row,
            max_col=max_col,
        )
    except FilterAlreadyExists:
        return Response.json(
            {"error": "Filter already exists for this sheet"},
            status=409,
        )
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)

    payload = f.model_dump()
    get_channel_manager().get_channel(sheet_id).publish(
        {"type": "filter-create", "filter": payload},
        exclude_client=body.client_id,
    )
    return Response.json({"filter": payload}, status=201)


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)/filter/update$",
    output=FilterResponse,
)
@check_permission()
async def update_filter(
    datasette,
    request,
    database: str,
    workbook_id: int,
    sheet_id: int,
    body: Annotated[UpdateFilterBody, Body()],
):
    db = await ensure_db(datasette, database)
    # Exactly one ``set_*`` flag per request — keeps each call's
    # intent unambiguous on the wire (and easy to audit in tests).
    flags = sum([body.set_predicate, body.set_sort])
    if flags == 0:
        return Response.json({"error": "Nothing to update"}, status=400)
    if flags > 1:
        return Response.json(
            {"error": "Only one of set_predicate / set_sort per request"},
            status=400,
        )

    if body.set_predicate:
        if body.predicate_col_idx is None:
            return Response.json(
                {"error": "predicate_col_idx required when set_predicate=true"},
                status=400,
            )
        try:
            f = await db.update_filter_predicate(
                sheet_id,
                body.predicate_col_idx,
                body.predicate_hidden,
            )
        except ValueError as e:
            return Response.json({"error": str(e)}, status=400)
    else:
        # set_sort path. ``sort_col_idx = None`` clears the sort
        # (no physical reordering, just metadata reset). Otherwise
        # the helper physically reorders rows in the data range
        # via repeated move_rows calls.
        if body.sort_col_idx is None:
            await db._set_filter_sort_metadata(sheet_id, None, None)
            f = await db.get_filter(sheet_id)
            if f is None:
                return Response.json({"error": "No filter on this sheet"}, status=400)
        else:
            if body.sort_direction is None:
                return Response.json(
                    {"error": "sort_direction required when sort_col_idx is set"},
                    status=400,
                )
            try:
                f = await db.sort_filter(
                    sheet_id,
                    body.sort_col_idx,
                    body.sort_direction,
                )
            except ValueError as e:
                return Response.json({"error": str(e)}, status=400)

    payload = f.model_dump()
    get_channel_manager().get_channel(sheet_id).publish(
        {"type": "filter-update", "filter": payload},
        exclude_client=body.client_id,
    )
    return Response.json({"filter": payload})


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)/filter/delete$",
    output=OkResponse,
)
@check_permission()
async def delete_filter(
    datasette,
    request,
    database: str,
    workbook_id: int,
    sheet_id: int,
):
    db = await ensure_db(datasette, database)
    removed = await db.delete_filter(sheet_id)
    if not removed:
        return Response.json({"error": "Filter not found"}, status=404)
    get_channel_manager().get_channel(sheet_id).publish(
        {"type": "filter-delete", "sheet_id": sheet_id},
    )
    return Response.json({"ok": True})
