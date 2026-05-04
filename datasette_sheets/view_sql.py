"""Pure SQL generation for datasette-sheets views and INSTEAD OF triggers.

This module is deliberately side-effect-free and import-light so every
statement it produces can be unit-tested in isolation, including against
SQL-injection attempts.

Safety model
------------
SQLite's ``CREATE TRIGGER`` body stores literal SQL that runs when the
trigger fires; bind parameters are not available at ``CREATE`` time, so
every value must be embedded as a literal. We therefore:

* validate identifiers (view name, column aliases, sheet id) against a
  strict regex *before* embedding them, and
* refuse any string literal that contains a quote or a NUL byte.

Callers MUST NOT bypass :func:`validate_view_name` / :func:`validate_sheet_id`.
The :class:`ViewSpec` constructor re-validates its own inputs so the
guarantee holds regardless of how it is constructed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Identifiers: letters, digits, underscores; no leading digit.
IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
# User-provided view name: same as identifier, capped at 63 chars so we can
# append `_insert`/`_update`/`_delete` without blowing past SQLite's comfort
# zone. We verify the user-facing cap in validate_view_name.
VIEW_NAME_MAX = 63
RESERVED_VIEW_PREFIXES = ("datasette_sheets_", "sqlite_")
ROW_COL = "_sheet_row"

# Internal helpers ------------------------------------------------------------


def _is_identifier(name: str) -> bool:
    return bool(IDENTIFIER_RE.match(name))


def _ident(name: str) -> str:
    """Quote an identifier after validating it. Refuses anything outside
    ``[a-zA-Z_][a-zA-Z0-9_]*`` so the ``[...]``-quoted output can never be
    escaped from."""
    if not _is_identifier(name):
        raise ValueError(f"Unsafe identifier: {name!r}")
    return f"[{name}]"


def _sheet_literal(sheet_id: int) -> str:
    """Embed a sheet_id as a SQL integer literal. We've already
    restricted the type to ``int`` (and rejected non-positive values
    in :func:`validate_sheet_id`), so the bare ``str(int)`` form is
    safe in DDL — there's no character set to escape."""
    validate_sheet_id(sheet_id)
    return str(sheet_id)


# Public validators -----------------------------------------------------------


def validate_view_name(name: str) -> None:
    if not isinstance(name, str) or not _is_identifier(name):
        raise ValueError(
            "Invalid view name: must be letters, digits, underscores, no leading digit"
        )
    if len(name) > VIEW_NAME_MAX:
        raise ValueError(f"View name too long (max {VIEW_NAME_MAX} chars)")
    if name.startswith(RESERVED_VIEW_PREFIXES):
        raise ValueError("Reserved prefix in view name")


def validate_sheet_id(sheet_id: int) -> None:
    # ``isinstance(True, int)`` is true (bool is an int subclass) — exclude
    # it explicitly so a stray boolean can't masquerade as a sheet id.
    if (
        not isinstance(sheet_id, int)
        or isinstance(sheet_id, bool)
        or sheet_id < 1
    ):
        raise ValueError("Invalid sheet_id: must be a positive integer")


def sanitize_column_names(
    names: list[str], reserved: tuple[str, ...] = ()
) -> list[str]:
    """Turn raw header strings into safe, unique SQL identifiers.

    * Chars outside ``[A-Za-z0-9_]`` are replaced with ``_``.
    * Leading/trailing underscores are stripped.
    * Empty or digit-leading results are prefixed with ``col_``.
    * Duplicates (including clashes against ``reserved``) get numeric suffixes.

    The output is guaranteed to pass :data:`IDENTIFIER_RE`.
    """
    sanitized: list[str] = []
    seen: dict[str, int] = {r: 1 for r in reserved}
    for name in names:
        s = re.sub(r"[^a-zA-Z0-9_]", "_", name).strip("_")
        if not s or s[0].isdigit():
            s = "col_" + s
        if s in seen:
            seen[s] += 1
            s = f"{s}_{seen[s]}"
        else:
            seen[s] = 1
        sanitized.append(s)
    # Defense-in-depth: if anything slipped past, fail loudly.
    for s in sanitized:
        if not _is_identifier(s):
            raise ValueError(f"Sanitization failed to produce a safe identifier: {s!r}")
    return sanitized


# Spec ------------------------------------------------------------------------


