"""Workbook-scoped dropdown-rule CRUD.

Routes mirror ``named_ranges.py`` but live at the workbook level
(``/api/workbooks/<wbId>/dropdown-rules/...``) so a single rule can
be referenced from any sheet in the workbook. Strict-mode-only in
v1; the cell-write validator in ``db.py::set_cells`` rejects values
that aren't in the rule's option list. [sheet.data.dropdown]
"""

import json
from typing import Annotated

from datasette import Response
from datasette_plugin_router import Body

from ..router import router, check_permission
from .helpers import ensure_db
from .schemas import (
    CreateDropdownRuleBody,
    DropdownRuleResponse,
    ListDropdownRulesResponse,
    OkResponse,
    UpdateDropdownRuleBody,
)


def _serialize(row) -> dict:
    """Adapt a codegened ``DropdownRule`` row to the JSON payload
    shape. ``options_json`` is decoded back to the list-of-objects
    surface the frontend expects under ``source.options``."""
    try:
        options = json.loads(row.options_json) if row.options_json else []
    except json.JSONDecodeError:
        options = []
    return {
        "id": row.id,
        "name": row.name,
        "multi": bool(row.multi),
        "source": {"kind": "list", "options": options},
    }


@router.GET(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/dropdown-rules$",
    output=ListDropdownRulesResponse,
)
@check_permission()
async def list_dropdown_rules(
    datasette, request, database: str, workbook_id: int
):
    db = await ensure_db(datasette, database)
    rules = await db.list_dropdown_rules(workbook_id)
    return Response.json(
        {"dropdown_rules": [_serialize(r) for r in rules]}
    )


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/dropdown-rules/create$",
    output=DropdownRuleResponse,
)
@check_permission()
async def create_dropdown_rule(
    datasette,
    request,
    database: str,
    workbook_id: int,
    body: Annotated[CreateDropdownRuleBody, Body()],
):
    db = await ensure_db(datasette, database)
    workbook = await db.get_workbook(workbook_id)
    if not workbook:
        return Response.json({"error": "Workbook not found"}, status=404)
    try:
        rule = await db.create_dropdown_rule(
            workbook_id,
            body.name,
            body.multi,
            [o.model_dump() for o in body.options],
        )
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    return Response.json({"dropdown_rule": _serialize(rule)})


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/dropdown-rules/(?P<rule_id>\d+)/update$",
    output=DropdownRuleResponse,
)
@check_permission()
async def update_dropdown_rule(
    datasette,
    request,
    database: str,
    workbook_id: int,
    rule_id: int,
    body: Annotated[UpdateDropdownRuleBody, Body()],
):
    db = await ensure_db(datasette, database)
    try:
        rule = await db.update_dropdown_rule(
            workbook_id,
            rule_id,
            name=body.name,
            name_set=body.name_set,
            multi=body.multi,
            options=(
                [o.model_dump() for o in body.options]
                if body.options is not None
                else None
            ),
        )
    except ValueError as e:
        return Response.json({"error": str(e)}, status=400)
    if rule is None:
        return Response.json({"error": "Dropdown rule not found"}, status=404)
    return Response.json({"dropdown_rule": _serialize(rule)})


@router.POST(
    r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/dropdown-rules/(?P<rule_id>\d+)/delete$",
    output=OkResponse,
)
@check_permission()
async def delete_dropdown_rule(
    datasette, request, database: str, workbook_id: int, rule_id: int
):
    db = await ensure_db(datasette, database)
    removed = await db.delete_dropdown_rule(workbook_id, rule_id)
    if not removed:
        return Response.json({"error": "Dropdown rule not found"}, status=404)
    return Response.json({"ok": True})
