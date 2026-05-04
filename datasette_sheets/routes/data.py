import lotus

from datasette import Response
from ..router import router, check_permission
from ..db import reconstruct_typed
from .helpers import ensure_db

SH = r"/(?P<database>[^/]+)/-/sheets/api/workbooks/(?P<workbook_id>\d+)/sheets/(?P<sheet_id>\d+)"
MAX_ROW = 99
MAX_COL = 14


def parse_range(range_str: str) -> tuple[int, int, int, int] | None:
    """Return ``(min_row, min_col, max_row, max_col)`` or ``None`` on failure.

    The heavy lifting is in the Rust ``lotus.parse_range`` — this
    wrapper just maps its dict output into the legacy tuple shape callers
    expect, substituting :data:`MAX_ROW` for an unbounded end.
    """
    try:
        r = lotus.parse_range(range_str)
    except ValueError:
        return None
    start = r["start"]
    end_row = r["end_row"] if r["end_row"] is not None else MAX_ROW
    return (start["row"], start["col"], end_row, r["end_col"])


@router.GET(SH + r"/data" + r"$")
@check_permission()
async def sheet_data(
    datasette, request, database: str, workbook_id: int, sheet_id: int
):
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    cells = await db.get_cells(sheet_id)
    columns = await db.get_columns(sheet_id)
    fmt = request.args.get("format", "arrays")
    range_str = request.args.get("range")
    if not cells:
        return Response.json({"columns": [c.name for c in columns], "rows": []})
    max_row, max_col = max(c.row_idx for c in cells), max(c.col_idx for c in cells)
    if range_str:
        bounds = parse_range(range_str)
        if not bounds:
            return Response.json({"error": f"Invalid range: {range_str}"}, status=400)
        min_row, min_col, rmr, rmc = bounds
    else:
        min_row, min_col, rmr, rmc = 0, 0, max_row, max_col
    # ``reconstruct_typed`` lifts INTEGER 0/1 back to Python ``bool``
    # when ``computed_value_kind == 'bool'`` so a comparison cell
    # (=A1<5) renders as JSON ``true``/``false`` rather than ``1``/``0``.
    cell_map = {
        (c.row_idx, c.col_idx): (
            reconstruct_typed(c.computed_value, c.computed_value_kind)
            if c.computed_value is not None
            else c.raw_value
        )
        for c in cells
    }
    range_cols = [lotus.index_to_col(i) for i in range(min_col, rmc + 1)]
    rows = []
    for r in range(min_row, rmr + 1):
        if fmt == "objects":
            rows.append(
                {
                    cn: cell_map.get((r, min_col + ci), "")
                    for ci, cn in enumerate(range_cols)
                }
            )
        else:
            rows.append(
                [cell_map.get((r, min_col + ci), "") for ci in range(len(range_cols))]
            )
    result: dict = {"columns": range_cols, "rows": rows}
    if range_str:
        result["range"] = range_str.upper()
    return Response.json(result)


@router.GET(SH + r"/data/(?P<cell_id>[A-Za-z]+\d+)$")
@check_permission()
async def sheet_cell_data(
    datasette, request, database: str, workbook_id: int, sheet_id: int, cell_id: str
):
    cell_id = cell_id.upper()
    db = await ensure_db(datasette, database)
    sheet = await db.get_sheet(sheet_id)
    if not sheet:
        return Response.json({"error": "Sheet not found"}, status=404)
    try:
        coord = lotus.parse_cell_id(cell_id)
    except ValueError:
        return Response.json({"error": f"Invalid cell ID: {cell_id}"}, status=400)
    row_idx, col_idx = coord["row"], coord["col"]
    for c in await db.get_cells(sheet_id):
        if c.row_idx == row_idx and c.col_idx == col_idx:
            return Response.json(
                {
                    "cell": cell_id,
                    "raw_value": c.raw_value,
                    "computed_value": reconstruct_typed(
                        c.computed_value, c.computed_value_kind
                    ),
                    "format_json": c.format_json,
                }
            )
    return Response.json(
        {"cell": cell_id, "raw_value": "", "computed_value": None, "format_json": None}
    )
