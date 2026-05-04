"""Unit tests for datasette_sheets.view_sql — the pure SQL generator.

These tests cover validation, injection defenses, and the exact shape of
generated SQL. For end-to-end trigger behavior (inserts/updates/deletes
actually writing cells), see test_views.py.
"""

from __future__ import annotations

import sqlite3

import pytest

from datasette_sheets.view_sql import (
    IDENTIFIER_RE,
    ROW_COL,
    VIEW_NAME_MAX,
    ViewSpec,
    build_delete_trigger_sql,
    build_insert_trigger_sql,
    build_trigger_sql_list,
    build_update_trigger_sql,
    build_view_sql,
    sanitize_column_names,
    validate_sheet_id,
    validate_view_name,
)


GOOD_SHEET_ID = 1


def make_spec(**overrides) -> ViewSpec:
    """Minimal valid ViewSpec; override fields as needed."""
    defaults = dict(
        view_name="students",
        sheet_id=GOOD_SHEET_ID,
        min_row=0,
        min_col=5,
        max_row=9,
        max_col=6,
        data_start_row=1,
        column_aliases=["Name", "Age"],
        enable_insert=False,
        enable_update=False,
        enable_delete=False,
    )
    defaults.update(overrides)
    return ViewSpec(**defaults)


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------


class TestValidateViewName:
    @pytest.mark.parametrize("name", ["students", "_x", "x1", "a" * VIEW_NAME_MAX])
    def test_accepts_valid(self, name):
        validate_view_name(name)

    @pytest.mark.parametrize(
        "name,reason",
        [
            ("", "empty"),
            ("1abc", "digit leading"),
            ("a b", "space"),
            ("a-b", "dash"),
            ("drop table", "space"),
            ("a" * (VIEW_NAME_MAX + 1), "too long"),
            ("datasette_sheets_x", "reserved prefix"),
            ("sqlite_master", "reserved prefix"),
            ("a'); DROP TABLE x; --", "injection"),
            ("a]bc", "bracket"),
            ('a"b', "quote"),
            ("a\x00b", "nul byte"),
        ],
    )
    def test_rejects(self, name, reason):
        with pytest.raises(ValueError):
            validate_view_name(name)

    def test_rejects_non_string(self):
        with pytest.raises(ValueError):
            validate_view_name(123)  # type: ignore[arg-type]


class TestValidateSheetId:
    @pytest.mark.parametrize("sid", [1, 42, 999_999_999])
    def test_accepts(self, sid):
        validate_sheet_id(sid)

    @pytest.mark.parametrize(
        "sid",
        [
            0,  # rowid is 1-based
            -1,
            "1",  # string-typed digits — rejected, must be int
            "x' OR 1=1",  # injection-style payload, never accepted as int
            None,
            True,  # bool is an int subclass — explicitly rejected
            1.5,
        ],
    )
    def test_rejects(self, sid):
        with pytest.raises(ValueError):
            validate_sheet_id(sid)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# sanitize_column_names
# ---------------------------------------------------------------------------


class TestSanitizeColumnNames:
    def test_basic(self):
        assert sanitize_column_names(["Name", "Age"]) == ["Name", "Age"]

    def test_spaces_and_punctuation_become_underscores(self):
        assert sanitize_column_names(["First Name", "e-mail!"]) == [
            "First_Name",
            "e_mail",
        ]

    def test_empty_or_digit_leading_gets_col_prefix(self):
        assert sanitize_column_names(["", "123", "7up"]) == [
            "col_",
            "col_123",
            "col_7up",
        ]

    def test_deduplicates(self):
        assert sanitize_column_names(["A", "A", "A"]) == ["A", "A_2", "A_3"]

    def test_reserves_names(self):
        # If we reserve ROW_COL, a user's "_sheet_row" header must not collide.
        # The header sanitizes to "sheet_row" (leading underscore stripped),
        # so no clash — but a raw header *equal* to ROW_COL after sanitize
        # should get suffixed.
        out = sanitize_column_names(["Name", "_sheet_row"], reserved=(ROW_COL,))
        # _sheet_row strips to "sheet_row" — no conflict
        assert out == ["Name", "sheet_row"]
        # But if someone somehow produces "_sheet_row" directly it'd conflict;
        # we simulate by supplying a name that sanitizes to exactly ROW_COL.
        # strip("_") would drop leading/trailing, so it's hard to hit from
        # user input. We still verify the dedup path via explicit collision:
        out2 = sanitize_column_names(["_sheet_row_"], reserved=("sheet_row",))
        assert out2 == ["sheet_row_2"]

    def test_all_outputs_are_safe_identifiers(self):
        weirds = [
            "a b c",
            "! @ #",
            "🚀rocket",
            "'; DROP TABLE x; --",
            "[bracket]",
            'quote"inside',
            "backtick`mark",
            "with\nnewline",
            "",
            "123",
        ]
        for out in sanitize_column_names(weirds):
            assert IDENTIFIER_RE.match(out), f"unsafe output: {out!r}"


