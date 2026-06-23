"""Pytest configuration for datasette-sheets.

Importing ``datasette.app`` here, at collection time, forces Datasette's
plugin manager to load its setuptools entrypoints (``datasette.plugins``
runs ``pm.load_setuptools_entrypoints`` on first import) *before* any test
module imports ``datasette_sheets`` directly.

Why this matters: ``datasette_sheets`` now imports ``datasette_acl`` (for the
sharing-v2 ``sheets-workbook`` resource model), and ``datasette_acl`` imports
``datasette.plugins``. If a test imports ``datasette_sheets`` (e.g. a plain
``from datasette_sheets.broadcast import ...`` in a sync test) *before*
``datasette.plugins`` has been imported, the entrypoint load fires while
``datasette_sheets/__init__`` is only partially executed — pluggy then
registers the half-built module and misses its ``register_routes`` /
``register_actions`` hookimpls, so every sheets route 404s for the rest of the
session. Importing ``datasette.app`` first makes the entrypoint load happen
cleanly with the fully-initialised module.
"""

import datasette.app  # noqa: F401  (import for its plugin-loading side effect)
