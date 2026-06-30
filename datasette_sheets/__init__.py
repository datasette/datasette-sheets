from datasette import hookimpl, Forbidden, Response
from datasette.permissions import Action
from datasette_vite import vite_entry
from .router import router, PERMISSION_NAME
from .routes.sse import api_events
from .db import SheetDB
from .permissions import (  # noqa: F401
    SheetsWorkbookResource,
    SHEETS_WORKBOOK_RESOURCE_TYPE,
    sheets_workbook_roles,
    can_use_sheets,
    can_view_workbook,
    can_manage_workbook,
)
import re

# datasette-acl-share is a hard dependency: the workbook page always hosts the
# <datasette-acl-share-dialog>, so its asset helper is always importable.
from datasette_acl_share import datasette_share_assets as _share_assets

# The workbook page is the only sheets page that hosts <datasette-acl-share-dialog>,
# so the share bundle is included there (opt-in) rather than site-wide. Matches
# ``/<db>/-/sheets/workbook/<id>`` exactly.
_WORKBOOK_PAGE_RE = re.compile(r"^/[^/]+/-/sheets/workbook/\d+$")


def _is_workbook_page(request) -> bool:
    return bool(request and _WORKBOOK_PAGE_RE.match(request.path or ""))


# Import route modules to trigger decorator registration
from . import routes  # noqa: F401

# datasette-paper integration. Importing the hookimpl into this module's
# namespace is what registers it on Datasette's plugin manager — a no-op unless
# datasette-paper is installed and owns the `paper_embed_provider` spec.
from .paper import paper_embed_provider  # noqa: F401


@hookimpl
def extra_template_vars(datasette):
    return {
        "datasette_sheets_vite_entry": vite_entry(
            datasette=datasette,
            plugin_package="datasette_sheets",
        ),
    }


@hookimpl
def extra_js_urls(datasette, request):
    """Include the <datasette-acl-share-dialog> JS bundle on the workbook page only."""
    if not _is_workbook_page(request):
        return []
    return _share_assets(datasette)["js"]


@hookimpl
def extra_css_urls(datasette, request):
    """Include the <datasette-acl-share-dialog> CSS on the workbook page only."""
    if not _is_workbook_page(request):
        return []
    return _share_assets(datasette)["css"]


async def workbook_list_page(datasette, request):
    database = request.url_vars["database"]
    # Coarse instance gate only — the listing page itself isn't workbook-scoped.
    # Per-workbook view enforcement happens when a workbook is opened
    # (workbook_page + the API routes). Filtering the list down to only the
    # workbooks the actor can view is a future enhancement (needs cross-DB
    # resource enumeration; see permissions.py resources_sql caveat).
    if not await can_use_sheets(datasette, request.actor):
        raise Forbidden("Permission denied")
    try:
        db_obj = datasette.get_database(database)
    except KeyError:
        return Response.html("Database not found", status=404)
    db = SheetDB(db_obj)
    await db.ensure_migrations()
    workbooks = await db.list_workbooks()
    return Response.html(
        await datasette.render_template(
            "sheets_workbook_list.html",
            {"database": database, "workbooks": workbooks},
            request=request,
        )
    )


async def workbook_page(datasette, request):
    database = request.url_vars["database"]
    workbook_id = int(request.url_vars["workbook_id"])
    # Coarse instance gate + per-workbook view: opening a specific workbook
    # requires sheets-view on it.
    if not await can_use_sheets(datasette, request.actor):
        raise Forbidden("Permission denied")
    if not await can_view_workbook(datasette, request.actor, database, workbook_id):
        raise Forbidden("Permission denied")
    try:
        db_obj = datasette.get_database(database)
    except KeyError:
        return Response.html("Database not found", status=404)
    db = SheetDB(db_obj)
    await db.ensure_migrations()
    workbook = await db.get_workbook(workbook_id)
    if not workbook:
        return Response.html("Workbook not found", status=404)
    # Whether to show the Share button. The dialog itself also reads acl and
    # only renders manage controls for managers, but gating the button here
    # avoids showing it to viewers/editors at all.
    can_manage = await can_manage_workbook(
        datasette, request.actor, database, workbook_id
    )
    self_actor = request.actor.get("id") if request.actor else ""
    return Response.html(
        await datasette.render_template(
            "sheets_base.html",
            {
                "database": database,
                "workbook_id": workbook_id,
                "workbook_name": workbook.name,
                "can_manage": can_manage,
                "self_actor": self_actor,
                "sheets_layout_css": datasette.urls.static_plugins(
                    "datasette_sheets", "sheets_layout.css"
                ),
            },
            request=request,
        )
    )


