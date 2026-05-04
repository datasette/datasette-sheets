from datasette import hookimpl, Forbidden, Response
from datasette.permissions import Action
from .router import router, PERMISSION_NAME
from .routes.sse import api_events
from .db import SheetDB
import os

# Import route modules to trigger decorator registration
from . import routes  # noqa: F401


@hookimpl
def extra_template_vars(datasette):
    vite_dev_path = os.environ.get("DATASETTE_SHEETS_VITE_PATH")
    if vite_dev_path:

        async def entry(entrypoint: str) -> str:
            return (
                f'<script type="module" src="{vite_dev_path}@vite/client"></script>\n'
                f'<script type="module" src="{vite_dev_path}{entrypoint}"></script>'
            )
    else:
        import json

        manifest_path = os.path.join(
            os.path.dirname(__file__), "static", "manifest.json"
        )
        try:
            with open(manifest_path) as f:
                manifest = json.load(f)
        except FileNotFoundError:
            manifest = {}

        async def entry(entrypoint: str) -> str:
            chunk = manifest.get(entrypoint, {})
            parts = []
            for css in chunk.get("css", []):
                parts.append(
                    f'<link rel="stylesheet" href="{datasette.urls.static_plugins("datasette_sheets", css)}">'
                )
            js_file = chunk.get("file", "")
            if js_file:
                parts.append(
                    f'<script type="module" src="{datasette.urls.static_plugins("datasette_sheets", js_file)}"></script>'
                )
            return "\n".join(parts)

    return {"datasette_sheets_vite_entry": entry}


async def workbook_list_page(datasette, request):
    database = request.url_vars["database"]
    if not await datasette.allowed(action=PERMISSION_NAME, actor=request.actor):
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
    if not await datasette.allowed(action=PERMISSION_NAME, actor=request.actor):
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
    return Response.html(
        await datasette.render_template(
            "sheets_base.html",
            {
                "database": database,
                "workbook_id": workbook_id,
                "workbook_name": workbook.name,
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
    return [Action(name=PERMISSION_NAME, description="Can access spreadsheet view")]


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

    @hookimpl
    def datasette_sidebar_apps(datasette):
        return [
            SidebarApp(
                label="Sheets",
                description="Collaborative spreadsheets",
                href=lambda db: f"/{db}/-/sheets" if db else "/",
                icon='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-calculator-fill" viewBox="0 0 16 16"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm2 .5v2a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5m0 4v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5M4.5 9a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM4 12.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5M7.5 6a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM7 9.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5m.5 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM10 6.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5m.5 2.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5z"/></svg>',
                color="#276890",
            )
        ]
except ImportError:
    pass