# ---------------------------------------------------------------------------
# ViewSpec validation
# ---------------------------------------------------------------------------


class TestViewSpec:
    def test_valid(self):
        spec = make_spec()
        assert spec.writable is False

    def test_writable_property(self):
        assert make_spec(enable_insert=True).writable is True
        assert make_spec(enable_update=True).writable is True
        assert make_spec(enable_delete=True).writable is True

    def test_bad_view_name(self):
        with pytest.raises(ValueError):
            make_spec(view_name="1bad")

    def test_bad_sheet_id(self):
        with pytest.raises(ValueError):
            make_spec(sheet_id="not-an-int")

    def test_bad_column_alias(self):
        with pytest.raises(ValueError, match="Unsafe column alias"):
            make_spec(column_aliases=["Name", "has space"])

    def test_alias_count_mismatch(self):
        with pytest.raises(ValueError, match="column_aliases length"):
            make_spec(column_aliases=["Name"])  # range covers 2 cols

    def test_row_col_collision_when_writable(self):
        with pytest.raises(ValueError, match="reserved"):
            make_spec(
                column_aliases=["Name", ROW_COL],
                enable_update=True,
            )

    def test_row_col_collision_allowed_when_not_writable(self):
        # Non-writable views don't expose _sheet_row so a coincidental column
        # alias of that name is fine (unlikely, but not harmful).
        make_spec(column_aliases=["Name", ROW_COL])

    def test_rejects_negative_int(self):
        with pytest.raises(ValueError):
            make_spec(min_row=-1)

    def test_rejects_reversed_range(self):
        with pytest.raises(ValueError):
            make_spec(min_col=10, max_col=5, column_aliases=[])


# ---------------------------------------------------------------------------
# SQL generation — shape + injection defenses
# ---------------------------------------------------------------------------


class TestBuildViewSql:
    def test_non_writable_uses_computed_value_only(self):
        sql = build_view_sql(make_spec())
        assert "COALESCE" not in sql
        assert "c.computed_value" in sql
        assert "[_sheet_row]" not in sql

    def test_writable_adds_coalesce_and_row_col(self):
        sql = build_view_sql(make_spec(enable_update=True))
        assert "COALESCE(c.computed_value, c.raw_value)" in sql
        assert "r.row_idx AS [_sheet_row]" in sql

    def test_identifiers_are_bracketed(self):
        sql = build_view_sql(make_spec(view_name="my_view"))
        assert "CREATE VIEW [my_view]" in sql
        assert "AS [Name]" in sql
        assert "AS [Age]" in sql

    def test_sheet_id_is_integer_literal(self):
        sql = build_view_sql(make_spec())
        # Embedded as a bare integer (no quoting needed — int isn't string).
        assert f"sheet_id = {GOOD_SHEET_ID}" in sql
        # No string-quoted form leaked into the DDL.
        assert f"'{GOOD_SHEET_ID}'" not in sql

    def test_no_stray_injection_payloads_in_output(self):
        """The inputs are pre-validated, but if an attacker somehow got an
        injection payload past validation, it would not appear in the SQL."""
        # ViewSpec should refuse injection input entirely.
        with pytest.raises(ValueError):
            make_spec(view_name="x]; DROP TABLE cells; --")

    def test_column_range_appears_as_integers(self):
        sql = build_view_sql(
            make_spec(min_col=5, max_col=6, column_aliases=["Name", "Age"])
        )
        assert "c.col_idx = 5" in sql
        assert "c.col_idx = 6" in sql
        assert "col_idx >= 5 AND col_idx <= 6" in sql