DB = r"(?P<database>[^/]+)"
WB = r"(?P<workbook_id>\d+)"
SH = r"(?P<sheet_id>\d+)"
BASE = f"/{DB}/-/sheets"


@hookimpl
def register_routes():
    return [
        (rf"{BASE}$", workbook_list_page),
        (rf"{BASE}/workbook/{WB}$", workbook_page),
        (rf"{BASE}/api/workbooks/{WB}/sheets/{SH}/events$", api_events),
    ] + router.routes()


@hookimpl
def register_actions(datasette):
    return [
        # --- Coarse instance gate (Option A, kept) --------------------------
        # "Can use sheets at all" — the original global action. Route handlers
        # check it as an outer gate, then layer the per-workbook actions below.
        Action(name=PERMISSION_NAME, description="Can access spreadsheet view"),
        # --- acl-backed per-workbook actions --------------------------------
        # These resolve against datasette-acl grants on SheetsWorkbookResource
        # (parent = database name, child = workbook id). Per-workbook view/edit/
        # manage checks go through these.
        Action(
            name="sheets-view",
            description="View a workbook",
            resource_class=SheetsWorkbookResource,
        ),
        Action(
            name="sheets-edit",
            description="Edit a workbook",
            resource_class=SheetsWorkbookResource,
            also_requires="sheets-view",
        ),
        Action(
            name="sheets-manage",
            description="Manage sharing for a workbook",
            resource_class=SheetsWorkbookResource,
            also_requires="sheets-view",
        ),
    ]


@hookimpl
def datasette_acl_roles(datasette):
    """Friendly Viewer / Editor / Manager roles for the ``sheets-workbook`` type.

    Consumed by datasette-acl's role registry (see ``build_roles_registry``).
    Built via acl's ``standard_roles`` factory in
    :func:`datasette_sheets.permissions.sheets_workbook_roles`.
    """
    return sheets_workbook_roles()


@hookimpl
async def startup(datasette):
    """One-time backfill of creator -> Manager grants for existing workbooks.

    CLOSED (owner-only) per DECISIONS.md: existing collaborators must be
    re-granted via the share dialog. Per-database marker makes this a no-op on
    every startup after the first.
    """
    from .migrations import backfill_workbook_acls

    await backfill_workbook_acls(datasette)


@hookimpl
def database_actions(datasette, actor, database):
    async def inner():
        if await datasette.allowed(action=PERMISSION_NAME, actor=actor):
            return [
                {
                    "href": datasette.urls.path(f"/{database}/-/sheets"),
                    "label": "Sheets",
                }
            ]
        return []

    return inner


try:
    from datasette_sidebar.hookspecs import SidebarApp  # type: ignore[import-not-found]

    def _first_sheets_database(datasette):
        """Pick the database Sheets should land on when there's no current db.

        The sidebar calls ``resolve_href(None)`` on db-less pages (the homepage /
        ``/-/`` index). Workbook URLs are database-scoped, so we resolve to the
        first database the way Datasette's homepage lists them: the first entry
        of ``datasette.databases`` (which already excludes the internal db).
        Prefer a real named, mutable database; fall back to whatever is first
        (e.g. ``_memory``) so we never emit a db-less/broken URL.
        """
        names = list(datasette.databases.keys())
        if not names:
            return None
        for name in names:
            db = datasette.databases[name]
            if name != "_memory" and getattr(db, "is_mutable", False):
                return name
        return names[0]

    @hookimpl
    def datasette_sidebar_apps(datasette):
        def sheets_href(database_name):
            if not database_name:
                database_name = _first_sheets_database(datasette)
            if not database_name:
                # No databases at all — land on the site root rather than a
                # broken db-scoped URL.
                return "/"
            return f"/{database_name}/-/sheets"

        return [
            SidebarApp(
                label="Sheets",
                description="Collaborative spreadsheets",
                href=sheets_href,
                icon='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-calculator-fill" viewBox="0 0 16 16"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm2 .5v2a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5m0 4v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5M4.5 9a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM4 12.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5M7.5 6a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM7 9.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5m.5 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM10 6.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5m.5 2.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5z"/></svg>',
                color="#276890",
            )
        ]
except ImportError:
    pass