@dataclass(frozen=True)
class ViewSpec:
    """Everything needed to build the view + optional triggers.

    Inputs are re-validated in __post_init__ so the SQL builders can trust
    them unconditionally.
    """

    view_name: str
    sheet_id: int
    min_row: int
    min_col: int
    max_row: int
    max_col: int
    data_start_row: int  # min_row + 1 if headers, else min_row
    column_aliases: list[str] = field(default_factory=list)
    enable_insert: bool = False
    enable_update: bool = False
    enable_delete: bool = False
    # "clear": DELETE the row's cells, leaving a gap.
    # "shift": DELETE the cells, then shift subsequent rows up by 1.
    delete_mode: str = "clear"

    @property
    def writable(self) -> bool:
        return self.enable_insert or self.enable_update or self.enable_delete

    def __post_init__(self):
        validate_view_name(self.view_name)
        validate_sheet_id(self.sheet_id)
        for attr in ("min_row", "min_col", "max_row", "max_col", "data_start_row"):
            v = getattr(self, attr)
            if not isinstance(v, int) or isinstance(v, bool):
                raise ValueError(f"{attr} must be int, got {type(v).__name__}")
            if v < 0:
                raise ValueError(f"{attr} must be non-negative, got {v}")
        if self.max_row < self.min_row:
            raise ValueError("max_row < min_row")
        if self.max_col < self.min_col:
            raise ValueError("max_col < min_col")
        expected_cols = self.max_col - self.min_col + 1
        if len(self.column_aliases) != expected_cols:
            raise ValueError(
                f"column_aliases length {len(self.column_aliases)} does not match "
                f"column range {self.min_col}..{self.max_col} ({expected_cols} cols)"
            )
        for a in self.column_aliases:
            if not _is_identifier(a):
                raise ValueError(f"Unsafe column alias: {a!r}")
        if self.writable and ROW_COL in self.column_aliases:
            raise ValueError(f"Column alias conflicts with reserved {ROW_COL!r}")
        if self.delete_mode not in ("clear", "shift"):
            raise ValueError(
                f"Invalid delete_mode: {self.delete_mode!r} (must be 'clear' or 'shift')"
            )


# SQL builders ----------------------------------------------------------------

_NOW_EXPR = "strftime('%Y-%m-%dT%H:%M:%f', 'now')"


def build_view_sql(spec: ViewSpec) -> str:
    sheet_lit = _sheet_literal(spec.sheet_id)
    value_expr = (
        "COALESCE(c.computed_value, c.raw_value)"
        if spec.writable
        else "c.computed_value"
    )
    select_parts: list[str] = []
    for i, col_idx in enumerate(range(spec.min_col, spec.max_col + 1)):
        alias = _ident(spec.column_aliases[i])
        select_parts.append(
            f"(SELECT {value_expr} FROM datasette_sheets_cell c "
            f"WHERE c.sheet_id = {sheet_lit} AND c.row_idx = r.row_idx "
            f"AND c.col_idx = {col_idx}) AS {alias}"
        )
    if spec.writable:
        select_parts.append(f"r.row_idx AS {_ident(ROW_COL)}")

    return (
        f"CREATE VIEW {_ident(spec.view_name)} AS\n"
        f"WITH rows AS (\n"
        f"  SELECT DISTINCT row_idx FROM datasette_sheets_cell\n"
        f"  WHERE sheet_id = {sheet_lit}\n"
        f"    AND row_idx >= {spec.data_start_row} AND row_idx <= {spec.max_row}\n"
        f"    AND col_idx >= {spec.min_col} AND col_idx <= {spec.max_col}\n"
        f")\n"
        f"SELECT\n"
        + ",\n".join(f"  {p}" for p in select_parts)
        + "\nFROM rows r\nORDER BY r.row_idx"
    )


def build_update_trigger_sql(spec: ViewSpec) -> str:
    sheet_lit = _sheet_literal(spec.sheet_id)
    row_col = _ident(ROW_COL)
    stmts: list[str] = []
    for i, col_idx in enumerate(range(spec.min_col, spec.max_col + 1)):
        alias = _ident(spec.column_aliases[i])
        stmts.append(
            f"INSERT INTO datasette_sheets_cell "
            f"(sheet_id, row_idx, col_idx, raw_value, computed_value, updated_at) "
            f"VALUES ({sheet_lit}, OLD.{row_col}, {col_idx}, "
            f"COALESCE(NEW.{alias}, ''), COALESCE(NEW.{alias}, ''), {_NOW_EXPR}) "
            f"ON CONFLICT(sheet_id, row_idx, col_idx) DO UPDATE SET "
            f"raw_value = excluded.raw_value, "
            f"computed_value = excluded.computed_value, "
            f"updated_at = excluded.updated_at;"
        )
    return (
        f"CREATE TRIGGER {_ident(spec.view_name + '_update')} "
        f"INSTEAD OF UPDATE ON {_ident(spec.view_name)} "
        f"BEGIN {' '.join(stmts)} END"
    )


