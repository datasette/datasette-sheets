"""Permission model for datasette-sheets.

Before sharing-v2, datasette-sheets had a single coarse global action,
``datasette-sheets-access``, which gated *everything*: any actor with it
could see and edit every workbook in the instance. There was no per-workbook
model at all.

This module adds the per-workbook layer. Per-workbook access is answered by
**datasette-acl**: the ``sheets-view`` / ``sheets-edit`` / ``sheets-manage``
actions resolve against acl grants on the :class:`SheetsWorkbookResource`
resource (type ``sheets-workbook``). The owner gets a Manager grant seeded for
``created_by`` on create (see :func:`seed_owner_manager_grant`); collaborators
and general access are acl grants written through the share UI.

Resource shape — workbooks live in the **end-user's** database (not Datasette's
internal DB), so the two-level hierarchy is ``parent = database name`` and
``child = workbook id``. This matches the share-dialog embed
(``<datasette-acl-share-dialog resource-type="sheets-workbook" parent={db}
child={workbookId}>``) and lets a future general-access grant target a whole
database (parent) if desired.

Global gate (DECISIONS.md / plan Part 3 Option A) — the original
``datasette-sheets-access`` action is **kept** as a coarse "can use sheets at
all" instance gate. Route handlers check it as an outer gate and then layer the
per-workbook ``sheets-view`` / ``sheets-edit`` check on top. This is the
least-disruptive option (the alternative, dropping it entirely, churns every
route guard and removes the simple "turn sheets off for this deployment"
switch).

``resources_sql`` caveat — core's ``allowed_resources()`` enumeration runs the
returned SQL against the **internal** database, but sheets' workbooks live in
user databases, so an enumeration query cannot reach them from there. The
per-workbook authorization path (``datasette.allowed(action=..., resource=...)``)
does **not** depend on ``resources_sql`` — it resolves purely against acl's
grant rows keyed by ``(resource_type, parent, child)`` — so every route guard,
grant, and the share dialog work correctly regardless. ``resources_sql`` returns
the correct two-column shape but selects nothing against the internal DB; see
its docstring.
"""

from __future__ import annotations

from datasette.permissions import Resource

# datasette-acl is a hard dependency: the permission model resolves every
# per-workbook check through acl grants, so its roles factory + grant helpers
# are always importable.
from datasette_acl.roles import standard_roles as _standard_roles
from datasette_acl.grants import grant as _acl_grant, Principal as _Principal


# The original coarse instance gate. Kept (Option A) as an outer "can use
# sheets at all" check; the per-workbook actions below layer on top.
GLOBAL_PERMISSION_NAME = "datasette-sheets-access"

# Resource type name for the acl-backed per-workbook model.
SHEETS_WORKBOOK_RESOURCE_TYPE = "sheets-workbook"

# Resource-scoped actions, resolved by datasette-acl against grants on
# SheetsWorkbookResource.
SHEETS_WORKBOOK_ACTIONS = (
    "sheets-view",
    "sheets-edit",
    "sheets-manage",
)


class SheetsDatabaseResource(Resource):
    """Parent level for :class:`SheetsWorkbookResource`.

    The parent is the **database name** the workbook lives in. This class
    exists to give ``SheetsWorkbookResource`` a ``parent_class`` (Datasette
    requires the two-level hierarchy be expressed via ``parent_class``); it is
    not granted on directly today, but a general-access grant could later target
    a whole database (every workbook in it) by granting at this level.
    """

    name = "sheets-database"
    parent_class = None

    @classmethod
    async def resources_sql(cls, datasette, actor=None) -> str:
        # Database names are not enumerable from the internal DB via SQL; the
        # acl management UI doesn't need parent-level rows for sheets today.
        return "SELECT NULL AS parent, NULL AS child WHERE 0"