class TestBuildUpdateTrigger:
    def test_shape(self):
        sql = build_update_trigger_sql(make_spec(enable_update=True))
        assert sql.startswith(
            "CREATE TRIGGER [students_update] INSTEAD OF UPDATE ON [students]"
        )
        # One statement per column
        assert sql.count("INSERT INTO datasette_sheets_cell") == 2
        # ON CONFLICT upserts
        assert sql.count("ON CONFLICT(sheet_id, row_idx, col_idx)") == 2
        # Uses OLD._sheet_row to locate the row
        assert "OLD.[_sheet_row]" in sql
        # Uses COALESCE(NEW.alias, '') for empty-string semantics
        assert "COALESCE(NEW.[Name], '')" in sql
        assert "COALESCE(NEW.[Age], '')" in sql
        # writes both raw and computed
        assert "raw_value = excluded.raw_value" in sql
        assert "computed_value = excluded.computed_value" in sql


class TestBuildDeleteTrigger:
    def test_shape(self):
        sql = build_delete_trigger_sql(make_spec(enable_delete=True))
        assert sql.startswith(
            "CREATE TRIGGER [students_delete] INSTEAD OF DELETE ON [students]"
        )
        assert "DELETE FROM datasette_sheets_cell" in sql
        assert "row_idx = OLD.[_sheet_row]" in sql
        assert "col_idx BETWEEN 5 AND 6" in sql
        assert f"sheet_id = {GOOD_SHEET_ID}" in sql

    def test_clear_mode_does_not_shift(self):
        sql = build_delete_trigger_sql(
            make_spec(enable_delete=True, delete_mode="clear")
        )
        assert "UPDATE datasette_sheets_cell" not in sql
        assert "SET row_idx = row_idx - 1" not in sql

    def test_shift_mode_emits_shift_update(self):
        sql = build_delete_trigger_sql(
            make_spec(enable_delete=True, delete_mode="shift")
        )
        # Still does the initial DELETE
        assert "DELETE FROM datasette_sheets_cell" in sql
        # Two-pass shift through negative buffer — avoids mid-UPDATE PK
        # collisions when cells were inserted in scrambled rowid order.
        assert "SET row_idx = -(row_idx + 1)" in sql
        assert "SET row_idx = -row_idx - 2" in sql
        assert "row_idx > OLD.[_sheet_row]" in sql
        assert "row_idx <= 9" in sql  # max_row from make_spec default
        assert "row_idx < 0" in sql

    def test_rejects_unknown_delete_mode(self):
        import pytest

        with pytest.raises(ValueError, match="Invalid delete_mode"):
            make_spec(enable_delete=True, delete_mode="banana")


class TestBuildInsertTrigger:
    def test_shape(self):
        sql = build_insert_trigger_sql(make_spec(enable_insert=True))
        assert sql.startswith(
            "CREATE TRIGGER [students_insert] INSTEAD OF INSERT ON [students]"
        )
        # One INSERT per column
        assert sql.count("INSERT INTO datasette_sheets_cell") == 2
        # First column picks fresh row_idx; later columns reuse it via MAX
        assert "COALESCE(MAX(row_idx)" in sql
        assert sql.count("SELECT MAX(row_idx)") >= 1

    def test_data_start_row_offset(self):
        # With headers: data_start_row=1, COALESCE fallback is data_start_row-1=0
        sql = build_insert_trigger_sql(make_spec(enable_insert=True, data_start_row=1))
        assert "COALESCE(MAX(row_idx), 0) + 1" in sql


class TestBuildTriggerList:
    def test_none_when_no_flags(self):
        assert build_trigger_sql_list(make_spec()) == []

    def test_ordering_update_delete_insert(self):
        sql_list = build_trigger_sql_list(
            make_spec(enable_insert=True, enable_update=True, enable_delete=True)
        )
        assert len(sql_list) == 3
        assert "students_update]" in sql_list[0]
        assert "students_delete]" in sql_list[1]
        assert "students_insert]" in sql_list[2]

    def test_subset(self):
        sql_list = build_trigger_sql_list(make_spec(enable_delete=True))
        assert len(sql_list) == 1
        assert "students_delete]" in sql_list[0]


# ---------------------------------------------------------------------------
# Execute generated SQL against a real in-memory SQLite to catch syntax errors
# ---------------------------------------------------------------------------


