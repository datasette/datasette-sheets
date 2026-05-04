"""Tests for the column-shift SQL that powers
:meth:`SheetDB.delete_columns`.

Mirrors :mod:`tests.test_row_shift` but on ``col_idx``. The real
method shifts both ``datasette_sheets_cell`` and
``datasette_sheets_column`` via the same two-pass negative-buffer
pattern; these tests exercise the cell-table shift in isolation
via the codegened helpers. The integration suite
(:mod:`tests.test_cols`) covers the column-table shift + HTTP
plumbing.
"""

from __future__ import annotations

import json
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


def seed(conn: sqlite3.Connection, cells: list[tuple[int, int, str]], sheet: str = "s"):
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


def delete_cols(conn: sqlite3.Connection, indices: list[int], sheet: str = "s"):
    """Run the cell-table half of the delete-columns shift via the
    codegened helpers. Same call order ``SheetDB.delete_columns`` uses.
    """
    if not indices:
        return
    normalized = sorted({int(i) for i in indices if int(i) >= 0})
    if not normalized:
        return
    indices_json = json.dumps(normalized)
    _queries.delete_cells_in_cols(conn, sheet_id=sheet, col_indices_json=indices_json)
    _queries.shift_cell_cols_to_buffer(
        conn, sheet_id=sheet, col_indices_json=indices_json
    )
    _queries.shift_cell_cols_from_buffer(
        conn, col_indices_json=indices_json, sheet_id=sheet
    )


# ---------------------------------------------------------------------------
# Contiguous deletions
# ---------------------------------------------------------------------------


class TestContiguousDeletion:
    def test_delete_single_column(self, conn):
        # One row, five columns.
        seed(conn, [(0, c, f"c{c}") for c in range(5)])
        delete_cols(conn, [2])
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c1"),
            (0, 2, "c3"),
            (0, 3, "c4"),
        ]

    def test_delete_leftmost_column(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(4)])
        delete_cols(conn, [0])
        assert current(conn) == [
            (0, 0, "c1"),
            (0, 1, "c2"),
            (0, 2, "c3"),
        ]

    def test_delete_rightmost_column_no_shift(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(4)])
        delete_cols(conn, [3])
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c1"),
            (0, 2, "c2"),
        ]

    def test_delete_contiguous_range(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(10)])
        delete_cols(conn, [3, 4, 5])
        expected = [(0, 0, "c0"), (0, 1, "c1"), (0, 2, "c2")]
        for new_idx, old_idx in enumerate(range(6, 10), start=3):
            expected.append((0, new_idx, f"c{old_idx}"))
        assert current(conn) == expected

    def test_multiple_rows_in_each_column_all_shift(self, conn):
        seed(conn, [(r, c, f"{r}-{c}") for r in range(3) for c in range(5)])
        delete_cols(conn, [1, 2])
        # Columns 0, 3, 4 survive; 3→1 and 4→2.
        expected = []
        for c_new, c_old in [(0, 0), (1, 3), (2, 4)]:
            for r in range(3):
                expected.append((r, c_new, f"{r}-{c_old}"))
        # current() sorts by col_idx then row_idx.
        expected.sort(key=lambda x: (x[1], x[0]))
        assert current(conn) == expected


# ---------------------------------------------------------------------------
# Non-contiguous deletions
# ---------------------------------------------------------------------------


class TestNonContiguousDeletion:
    def test_two_holes(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(11)])
        delete_cols(conn, [2, 5])
        deleted = {2, 5}
        surviving = [c for c in range(11) if c not in deleted]
        expected = [
            (0, c - sum(1 for d in deleted if d < c), f"c{c}") for c in surviving
        ]
        assert current(conn) == expected

    def test_three_spread_out(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(15)])
        delete_cols(conn, [1, 7, 12])
        deleted = {1, 7, 12}
        surviving = [c for c in range(15) if c not in deleted]
        expected = [
            (0, c - sum(1 for d in deleted if d < c), f"c{c}") for c in surviving
        ]
        assert current(conn) == expected

    def test_unsorted_duplicate_input(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(8)])
        delete_cols(conn, [5, 2, 5, 2, 5])
        expected = [
            (0, c - sum(1 for d in {2, 5} if d < c), f"c{c}")
            for c in range(8)
            if c not in {2, 5}
        ]
        assert current(conn) == expected


# ---------------------------------------------------------------------------
# Regression: scrambled rowid scan order
# ---------------------------------------------------------------------------


def test_scrambled_insert_order_does_not_collide(conn):
    """Same PK-collision hazard as for row deletes — SQLite iterates by
    rowid, not PK order. Insert cells out of order and confirm the shift
    still lands them correctly."""
    conn.executemany(
        "INSERT INTO datasette_sheets_cell (sheet_id, row_idx, col_idx, raw_value) "
        "VALUES (?, ?, ?, ?)",
        [
            ("s", 0, 5, "c5"),
            ("s", 0, 3, "c3"),
            ("s", 0, 4, "c4"),
            ("s", 0, 6, "c6"),
            ("s", 0, 0, "c0"),
            ("s", 0, 1, "c1"),
        ],
    )
    delete_cols(conn, [4])
    # Surviving: 0, 1, 3, 5, 6 → 0, 1, 3, 4, 5 (after -1 shift for cols > 4)
    assert current(conn) == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 3, "c3"),
        (0, 4, "c5"),
        (0, 5, "c6"),
    ]


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_indices_is_no_op(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(3)])
        delete_cols(conn, [])
        assert current(conn) == [(0, 0, "c0"), (0, 1, "c1"), (0, 2, "c2")]

    def test_indices_beyond_populated_cols_no_effect(self, conn):
        seed(conn, [(0, c, f"c{c}") for c in range(4)])
        delete_cols(conn, [7])
        assert current(conn) == [
            (0, 0, "c0"),
            (0, 1, "c1"),
            (0, 2, "c2"),
            (0, 3, "c3"),
        ]

    def test_sparse_cols_with_deletion_in_gap(self, conn):
        seed(conn, [(0, 0, "a"), (0, 1, "b"), (0, 5, "c"), (0, 6, "d")])
        delete_cols(conn, [3])
        # Cols 5 and 6 shift left by 1 → 4 and 5.
        assert current(conn) == [
            (0, 0, "a"),
            (0, 1, "b"),
            (0, 4, "c"),
            (0, 5, "d"),
        ]

    def test_other_sheets_untouched(self, conn):
        seed(conn, [(0, c, f"a{c}") for c in range(4)], sheet="a")
        seed(conn, [(0, c, f"b{c}") for c in range(4)], sheet="b")
        delete_cols(conn, [1], sheet="a")
        assert current(conn, "a") == [
            (0, 0, "a0"),
            (0, 1, "a2"),
            (0, 2, "a3"),
        ]
        assert current(conn, "b") == [
            (0, 0, "b0"),
            (0, 1, "b1"),
            (0, 2, "b2"),
            (0, 3, "b3"),
        ]
