"""Tests for the datasette_sidebar_apps hook entry registered by sheets.

The sidebar calls ``app.resolve_href(database_name)`` with the *current*
database name, or ``None`` on pages without a database context (the homepage /
``/-/`` index). Workbook URLs are database-scoped, so the index case must
resolve to the first database in the listing rather than a db-less/broken URL.
"""

import os
import tempfile

import pytest
from datasette.app import Datasette

import datasette_sheets


def _sheets_app(ds):
    apps = datasette_sheets.datasette_sidebar_apps(datasette=ds)
    sheets = [a for a in apps if a.label == "Sheets"]
    assert sheets, "Sheets sidebar app should be registered"
    return sheets[0]


def test_resolve_href_with_database_is_db_scoped():
    """When a database IS in context, keep the db-scoped behavior."""
    ds = Datasette(memory=True)
    app = _sheets_app(ds)
    assert app.resolve_href("somedb") == "/somedb/-/sheets"


def test_resolve_href_none_uses_first_named_database():
    """On the index (database_name=None) resolve to the first user database."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_name = os.path.basename(tmp.name).replace(".db", "")
    try:
        # memory=True puts _memory in the listing too; the index href must skip
        # it and land on the real named database.
        ds = Datasette([tmp.name], memory=True)
        app = _sheets_app(ds)
        assert app.resolve_href(None) == f"/{db_name}/-/sheets"
        # And an explicit db still wins.
        assert app.resolve_href(db_name) == f"/{db_name}/-/sheets"
    finally:
        os.unlink(tmp.name)


def test_resolve_href_none_memory_only_falls_back_to_memory():
    """With no named user database, fall back to _memory (not a broken URL)."""
    ds = Datasette(memory=True)
    app = _sheets_app(ds)
    assert app.resolve_href(None) == "/_memory/-/sheets"
