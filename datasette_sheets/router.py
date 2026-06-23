from datasette import Forbidden
from datasette_plugin_router import Router
from functools import wraps

from .permissions import (
    GLOBAL_PERMISSION_NAME,
    can_use_sheets,
    can_view_workbook,
    can_edit_workbook,
    can_manage_workbook,
)

router = Router()

# Backwards-compatible alias — the original coarse instance gate. Kept as a
# module-level name because the SSE handler and the HTML pages import it.
PERMISSION_NAME = GLOBAL_PERMISSION_NAME


async def _resolve_workbook_id(datasette, request, kwargs):
    """Pull the workbook id out of the matched route.

    datasette-plugin-router injects path params as keyword args to the view, so
    ``workbook_id`` is normally in ``kwargs``; fall back to ``request.url_vars``
    for handlers that don't declare it as a parameter.
    """
    wb = kwargs.get("workbook_id")
    if wb is None and request is not None:
        wb = request.url_vars.get("workbook_id")
    return None if wb is None else int(wb)


async def _resolve_database(datasette, request, kwargs):
    db = kwargs.get("database")
    if db is None and request is not None:
        db = request.url_vars.get("database")
    return db


def check_permission(action: str = "view"):
    """Gate a route on the coarse instance gate + a per-workbook check.

    ``action`` selects the per-workbook capability required:

    - ``"view"``   → ``sheets-view``   (read routes)
    - ``"edit"``   → ``sheets-edit``   (write routes)
    - ``"manage"`` → ``sheets-manage`` (sharing)
    - ``"use"``    → coarse gate only; no per-workbook check. Used by routes
      that have no specific workbook in scope yet — listing workbooks and
      creating a brand-new workbook.

    Every route first passes the coarse ``datasette-sheets-access`` gate
    (Option A, kept as a "can use sheets at all" instance switch); the
    per-workbook ``sheets-view`` / ``sheets-edit`` / ``sheets-manage`` check is
    then layered on top against ``SheetsWorkbookResource(database, workbook_id)``.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(datasette, request, **kwargs):
            actor = request.actor
            # Outer coarse gate — "can use sheets at all".
            if not await can_use_sheets(datasette, actor):
                raise Forbidden("Permission denied")

            if action != "use":
                database = await _resolve_database(datasette, request, kwargs)
                workbook_id = await _resolve_workbook_id(datasette, request, kwargs)
                # A workbook-scoped route with no workbook id is a routing bug;
                # deny rather than silently skipping the per-workbook check.
                if database is None or workbook_id is None:
                    raise Forbidden("Permission denied")
                if action == "view":
                    allowed = await can_view_workbook(
                        datasette, actor, database, workbook_id
                    )
                elif action == "edit":
                    allowed = await can_edit_workbook(
                        datasette, actor, database, workbook_id
                    )
                elif action == "manage":
                    allowed = await can_manage_workbook(
                        datasette, actor, database, workbook_id
                    )
                else:  # pragma: no cover - guarded by callers
                    raise ValueError(f"Unknown permission action: {action!r}")
                if not allowed:
                    raise Forbidden("Permission denied")

            return await func(datasette=datasette, request=request, **kwargs)

        return wrapper

    return decorator
