"""Integration tests for :meth:`SheetDB.move_rows`.

Mirror of :mod:`tests.test_col_move` on the row axis. The HTTP
route ``POST /rows/move`` lands in att ``eu1tfy2o``; those
route-level tests live in :mod:`tests.test_rows`. This file
covers everything *under* the route — orchestrator, formula
rewrite, named-range rewrite, view-row-bound update, recalc.
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest
from datasette.app import Datasette

from datasette_sheets.db import SheetDB


def make_datasette():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return (
        Datasette(
            [tmp.name],
            config={"permissions": {"datasette-sheets-access": True}},
        ),
        os.path.basename(tmp.name).replace(".db", ""),
    )


async def make_sheet(ds, db_name):
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    return SheetDB(ds.get_database(db_name)), data["workbook"]["id"], data["sheet"]["id"]


async def post_cells(ds, db_name, wb_id, sheet_id, cells):
    return await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb_id}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {"row_idx": r, "col_idx": c, "raw_value": v}
                    for (r, c, v) in cells
                ]
            }
        ),
    )


async def get_cells(ds, db_name, sheet_id):
    db = ds.get_database(db_name)
    return [
        (r["row_idx"], r["col_idx"], r["raw_value"], r["computed_value"])
        for r in await db.execute(
            "SELECT row_idx, col_idx, raw_value, computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ? ORDER BY row_idx, col_idx",
            [sheet_id],
        )
    ]


# ---------------------------------------------------------------------------
# Basic moves
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_row_4_above_row_3():
    """Drag row 4 (idx 3) above row 3 (idx 2) — drop at gap 2."""
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(r, 0, f"r{r}") for r in range(5)])

    result = await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=2)

    assert result == {"src_start": 3, "src_end": 3, "final_start": 2, "width": 1}
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [
        (0, 0, "r0"),
        (1, 0, "r1"),
        (2, 0, "r3"),  # old row 3 lands above old row 3 → at row 2
        (3, 0, "r2"),  # old row 2 pushed down
        (4, 0, "r4"),
    ]


@pytest.mark.asyncio
async def test_move_row_to_bottom():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(r, 0, f"r{r}") for r in range(5)])

    # Drop row 1 at gap 5 (after the last row).
    result = await db.move_rows(sheet_id, src_start=1, src_end=1, dest_gap=5)

    assert result == {"src_start": 1, "src_end": 1, "final_start": 4, "width": 1}
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [
        (0, 0, "r0"),
        (1, 0, "r2"),
        (2, 0, "r3"),
        (3, 0, "r4"),
        (4, 0, "r1"),
    ]


@pytest.mark.asyncio
async def test_block_move():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(r, 0, f"r{r}") for r in range(7)])

    # Move rows 1..3 to start at index 4. dest_gap = 7.
    result = await db.move_rows(sheet_id, src_start=1, src_end=3, dest_gap=7)

    assert result == {"src_start": 1, "src_end": 3, "final_start": 4, "width": 3}
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [
        (0, 0, "r0"),
        (1, 0, "r4"),
        (2, 0, "r5"),
        (3, 0, "r6"),
        (4, 0, "r1"),
        (5, 0, "r2"),
        (6, 0, "r3"),
    ]


# ---------------------------------------------------------------------------
# No-op cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_in_place_returns_none():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(r, 0, f"r{r}") for r in range(5)])

    assert await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=3) is None
    assert await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=4) is None
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [(r, 0, f"r{r}") for r in range(5)]


@pytest.mark.asyncio
async def test_move_inside_source_range_is_noop():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(r, 0, f"r{r}") for r in range(5)])

    # Block 1..3 dropped at gap 2 — inside the source range.
    assert await db.move_rows(sheet_id, src_start=1, src_end=3, dest_gap=2) is None


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_inputs_raise():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)

    with pytest.raises(ValueError):
        await db.move_rows(sheet_id, src_start=-1, src_end=3, dest_gap=2)
    with pytest.raises(ValueError):
        await db.move_rows(sheet_id, src_start=3, src_end=1, dest_gap=2)
    with pytest.raises(ValueError):
        await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=-1)


# ---------------------------------------------------------------------------
# Cell format follows the data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cell_format_json_follows_data():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # Bold cell at A4 (row 3, col 0).
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 3,
                        "col_idx": 0,
                        "raw_value": "bold!",
                        "format_json": json.dumps({"bold": True}),
                    },
                ]
            }
        ),
    )

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    rows = list(
        await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value, format_json FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    )
    bold = [r for r in rows if r["raw_value"] == "bold!"][0]
    # Bold cell now at A2 (row 1, col 0).
    assert (bold["row_idx"], bold["col_idx"]) == (1, 0)
    assert json.loads(bold["format_json"]) == {"bold": True}


# ---------------------------------------------------------------------------
# Formula rewrite — cell formulas
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_cell_ref_follows_data():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # B1 = =A4, A4 = 42. Move row 4 (idx 3) above row 2 (gap 1).
    await post_cells(ds, db_name, wb, sheet_id, [(0, 1, "=A4"), (3, 0, "42")])

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    rows = {
        (r["row_idx"], r["col_idx"]): (r["raw_value"], r["computed_value"])
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value, computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    # B1's formula now points at A2 (where the data landed).
    assert rows[(0, 1)][0] == "=A2"
    assert rows[(0, 1)][1] == 42
    # The 42 lives at A2 now.
    assert rows[(1, 0)][0] == "42"


@pytest.mark.asyncio
async def test_whole_row_ref_follows():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # F1 = =SUM(4:4); A4=10, B4=20.
    await post_cells(
        ds,
        db_name,
        wb,
        sheet_id,
        [(0, 5, "=SUM(4:4)"), (3, 0, "10"), (3, 1, "20")],
    )

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    rows = {
        (r["row_idx"], r["col_idx"]): (r["raw_value"], r["computed_value"])
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value, computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(0, 5)][0] == "=SUM(2:2)"
    assert rows[(0, 5)][1] == 30


@pytest.mark.asyncio
async def test_bounded_range_in_cell_formula_stays_positional():
    """Cell-formula bounded ranges denote rectangles — they
    shouldn't move when one of their rows permutes inside."""
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # F1 = =SUM(A1:D4). Bounded range — should NOT rewrite.
    await post_cells(
        ds,
        db_name,
        wb,
        sheet_id,
        [(0, 5, "=SUM(A1:D4)"), (0, 0, "1"), (1, 0, "2"), (2, 0, "3"), (3, 0, "4")],
    )

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    rows = {
        (r["row_idx"], r["col_idx"]): r["raw_value"]
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(0, 5)] == "=SUM(A1:D4)"  # unchanged