class SheetsWorkbookResource(Resource):
    """A single workbook, acl-backed (resource type ``sheets-workbook``).

    Two-level resource: ``parent`` is the database name the workbook lives in,
    ``child`` is the workbook id. This is the model the ``sheets-view`` /
    ``sheets-edit`` / ``sheets-manage`` actions resolve against via
    datasette-acl's ``permission_resources_sql`` and grant helpers.

    Constructed positionally as ``SheetsWorkbookResource(database, workbook_id)``
    — matching acl's ``build_resource`` convention for two-level types
    (``rc(parent, child)``).
    """

    name = SHEETS_WORKBOOK_RESOURCE_TYPE
    parent_class = SheetsDatabaseResource

    def __init__(self, parent=None, child=None):
        super().__init__(
            parent=str(parent) if parent is not None else None,
            child=str(child) if child is not None else None,
        )

    @classmethod
    async def resources_sql(cls, datasette, actor=None) -> str:
        """Two-column ``(parent, child)`` enumeration of all workbooks.

        Core (and datasette-acl) run this against the **internal** database, but
        sheets' workbooks live in *user* databases (``_datasette_sheets_workbook``
        is created per user DB by the plugin's migrations) — there is no
        single-database SQL the internal DB could run to enumerate them.

        Instead we enumerate from acl's own ``acl_resources`` table (which *is*
        in the internal DB): every workbook created through the normal flow seeds
        a creator Manager grant, which upserts an ``acl_resources`` row. So this
        reports exactly the set of workbooks that have any grant — which is what
        ``datasette_acl.utils.resource_exists`` needs so the share dialog's read
        API can confirm a workbook is real (without it, the dialog 403s for
        everyone). Anonymous zero-grant workbooks are excluded, which is correct
        — they have no manager. ``acl`` is a hard dependency, so the table always
        exists. The authorization path (``datasette.allowed(..., resource=...)``)
        resolves against grant rows directly and does not depend on this.
        """
        return (
            "SELECT parent, child FROM acl_resources "
            "WHERE resource_type = 'sheets-workbook'"
        )


def workbook_resource(database: str, workbook_id) -> SheetsWorkbookResource:
    """Build a :class:`SheetsWorkbookResource` for ``(database, workbook_id)``.

    Central helper so every route handler constructs the resource the same
    way (and so the parent/child encoding lives in one place).
    """
    return SheetsWorkbookResource(database, workbook_id)


def sheets_workbook_roles():
    """Viewer / Editor / Manager roles for the ``sheets-workbook`` resource type.

    Built from acl's :func:`datasette_acl.roles.standard_roles` factory (the
    canonical cumulative triple): Viewer = view, Editor = view + edit, Manager =
    view + edit + manage (``manage=True``, so the ``sheets-manage`` action
    authorizes re-sharing). Consumed by the ``datasette_acl_roles`` hook.
    """
    return _standard_roles(
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        view="sheets-view",
        edit="sheets-edit",
        manage="sheets-manage",
        descriptions={
            "Viewer": "Can view the workbook",
            "Editor": "Can view and edit the workbook",
            "Manager": "Can view, edit, and manage sharing",
        },
    )


async def seed_owner_manager_grant(
    datasette, database, workbook_id, created_by
) -> None:
    """Grant the workbook creator the Manager role on the new workbook.

    Ownership is an acl Manager grant on the ``sheets-workbook`` resource. No-op
    for anonymous creates (``created_by`` falsy — anonymous actors never own).
    """
    if not created_by:
        return
    await _acl_grant(
        datasette,
        SHEETS_WORKBOOK_RESOURCE_TYPE,
        str(database),
        str(workbook_id),
        principal=_Principal.actor(str(created_by)),
        role="Manager",
        by_actor=str(created_by),
    )


# ---------------------------------------------------------------------------
# Per-action helpers used by route handlers
# ---------------------------------------------------------------------------


async def can_use_sheets(datasette, actor) -> bool:
    """The coarse instance gate — ``datasette-sheets-access`` (Option A)."""
    return await datasette.allowed(action=GLOBAL_PERMISSION_NAME, actor=actor)


async def can_view_workbook(datasette, actor, database, workbook_id) -> bool:
    """True when ``actor`` may view workbook ``workbook_id`` in ``database``."""
    return await datasette.allowed(
        action="sheets-view",
        resource=workbook_resource(database, workbook_id),
        actor=actor,
    )


async def can_edit_workbook(datasette, actor, database, workbook_id) -> bool:
    """True when ``actor`` may edit workbook ``workbook_id`` in ``database``."""
    return await datasette.allowed(
        action="sheets-edit",
        resource=workbook_resource(database, workbook_id),
        actor=actor,
    )


async def can_manage_workbook(datasette, actor, database, workbook_id) -> bool:
    """True when ``actor`` may manage sharing for workbook ``workbook_id``."""
    return await datasette.allowed(
        action="sheets-manage",
        resource=workbook_resource(database, workbook_id),
        actor=actor,
    )
