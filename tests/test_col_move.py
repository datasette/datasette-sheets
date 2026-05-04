"""Integration tests for :meth:`SheetDB.move_columns`.

The HTTP route ``POST /columns/move`` lands in att ``nmc93qhu``;
those route-level tests live in :mod:`tests.test_cols`. This file
covers everything *under* the route — the orchestrator method
itself, the formula-rewrite pass, the named-range rewrite, the
view-bound update, and the recalc loop integration.

Test surface (mirrors the att ticket's table):

  - basic single / block moves with cells-only payload
  - column-metadata follows the data (names, widths, formats)
  - cell-level format_json follows the data
  - formula refs follow per the engine's semantics
    (single cells, whole-col, bounded ranges, absolute markers,
    spill anchors)
  - named-range definitions rewritten
  - view-registry ``min_col``/``max_col`` updated
  - no-op cases return None and don't touch the DB
  - input validation raises ``ValueError``
  - recalc actually runs on the new layout (computed values are
    correct after move)
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
    """Create a workbook + auto-sheet, return (db, wb_id, sheet_id)."""
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/create",
        content=json.dumps({"name": "T"}),
    )
    data = resp.json()
    return SheetDB(ds.get_database(db_name)), data["workbook"]["id"], data["sheet"]["id"]


async def post_cells(ds, db_name, wb_id, sheet_id, cells):
    """Seed (row, col, value) tuples through the cells endpoint so
    the typed-input + recalc pipeline runs."""
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
            "WHERE sheet_id = ? ORDER BY col_idx, row_idx",
            [sheet_id],
        )
    ]


async def get_columns(ds, db_name, sheet_id):
    db = ds.get_database(db_name)
    return [
        (r["col_idx"], r["name"], r["width"], r["format_json"])
        for r in await db.execute(
            "SELECT col_idx, name, width, format_json FROM _datasette_sheets_column "
            "WHERE sheet_id = ? ORDER BY col_idx",
            [sheet_id],
        )
    ]


# ---------------------------------------------------------------------------
# Basic moves
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_d_between_b_and_c():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(0, c, f"c{c}") for c in range(5)])

    result = await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    assert result == {"src_start": 3, "src_end": 3, "final_start": 2, "width": 1}
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [
        (0, 0, "c0"),
        (0, 1, "c1"),
        (0, 2, "c3"),  # old D landed at C
        (0, 3, "c2"),  # old C pushed right to D
        (0, 4, "c4"),
    ]


@pytest.mark.asyncio
async def test_move_b_to_end():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(0, c, f"c{c}") for c in range(5)])

    # Drop B (col 1) at gap 5 (after the last column). Block of width 1
    # → final_start = dest_gap - width = 4.
    result = await db.move_columns(sheet_id, src_start=1, src_end=1, dest_gap=5)

    assert result == {"src_start": 1, "src_end": 1, "final_start": 4, "width": 1}
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [
        (0, 0, "c0"),
        (0, 1, "c2"),
        (0, 2, "c3"),
        (0, 3, "c4"),
        (0, 4, "c1"),  # B at the far right
    ]


@pytest.mark.asyncio
async def test_block_move():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(0, c, f"c{c}") for c in range(7)])

    # Move B:D (cols 1..3) to start at index 4. dest_gap = 7 (after the
    # last col), final_start = 7 - 3 = 4.
    result = await db.move_columns(sheet_id, src_start=1, src_end=3, dest_gap=7)

    assert result == {"src_start": 1, "src_end": 3, "final_start": 4, "width": 3}
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [
        (0, 0, "c0"),
        (0, 1, "c4"),
        (0, 2, "c5"),
        (0, 3, "c6"),
        (0, 4, "c1"),
        (0, 5, "c2"),
        (0, 6, "c3"),
    ]


# ---------------------------------------------------------------------------
# No-op cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_in_place_returns_none():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(0, c, f"c{c}") for c in range(5)])

    # Drop on the source position itself.
    assert await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=3) is None
    # Drop just after the source range (still no-op — same final position).
    assert await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=4) is None
    cells = [(r, c, raw) for (r, c, raw, _) in await get_cells(ds, db_name, sheet_id)]
    assert cells == [(0, c, f"c{c}") for c in range(5)]


@pytest.mark.asyncio
async def test_move_inside_source_range_is_noop():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, _wb, sheet_id, [(0, c, f"c{c}") for c in range(5)])

    # Block B:D (1..3), drop at gap 2 (between B and C — inside the
    # source range). No-op.
    assert await db.move_columns(sheet_id, src_start=1, src_end=3, dest_gap=2) is None


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_inputs_raise():
    ds, db_name = make_datasette()
    db, _wb, sheet_id = await make_sheet(ds, db_name)

    with pytest.raises(ValueError):
        await db.move_columns(sheet_id, src_start=-1, src_end=3, dest_gap=2)
    with pytest.raises(ValueError):
        await db.move_columns(sheet_id, src_start=3, src_end=1, dest_gap=2)
    with pytest.raises(ValueError):
        await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=-1)


# ---------------------------------------------------------------------------
# Column metadata + cell format follow the data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_column_metadata_moves_with_block():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, wb, sheet_id, [(0, c, f"c{c}") for c in range(5)])

    # Customize column D (idx 3): rename + resize. The endpoint is
    # /columns (no /update suffix — the router doesn't method-dispatch
    # so the lone POST takes that slot).
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/columns",
        content=json.dumps(
            {"columns": [{"col_idx": 3, "name": "Price", "width": 200}]}
        ),
    )
    assert resp.status_code == 200, resp.text

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    cols_by_idx = {c[0]: c for c in await get_columns(ds, db_name, sheet_id)}
    # The custom row for old col 3 should now sit at col 2.
    assert cols_by_idx[2][1] == "Price"
    assert cols_by_idx[2][2] == 200


@pytest.mark.asyncio
async def test_cell_format_json_follows_data():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # Put a bold cell at D5 (row 4, col 3).
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/cells",
        content=json.dumps(
            {
                "changes": [
                    {
                        "row_idx": 4,
                        "col_idx": 3,
                        "raw_value": "bold!",
                        "format_json": json.dumps({"bold": True}),
                    },
                ]
            }
        ),
    )

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    rows = list(
        await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value, format_json FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    )
    # Bold cell now at C5 (row 4, col 2).
    bold = [r for r in rows if r["raw_value"] == "bold!"][0]
    assert (bold["row_idx"], bold["col_idx"]) == (4, 2)
    assert json.loads(bold["format_json"]) == {"bold": True}


# ---------------------------------------------------------------------------
# Formula rewrite — the meaty branch table
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_cell_ref_follows_data():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # A1 = =D1, D1 = 42. Move D between B/C.
    await post_cells(ds, db_name, wb, sheet_id, [(0, 0, "=D1"), (0, 3, "42")])

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    rows = {
        (r["row_idx"], r["col_idx"]): (r["raw_value"], r["computed_value"])
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value, computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    # A1 raw rewrites to =C1; computed value still 42 (the cell at C
    # is now where D used to be).
    assert rows[(0, 0)][0] == "=C1"
    assert rows[(0, 0)][1] == 42
    # D's data is now at C.
    assert rows[(0, 2)][0] == "42"


@pytest.mark.asyncio
async def test_whole_col_ref_follows():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # A1 = =SUM(D:D), D1=10, D2=20.
    await post_cells(
        ds, db_name, wb, sheet_id, [(0, 0, "=SUM(D:D)"), (0, 3, "10"), (1, 3, "20")]
    )

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    rows = {
        (r["row_idx"], r["col_idx"]): (r["raw_value"], r["computed_value"])
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value, computed_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(0, 0)][0] == "=SUM(C:C)"
    assert rows[(0, 0)][1] == 30  # 10 + 20


@pytest.mark.asyncio
async def test_bounded_range_stays_positional():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # A2 (row 1) = =SUM(A1:D1). Bounded ranges are positional — should
    # NOT rewrite even though col D moves. (Formula sits at A2 so the
    # bounded range A1:D1 doesn't include the formula cell — avoiding
    # a circular ref.)
    await post_cells(
        ds,
        db_name,
        wb,
        sheet_id,
        [(1, 0, "=SUM(A1:D1)"), (0, 0, "1"), (0, 1, "1"), (0, 2, "2"), (0, 3, "4")],
    )

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    rows = {
        (r["row_idx"], r["col_idx"]): r["raw_value"]
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(1, 0)] == "=SUM(A1:D1)"  # unchanged


@pytest.mark.asyncio
async def test_absolute_marker_preserved():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    await post_cells(ds, db_name, wb, sheet_id, [(0, 0, "=$D$1"), (0, 3, "99")])

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    rows = {
        (r["row_idx"], r["col_idx"]): r["raw_value"]
        for r in await ds.get_database(db_name).execute(
            "SELECT row_idx, col_idx, raw_value FROM _datasette_sheets_cell "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert rows[(0, 0)] == "=$C$1"


# ---------------------------------------------------------------------------
# Named-range rewrite
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_named_range_definition_rewrites():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # Whole-column named range → follows the move via the engine's
    # interior-bbox semantics.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "PricesCol", "definition": "=D:D"}),
    )
    # Single-cell named range → follows.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Anchor", "definition": "=D5"}),
    )
    # Bounded range in a named-range definition → ALSO follows the
    # data, via the engine's data-following variant
    # (lotus.adjust_refs_for_column_block_move_data_following). This
    # is the user-facing behaviour: a named bounded range tracks
    # the cells the user named, not the rectangle of cells that
    # used to live there. (Cell-formula bounded ranges keep the
    # positional semantic — see test_bounded_range_stays_positional
    # below.)
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "PricesBounded", "definition": "=D1:D10"}),
    )
    # Literal — never rewritten.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "TaxRate", "definition": "0.05"}),
    )

    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    defs = {
        r["name"]: r["definition"]
        for r in await ds.get_database(db_name).execute(
            "SELECT name, definition FROM _datasette_sheets_named_range "
            "WHERE sheet_id = ?",
            [sheet_id],
        )
    }
    assert defs["PricesCol"] == "=C:C"
    assert defs["Anchor"] == "=C5"
    # Bounded range follows the data: forward_col(D=3) = 2 → C.
    assert defs["PricesBounded"] == "=C1:C10"
    assert defs["TaxRate"] == "0.05"


@pytest.mark.asyncio
async def test_named_bounded_range_follows_block_move():
    """Multi-col block move — bounded named range straddling the
    block grows to cover the new positions of every interior col.
    Pins the data-following semantic for the multi-col case."""
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)

    # Range covers C:D (cols 2..3). Move B:D (cols 1..3) to start
    # at 4 → forward({2,3}) = {5,6} → bbox 5..6 = F:G.
    await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/names/set",
        content=json.dumps({"name": "Region", "definition": "=C1:D10"}),
    )

    await db.move_columns(sheet_id, src_start=1, src_end=3, dest_gap=7)

    row = (
        await ds.get_database(db_name).execute(
            "SELECT definition FROM _datasette_sheets_named_range "
            "WHERE sheet_id = ? AND name = ?",
            [sheet_id, "Region"],
        )
    ).first()
    assert row["definition"] == "=F1:G10"


# ---------------------------------------------------------------------------
# View-registry bound update
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_view_min_max_col_update():
    ds, db_name = make_datasette()
    db, wb, sheet_id = await make_sheet(ds, db_name)
    # Header row + a couple of data rows; create a view over D:E
    # (cols 3..4).
    await post_cells(
        ds,
        db_name,
        wb,
        sheet_id,
        [
            (0, 3, "name"),
            (0, 4, "qty"),
            (1, 3, "alpha"),
            (1, 4, "1"),
            (2, 3, "beta"),
            (2, 4, "2"),
        ],
    )
    resp = await ds.client.post(
        f"/{db_name}/-/sheets/api/workbooks/{wb}/sheets/{sheet_id}/views/create",
        content=json.dumps({"view_name": "v_de", "range": "D1:E3"}),
    )
    assert resp.status_code in (200, 201), resp.text

    # Move D between B and C — D's data lands at col 2; E (col 4) is
    # outside the affected band, so its index doesn't change.
    # The interior bbox of {2, 4} = [2, 4], so view bounds become
    # min_col=2, max_col=4.
    await db.move_columns(sheet_id, src_start=3, src_end=3, dest_gap=2)

    view_row = (
        await ds.get_database(db_name).execute(
            "SELECT min_col, max_col FROM _datasette_sheets_view "
            "WHERE sheet_id = ? AND view_name = ?",
            [sheet_id, "v_de"],
        )
    ).first()
    assert view_row["min_col"] == 2
    assert view_row["max_col"] == 4
