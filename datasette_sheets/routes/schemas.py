"""Pydantic models for HTTP request/response payloads.

These feed the OpenAPI doc emitted by `datasette_plugin_router` (via
`router.openapi_document_json()`), which the frontend consumes as generated
TypeScript types for its `openapi-fetch` client. Keep this file the single
source of truth for the API wire format.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# -- Records --------------------------------------------------------------


class SheetRecord(BaseModel):
    id: str
    name: str
    color: str
    created_at: str
    updated_at: str
    sort_order: int


class ColumnRecord(BaseModel):
    col_idx: int
    name: str
    width: int


class CellRecord(BaseModel):
    row_idx: int
    col_idx: int
    raw_value: str
    format_json: str | None = None
    # Persisted typed-input override. NULL = auto-classify (raw);
    # 'string' = force-text. Future kinds (number / boolean / custom)
    # plug into the same field. Lets reload re-install the override
    # on the local engine via loadIntoEngine.
    # [sheet.cell.force-text]
    typed_kind: str | None = None


class WorkbookRecord(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str


class UpdateWorkbookBody(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class WorkbookResponse(BaseModel):
    workbook: WorkbookRecord


class ViewRecord(BaseModel):
    id: str
    view_name: str
    range_str: str
    min_row: int
    min_col: int
    max_row: int
    max_col: int
    use_headers: bool
    color: str
    enable_insert: bool
    enable_update: bool
    enable_delete: bool
    delete_mode: str  # "clear" | "shift"


# -- Sheets ---------------------------------------------------------------


class ListSheetsResponse(BaseModel):
    sheets: list[SheetRecord]


class CreateSheetBody(BaseModel):
    name: str = "Sheet 1"
    color: str = "#8b774f"


class SheetWithColumnsResponse(BaseModel):
    sheet: SheetRecord
    columns: list[ColumnRecord]


class GetSheetResponse(BaseModel):
    sheet: SheetRecord
    columns: list[ColumnRecord]
    cells: list[CellRecord]


class UpdateSheetBody(BaseModel):
    name: str | None = None
    color: str | None = None
    sort_order: int | None = None


class SheetResponse(BaseModel):
    sheet: SheetRecord


class ReorderSheetsBody(BaseModel):
    # Full permutation of the workbook's current sheet ids in their
    # desired left-to-right order. Partial lists are rejected — the
    # server assigns sort_order = 0..N-1 based on position.
    sheet_ids: list[str] = Field(default_factory=list)


class ReorderSheetsResponse(BaseModel):
    sheets: list[SheetRecord]


class OkResponse(BaseModel):
    ok: bool = True


class DeleteRowsBody(BaseModel):
    # Zero-based row indices to remove. Order doesn't matter; the server
    # dedupes and sorts. Any index that has no cells is silently ignored.
    row_indices: list[int] = Field(default_factory=list)
    client_id: str | None = None


class DeleteRowsResponse(BaseModel):
    # The normalized sorted indices that were actually targeted.
    deleted: list[int]


class DeleteColumnsBody(BaseModel):
    # Zero-based column indices to remove. Order doesn't matter; the
    # server dedupes and sorts.
    col_indices: list[int] = Field(default_factory=list)
    client_id: str | None = None


class DeleteColumnsResponse(BaseModel):
    deleted: list[int]


class InsertColumnsBody(BaseModel):
    # Zero-based column index to insert *at* — the new blank column(s)
    # take this index; every column at or past it shifts right by
    # ``count``. ``count`` must be >= 1; out-of-range values are
    # normalized server-side.
    at: int
    count: int = 1
    client_id: str | None = None


class InsertColumnsResponse(BaseModel):
    # Zero-based indices where new blank columns were inserted, in
    # left-to-right order. For ``count=N`` inserts at index ``k``, this
    # is ``[k, k+1, …, k+N-1]`` — the indices the new blank columns
    # occupy *after* the shift.
    inserted: list[int]


class MoveColumnsBody(BaseModel):
    # 0-based source range (inclusive). For single-column drag,
    # ``src_start == src_end``. Multi-column drag (a B:E header
    # selection) sets the appropriate range — backend + engine
    # already handle block moves; only the frontend UX is gated
    # on the multi-col follow-up (att ortkjljr).
    src_start: int
    src_end: int
    # 0-based gap index where the block lands. Gap k = "before
    # column k". Gap 0 = before A; gap N = after the last column.
    # Drops on the source range itself or inside it are silently
    # no-op (server returns ``moved: null``).
    dest_gap: int
    client_id: str | None = None


class MoveColumnsResult(BaseModel):
    src_start: int
    src_end: int
    # Post-move starting index of the moved block.
    final_start: int
    width: int


class MoveColumnsResponse(BaseModel):
    # ``null`` on no-op (drop in place, drop on either source-range
    # edge, drop inside source range). Otherwise the resolved move
    # parameters so clients can mirror the optimistic state.
    moved: MoveColumnsResult | None = None


class MoveRowsBody(BaseModel):
    # 0-based source range (inclusive). Single-row drag sets
    # src_start == src_end. Multi-row drag (a 3:7 header
    # selection) sets the contiguous range.
    src_start: int
    src_end: int
    # 0-based gap index where the block lands. Gap k = "before
    # row index k". Gap 0 = above the first row; gap N = after
    # the last row. Drops on the source range itself or inside
    # it are silently no-op.
    dest_gap: int
    client_id: str | None = None


class MoveRowsResult(BaseModel):
    src_start: int
    src_end: int
    final_start: int
    width: int


class MoveRowsResponse(BaseModel):
    moved: MoveRowsResult | None = None


# -- Cells ----------------------------------------------------------------


class CellChangeBody(BaseModel):
    row_idx: int
    col_idx: int
    raw_value: str = ""
    format_json: str | None = None
    # Discriminates the cell-write semantics:
    # - "raw" (default): server runs auto-classification on raw_value.
    # - "string": server stores raw_value as a literal String, bypassing
    #   auto-classification. Used for the leading-' force-text UX
    #   ([sheet.cell.force-text]) — strips the prefix client-side and
    #   sends the rest with kind="string" so the engine never tries to
    #   parse "2/4" as a date.
    # Other typed-input kinds (number / boolean / custom) are reserved
    # for future affordances (column-type hints, custom-type widgets)
    # and not yet exposed at the API layer.
    kind: Literal["raw", "string"] = "raw"


class UpdateCellsBody(BaseModel):
    changes: list[CellChangeBody] = Field(default_factory=list)
    client_id: str | None = None


class UpdateCellsResponse(BaseModel):
    cells: list[CellRecord]


# -- Columns --------------------------------------------------------------


class ColumnChangeBody(BaseModel):
    col_idx: int
    name: str | None = None
    width: int | None = None


class UpdateColumnsBody(BaseModel):
    columns: list[ColumnChangeBody] = Field(default_factory=list)


class UpdateColumnsResponse(BaseModel):
    columns: list[ColumnRecord]


# -- Presence -------------------------------------------------------------


class PresenceCursor(BaseModel):
    row: int
    col: int


class PresenceBody(BaseModel):
    cursor: PresenceCursor | None = None
    # A list of A1-style cell ids (e.g. ["A1", "B2"]).
    selection: list[str] = Field(default_factory=list)
    client_id: str | None = None


# -- Views ----------------------------------------------------------------


class ListViewsResponse(BaseModel):
    views: list[ViewRecord]


class CreateViewBody(BaseModel):
    view_name: str
    range: str
    use_headers: bool = True
    enable_insert: bool = False
    enable_update: bool = False
    enable_delete: bool = False
    delete_mode: str = "clear"  # "clear" | "shift"


class CreateViewResponse(BaseModel):
    view: ViewRecord


# -- Named ranges ---------------------------------------------------------


class NamedRangeRecord(BaseModel):
    name: str
    definition: str
    updated_at: str


class ListNamedRangesResponse(BaseModel):
    named_ranges: list[NamedRangeRecord]


class SetNamedRangeBody(BaseModel):
    name: str
    definition: str


class SetNamedRangeResponse(BaseModel):
    named_range: NamedRangeRecord


# -- Dropdown rules -------------------------------------------------------


class DropdownOptionRecord(BaseModel):
    value: str
    color: str


class DropdownRuleSource(BaseModel):
    """Discriminated source — only ``kind: "list"`` for v1, but the
    wrapper keeps room for ``"range"`` later without rename."""

    kind: str = "list"  # narrowed to "list" in v1
    options: list[DropdownOptionRecord] = Field(default_factory=list)


class DropdownRuleRecord(BaseModel):
    id: str
    name: str | None = None
    multi: bool
    source: DropdownRuleSource


class ListDropdownRulesResponse(BaseModel):
    dropdown_rules: list[DropdownRuleRecord]


class DropdownRuleResponse(BaseModel):
    dropdown_rule: DropdownRuleRecord


class CreateDropdownRuleBody(BaseModel):
    name: str | None = None
    multi: bool = False
    options: list[DropdownOptionRecord] = Field(default_factory=list)


class UpdateDropdownRuleBody(BaseModel):
    # All fields are optional so PATCH-style partial updates work. ``name``
    # is the awkward case: ``None`` is a meaningful value (clear the name)
    # but Pydantic can't tell "missing" from "explicit null" with this
    # shape. We use ``name_set`` as the explicit "the client included
    # name" signal — when False, name is left alone server-side.
    name_set: bool = False
    name: str | None = None
    multi: bool | None = None
    options: list[DropdownOptionRecord] | None = None


# -- Filters --------------------------------------------------------------


class FilterPredicate(BaseModel):
    # Display strings the user has unchecked in the picker. Stored as
    # display strings (post-formatter) so the picker labels and the
    # predicate match what the user sees, even for booleans / dates.
    hidden: list[str] = Field(default_factory=list)


class FilterRecord(BaseModel):
    id: str
    min_row: int
    min_col: int
    max_row: int
    max_col: int
    sort_col_idx: int | None = None
    sort_direction: Literal["asc", "desc"] | None = None
    # JSON object keys are always strings, so ``predicates`` keys are
    # the col_idx as a decimal string ("3"). Absent keys ⇒ no predicate.
    predicates: dict[str, FilterPredicate] = Field(default_factory=dict)


class GetFilterResponse(BaseModel):
    filter: FilterRecord | None = None


class CreateFilterBody(BaseModel):
    # A1-style range, e.g. ``"B2:D5"``. Required — there's no
    # default rectangle (a default filter would be confusing UX).
    range: str
    client_id: str | None = None


class FilterResponse(BaseModel):
    filter: FilterRecord


class UpdateFilterBody(BaseModel):
    """Patch a single field of the filter. The route validates that
    exactly one ``set_*`` flag is true so a misencoded request can't
    accidentally overwrite something it didn't intend.

    Phase D ships only the predicate path; the sort path is reserved
    for Phase E and the route returns 400 if used today.
    """

    # Predicate write. ``predicate_col_idx`` must be inside the
    # filter rectangle. ``predicate_hidden = None`` removes the
    # column's predicate entirely; an empty list is the "predicate
    # exists, hides nothing" state (functionally identical from the
    # user's POV but stored explicitly).
    set_predicate: bool = False
    predicate_col_idx: int | None = None
    predicate_hidden: list[str] | None = None

    # Sort write — reserved for Phase E.
    set_sort: bool = False
    sort_col_idx: int | None = None
    sort_direction: Literal["asc", "desc"] | None = None

    client_id: str | None = None
