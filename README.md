# datasette-sheets

[![PyPI](https://img.shields.io/pypi/v/datasette-sheets.svg)](https://pypi.org/project/datasette-sheets/)
[![Changelog](https://img.shields.io/github/v/release/datasette/datasette-sheets?include_prereleases&label=changelog)](https://github.com/datasette/datasette-sheets/releases)
[![Tests](https://github.com/datasette/datasette-sheets/actions/workflows/test.yml/badge.svg)](https://github.com/datasette/datasette-sheets/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/datasette/datasette-sheets/blob/main/LICENSE)

Custom spreadsheets in Datasette. Work in progress, heavy usage of LLM development. 

## Installation

Install this plugin in the same environment as Datasette.
```bash
datasette install datasette-sheets
```
## Usage

Usage instructions go here.

## Permissions

datasette-sheets uses a two-layer permission model:

- **`datasette-sheets-access`** — a coarse, instance-wide gate: "can this actor
  use sheets at all". Grant it the usual way (the `permissions:` config block,
  datasette-acl, etc.). Every sheets route checks it first.
- **Per-workbook access** — resolved by
  [datasette-acl](https://github.com/datasette/datasette-acl) against the
  `sheets-workbook` resource (parent = database name, child = workbook id), via
  the `sheets-view` / `sheets-edit` / `sheets-manage` actions and the
  Viewer / Editor / Manager roles. The workbook **creator** is granted Manager
  automatically on create. Sharing is managed from the workbook's Share button.

### Upgrade behaviour (CLOSED by default)

Before this version, anyone with `datasette-sheets-access` could see and edit
**every** workbook. After upgrading, access is per-workbook. On first startup a
one-time backfill grants each existing workbook's creator (`created_by`) the
**Manager** role so owners are never locked out.

The upgrade default is **CLOSED (owner-only)**: the backfill does **not** grant
`_signed_in` or `*`, so workbooks that used to be visible to everyone become
visible only to their creator. **Existing collaborators must be explicitly
re-granted** through the Share dialog (or the datasette-acl API). Workbooks
created anonymously (no `created_by`) get no owner grant and stay inaccessible
until granted. The backfill logs a one-line summary of what it did.

## Development

To set up this plugin locally, first checkout the code. You can confirm it is available like this:
```bash
cd datasette-sheets
# Confirm the plugin is visible
uv run datasette plugins
```
To run the tests:
```bash
uv run pytest
```
