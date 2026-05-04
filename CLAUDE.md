# datasette-sheets

Collaborative spreadsheet plugin for Datasette. Full-stack: Rust engine (WASM + PyO3), Svelte 5 frontend, Python/Datasette backend, real-time collaboration via SSE.

## Architecture

```
Browser (Svelte + WASM)  ←→  Datasette (Python + PyO3)  ←→  SQLite (user's DB)
         ↕ SSE                        ↕ broadcast
    Other browsers              asyncio pub/sub
```

- **Engine**: Rust `lotus-core` compiled to WASM (browser) and native (Python via PyO3). Single source of truth for formula evaluation.
- **Backend**: Datasette plugin (`datasette_sheets/`). REST API, SSE streaming, permission checks.
- **Frontend**: Svelte 5 + TypeScript (`frontend/`). Vite build outputs to `datasette_sheets/static/gen/`.
- **Storage**: User's SQLite database (not Datasette internal DB). 4 tables: workbook, sheet, column, cell.
- **Collaboration**: SSE for server→client events, HTTP POST for client→server mutations. Cell-level last-write-wins.

### liblotus surface map

When you need to look up an engine API or a `CellValue` variant,
these are the canonical files in the upstream
[`asg017/liblotus`](https://github.com/asg017/liblotus) repo. We
consume binary releases (PyPI wheel + GH release wasm tarball, both
pinned in `Justfile` as `LIBLOTUS_VERSION_*`) — paths below are inside
that repo, not this one:

| File | What lives there |
|------|------------------|
| `crates/lotus-core/src/types.rs` | `CellValue` enum (`Number`/`String`/`Boolean`/`Empty`/`Custom`), `ArrayValue`, `MAX_RANGE_CELLS` |
| `crates/lotus-core/src/eval.rs` | `Evaluator`, literal parsing, `broadcast_compare`, comparison rules |
| `crates/lotus-core/src/dag.rs` | `Sheet` (the workbook-level type), `set_cells`/`recalculate`/`pin_value`/`spill_at` |
| `crates/lotus-core/src/{lexer,parser,functions,refs,range,names,custom}.rs` | The grammar + builtin functions; touch via TODOs (see Cross-repo work below) |
| `crates/lotus-pyo3/src/lib.rs` | Python bindings — `Sheet`, `cell_value_to_py`, `py_to_cell_value`, custom-handler trampoline |
| `crates/lotus-wasm/src/lib.rs` | JS bindings — `WasmSheet`, `get_all`/`get_all_typed`, `parse_range`, `extract_refs` |
| `crates/lotus-wasm/src/custom_bridge.rs` | wasm `cell_value_to_js` / `js_to_cell_value` |

### Computed value pipeline

Tracking how a value flows from the engine to a rendered cell — the
single most useful map when adding a new `CellValue` variant or a
new format type:

```
liblotus CellValue (types.rs)
  → wasm get_all_typed (lotus-wasm/src/lib.rs)        ← native JS types: number | string | boolean | null | {type_tag, data}
  → frontend engine.ts: typedMap + coerceTypedValue   ← numeric-string second pass for pin_value path; passes Custom {type_tag, data} through
  → stores/spreadsheet.ts: mergeComputedIntoCells     ← writes CellData.computedValue, error detection
  → spreadsheet/formatter.ts: formatValue             ← per-type display string (TRUE/FALSE, currency, jdate locale, jspan ISO duration, …)
  → Cell.svelte: $: is<Variant>; class:<variant>      ← reactive class flag, accent / alignment
  → Cell.svelte <style> .cell-value.<variant>         ← CSS treatment, must sit BEFORE .h-* so explicit hAlign wins
```

Python side (recalc loop in `db.py::_recalculate_sheet`) uses
`engine.get_all_typed()` and persists the typed value directly into
the `computed_value` BLOB-affinity column — booleans land as Python
`bool` and survive the SQLite round-trip; `Custom({type_tag, data})`
values JSON-encode into `computed_value` with `computed_value_kind =
'custom'` (see `_split_typed` / `reconstruct_typed`).

The wasm `pin_value` (used by `=SQL(...)` and other host-injected
arrays) is the **one place** values cross the boundary as plain
strings: the JS API takes a 2-D string array and the engine wraps
each as `CellValue::String`. That's why `coerceTypedValue` does a
numeric-string second pass — a pinned `"42"` should still feel like
a number to the rest of the app.

### Embedder-controlled cell typing (input side)

Phase B added a per-cell typed override that bypasses the engine's
auto-classification. Schema columns `typed_kind` + `typed_data` on
`datasette_sheets_cell` carry it; the recalc loop reconstructs them
as `set_cells_typed` input on every pass via
`db.py::_build_cell_input`, so the override survives. Today the only
producer is the leading-`'` force-text UX
([`sheet.cell.force-text`](specs/sheet.cell.force-text.md)) — `kind:
"string"` writes from `Cell.svelte::commitCellEdit` → `CellChangeBody.kind`
→ server `set_cells` → `typed_kind = 'string'`. SSE echoes the
`kind` so remote clients install the same override locally; reload
reads `typed_kind` from `GetSheetResponse.cells` and reconstructs
the engine input via `loadIntoEngine`.

Future kinds (`number` / `boolean` / `custom` for column-type hints
or "Format → Plain text") plug into the same columns + the same
discriminator.

## Development

**Prerequisites**: Node.js, `uv`, `just`, `curl`, `tar`

The Rust engine ships as binary releases:
- **Python**: PyPI package [`liblotus`](https://pypi.org/project/liblotus/) (importable as `lotus`).
- **WASM**: tarball asset on the matching [`asg017/liblotus` GitHub release](https://github.com/asg017/liblotus/releases). `just engine-wasm` downloads and extracts it into `frontend/vendor/lotus-wasm/` (gitignored).

Both pins live in `Justfile` (`LIBLOTUS_VERSION_PY` for PyPI's PEP 440 form, `LIBLOTUS_VERSION_GH` for the GitHub tag) and `pyproject.toml`. Bump them together — the wheel and tarball must come from the same release.

**Setup:**
```bash
just engine          # Sync Python wheel + download wasm tarball
npm install --prefix frontend
just frontend        # Build Svelte → static assets
```

**Dev with HMR (3 terminals):**
```bash
just frontend-dev    # Vite dev server (port 5171)
just dev-with-hmr    # Datasette + auto-restart on Python/template changes
# Optional: just types-watch for type generation
```

**Production dev:**
```bash
just frontend && just dev --memory
```

## Just Commands

| Command | Description |
|---------|-------------|
| `just engine` | Sync Python wheel from PyPI + download wasm tarball from GH release |
| `just engine-wheel` | `uv sync` — pulls the pinned `liblotus` wheel from PyPI |
| `just engine-wasm` | curl + extract the matching `liblotus-wasm-<ver>.tar.gz` into `frontend/vendor/lotus-wasm/` |
| `just frontend` | Build production frontend |
| `just frontend-dev` | Vite dev server with HMR |
| `just dev` | Run Datasette (pass `--memory` or DB path) |
| `just dev-with-hmr` | Datasette + watchexec auto-restart |
| `just types` | Regenerate `frontend/api.d.ts` from router's OpenAPI doc |
| `just types-watch` | Re-run `just types` on Python changes |
| `just test` | Run pytest |
| `just test-frontend` | Vitest browser unit tests (chromium, ~1s) — component + store + WASM, no Python backend |
| `just test-frontend-watch` | Same, watch mode |
| `just test-e2e` | Run Playwright (auto-spawns Datasette on :8484) |
| `just test-all` | All three suites |
| `just verify-frontend` | Pre-commit sanity: test + check + lint + format-check (skips e2e) |
| `just format` | Format all (ruff + prettier) |
| `just format-frontend` / `just format-backend` | Scoped |
| `just format-check` / `just format-frontend-check` / `just format-backend-check` | Check-only |
| `just lint-frontend` / `just lint-frontend-fix` | eslint |
| `just check` | Type check all (ty + svelte-check + tsc) |
| `just check-frontend-app` | Faster: svelte-check only, skips tsc on vite/vitest configs |

## Bumping the liblotus pin — gotchas

When liblotus cuts a new release with primitives we want to consume,
two pins move in lockstep:

1. **`pyproject.toml`**: `liblotus==<X.Y.Z…>` (PEP 440 form, e.g. `0.0.1a2`).
2. **`Justfile`**: `LIBLOTUS_VERSION_PY` matches the pyproject pin; `LIBLOTUS_VERSION_GH` matches the GitHub release tag (e.g. `0.0.1-alpha.2`). PyPI normalises `-alpha.N` → `aN`, so the two strings always differ.

After bumping, run `just engine` — `engine-wheel` calls `uv sync`
which pulls the new wheel from PyPI; `engine-wasm` downloads
`liblotus-wasm-<LIBLOTUS_VERSION_GH>.tar.gz` from the GitHub release
and extracts it into `frontend/vendor/lotus-wasm/`. Then run `just
frontend` so Vite re-bundles against the new wasm.

Things that used to be gotchas and are no longer:

- We no longer build the engine from source — no Rust toolchain,
  `maturin`, or `wasm-pack` required locally. The release workflow
  upstream builds wheels for cp310-cp313 across linux/macos/windows
  and a wasm tarball with `--target bundler --features datetime,url`.
- The frontend used to import from a sibling-repo path
  (`../../../../../../projects/liblotus/...`); it now imports from
  `frontend/vendor/lotus-wasm/lotus_wasm`, populated by `just engine-wasm`.

If something is out of sync you'll see import errors at runtime —
the backend raises `AttributeError: module 'lotus' has no
attribute '...'`, the frontend shows `wasm is undefined` or a missing
`vendor/lotus-wasm` path. Run `just engine` to refresh both.

### Cross-repo work (liblotus)

Speculative engine changes don't belong in a datasette-sheets
session. Write a `TODO-liblotus-*.md` in this repo root describing
the change — state the current pain, sketch the Rust API, list pyo3 /
wasm-bindgen surface, give a test table, call out what's *not* in
scope — and let the work land in a proper [`asg017/liblotus`](https://github.com/asg017/liblotus)
PR + release. Bumping the version pins here is a separate, mechanical
follow-up.

The same rule applies to any Python / Svelte code that would
otherwise reach for `re` on formula text, cell refs, or range
strings: the engine owns that grammar, a regex is a bespoke second
grammar that will drift. Examples: `TODO-liblotus-range-cap.md`, the
`TODO-liblotus-ranges.md` / `TODO-liblotus-ref-rewrite.md` that
preceded today's engine primitives.

**Exception**: pure data sanitation of user-typed text (e.g.
`sanitize_column_names` in `view_sql.py` turning headers into SQL
identifiers) is fine as local Python regex — it's munging arbitrary
text, not parsing the engine's grammar.

## Testing

Three suites, fastest → slowest:

```bash
just test            # Python unit/integration tests (pytest)
just test-frontend   # Vitest browser: Svelte + WASM in chromium, no backend
just test-e2e        # Playwright: full stack, spawns its own Datasette on :8484
just test-all        # All three
```

**Which suite for which change:**

| Change | Command | Why |
|---|---|---|
| Store / helper / pure TS | `just test-frontend` | ~1s, no backend |
| Component rendering / keyboard | `just test-frontend` | Real browser, real WASM |
| Multi-step UX flow (select → cut → paste) | `just test-frontend` → `clipboardFlow.test.ts` style | Scenario-level store stitching |
| Backend Python | `just test` | pytest |
| SSE / persistence / multi-client | `just test-e2e` | Full stack, needs Datasette |
| Rust engine (liblotus) | `just engine && just test-frontend && just test` | Rebuild wheel + wasm, then both sides |

- **`test-frontend`** lives at `frontend/src/**/__tests__/*.test.ts`,
  uses `vitest-browser-svelte` + `@vitest/browser-playwright`. Mount a
  Svelte component, drive it via `userEvent`, assert against DOM
  locators. No Datasette, no network — stores are reset in
  `beforeEach`. Use this for component/store/WASM logic.
- **`test-e2e`** stays for anything that needs the real backend:
  persistence round-trips, SSE collaboration, server-side formula
  evaluation.

Playwright e2e spawns its own Datasette server — no manual process management needed.

### Before committing

`just verify-frontend` is the standard pre-commit gate for frontend
work — it chains `test-frontend` + `check-frontend` + `lint-frontend`
+ `format-frontend-check` and stops at the first failure. For
backend work add `just test`. Only run `just test-e2e` when your
change could plausibly regress SSE, persistence, or multi-client
behaviour; it's slow.

### LSP staleness caveat

After adding/renaming an export in a store module, the IDE's TypeScript
language server sometimes continues to flag the import as missing in
consumer files even though the change is correct. `just check-frontend`
(or `just check-frontend-app` for the faster svelte-check-only pass)
is authoritative — trust it over red squiggles.

## Interaction specs (`specs/`)

When you add, change, or delete a user-visible behavior (selection,
keyboard shortcut, clipboard, visual state, etc.), **update `specs/`
in the same commit**. Platform-neutral UX rules live there, each
tagged with an ID like `sheet.clipboard.copy` that also appears as a
one-line `// [id]` comment above the code that implements it.

See `specs/CLAUDE.md` for the write / update / tag workflow and
`specs/README.md` for the file format + ID conventions. The
workflow doc is small — read it before touching UX code.

## Key Files

| File | Purpose |
|------|---------|
| `datasette_sheets/__init__.py` | Plugin hooks, route registration, Vite manifest |
| `datasette_sheets/routes/` | All HTTP handlers — one file per resource. Each `@router.GET/POST` carries the full explicit regex (no `SH`/`VIEWS` helpers, see `datasette-libfec`) |
| `datasette_sheets/routes/schemas.py` | Pydantic request/response models. Single source of truth for the OpenAPI doc → `frontend/api.d.ts` |
| `datasette_sheets/db.py` | `SheetDB` — all DB ops on the user's DB (not internal). Uses Rust engine for recalc and formula ref-rewriting on delete |
| `datasette_sheets/view_sql.py` | SQL generation for SQL views over cell ranges + INSTEAD OF triggers. All identifier/literal validation lives here |
| `datasette_sheets/broadcast.py` | In-process pub/sub for SSE |
| `datasette_sheets/migrations.py` | sqlite-migrate steps with sqlite-docs comments. Schema changes land as new `m00N_*` steps; never edit existing steps |
| `frontend/src/lib/engine.ts` | WASM engine wrapper — `parseRange`, `adjustRefsForDeletion`, `setAndRecalculate` |
| `frontend/src/lib/api.ts` | `openapi-fetch` client. All mutations route through `lib/client.ts` which sets `Content-Type: application/json` (CSRF workaround) |
| `frontend/src/lib/stores/persistence.ts` | API-backed save/load, dirty tracking, `removeRows`/`removeCols` |
| `frontend/src/lib/stores/spreadsheet.ts` | Cell store, selection, local delete+shift (server-parity via `adjustRefsForDeletion`) |
| `frontend/src/lib/components/Grid.svelte` | Header drag-select, right-click context menus, delete confirmation, filter row hiding |
| `frontend/src/lib/stores/filter.ts` | Per-sheet basic filter (one filter per sheet). `sheetFilter` writable + derived stores (`filterCellMap`, `filterHeaderCells`, `filterEdgeMap`, `hiddenRowIndices`); `computeHiddenRows` / `distinctValuesForColumn` / `maybeAutoExpandLocally` helpers; create / delete / setFilterPredicate / setFilterSort actions |
| `frontend/src/lib/formatCommands.ts` | Shared dispatch for every format mutation — toolbar, Format menu, context menu, keyboard shortcuts all funnel through `applyFormat` / `toggleFormatFlag` / `clearAllFormat`. See `frontend/CLAUDE.md` "Format surface" for the full pattern and the popover / z-index gotchas |
| [`asg017/liblotus`](https://github.com/asg017/liblotus) `crates/lotus-core/` | Rust formula engine (lexer→parser→evaluator→DAG + refs + range parser) — source of every primitive Python and TS consume. Consumed here as the `liblotus` PyPI wheel + a wasm tarball from the GH release |

Scoping / open-work docs at the repo root — check these before starting new work in an adjacent area:

- `TODO-styling.md` — format-styling roadmap + deferred follow-ups (colours, borders, wrap, number formats, toolbar / menu UX). Every v1-deferred item is explicitly marked; the "Deferred follow-ups" rollup near the top is the canonical "what's left" view.
- `TODO-frontend-followups.md` — array-formula + `=SQL()` loose ends.
- `TODO-liblotus-*.md` — cross-repo requests into the Rust engine. One per primitive; each is self-contained enough to hand off.

## Dependencies

**Python**: datasette, sqlite-migrate, sqlite-utils, python-ulid, `liblotus` (PyPI wheel)
**Frontend**: svelte 5, vite 7, vite-plugin-wasm, typescript; `liblotus` wasm tarball vendored under `frontend/vendor/lotus-wasm/`
**Rust** (upstream, not built here): lotus-core, pyo3, wasm-bindgen, serde_json
**Dev**: datasette-debug-gotham, datasette-sidebar, datasette-user-profiles, playwright