@pytest.mark.asyncio
async def test_whole_col_ref_unaffected_by_row_move():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # F1 = =SUM(A:A); whole-col ref — row move shouldn't touch it.
    await post_cells(ds, db_name, wb, sheet_id, [(0, 5, "=SUM(A:A)"), (0, 0, "5")])

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    rows = {
        (r["row_idx"], r["col_idx"]): r["raw_value"]
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(0, 5)] == "=SUM(A:A)"


@pytest.mark.asyncio
async def test_absolute_marker_preserved():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, wb, sheet_id, [(0, 5, "=$A$4"), (3, 0, "99")])

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    rows = {
        (r["row_idx"], r["col_idx"]): r["raw_value"]
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(0, 5)] == "=$A$2"


# ---------------------------------------------------------------------------
# Named-range rewrite — uses the data-following variant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_named_range_definition_rewrites():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # Single-cell named range pointing at row 4 → follows.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Anchor", "definition": "=A4"}),
    )
    # Whole-row named range → follows.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "HeaderRow", "definition": "=4:4"}),
    )
    # Bounded range with partial overlap of the moved row → follows
    # via interior-bbox (data-following variant).
    # Range A3:A4 covers rows 2..3. Move row 3 (idx 3) to row 2
    # (idx 1, dest_gap=1, final_start=1).
    # forward(2) = 3, forward(3) = 1. bbox {1, 3} → A2:A4.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "RangeNamed", "definition": "=A3:A4"}),
    )
    # Literal — never rewritten.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Rate", "definition": "0.05"}),
    )

    await db.move_rows(sheet_id, src_start=3, src_end=3, dest_gap=1)

    defs = {
        r["name"]: r["definition"]
        for r in await ds.get_database(db_name).execute(
            "SELECT name, definition FROM _datasette_sheets_named_range "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert defs["Anchor"] == "=A2"
    assert defs["HeaderRow"] == "=2:2"
    assert defs["RangeNamed"] == "=A2:A4"  # data-following bbox
    assert defs["Rate"] == "0.05"


# ---------------------------------------------------------------------------
# View-registry row-bound update
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_view_min_max_row_update():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # Header + data rows; create a view over A2:B5 (rows 1..4).
    await post_cells(
        ds,
        db_name,
        wb,
        sheet_id,
        [
            (0, 0, "name"),
            (0, 1, "qty"),
            (1, 0, "alpha"),
            (1, 1, "1"),
            (2, 0, "beta"),
            (2, 1, "2"),
            (3, 0, "gamma"),
            (3, 1, "3"),
            (4, 0, "delta"),
            (4, 1, "4"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/views/create",
        content=json.dumps({"view_name": "v_rows", "range": "A2:B5"}),
    )
    assert resp.status_code in (200, 201), resp.text

    # Move row 5 (idx 4) above row 1 (idx 0, gap 0). The view's
    # range was rows 1..4. After move:
    # forward(1) = 2, forward(2) = 3, forward(3) = 4, forward(4) = 0.
    # bbox = {0, 2, 3, 4} = [0, 4] → min_row=0, max_row=4.
    await db.move_rows(sheet_id, src_start=4, src_end=4, dest_gap=0)

    view_row = (
        await ds.get_database(db_name).execute(
            "SELECT min_row, max_row FROM _datasette_sheets_view "
            "WHERE sheet_id = ? AND view_name = ?",
            [sheet_id, "v_rows"],
        )
    ).first()
    assert view_row["min_row"] == 0
    assert view_row["max_row"] == 4
