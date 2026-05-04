# tests/ — Python Unit & Integration Tests

pytest test suite for the backend. Run with `just test` or `uv run pytest`.

## Test Files

| File | What it covers |
|------|---------------|
| `test_workbooks.py` | Workbook CRUD, workbook page render, sheets within workbook, cell operations, data API |
| `test_sse.py` | Cell-update broadcast, sender exclusion, sheet-meta broadcast, presence broadcast/exclusion, multi-client fan-out |
| `test_broadcast.py` | SheetChannel subscribe/unsubscribe/publish, exclude client, queue overflow drop, ChannelManager lifecycle |
| `test_views.py` | SQL view creation, INSTEAD OF triggers, clear vs. shift delete modes, identifier sanitization integration |
| `test_view_sql.py` | Pure-SQL unit tests for `datasette_sheets.view_sql` — validation, injection defense, generated-SQL shape |
| `test_rows.py` | `POST /rows/delete` — endpoint, SSE broadcast, view round-trip, formula rewrite after delete |
| `test_row_shift.py` | Pure SQLite unit tests for the two-pass shift SQL (contiguous, non-contiguous, scrambled-insert regression) |
| `test_cols.py` | `POST /columns/delete` + `/columns/move` — symmetric coverage of test_rows.py including column-metadata shift, plus the move endpoint surface |
| `test_col_shift.py` | Pure SQLite unit tests for the column shift SQL |
| `test_cols_insert.py` | `POST /columns/insert` — endpoint + SSE + named-range parity for insertion |
| `test_col_move.py` | Integration tests for `SheetDB.move_columns` — formula + named-range + view-bound rewrites; cell-level format follow-the-data; all the no-op / error branches |
| `test_col_move_shift.py` | Pure SQLite unit tests for the column block-move SQL (negative-buffer two-pass on cell + column-meta tables, scrambled-insert regression) |
| `test_row_move.py` | Row-axis sibling of `test_col_move.py` |
| `test_row_move_shift.py` | Row-axis sibling of `test_col_move_shift.py` (cell table only — there's no row-meta table) |
| `test_named_ranges.py` | `GET/POST /names` + `/names/<name>/delete` — set/list, case-insensitive upsert, recalc integration (`#NAME?` after delete), validation surface |

Engine-level tests for `lotus.Sheet` / `extract_refs` / `adjust_refs_*` live upstream in [`asg017/liblotus`](https://github.com/asg017/liblotus) (`crates/lotus-pyo3/tests/test_integration.py`) and run on every release. We don't re-run them here — we exercise the engine through the SheetDB integration tests above.

## Test Patterns

**Creating a writable Datasette**: Tests that need to write data use a temp `.db` file (not `memory=True`, which creates an immutable `_memory` DB):

```python
def make_datasette():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return Datasette(
        [tmp.name],
        config={"permissions": {"datasette-sheets-access": True}},
    ), os.path.basename(tmp.name).replace(".db", "")
```

**Broadcast tests**: Subscribe a listener to the broadcast channel, make an API call, assert the listener's queue received the event:

```python
manager = get_channel_manager()
channel = manager.get_channel(sheet_id)
queue = channel.subscribe("listener")
# ... make API call ...
assert queue.qsize() == 1
event = queue.get_nowait()
```

**API helper**: Create workbook + get auto-created sheet in one call
(note: the plugin router doesn't method-dispatch, so this path must
include `/create`):

```python
async def create_workbook_and_sheet(ds, db_name):
    resp = await ds.client.post(f"/{db_name}/-/sheets/api/workbooks/create", ...)
    return data["workbook"]["id"], data["sheet"]["id"]
```

**Pure SQL fixture**: For tests of generated SQL (views, shift-up
UPDATE) use an in-memory SQLite connection and check behavior
directly — no `Datasette` needed:

```python
@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA)
    yield c
    c.close()
```

See `test_row_shift.py` and `test_view_sql.py::TestGeneratedSqlCompiles`
for the idiom. Much faster than spinning up Datasette for every
assertion, and the right call when the behavior under test is purely
SQL-level.

## What NOT to do

- Don't shell out to verify things (`uv run python -c '...'` or
  `<<EOF` heredocs). Write a pytest in this directory instead —
  the user has corrected this multiple times.
- Don't re-implement engine-domain logic in Python regex. If you
  need to understand formula/ref/range structure, call into
  `lotus` or write a TODO for liblotus.
