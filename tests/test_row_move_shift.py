"""Tests for the row block-move SQL that powers
:meth:`SheetDB.move_rows`.

Mirrors :mod:`tests.test_col_move_shift` on the row axis. NO
column-meta-table parity test — there's no
``datasette_sheets_row`` table; cells are the only persisted
per-row state. Otherwise the suite exercises the same surface:
both directions of the uniform CASE, single + block moves, and
the scrambled-rowid UNIQUE collision regression.
"""

from __future__ import annotations

import sqlite3

import pytest
from sqlite_utils import Database

from datasette_sheets import _queries
from datasette_sheets.migrations import migrations


@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    migrations.apply(Database(c))
    yield c
    c.close()


def seed(
    conn: sqlite3.Connection,
    cells: list[tuple[int, int, str]],
    sheet: str = "s",
):
    """Insert (row_idx, col_idx, raw_value) triples."""
    conn.executemany(
        "INSERT INTO datasette_sheets_cell (sheet_id, row_idx, col_idx, raw_value) "
        "VALUES (?, ?, ?, ?)",
        [(sheet, r, c, v) for (r, c, v) in cells],
    )


def current(conn: sqlite3.Connection, sheet: str = "s") -> list[tuple[int, int, str]]:
    return [
        (r, c, v)
        for (r, c, v) in conn.execute(
            "SELECT row_idx, col_idx, raw_value FROM datasette_sheets_cell "
            "WHERE sheet_id = ? ORDER BY row_idx, col_idx",
            [sheet],
        )
    ]


def move_rows(
    conn: sqlite3.Connection,
    src_start: int,
    src_end: int,
    final_start: int,
    sheet: str = "s",
):
    """Run the cell-table half of the move-rows shift via the
    codegened helpers. Same call order ``SheetDB.move_rows`` uses.
    """
    width = src_end - src_start + 1
    low = min(src_start, final_start)
    high = max(src_end, final_start + width - 1)
    _queries.move_cell_rows_to_buffer(conn, sheet_id=sheet, low=low, high=high)
    _queries.move_cell_rows_from_buffer(
        conn,
        sheet_id=sheet,
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
        width=width,
    )


# ---------------------------------------------------------------------------
# Single-row moves
# ---------------------------------------------------------------------------


class TestSingleRowMove:
    def test_move_up(self, conn):
        # rows 0..4 → drag row 3 up to row 1 (final_start=1).
        # forward: 0→0, 1→2, 2→3, 3→1, 4→4.
        seed(conn, [(r, 0, f"r{r}") for r in range(5)])
        move_rows(conn, src_start=3, src_end=3, final_start=1)
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r3"),  # old row 3 landed at row 1
            (2, 0, "r1"),  # old row 1 pushed down
            (3, 0, "r2"),  # old row 2 pushed down
            (4, 0, "r4"),
        ]

    def test_move_down(self, conn):
        # rows 0..4 → drag row 1 down to row 4 (final_start=4).
        seed(conn, [(r, 0, f"r{r}") for r in range(5)])
        move_rows(conn, src_start=1, src_end=1, final_start=4)
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r2"),
            (2, 0, "r3"),
            (3, 0, "r4"),
            (4, 0, "r1"),
        ]

    def test_move_to_top(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(5)])
        move_rows(conn, src_start=3, src_end=3, final_start=0)
        assert current(conn) == [
            (0, 0, "r3"),
            (1, 0, "r0"),
            (2, 0, "r1"),
            (3, 0, "r2"),
            (4, 0, "r4"),
        ]

    def test_outside_band_untouched(self, conn):
        # 7 rows; move row 3 up to row 1. Rows 5+ are outside the
        # affected band [1, 3] and shouldn't be touched.
        seed(conn, [(r, 0, f"r{r}") for r in range(7)])
        move_rows(conn, src_start=3, src_end=3, final_start=1)
        assert (5, 0, "r5") in current(conn)
        assert (6, 0, "r6") in current(conn)

    def test_multi_col_data_per_row(self, conn):
        # Each row carries data across 4 columns. After move row 3
        # → row 1, every column at the new row 1 should hold what
        # used to be at the old row 3.
        seed(conn, [(r, c, f"r{r}c{c}") for r in range(4) for c in range(4)])
        move_rows(conn, src_start=3, src_end=3, final_start=1)
        for c in range(4):
            assert (1, c, f"r3c{c}") in current(conn)
            assert (2, c, f"r1c{c}") in current(conn)


