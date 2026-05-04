from sqlite_utils import Database
from sqlite_migrate import Migrations

migrations = Migrations("datasette-sheets")


@migrations()
def m001_schema(db: Database):
    # Initial schema. Schema changes after this point land as new
    # ``m00N_*`` migration steps below — never edit existing steps.
    # Doc comments use sqlite-docs format (asg017/sqlite-docs):
    #   --! table description
    #   --- column description
    #   --- @example 'literal value'
    #   --- @details free-form notes / link
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS datasette_sheets_workbook(
            --! A collection of spreadsheet tabs ("sheets") owned by a user.
            --! One workbook maps to one Datasette "document"; every sheet
            --! underneath shares its lifetime.
            --! @details Rows live in the end-user's database, not
            --! Datasette's internal DB.

            --- ULID for the workbook. Explicit NOT NULL because
            --- SQLite's historical quirk lets a TEXT PRIMARY KEY
            --- hold NULL otherwise.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            id TEXT PRIMARY KEY NOT NULL,

            --- Human-readable workbook name shown in the UI.
            --- @example 'Q3 Budget'
            name TEXT NOT NULL,

            --- ISO-8601 UTC timestamp when the workbook was created.
            --- @example '2026-04-17T12:34:56.789'
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

            --- ISO-8601 UTC timestamp of the most recent edit to any
            --- descendant (sheet, column, cell).
            --- @example '2026-04-17T12:34:56.789'
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

            --- Datasette actor id of the creator, if authenticated.
            --- @example 'alex'
            created_by TEXT,

            --- Display order in the workbook list. Lower comes first.
            --- @example 0
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS datasette_sheets_sheet(
            --! A single tab within a workbook. Holds cells, column
            --! metadata, and views.

            --- ULID for the sheet.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            id TEXT PRIMARY KEY NOT NULL,

            --- Parent workbook id. Cascades on delete.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            workbook_id TEXT NOT NULL REFERENCES datasette_sheets_workbook(id) ON DELETE CASCADE,

            --- Tab name shown in the UI.
            --- @example 'Sheet1'
            name TEXT NOT NULL,

            --- Tab color as a CSS hex string (#RRGGBB).
            --- @example '#8b774f'
            color TEXT NOT NULL DEFAULT '#8b774f',

            --- Display order among sibling tabs. Lower comes first.
            --- @example 0
            sort_order INTEGER NOT NULL DEFAULT 0,

            --- ISO-8601 UTC timestamp when the sheet was created.
            --- @example '2026-04-17T12:34:56.789'
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

            --- ISO-8601 UTC timestamp of the last cell or metadata edit.
            --- @example '2026-04-17T12:34:56.789'
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
        );

        CREATE TABLE IF NOT EXISTS datasette_sheets_column(
            --! Per-column UI metadata (width, header name, format) for a
            --! sheet. A row per column that has been customized; absent
            --! rows use DEFAULT_COLUMNS in db.py.

            --- Parent sheet id. Cascades on delete.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            sheet_id TEXT NOT NULL REFERENCES datasette_sheets_sheet(id) ON DELETE CASCADE,

            --- Zero-based column index. 0 is column A, 1 is B, etc.
            --- @example 0
            col_idx INTEGER NOT NULL,

            --- Header label shown at the top of the column.
            --- @example 'Price (USD)'
            name TEXT NOT NULL,

            --- Rendered column width in pixels.
            --- @example 120
            width INTEGER NOT NULL DEFAULT 100,

            --- JSON blob describing the display format for cells in
            --- this column (currency, percent, decimals, etc.).
            --- @details See CellFormat in frontend/src/lib/spreadsheet/types.ts
            --- @example '{"kind":"currency","symbol":"$","decimals":2}'
            format_json TEXT,

            PRIMARY KEY (sheet_id, col_idx)
        );

        CREATE TABLE IF NOT EXISTS datasette_sheets_cell(
            --! One row per non-empty cell. ``raw_value`` is what the user
            --! typed; ``computed_value`` is the Rust formula engine's
            --! evaluation of that raw value (equal to raw_value for
            --! literal text).

            --- Parent sheet id. Cascades on delete.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            sheet_id TEXT NOT NULL REFERENCES datasette_sheets_sheet(id) ON DELETE CASCADE,

            --- Zero-based row index (0 == row 1 in A1 notation).
            --- @example 0
            row_idx INTEGER NOT NULL,

            --- Zero-based column index (0 == column A).
            --- @example 5
            col_idx INTEGER NOT NULL,

            --- Exactly what the user typed, including leading '=' for
            --- formulas.
            --- @example '=SUM(A1:A10)'
            raw_value TEXT NOT NULL DEFAULT '',

            --- Result of evaluating ``raw_value`` through the Rust
            --- engine. NULL means "needs recalculation"; the view layer
            --- COALESCEs to ``raw_value`` in that case. Declared with
            --- BLOB affinity (no type) so SQLite preserves the storage
            --- class — numeric cells stay INTEGER / REAL instead of
            --- being coerced to TEXT, matching the engine's typed
            --- classification.
            --- @example 42
            computed_value,

            --- JSON override of cell-level formatting. Falls back to the
            --- column's ``format_json`` when NULL.
            --- @details See CellFormat in frontend/src/lib/spreadsheet/types.ts
            --- @example '{"bold":true}'
            format_json TEXT,

            --- ISO-8601 UTC timestamp of the last edit to this cell.
            --- @example '2026-04-17T12:34:56.789'
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

            --- Datasette actor id of whoever last touched this cell.
            --- @example 'alex'
            updated_by TEXT,

            PRIMARY KEY (sheet_id, row_idx, col_idx)
        );

        CREATE INDEX IF NOT EXISTS idx_sheets_cells_sheet
            ON datasette_sheets_cell(sheet_id);
        CREATE INDEX IF NOT EXISTS idx_sheets_cells_sheet_row
            ON datasette_sheets_cell(sheet_id, row_idx);

        CREATE TABLE IF NOT EXISTS datasette_sheets_view(
            --! Tracks SQL VIEWs created from sheet ranges. The actual
            --! view (and any INSTEAD OF triggers) lives alongside this
            --! row in sqlite_master; this table is the plugin's registry.

            --- ULID for the view record.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            id TEXT PRIMARY KEY NOT NULL,

            --- Parent sheet id. Cascades on delete.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            sheet_id TEXT NOT NULL REFERENCES datasette_sheets_sheet(id) ON DELETE CASCADE,

            --- Name of the generated SQL VIEW in the database. Must be a
            --- safe SQL identifier; enforced by view_sql.validate_view_name.
            --- @example 'students'
            view_name TEXT NOT NULL UNIQUE,

            --- A1-style range string the view was built from.
            --- @example 'F1:G'
            range_str TEXT NOT NULL,

            --- Zero-based first row of the view's range (inclusive).
            --- @example 0
            min_row INTEGER NOT NULL,

            --- Zero-based first column of the view's range (inclusive).
            --- @example 5
            min_col INTEGER NOT NULL,

            --- Zero-based last row of the view's range (inclusive).
            --- @example 99
            max_row INTEGER NOT NULL,

            --- Zero-based last column of the view's range (inclusive).
            --- @example 6
            max_col INTEGER NOT NULL,

            --- 1 if the first row of the range supplies column names,
            --- 0 if the view uses spreadsheet letter labels (A, B, ...).
            --- @value 0
            --- @value 1
            use_headers INTEGER NOT NULL DEFAULT 1,

            --- Accent color associated with the view in the UI.
            --- @example '#6366f1'
            color TEXT NOT NULL DEFAULT '#6366f1',

            --- ISO-8601 UTC timestamp when the view was registered.
            --- @example '2026-04-17T12:34:56.789'
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

            --- 1 if an INSTEAD OF INSERT trigger was created, allowing
            --- ``INSERT INTO <view>`` to append a row to the sheet.
            --- @value 0
            --- @value 1
            enable_insert INTEGER NOT NULL DEFAULT 0,

            --- 1 if an INSTEAD OF UPDATE trigger was created, allowing
            --- ``UPDATE <view> SET ...`` to rewrite cells in that row.
            --- @value 0
            --- @value 1
            enable_update INTEGER NOT NULL DEFAULT 0,

            --- 1 if an INSTEAD OF DELETE trigger was created, allowing
            --- ``DELETE FROM <view>`` to clear cells in that row.
            --- @value 0
            --- @value 1
            enable_delete INTEGER NOT NULL DEFAULT 0,

            --- Behavior of the DELETE trigger. Only meaningful when
            --- ``enable_delete = 1``.
            --- ``clear``: delete cells at the target row, leaving a gap.
            --- ``shift``: delete cells, then shift every subsequent row
            --- in the view's range up by one.
            --- @value 'clear'
            --- @value 'shift'
            delete_mode TEXT NOT NULL DEFAULT 'clear'
        );

        CREATE TABLE IF NOT EXISTS datasette_sheets_named_range(
            --! A workbook-global named range defined on a sheet.
            --! ``definition`` is the raw text handed to the Rust engine
            --! via ``Sheet.set_name`` — a literal ('0.05'), a cell
            --! reference ('=B1'), a range ('=A1:A10'), or a formula
            --! ('=SUM(A1:A10)'). Names resolve case-insensitively; the
            --! engine uppercases on storage.

            --- Parent sheet id. Cascades on delete.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            sheet_id TEXT NOT NULL REFERENCES datasette_sheets_sheet(id) ON DELETE CASCADE,

            --- Name as the user typed it. The primary key uses
            --- ``COLLATE NOCASE`` so lookups match the engine's
            --- case-insensitive semantics.
            --- @example 'TaxRate'
            name TEXT NOT NULL,

            --- Raw definition text fed to ``Sheet.set_name``. May be a
            --- literal, cell ref, range, or formula.
            --- @example '=A1:A10'
            definition TEXT NOT NULL,

            --- ISO-8601 UTC timestamp of the last edit to this name.
            --- @example '2026-04-17T12:34:56.789'
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

            PRIMARY KEY (sheet_id, name COLLATE NOCASE)
        );

        CREATE INDEX IF NOT EXISTS idx_sheets_named_range_sheet
            ON datasette_sheets_named_range(sheet_id);
        """
    )


@migrations()
def m002_computed_value_kind(db: Database):
    # SQLite has no boolean storage class, so ``CellValue::Boolean``
    # adapts to INTEGER 0/1 — indistinguishable from a Number(1.0)
    # cell on the way back out. ``computed_value_kind`` is the type
    # discriminator: NULL for the common case (Number → INTEGER /
    # REAL, String → TEXT, Empty → NULL); ``'bool'`` when the engine
    # returned a Boolean (still stored as INTEGER 0/1). Set + read
    # in lockstep with ``computed_value`` — see ``_split_typed`` /
    # ``reconstruct_typed`` in db.py.
    #
    # Existing rows get NULL — every cell whose formula now produces
    # a Boolean will repopulate the kind on the next recalc (the
    # ``listCellsForRecalc`` query selects on (value, kind), so a
    # Number(1.0) → Boolean(true) flip writes through).
    db.executescript(
        """
        ALTER TABLE datasette_sheets_cell
            ADD COLUMN computed_value_kind TEXT;
        """
    )


@migrations()
def m003_dropdown_rules(db: Database):
    # Workbook-scoped data-validation rules. Cells reference these by
    # id from their ``format_json`` (``controlType: "dropdown"`` +
    # ``dropdownRuleId``); the strict-mode validator in
    # ``db.py::set_cells`` enforces option membership at write time.
    # See specs/sheet.data.dropdown.md.
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS datasette_sheets_dropdown_rule(
            --! A workbook-scoped data-validation dropdown rule. Cells
            --! point at one of these via their ``format_json``
            --! ``dropdownRuleId`` field; selecting an option writes
            --! ``raw_value`` to the option's ``value`` (or a
            --! comma-joined list of values when ``multi`` is true).
            --! @details Strict-mode-only in v1: values not in the
            --! option list are rejected server-side at write time.

            --- ULID for the rule. Workbook-scoped so multiple sheets
            --- can share one rule.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            id TEXT PRIMARY KEY NOT NULL,

            --- Parent workbook id. Cascades on workbook delete (the
            --- delete is a manual DELETE in db.py mirroring the rest
            --- of the cascade — see deleteWorkbook* in queries.sql).
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            workbook_id TEXT NOT NULL REFERENCES datasette_sheets_workbook(id) ON DELETE CASCADE,

            --- Optional human label shown in the rule list / editor.
            --- @example 'Status'
            name TEXT,

            --- 1 if cells using this rule store a comma-joined list of
            --- selected option values; 0 if exactly one option's value.
            --- @value 0
            --- @value 1
            multi INTEGER NOT NULL DEFAULT 0,

            --- JSON-encoded option list. Shape:
            --- ``[{"value": "<text>", "color": "#RRGGBB"}, ...]``.
            --- ``value`` must not contain ``,`` (rejected at write
            --- time) — comma is reserved for multi-select join.
            --- @example '[{"value":"Done","color":"#b6dfa8"}]'
            options_json TEXT NOT NULL DEFAULT '[]',

            --- ISO-8601 UTC timestamp of the last edit to this rule.
            --- @example '2026-04-25T12:34:56.789'
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sheets_dropdown_rule_workbook
            ON datasette_sheets_dropdown_rule(workbook_id);
        """
    )


@migrations()
def m004_typed_input(db: Database):
    # Per-cell typed override — Phase B of the engine-typed-cells epic.
    # Phase A's m002 added ``computed_value_kind`` for the engine's
    # *output* discriminator; this migration adds the matching *input*
    # override columns. When ``typed_kind`` is NULL the cell is raw
    # text and the engine auto-classifies it on every recalc; when
    # set, the recalc rebuilds the cell as a ``set_cells_typed`` input
    # so the typed value survives across passes. The frontend
    # ``'``-prefix affordance is the first user-visible producer;
    # future surfaces (column-level type hints, "Format → Plain text"
    # toggle, etc.) plug into the same columns.
    #
    # ``typed_data`` only carries content when ``typed_kind == 'custom'``
    # — the JSON-encoded ``{type_tag, data}`` payload. For
    # ``string`` / ``number`` / ``boolean`` the value is already in
    # ``raw_value`` (engine renders the typed value back to display
    # text), so a second copy in ``typed_data`` would be redundant.
    #
    # Existing rows get NULL → behave exactly as before. A subsequent
    # ``upsertCell`` with NULL typed_kind keeps the column NULL,
    # preserving the auto-classify default.
    db.executescript(
        """
        ALTER TABLE datasette_sheets_cell
            ADD COLUMN typed_kind TEXT;
        ALTER TABLE datasette_sheets_cell
            ADD COLUMN typed_data TEXT;
        """
    )


@migrations()
def m005_filter(db: Database):
    # Google-Sheets-style "Basic Filter" applied to a contiguous
    # rectangle on a sheet. At most one filter per sheet
    # (UNIQUE(sheet_id) below); multi-filter / saved "filter views"
    # is deferred. The first row of the rectangle is the header;
    # rows below up to ``max_row`` are filterable.
    #
    # Predicates per column and the active sort live as JSON inside
    # the same row to keep load + write a single round-trip — same
    # rationale as ``dropdown_rule.options_json``.
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS datasette_sheets_filter(
            --! A "Basic Filter" applied to a contiguous rectangle on
            --! a sheet. At most one per sheet — multi-filter / saved
            --! "filter views" is deferred. Bounds shift in lockstep
            --! with row/col delete / insert / move via the same
            --! forward-map helper that updates ``datasette_sheets_view``.

            --- ULID for the filter.
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            id TEXT PRIMARY KEY NOT NULL,

            --- Parent sheet id. Cascades on sheet delete (the cascade
            --- is a manual DELETE in db.py mirroring the rest of the
            --- cascade — see ``deleteSheet*`` in queries.sql).
            --- @example '01HZZZZZZZZZZZZZZZZZZZZZZZ'
            sheet_id TEXT NOT NULL UNIQUE
                REFERENCES datasette_sheets_sheet(id) ON DELETE CASCADE,

            --- Zero-based first row of the filter (the header row).
            --- @example 0
            min_row INTEGER NOT NULL,

            --- Zero-based first column of the filter.
            --- @example 1
            min_col INTEGER NOT NULL,

            --- Zero-based last filterable row (inclusive).
            --- @example 9
            max_row INTEGER NOT NULL,

            --- Zero-based last column of the filter (inclusive).
            --- @example 3
            max_col INTEGER NOT NULL,

            --- Column index whose values drive the active sort.
            --- NULL = no sort. Shifts under fwd_col like the bounds.
            --- @example 2
            sort_col_idx INTEGER,

            --- ``'asc'`` or ``'desc'``. NULL when ``sort_col_idx`` is.
            --- @value 'asc'
            --- @value 'desc'
            sort_direction TEXT,

            --- JSON ``{<col_idx>: {"hidden": [<display>, ...]}}``.
            --- Stored as *display strings* (post-formatter) so the
            --- picker labels and the predicate match what the user
            --- sees. Predicate keys re-key under ``fwd_col`` on
            --- column delete / move; values are unaffected.
            --- @example '{"3":{"hidden":["closed"]}}'
            predicates_json TEXT NOT NULL DEFAULT '{}',

            --- ISO-8601 UTC timestamps.
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sheets_filter_sheet
            ON datasette_sheets_filter(sheet_id);
        """
    )
