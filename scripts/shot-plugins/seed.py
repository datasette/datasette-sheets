"""Throwaway seed + actor-name plugin for the doc screenshot script.

Loaded via ``datasette --plugins-dir`` from ``scripts/screenshots.mjs`` so the
self-contained shots run against deterministic data without the Node driver
having to reimplement the cell / grant APIs.

It does two things, both dev/screenshot-only (NOT shipped):

1. ``actors_from_ids`` — friendly display names ("Alice Ada", …) so the
   presence avatar strip, presence labels, and the share dialog's people list
   render real names instead of raw actor ids. ``firstresult=True``; a
   plugins-dir plugin loads after Datasette's core default, so this is called
   first and wins.

2. ``startup`` — seeds one shared "Q3 Revenue Plan" workbook (owned by ``alice``)
   with a small forecast table (values + SUM formulas + bold/currency
   formatting) and acl grants that populate the share dialog: alice Manager
   (owner), bob Editor, carol Viewer. Idempotent — skips a database that
   already has workbooks, so a re-run against a fresh throwaway DB always
   produces the same content.
"""

import json

from datasette import hookimpl

# Stable cast so every shot shows the same names / avatar colours (colour is a
# deterministic hash of the actor id, so these never move between runs).
# Actor ids chosen so their presence colours (PRESENCE_COLORS[hash(id) % N],
# with the screenshot server pinned to PYTHONHASHSEED=0) come out distinct:
# bob → orange, grace → teal. See scripts/screenshots.mjs.
DISPLAY_NAMES = {
    "alice": "Alice Ada",
    "bob": "Bob Babbage",
    "grace": "Grace Hopper",
}


# tryfirst: actors_from_ids is firstresult, and datasette-debug-gotham also
# registers it (returning its own cast). Without tryfirst, gotham can win and
# our demo actors fall back to raw ids in the share dialog / presence labels.
@hookimpl(tryfirst=True)
def actors_from_ids(actor_ids):
    out = {}
    for aid in actor_ids:
        sid = str(aid)
        actor = {"id": sid}
        if sid in DISPLAY_NAMES:
            # ``name`` is what sheets' presence resolver reads; ``display_name``
            # is what datasette-acl's share API reads. Set both so the name
            # shows in the presence labels AND the share dialog.
            actor["name"] = DISPLAY_NAMES[sid]
            actor["display_name"] = DISPLAY_NAMES[sid]
        out[sid] = actor
    return out


# ---------------------------------------------------------------------------
# Seed data. row_idx / col_idx are 0-based; formulas use 1-based A1 refs.
_BOLD = json.dumps({"bold": True})


def _money(*, bold=False):
    fmt = {"type": "currency", "decimals": 0, "currencySymbol": "$"}
    if bold:
        fmt["bold"] = True
    return json.dumps(fmt)


# (row_idx, col_idx, raw_value, format_json)
_FORECAST_CELLS = [
    # Header row — bold labels.
    (0, 0, "Region", _BOLD),
    (0, 1, "Q1", _BOLD),
    (0, 2, "Q2", _BOLD),
    (0, 3, "Total", _BOLD),
    # Data rows — currency on the numeric columns, =SUM across the quarter.
    (1, 0, "West", None),
    (1, 1, "4200", _money()),
    (1, 2, "4800", _money()),
    (1, 3, "=SUM(B2:C2)", _money()),
    (2, 0, "East", None),
    (2, 1, "3100", _money()),
    (2, 2, "3600", _money()),
    (2, 3, "=SUM(B3:C3)", _money()),
    (3, 0, "North", None),
    (3, 1, "2700", _money()),
    (3, 2, "3050", _money()),
    (3, 3, "=SUM(B4:C4)", _money()),
    (4, 0, "South", None),
    (4, 1, "5400", _money()),
    (4, 2, "5900", _money()),
    (4, 3, "=SUM(B5:C5)", _money()),
    # Total row — bold currency, column subtotals.
    (5, 0, "Total", _BOLD),
    (5, 1, "=SUM(B2:B5)", _money(bold=True)),
    (5, 2, "=SUM(C2:C5)", _money(bold=True)),
    (5, 3, "=SUM(D2:D5)", _money(bold=True)),
]

_SUMMARY_CELLS = [
    (0, 0, "Highlights", _BOLD),
    (1, 0, "Total bookings landed 12% above plan.", None),
    (2, 0, "West region carried the quarter.", None),
    (3, 0, "Edits here sync live to everyone viewing.", None),
]

WORKBOOK_NAME = "Q3 Revenue Plan"


@hookimpl
def startup(datasette):
    async def inner():
        from datasette_sheets.db import SheetDB, CellChange
        from datasette_sheets.permissions import (
            SHEETS_WORKBOOK_RESOURCE_TYPE,
            seed_owner_manager_grant,
        )
        from datasette_sheets.migrations import _ensure_acl_tables
        from datasette_acl.grants import grant, Principal

        for name, db_obj in datasette.databases.items():
            if name == "_internal" or not db_obj.is_mutable:
                continue
            db = SheetDB(db_obj)
            await db.ensure_migrations()
            # Idempotent: a fresh throwaway DB seeds once; a re-run is a no-op.
            if await db.list_workbooks():
                continue

            # A couple of extra (empty) workbooks so the list page looks lived-in.
            # Created first so the rich "Q3 Revenue Plan" lands at the top.
            for extra in ("Customer CRM", "Sprint Planning", "2026 Budget"):
                ewb = await db.create_workbook(extra, actor_id="alice")
                await db.create_sheet(ewb.id, "Sheet 1")
                await _ensure_acl_tables(datasette)
                await seed_owner_manager_grant(datasette, name, ewb.id, "alice")

            wb = await db.create_workbook(WORKBOOK_NAME, actor_id="alice")
            forecast = await db.create_sheet(wb.id, "Forecast")
            summary = await db.create_sheet(wb.id, "Summary")

            await db.set_cells(
                forecast.id,
                [CellChange(r, c, v, fmt) for (r, c, v, fmt) in _FORECAST_CELLS],
                actor_id="alice",
            )
            await db.set_cells(
                summary.id,
                [CellChange(r, c, v, fmt) for (r, c, v, fmt) in _SUMMARY_CELLS],
                actor_id="alice",
            )

            # Named ranges (forecast sheet) so the Named ranges panel has content
            # — a couple of ranges plus a scalar named value.
            await db.set_named_range(forecast.id, "Q1Revenue", "B2:B5")
            await db.set_named_range(forecast.id, "Q2Revenue", "C2:C5")
            await db.set_named_range(forecast.id, "TaxRate", "0.08")

            # Sharing: owner + two collaborators so the share dialog's
            # people-with-access list has real rows to render.
            await _ensure_acl_tables(datasette)
            await seed_owner_manager_grant(datasette, name, wb.id, "alice")
            await grant(
                datasette,
                SHEETS_WORKBOOK_RESOURCE_TYPE,
                name,
                str(wb.id),
                principal=Principal.actor("bob"),
                role="Editor",
                by_actor="alice",
            )
            await grant(
                datasette,
                SHEETS_WORKBOOK_RESOURCE_TYPE,
                name,
                str(wb.id),
                principal=Principal.actor("grace"),
                role="Viewer",
                by_actor="alice",
            )

    return inner