# ---------------------------------------------------------------------------
# Block moves (multi-row)
# ---------------------------------------------------------------------------


class TestBlockMove:
    def test_block_move_down(self, conn):
        # 7 rows → move block [1..3] to start at row 4.
        # forward: 0→0, 1→4, 2→5, 3→6, 4→1, 5→2, 6→3.
        seed(conn, [(r, 0, f"r{r}") for r in range(7)])
        move_rows(conn, src_start=1, src_end=3, final_start=4)
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r4"),
            (2, 0, "r5"),
            (3, 0, "r6"),
            (4, 0, "r1"),
            (5, 0, "r2"),
            (6, 0, "r3"),
        ]

    def test_block_move_up(self, conn):
        # 7 rows → move block [4..6] up to start at row 1.
        # forward: 0→0, 1→4, 2→5, 3→6, 4→1, 5→2, 6→3.
        # Same final layout as above (block-move is symmetric for
        # this case — both produce r0, r4, r5, r6, r1, r2, r3).
        seed(conn, [(r, 0, f"r{r}") for r in range(7)])
        move_rows(conn, src_start=4, src_end=6, final_start=1)
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r4"),
            (2, 0, "r5"),
            (3, 0, "r6"),
            (4, 0, "r1"),
            (5, 0, "r2"),
            (6, 0, "r3"),
        ]


# ---------------------------------------------------------------------------
# Scrambled-rowid UNIQUE collision regression
# ---------------------------------------------------------------------------


class TestScrambledInsertOrder:
    """Reproduces the collision a naive in-place ``SET row_idx =
    row_idx + 1`` would hit when SQLite scans by rowid not PK
    order. Inserts cells in deliberately scrambled order, then
    runs the move; the negative-buffer two-pass should still
    produce the correct final layout.
    """

    def test_scrambled_up_move(self, conn):
        for r in [4, 0, 3, 1, 2]:
            conn.execute(
                "INSERT INTO datasette_sheets_cell "
                "(sheet_id, row_idx, col_idx, raw_value) VALUES (?, ?, ?, ?)",
                ["s", r, 0, f"r{r}"],
            )
        move_rows(conn, src_start=3, src_end=3, final_start=1)
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r3"),
            (2, 0, "r1"),
            (3, 0, "r2"),
            (4, 0, "r4"),
        ]

    def test_scrambled_down_move(self, conn):
        for r in [3, 1, 4, 0, 2]:
            conn.execute(
                "INSERT INTO datasette_sheets_cell "
                "(sheet_id, row_idx, col_idx, raw_value) VALUES (?, ?, ?, ?)",
                ["s", r, 0, f"r{r}"],
            )
        move_rows(conn, src_start=1, src_end=1, final_start=4)
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r2"),
            (2, 0, "r3"),
            (3, 0, "r4"),
            (4, 0, "r1"),
        ]


# ---------------------------------------------------------------------------
# Sheet isolation
# ---------------------------------------------------------------------------


def test_other_sheet_untouched(conn):
    seed(conn, [(r, 0, f"r{r}") for r in range(5)], sheet="s1")
    seed(conn, [(r, 0, f"x{r}") for r in range(5)], sheet="s2")
    move_rows(conn, src_start=3, src_end=3, final_start=1, sheet="s1")
    assert current(conn, "s2") == [
        (0, 0, "x0"),
        (1, 0, "x1"),
        (2, 0, "x2"),
        (3, 0, "x3"),
        (4, 0, "x4"),
    ]
