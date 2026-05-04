"""Tests for the column block-move SQL that powers
:meth:`SheetDB.move_columns`.

Mirrors :mod:`tests.test_col_shift` but on the move pair
(``moveCellColsToBuffer`` / ``moveCellColsFromBuffer``). The real
method shifts both ``datasette_sheets_cell`` and
``datasette_sheets_column`` via the same two-pass negative-buffer
pattern; these tests exercise the cell-table shift in isolation via
the codegened helpers. The integration suite
(:mod:`tests.test_col_move`) covers the column-table shift, formula
rewrite, named-range rewrite, view-bound update, and end-to-end
behavior through ``SheetDB.move_columns``.

Two regressions worth being explicit about:

1. **Scrambled-rowid UNIQUE collision** — same as
   ``test_col_shift``. SQLite iterates UPDATE by rowid not PK order,
   so a naive in-place shift collides on
   ``UNIQUE(sheet_id, row_idx, col_idx)``. The negative-buffer
   trick dodges it; tests insert in deliberately scrambled order.

2. **Uniform CASE branch coverage** — the CASE expression handles
   both directions (``final_start < src_start`` and
   ``final_start > src_end``) in a single SQL block. We test both
   directions plus boundary cases (block at the very start / end of
   the sheet).
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
            "WHERE sheet_id = ? ORDER BY col_idx, row_idx",
            [sheet],
        )
    ]


def move_cols(
    conn: sqlite3.Connection,
    src_start: int,
    src_end: int,
    final_start: int,
    sheet: str = "s",
):
    """Run the cell-table half of the move-cols shift via the
    codegened helpers. Same call order ``SheetDB.move_columns`` uses.
    """
    width = src_end - src_start + 1
    low = min(src_start, final_start)
    high = max(src_end, final_start + width - 1)
    _queries.move_cell_cols_to_buffer(conn, sheet_id=sheet, low=low, high=high)
    _queries.move_cell_cols_from_buffer(
        conn,
        sheet_id=sheet,
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
        width=width,
    )


# ---------------------------------------------------------------------------
# Single-column moves
# ---------------------------------------------------------------------------


class TestSingleColumnMove:
    def test_move_left(self, conn):
        # A B C D E → drag D between B and C → A B D C E.
        # cells in cols 0..4; src=3, final=2.
        seed(conn, [(0, c, f"c{c}") for c in range(5)])
        move_cols(conn, src_start=3, src_end=3, final_start=2)
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c1"),
            (0, 2, "c3"),  # old D landed at C
            (0, 3, "c2"),  # old C pushed right to D
            (0, 4, "c4"),
        ]

    def test_move_right(self, conn):
        # A B C D E → drag B to end → A C D E B.
        # src=1, final=4.
        seed(conn, [(0, c, f"c{c}") for c in range(5)])
        move_cols(conn, src_start=1, src_end=1, final_start=4)
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c2"),
            (0, 2, "c3"),
            (0, 3, "c4"),
            (0, 4, "c1"),  # old B at the end
        ]

    def test_move_to_start(self, conn):
        # A B C D E → drag D to before A → D A B C E.
        # src=3, final=0.
        seed(conn, [(0, c, f"c{c}") for c in range(5)])
        move_cols(conn, src_start=3, src_end=3, final_start=0)
        assert current(conn) == [
            (0, 0, "c3"),
            (0, 1, "c0"),
            (0, 2, "c1"),
            (0, 3, "c2"),
            (0, 4, "c4"),
        ]

    def test_move_outside_band_untouched(self, conn):
        # A..F → move D between B and C. col F is outside the band.
        seed(conn, [(0, c, f"c{c}") for c in range(6)])
        move_cols(conn, src_start=3, src_end=3, final_start=2)
        # F (col 5) sits past max(src_end, final_start+width-1) = 3,
        # so the move-from-buffer pass shouldn't touch it.
        assert (0, 5, "c5") in current(conn)

    def test_multiple_rows_each_row_moves(self, conn):
        # Three rows, each with five cols.
        seed(conn, [(r, c, f"r{r}c{c}") for r in range(3) for c in range(5)])
        move_cols(conn, src_start=3, src_end=3, final_start=2)
        for r in range(3):
            assert (r, 2, f"r{r}c3") in current(conn)
            assert (r, 3, f"r{r}c2") in current(conn)


# ---------------------------------------------------------------------------
# Block moves (multi-column)
# ---------------------------------------------------------------------------


class TestBlockMove:
    def test_block_move_left(self, conn):
        # A B C D E F → move C:E (cols 2..4) to the start → C D E A B F.
        # src_start=2, src_end=4, final_start=0.
        seed(conn, [(0, c, f"c{c}") for c in range(6)])
        move_cols(conn, src_start=2, src_end=4, final_start=0)
        assert current(conn) == [
            (0, 0, "c2"),
            (0, 1, "c3"),
            (0, 2, "c4"),
            (0, 3, "c0"),
            (0, 4, "c1"),
            (0, 5, "c5"),
        ]

    def test_block_move_right(self, conn):
        # A B C D E F → move B:D (cols 1..3) to start at index 4 → A E B C D F.
        # The block of width 3 lands at indices 4..6 — but with 6 cols
        # total, the last index of the block is 5 (=4+3-1=6 invalid).
        # Pick a sheet wide enough: 7 cols (A..G).
        seed(conn, [(0, c, f"c{c}") for c in range(7)])
        # Move B:D → start at 4 → A E F G B C D … wait let me recompute.
        # src=1..3, final_start=4. width=3, band [1, 6].
        # forward: 0→0; 1..3 → 4,5,6; 4..6 → 1..3 (subtract width).
        move_cols(conn, src_start=1, src_end=3, final_start=4)
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c4"),
            (0, 2, "c5"),
            (0, 3, "c6"),
            (0, 4, "c1"),
            (0, 5, "c2"),
            (0, 6, "c3"),
        ]


# ---------------------------------------------------------------------------
# Scrambled-rowid regression — UNIQUE(sheet_id, row_idx, col_idx)
# ---------------------------------------------------------------------------


class TestScrambledInsertOrder:
    """Reproduces the collision a naive in-place ``SET col_idx =
    col_idx + 1`` would hit when SQLite scans by rowid not PK order.
    Inserts cells in deliberately scrambled order, then runs the
    move; the negative-buffer two-pass should still produce the
    correct final layout.
    """

    def test_scrambled_left_move(self, conn):
        # Insert cols in scrambled order: 4, 0, 3, 1, 2.
        for c in [4, 0, 3, 1, 2]:
            conn.execute(
                "INSERT INTO datasette_sheets_cell "
                "(sheet_id, row_idx, col_idx, raw_value) VALUES (?, ?, ?, ?)",
                ["s", 0, c, f"c{c}"],
            )
        move_cols(conn, src_start=3, src_end=3, final_start=2)
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c1"),
            (0, 2, "c3"),
            (0, 3, "c2"),
            (0, 4, "c4"),
        ]

    def test_scrambled_right_move(self, conn):
        for c in [3, 1, 4, 0, 2]:
            conn.execute(
                "INSERT INTO datasette_sheets_cell "
                "(sheet_id, row_idx, col_idx, raw_value) VALUES (?, ?, ?, ?)",
                ["s", 0, c, f"c{c}"],
            )
        # Move B (1) → after E (final_start=4).
        move_cols(conn, src_start=1, src_end=1, final_start=4)
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c2"),
            (0, 2, "c3"),
            (0, 3, "c4"),
            (0, 4, "c1"),
        ]


# ---------------------------------------------------------------------------
# Sheet isolation
# ---------------------------------------------------------------------------


def test_other_sheet_untouched(conn):
    """Moves on one sheet must not bleed into another."""
    seed(conn, [(0, c, f"c{c}") for c in range(5)], sheet="s1")
    seed(conn, [(0, c, f"d{c}") for c in range(5)], sheet="s2")
    move_cols(conn, src_start=3, src_end=3, final_start=2, sheet="s1")
    assert current(conn, "s2") == [
        (0, 0, "d0"),
        (0, 1, "d1"),
        (0, 2, "d2"),
        (0, 3, "d3"),
        (0, 4, "d4"),
    ]


# ---------------------------------------------------------------------------
# Column-meta table parity
# ---------------------------------------------------------------------------


def test_column_meta_shift_mirror(conn):
    """The column-meta helpers run the same shape against
    ``datasette_sheets_column``. Sanity-check that they preserve
    name and width while swapping col_idx the same way."""
    conn.executemany(
        "INSERT INTO datasette_sheets_column "
        "(sheet_id, col_idx, name, width) VALUES (?, ?, ?, ?)",
        [("s", c, f"col{c}", 100 + c) for c in range(5)],
    )
    src_start, src_end, final_start = 3, 3, 2
    width = src_end - src_start + 1
    low = min(src_start, final_start)
    high = max(src_end, final_start + width - 1)
    _queries.move_column_meta_to_buffer(conn, sheet_id="s", low=low, high=high)
    _queries.move_column_meta_from_buffer(
        conn,
        sheet_id="s",
        src_start=src_start,
        src_end=src_end,
        final_start=final_start,
        width=width,
    )
    rows = list(
        conn.execute(
            "SELECT col_idx, name, width FROM datasette_sheets_column "
            "WHERE sheet_id = ? ORDER BY col_idx",
            ["s"],
        )
    )
    assert rows == [
        (0, "col0", 100),
        (1, "col1", 101),
        (2, "col3", 103),  # old D
        (3, "col2", 102),  # old C
        (4, "col4", 104),
    ]