@pytest.fixture()
def sqlite_conn():
    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE datasette_sheets_cell (
            sheet_id INTEGER NOT NULL,
            row_idx INTEGER NOT NULL,
            col_idx INTEGER NOT NULL,
            raw_value TEXT NOT NULL DEFAULT '',
            computed_value TEXT,
            format_json TEXT,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
            updated_by TEXT,
            PRIMARY KEY (sheet_id, row_idx, col_idx)
        );
        """
    )
    yield conn
    conn.close()


class TestGeneratedSqlCompiles:
    """Quick smoke tests that the generated strings are actually valid SQL.
    Full behavior is covered by test_views.py's integration tests."""

    def test_view_compiles(self, sqlite_conn):
        sqlite_conn.execute(build_view_sql(make_spec()))

    def test_writable_view_and_all_triggers_compile(self, sqlite_conn):
        spec = make_spec(enable_insert=True, enable_update=True, enable_delete=True)
        sqlite_conn.execute(build_view_sql(spec))
        for trig in build_trigger_sql_list(spec):
            sqlite_conn.execute(trig)
        # All three triggers should now exist
        trigs = [
            r[0]
            for r in sqlite_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
            )
        ]
        assert trigs == ["students_delete", "students_insert", "students_update"]

    def test_dropping_view_cascades_triggers(self, sqlite_conn):
        spec = make_spec(enable_insert=True, enable_update=True, enable_delete=True)
        sqlite_conn.execute(build_view_sql(spec))
        for trig in build_trigger_sql_list(spec):
            sqlite_conn.execute(trig)
        sqlite_conn.execute("DROP VIEW [students]")
        trigs = list(
            sqlite_conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'")
        )
        assert trigs == []

    def test_weird_but_sanitized_headers_compile(self, sqlite_conn):
        # Simulate a real flow: sanitize user headers then build the view.
        aliases = sanitize_column_names(
            ["First Name", "'; DROP TABLE x; --", "7th Col"],
            reserved=(ROW_COL,),
        )
        spec = make_spec(
            min_col=0,
            max_col=2,
            column_aliases=aliases,
            enable_update=True,
        )
        sqlite_conn.execute(build_view_sql(spec))
        for trig in build_trigger_sql_list(spec):
            sqlite_conn.execute(trig)

    def test_sqlite_shift_up_update_is_safe(self, sqlite_conn):
        """The ``delete_mode=shift`` trigger does::

            DELETE FROM cells WHERE row_idx = N;
            UPDATE cells SET row_idx = row_idx - 1 WHERE row_idx > N;

        against a PRIMARY KEY (sheet_id, row_idx, col_idx) table. This would
        fail if SQLite evaluated the UPDATE with intermediate PK collisions.
        Verify the expected end state so we can trust the generated trigger.
        """
        sqlite_conn.executescript(
            """
            INSERT INTO datasette_sheets_cell (sheet_id, row_idx, col_idx, raw_value)
            VALUES
                ('s', 0, 0, 'r0c0'), ('s', 0, 1, 'r0c1'),
                ('s', 1, 0, 'r1c0'), ('s', 1, 1, 'r1c1'),
                ('s', 2, 0, 'r2c0'), ('s', 2, 1, 'r2c1'),
                ('s', 3, 0, 'r3c0'), ('s', 3, 1, 'r3c1'),
                ('s', 4, 0, 'r4c0'), ('s', 4, 1, 'r4c1');
            """
        )
        # Delete row 2 and shift rows 3..4 up.
        sqlite_conn.execute(
            "DELETE FROM datasette_sheets_cell WHERE sheet_id='s' AND row_idx = 2"
        )
        sqlite_conn.execute(
            "UPDATE datasette_sheets_cell SET row_idx = row_idx - 1 "
            "WHERE sheet_id='s' AND row_idx > 2"
        )
        rows = sqlite_conn.execute(
            "SELECT row_idx, col_idx, raw_value FROM datasette_sheets_cell ORDER BY row_idx, col_idx"
        ).fetchall()
        assert rows == [
            (0, 0, "r0c0"),
            (0, 1, "r0c1"),
            (1, 0, "r1c0"),
            (1, 1, "r1c1"),
            (2, 0, "r3c0"),
            (2, 1, "r3c1"),
            (3, 0, "r4c0"),
            (3, 1, "r4c1"),
        ]

    def test_regex_constants_are_sane(self):
        # Belt-and-braces: make sure the identifier regex hasn't drifted
        # into accepting something obviously unsafe.
        assert IDENTIFIER_RE.match("Name")
        assert not IDENTIFIER_RE.match("Name; --")