def build_delete_trigger_sql(spec: ViewSpec) -> str:
    sheet_lit = _sheet_literal(spec.sheet_id)
    row_col = _ident(ROW_COL)
    clear_stmt = (
        f"DELETE FROM datasette_sheets_cell "
        f"WHERE sheet_id = {sheet_lit} "
        f"AND row_idx = OLD.{row_col} "
        f"AND col_idx BETWEEN {spec.min_col} AND {spec.max_col};"
    )
    if spec.delete_mode == "shift":
        # Shift every subsequent row in the view's range up by 1.
        #
        # Must use a two-pass negative-buffer shift, not a naive
        # ``row_idx - 1`` UPDATE, because SQLite iterates by rowid and
        # scrambled insert order can cause mid-statement PK collisions.
        # See SheetDB.delete_rows + tests/test_row_shift.py for the
        # detailed regression.
        shift_pass_1 = (
            f"UPDATE datasette_sheets_cell "
            f"SET row_idx = -(row_idx + 1) "
            f"WHERE sheet_id = {sheet_lit} "
            f"AND row_idx > OLD.{row_col} AND row_idx <= {spec.max_row} "
            f"AND col_idx BETWEEN {spec.min_col} AND {spec.max_col};"
        )
        shift_pass_2 = (
            f"UPDATE datasette_sheets_cell "
            f"SET row_idx = -row_idx - 2, updated_at = {_NOW_EXPR} "
            f"WHERE sheet_id = {sheet_lit} "
            f"AND row_idx < 0 "
            f"AND col_idx BETWEEN {spec.min_col} AND {spec.max_col};"
        )
        body = f"{clear_stmt} {shift_pass_1} {shift_pass_2}"
    else:
        body = clear_stmt
    return (
        f"CREATE TRIGGER {_ident(spec.view_name + '_delete')} "
        f"INSTEAD OF DELETE ON {_ident(spec.view_name)} "
        f"BEGIN {body} END"
    )


def build_insert_trigger_sql(spec: ViewSpec) -> str:
    sheet_lit = _sheet_literal(spec.sheet_id)
    next_row_expr = (
        f"(SELECT COALESCE(MAX(row_idx), {spec.data_start_row - 1}) + 1 "
        f"FROM datasette_sheets_cell WHERE sheet_id = {sheet_lit} "
        f"AND row_idx >= {spec.data_start_row})"
    )
    same_row_expr = (
        f"(SELECT MAX(row_idx) FROM datasette_sheets_cell "
        f"WHERE sheet_id = {sheet_lit} AND row_idx >= {spec.data_start_row})"
    )
    stmts: list[str] = []
    for i, col_idx in enumerate(range(spec.min_col, spec.max_col + 1)):
        alias = _ident(spec.column_aliases[i])
        # First column establishes the new row_idx; later columns reference
        # it back via MAX so every inserted value lands in the same row.
        row_expr = next_row_expr if i == 0 else same_row_expr
        stmts.append(
            f"INSERT INTO datasette_sheets_cell "
            f"(sheet_id, row_idx, col_idx, raw_value, computed_value, updated_at) "
            f"VALUES ({sheet_lit}, {row_expr}, {col_idx}, "
            f"COALESCE(NEW.{alias}, ''), COALESCE(NEW.{alias}, ''), {_NOW_EXPR});"
        )
    return (
        f"CREATE TRIGGER {_ident(spec.view_name + '_insert')} "
        f"INSTEAD OF INSERT ON {_ident(spec.view_name)} "
        f"BEGIN {' '.join(stmts)} END"
    )


def build_trigger_sql_list(spec: ViewSpec) -> list[str]:
    out: list[str] = []
    if spec.enable_update:
        out.append(build_update_trigger_sql(spec))
    if spec.enable_delete:
        out.append(build_delete_trigger_sql(spec))
    if spec.enable_insert:
        out.append(build_insert_trigger_sql(spec))
    return out
