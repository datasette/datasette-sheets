"""Tests for the two-pass negative-buffer shift that powers
:meth:`SheetDB.delete_rows`.

Exercises the codegened queries (``delete_cells_in_rows`` +
``shift_cell_rows_to_buffer`` + ``shift_cell_rows_from_buffer``)
directly against a real in-memory SQLite with
``migrations.apply()`` — no duplicated SQL strings, so any drift
between ``queries.sql`` and the test's expected shape shows up as
a test failure.

Covers contiguous and non-contiguous deletions, edge cases (top
row, no-op, out-of-range indices), and the scrambled-insert
regression that drove the negative-buffer idiom in the first
place (SQLite iterates UPDATE by rowid, not PK order, so a naive
``SET row_idx = row_idx - N`` can hit
``UNIQUE(sheet_id, row_idx, col_idx)`` mid-statement).
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


def seed(conn: sqlite3.Connection, rows: list[tuple[int, int, str]], sheet: str = "s"):
    """Insert (row_idx, col_idx, raw_value) triples under the given sheet."""
    conn.executemany(
        "INSERT INTO datasette_sheets_cell (sheet_id, row_idx, col_idx, raw_value) "
        "VALUES (?, ?, ?, ?)",
        [(sheet, r, c, v) for (r, c, v) in rows],
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


def delete_rows(conn: sqlite3.Connection, indices: list[int], sheet: str = "s"):
    """Run the delete-and-shift in the same order ``SheetDB.delete_rows``
    does, against the codegened helpers. A regression in either place
    shows up here.
    """
    if not indices:
        return
    normalized = sorted({int(i) for i in indices if int(i) >= 0})
    if not normalized:
        return
    indices_json = json.dumps(normalized)
    _queries.delete_cells_in_rows(conn, sheet_id=sheet, row_indices_json=indices_json)
    _queries.shift_cell_rows_to_buffer(
        conn, sheet_id=sheet, row_indices_json=indices_json
    )
    _queries.shift_cell_rows_from_buffer(
        conn, row_indices_json=indices_json, sheet_id=sheet
    )


# ---------------------------------------------------------------------------
# Contiguous deletions
# ---------------------------------------------------------------------------


class TestContiguousDeletion:
    def test_delete_single_row_shifts_rest_up(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(5)])
        delete_rows(conn, [2])
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r1"),
            (2, 0, "r3"),
            (3, 0, "r4"),
        ]

    def test_delete_top_row(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(4)])
        delete_rows(conn, [0])
        assert current(conn) == [
            (0, 0, "r1"),
            (1, 0, "r2"),
            (2, 0, "r3"),
        ]

    def test_delete_bottom_row_no_shift_needed(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(4)])
        delete_rows(conn, [3])
        # Nothing below row 3, so nothing to shift.
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r1"),
            (2, 0, "r2"),
        ]

    def test_delete_contiguous_range(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(10)])
        delete_rows(conn, [3, 4, 5])
        expected = [(0, 0, "r0"), (1, 0, "r1"), (2, 0, "r2")]
        # Rows 6..9 shift down by 3 → end up at 3..6.
        for new_idx, old_idx in enumerate(range(6, 10), start=3):
            expected.append((new_idx, 0, f"r{old_idx}"))
        assert current(conn) == expected

    def test_multiple_columns_on_each_row_all_shift_together(self, conn):
        seed(
            conn,
            [(r, c, f"{r}-{c}") for r in range(5) for c in range(3)],
        )
        delete_rows(conn, [1, 2])
        # Rows 0, 3, 4 survive; 3→1 and 4→2.
        assert current(conn) == [
            (0, 0, "0-0"),
            (0, 1, "0-1"),
            (0, 2, "0-2"),
            (1, 0, "3-0"),
            (1, 1, "3-1"),
            (1, 2, "3-2"),
            (2, 0, "4-0"),
            (2, 1, "4-1"),
            (2, 2, "4-2"),
        ]


# ---------------------------------------------------------------------------
# Non-contiguous deletions — the interesting case for correctness
# ---------------------------------------------------------------------------


class TestNonContiguousDeletion:
    def test_two_holes_shift_by_increasing_amounts(self, conn):
        """With rows 0..10 and deletions [2, 5]:
        - row 3 has 1 deleted below it  → new idx 2
        - row 4 has 1 deleted below it  → new idx 3
        - row 6 has 2 deleted below it  → new idx 4
        - row 7 has 2 deleted below it  → new idx 5
        …
        """
        seed(conn, [(r, 0, f"r{r}") for r in range(11)])
        delete_rows(conn, [2, 5])
        # Build the expected list from the rule.
        deleted = {2, 5}
        surviving = [r for r in range(11) if r not in deleted]
        expected = [
            (r - sum(1 for d in deleted if d < r), 0, f"r{r}") for r in surviving
        ]
        assert current(conn) == expected

    def test_three_spread_out_deletions(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(15)])
        delete_rows(conn, [1, 7, 12])
        deleted = {1, 7, 12}
        surviving = [r for r in range(15) if r not in deleted]
        expected = [
            (r - sum(1 for d in deleted if d < r), 0, f"r{r}") for r in surviving
        ]
        assert current(conn) == expected

    def test_unsorted_duplicate_input_is_normalized(self, conn):
        """Callers can pass messy input; the DELETE still matches once and
        the SHIFT counts each unique deletion once."""
        seed(conn, [(r, 0, f"r{r}") for r in range(8)])
        delete_rows(conn, [5, 2, 5, 2, 5])  # same as [2, 5]
        expected = [
            (r - sum(1 for d in {2, 5} if d < r), 0, f"r{r}")
            for r in range(8)
            if r not in {2, 5}
        ]
        assert current(conn) == expected


# ---------------------------------------------------------------------------
# No-op / edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_indices_is_no_op(self, conn):
        seed(conn, [(r, 0, f"r{r}") for r in range(3)])
        delete_rows(conn, [])
        assert current(conn) == [(0, 0, "r0"), (1, 0, "r1"), (2, 0, "r2")]

    def test_indices_beyond_populated_rows_only_shift_nothing(self, conn):
        """Deleting rows that don't have cells still shifts any populated
        rows below them. With only rows 0..3 present and deletion of [5]:
        no cells to delete, and MIN(deleted)=5 so the UPDATE filters to
        rows > 5 — which is none. Result: unchanged."""
        seed(conn, [(r, 0, f"r{r}") for r in range(4)])
        delete_rows(conn, [5])
        assert current(conn) == [
            (0, 0, "r0"),
            (1, 0, "r1"),
            (2, 0, "r2"),
            (3, 0, "r3"),
        ]

    def test_sparse_rows_with_deletion_in_gap(self, conn):
        """Sheet rows aren't always dense. Deleting an index with no
        populated cells should still shift whatever rows are below it."""
        seed(conn, [(0, 0, "a"), (1, 0, "b"), (5, 0, "c"), (6, 0, "d")])
        delete_rows(conn, [3])
        # Rows 5 and 6 shift down by 1 → 4 and 5. Rows 0, 1 unchanged.
        assert current(conn) == [
            (0, 0, "a"),
            (1, 0, "b"),
            (4, 0, "c"),
            (5, 0, "d"),
        ]

    def test_other_sheets_untouched(self, conn):
        seed(conn, [(r, 0, f"a{r}") for r in range(4)], sheet="a")
        seed(conn, [(r, 0, f"b{r}") for r in range(4)], sheet="b")
        delete_rows(conn, [1], sheet="a")
        assert current(conn, "a") == [
            (0, 0, "a0"),
            (1, 0, "a2"),
            (2, 0, "a3"),
        ]
        # Sheet b is untouched.
        assert current(conn, "b") == [
            (0, 0, "b0"),
            (1, 0, "b1"),
            (2, 0, "b2"),
            (3, 0, "b3"),
        ]


# ---------------------------------------------------------------------------
# Concurrency / ordering — regression guard
# ---------------------------------------------------------------------------


def test_shift_with_non_monotonic_insert_order(conn):
    """Regression for a production crash: when a user types cells in a
    scattered order (e.g. fills row 5 before row 3), the underlying rowid
    sequence doesn't match PK order. SQLite's UPDATE iterates by rowid,
    so an in-place ``row_idx = row_idx - N`` shift can hit an
    intermediate PK collision. The fix must produce the same final state
    regardless of insert order.
    """
    # Intentionally scrambled insert order — rowid 1 is row 5, rowid 2 is
    # row 3, etc. With an in-place shift-by-1, SQLite would try to move
    # row 5 → 4 while row 4 still exists → UNIQUE constraint failed.
    conn.executemany(
        "INSERT INTO datasette_sheets_cell (sheet_id, row_idx, col_idx, raw_value) "
        "VALUES (?, ?, ?, ?)",
        [
            ("s", 5, 0, "r5"),
            ("s", 3, 0, "r3"),
            ("s", 4, 0, "r4"),
            ("s", 6, 0, "r6"),
            ("s", 0, 0, "r0"),
            ("s", 1, 0, "r1"),
        ],
    )
    delete_rows(
        conn, [2]
    )  # no-op DELETE (no cells at 2), but shift still applies to >2
    assert current(conn) == [
        (0, 0, "r0"),
        (1, 0, "r1"),
        (2, 0, "r3"),  # was 3, shifted down by 1
        (3, 0, "r4"),  # was 4
        (4, 0, "r5"),  # was 5
        (5, 0, "r6"),  # was 6
    ]


def test_shift_with_scrambled_inserts_and_middle_delete(conn):
    """Same as above but actually deleting a row with scrambled order."""
    conn.executemany(
        "INSERT INTO datasette_sheets_cell (sheet_id, row_idx, col_idx, raw_value) "
        "VALUES (?, ?, ?, ?)",
        [
            ("s", 7, 0, "r7"),
            ("s", 3, 0, "r3"),
            ("s", 5, 0, "r5"),
            ("s", 4, 0, "r4"),
            ("s", 6, 0, "r6"),
            ("s", 0, 0, "r0"),
        ],
    )
    delete_rows(conn, [4])
    assert current(conn) == [
        (0, 0, "r0"),
        (3, 0, "r3"),
        (4, 0, "r5"),  # was 5
        (5, 0, "r6"),
        (6, 0, "r7"),
    ]


def test_shift_has_no_intermediate_pk_collisions(conn):
    """Shifting rows upward could in principle trip the unique PRIMARY
    KEY (sheet_id, row_idx, col_idx) mid-statement if SQLite evaluated
    the UPDATE row-by-row without freeing slots first. Empirically it
    doesn't — this pins that guarantee for our shape of UPDATE."""
    # Fill rows 0..9, every column 0..2 — a realistic-sized grid.
    seed(conn, [(r, c, f"{r}-{c}") for r in range(10) for c in range(3)])
    # Delete rows 2 and 4 and 6 — three non-adjacent, forces a non-trivial
    # shift pattern on every surviving row below.
    delete_rows(conn, [2, 4, 6])
    remaining = {r for r in range(10)} - {2, 4, 6}
    expected = []
    for r in sorted(remaining):
        shift = sum(1 for d in (2, 4, 6) if d < r)
        for c in range(3):
            expected.append((r - shift, c, f"{r}-{c}"))
    assert current(conn) == expected
