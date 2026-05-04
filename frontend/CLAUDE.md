# frontend/ — Svelte 5 + TypeScript + Vite

Interactive spreadsheet UI. Builds to `../datasette_sheets/static/gen/` for Datasette to serve.

## Tech Stack

- **Svelte 5** in **runes mode** (`$state`, `$derived`, `$effect`, `$props`, `$bindable`). Stores still used for cross-component shared state. Event listeners use the attribute style (`onclick={…}`) — `on:event` is deprecated and absent from the codebase.
- **TypeScript** with strict mode
- **Vite 7** with `vite-plugin-wasm` for WASM loading
- **WASM**: Rust `lotus-core` consumed as a prebuilt wasm-bindgen pkg.
  `just engine-wasm` downloads the matching tarball from the
  [`asg017/liblotus`](https://github.com/asg017/liblotus) GitHub release and
  extracts it into `frontend/vendor/lotus-wasm/` (gitignored). The frontend
  imports it as `../../vendor/lotus-wasm/lotus_wasm` (path varies by depth);
  see root `CLAUDE.md` for the version-pin workflow.
- **HTTP client**: `openapi-fetch` typed against `frontend/api.d.ts`
  (generated from the Python router's OpenAPI doc via `just types`).
  All requests flow through `lib/client.ts`, which sets
  `Content-Type: application/json` by default — Datasette's `skip_csrf`
  hook only waives CSRF for that content-type, and bodyless POSTs
  would otherwise 403.
- **Tooling**: `prettier` + `prettier-plugin-svelte` for format,
  `eslint` flat-config with `typescript-eslint` + `eslint-plugin-svelte`
  for lint (rune-mode rules disabled, we're on legacy Svelte 5).

## Build

```bash
npm run build        # Production build → ../datasette_sheets/static/gen/
npm run dev          # Vite dev server (HMR)
npm run test         # Vitest browser unit tests (chromium, headless)
npm run test:watch   # Vitest in watch mode
```

### Browser unit tests (`src/**/__tests__/*.test.ts`)

Uses `vitest-browser-svelte` + `@vitest/browser-playwright`. Runs the
real Svelte component, real stores, and real Rust WASM engine in a
chromium iframe — only the Datasette backend is absent. Rule of thumb:

- **Here** for component/store behaviour, WASM correctness, keyboard
  handling, formula ref coloring — anything that would run
  identically whether or not the server exists.
- **`../e2e/`** for everything that round-trips through Datasette:
  persistence, SSE collaboration, column/row delete propagation.

Conventions:

- `data-cell-id` is configured as the test-id attribute, so
  `page.getByTestId("A1")` locates a rendered cell by its id.
- Stores are module-level singletons — reset them in `beforeEach` so
  tests don't bleed into each other.
- Don't call `enableAutoSave()`. `markCellDirty` still works (it
  only flips an in-memory flag), but without the subscription no
  debounced save fires, so tests never touch `/api/…`.
- Import `userEvent` and `page` from `vitest/browser`. For a Cmd+B
  shortcut, `userEvent.keyboard("{Control>}b{/Control}")` hits the
  `e.metaKey || e.ctrlKey` branch.

Vite config sets `base: "/-/static-plugins/datasette-sheets/gen/"` so asset URLs (including `.wasm`) resolve correctly when served by Datasette.

## Directory Structure

```
src/
├── pages/sheets/
│   ├── index.ts              # Entry point — mounts SheetsPage, reads data-* attrs from DOM
│   └── SheetsPage.svelte     # Top-level: init, SSE, presence, loading/error states
├── lib/
│   ├── engine.ts             # WASM engine wrapper (loadIntoEngine, setAndRecalculate, parseRange, adjustRefsForDeletion)
│   ├── client.ts             # Shared openapi-fetch instance, pre-configured with Content-Type: application/json
│   ├── api.ts                # Typed HTTP fns — wraps `client.ts` with a thin unwrap()
│   ├── sse.ts                # SheetSSEClient (EventSource wrapper) + sendPresence
│   ├── clipboard.ts          # Paste parser (HTML tables, TSV, Markdown) + copy-payload builder. Round-trips the full format surface (bold/italic/underline/strike, color, fill, h-align, font-size) in addition to values + formulas
│   ├── formatCommands.ts     # Shared dispatch for every format mutation (applyFormat, toggleFormatFlag, clearAllFormat). Toolbar + FormatMenu + cell context menu + keyboard shortcuts all call the same helpers — one source of truth per command
│   ├── components/
│   │   ├── Cell.svelte       # Individual cell — editing, selection, paste, text styling, alignment, colors, fontSize, borders, wrap, presence
│   │   ├── Grid.svelte       # Grid layout, column resize, auto-fit, cell context menu (incl. Format section)
│   │   ├── FormulaBar.svelte # Formula/value input bar
│   │   ├── Toolbar.svelte    # Rich format toolbar — icon buttons + dropdown popovers. Group order documented in `specs/sheet.format.toolbar-layout.md`
│   │   ├── ColorPicker.svelte  # 12-swatch palette + custom hex + reset. Dispatches `change` with `string | null`. Reused for text + fill colors
│   │   ├── BorderPicker.svelte # Color + style selects, then preset grid (All / Outer / Top / Right / Bottom / Left / Top+Bottom / Left+Right / Clear)
│   │   ├── FormatMenu.svelte # Header "Format" menu — submenus for Number, Text, Alignment, Wrapping, Borders + Clear formatting
│   │   ├── StatusBar.svelte  # Selection stats (sum, avg, count)
│   │   ├── SheetTabs.svelte  # Multi-sheet tab bar (add, rename, delete, color)
│   │   ├── SignatureHelpPopup.svelte # Dark tooltip: function signature while editing a `=FN(…)` call
│   │   └── NamedRangesPanel.svelte # Right-side drawer: define/edit/delete named ranges
│   ├── stores/
│   │   ├── spreadsheet.ts    # Cell data store, selection, navigation, undo/redo
│   │   ├── persistence.ts    # API-backed save/load, dirty tracking, auto-save
│   │   ├── presence.ts       # Remote user cursor/selection tracking
│   │   ├── namedRanges.ts    # Named-range CRUD + panel open state; pushes names into the WASM engine
│   │   └── filter.ts         # Per-sheet filter (one filter per sheet). FilterMeta + filterCellMap / filterHeaderCells / filterEdgeMap / hiddenRowIndices derived stores; computeHiddenRows / distinctValuesForColumn helpers; SSE handlers; filter popover open-state
│   └── spreadsheet/
│       ├── types.ts          # CellData, CellFormat (bold/italic/underline/strike, text+fill color, h/v-align, wrap, fontSize, borders), CellBorders, HAlign/VAlign/WrapMode/BorderStyle, NumberFormatType, CellValue, CellId
│       ├── formatter.ts      # Display dispatch per `CellFormat.type` — general/number/currency/percentage/scientific/date/time/datetime. Also exports `hasNonDefaultFormat` (save gate) and `createDefaultFormat`
│       └── formula-helpers.ts # Reference extraction (via WASM), caret-position heuristics (canInsertCellRef, getCallAtCursor), function catalog + aliases
```

## Data Flow

```
User edits cell → Cell.svelte
  → markCellDirty(cellId)        # must come BEFORE setCellValue
  → cells.setCellValue(cellId)   # updates store, triggers WASM recalculate
  → store subscription fires debouncedSave (1s)
  → saveCellsToWorkbook() POSTs only dirty cells to API
  → server broadcasts via SSE to other clients
```

**Critical ordering**: `markCellDirty()` must be called BEFORE `cells.setCellValue()` because `setCellValue` triggers Svelte store subscriptions synchronously, and `debouncedSave` checks `_dirtyCellIds.size` before scheduling.

## WASM Engine

`engine.ts` wraps `WasmSheet` from the Rust WASM package. Exposed helpers:

- `loadIntoEngine(cellEntries)` / `setAndRecalculate(changes)` — feed
  cells in, get the computed map back. Both call `WasmSheet.get_all_typed`
  under the hood, so values come back as native JS types
  (`number | string | boolean | null`), not stringified. `pinValue`
  is the **one exception**: the wasm boundary takes a 2-D string
  array, so pinned numerals (e.g. `=SQL(...)` row values) come back
  as strings and are numeric-coerced in `engine.ts::coerceTypedValue`.
  The engine handles DAG-based dependency resolution and circular-dep
  detection.
- `evaluate(formula)` — one-shot formula eval with no cell context.
- `parseRange(input)` / `isUnboundedRange(input)` — canonical A1-range
  parsing (shared with the Python backend). **Never use a regex for
  range parsing in this repo** — see the liblotus TODO history.
- `adjustRefsForDeletion(formula, cols, rows)` — Google-Sheets-style
  formula rewrite for row/column deletion. Refs past the deletion
  shift, ranges trim, fully-deleted refs become `#REF!`. Used by
  `cells.deleteRowsLocally` / `deleteColsLocally` so the optimistic
  UI matches what the server persists via
  `db.py::_rewrite_formulas_for_deletion`.
- `adjustRefsForInsertion(formula, cols, rows)` — mirror for the
  insertion direction; refs at-or-past each inserted index shift
  outward.
- `adjustRefsForColumnBlockMove(formula, srcStart, srcEnd, finalStart)`
  — column drag-reorder rewrite. Block move (single-col is just
  `srcStart === srcEnd`) has no `#REF!` case — it's a permutation.
  Bounded ranges stay positional; whole-col refs use interior-bbox
  semantics. Used by `cells.moveColsLocally` for the optimistic
  shift; server runs the same primitive via
  `db.py::_rewrite_formulas_for_move`.
  See `[sheet.column.drag-reorder]`.
- `adjustRefsForRowBlockMove(formula, srcStart, srcEnd, finalStart)`
  — row-axis sibling. Same shape: positional bounded ranges,
  interior-bbox whole-row, whole-col unaffected. Used by
  `cells.moveRowsLocally`. See `[sheet.row.drag-reorder]`.
- `adjustRefsForRowBlockMoveDataFollowing(formula, ...)` — variant
  where bounded ranges follow via interior-bbox. Used for
  named-range definitions on the backend.

Formula reference coloring (`extractFormulaRefs` in `formula-helpers.ts`) also uses WASM via `WasmSheet.extract_refs()`. Since the liblotus handoff, `extract_refs` returns a `kind` discriminator (`cell` / `range` / `whole_column` / `whole_row`); whole-col/row refs have empty `cells`.

## Auto-Save / Dirty Tracking

`persistence.ts` uses a `Set<CellId>` of dirty cell IDs (not a boolean flag). Key behaviors:
- Only dirty cells are POSTed (not the full sheet)
- Empty cells (`raw_value: ""`) are sent to trigger server-side deletion
- Remote SSE changes are wrapped in `suppressAutoSave()` to prevent echo loops
- Column width saves are gated by a separate `_columnWidthsDirty` flag

## Keyboard Input

All cell keystrokes go through `Cell.svelte`:

- **Nav mode** (no cell editing): `handleCellKeydown` on the outer
  `<div class="cell" tabindex="0">`. Arrows, Tab/Shift+Tab, Enter/F2
  (to open edit), Cmd+B/Z/Y, Delete, printable char (type-to-edit).
- **Edit mode** (cell input is focused): `handleKeydown` on the
  inner `<input>`. Commit keys (Enter/Tab), Escape, formula-ref
  pointing, autocomplete.

**Invariant**: every cell div has `tabindex="0"`, so any focus-moving
key left unhandled in `handleCellKeydown` falls through to the
browser's default — which moves DOM focus without touching
`$selectedCell`, so the `.selected` outline desyncs from the focused
cell. When adding keys that move focus, always `preventDefault` and
call `selectSingle` + `focusCell` in lockstep (see the Tab/arrow
blocks for the pattern).

## Clipboard Paste

`clipboard.ts` parses paste data via `DOMParser` (safe, no script eval). Extracts:
- Cell values from `<table>` HTML (Google Sheets, Excel, Obsidian)
- Text styling: bold (`font-weight`, `<th>`, `<b>`, `<strong>`), italic (`font-style`, `<i>`, `<em>`), underline (`text-decoration`, `<u>`), strikethrough (`text-decoration: line-through`, `<s>`/`<strike>`/`<del>`)
- Inline style CSS: `color`, `background-color` / `background`, `text-align`, `font-size` (pt / px / em, converted to pt)
- Falls back to TSV (tab-separated) or pipe-delimited Markdown tables

`buildCopyPayload` emits the same attrs as inline styles on outbound `<td>` so external apps (GSheets / Excel) see the styling on paste. Per-cell borders currently travel only through the intra-app format path — inter-app border round-trip is a known gap (see TODO-styling.md §6 Deferred).

## Format surface

Cell formatting is the richest UX surface after the grid itself. Entry points are all thin — the moment you follow any of them, you land in `lib/formatCommands.ts`.

- **What's on the cell**: every format attribute lives on `CellFormat` in `spreadsheet/types.ts`. Optional fields; `hasNonDefaultFormat` (in `formatter.ts`) decides whether a cell serialises a `format_json` blob on save.
- **How commands dispatch**: one module, four helpers.
  - `applyFormat(partial)` — merge a partial `CellFormat` into every target cell.
  - `toggleFormatFlag(flag)` — active-cell-authoritative boolean toggle (`bold | italic | underline | strikethrough`).
  - `clearAllFormat()` — reset every field on the selection.
  - "Targets" = the multi-selection if any, else the active cell.
- **Where the commands fire from**:
  - `Toolbar.svelte` — icon buttons + popover dropdowns (color pickers, border picker, number-format menu, wrap menu).
  - `FormatMenu.svelte` — header-mounted "Format" menu with submenus.
  - `Grid.svelte` — cell right-click menu (Bold / Italic / Underline / Clear formatting).
  - `Cell.svelte` — keyboard (Cmd+B/I/U, Cmd+Shift+X, Cmd+\ for clear).
  All four paths call the same helpers. When adding a new format attribute, add one branch to each surface — the dispatch is always a single call to `applyFormat` / `toggleFormatFlag`.

### Adding a new format attribute

Checklist — follow this and nothing will drift:

1. Add the optional field to `CellFormat` in `spreadsheet/types.ts`.
2. Extend `hasNonDefaultFormat` in `spreadsheet/formatter.ts` so the save gate serialises it.
3. Consume it in `Cell.svelte` — new `let foo = $derived(cell?.format.foo)`; apply as a class / inline style on `.cell` or `.cell-value`.
4. If it affects rendered output (not just style), add a branch in `formatter.ts::formatValue`.
5. Add a toolbar control (icon + handler calling `applyFormat({ foo: … })`) and, if there's a natural Format-menu home for it, a submenu entry too.
6. Extend `clearAllFormat` in `formatCommands.ts` to reset the new field to its default.
7. If it's user-authored content that should survive copy/paste, thread it through `clipboard.ts` (`ClipboardCell` + `CopyCell` interfaces, the HTML parser, `buildCopyPayload`) and the `applyPastedFormat` helper in `SheetsPage.svelte`.
8. Write a spec at `specs/sheet.format.<slug>.md`, add it to `specs/INDEX.md`, and tag implementation sites with `// [sheet.format.<slug>]`.
9. Add a browser test per the existing `Cell.textStyling.test.ts` / `Cell.alignment.test.ts` / `Cell.color.test.ts` style.

### Adding a new CellValue variant

Parallel to the format checklist above, but for new computed-value
*types* — when liblotus grows a new `CellValue` variant (e.g. the
recent `Boolean`, or future `Date` / `Duration` / `Currency`), the
flow is:

1. Update the union in `spreadsheet/types.ts::CellValue` to include the new JS type.
2. Make sure `engine.ts::coerceTypedValue` passes the type through (its `typeof` allowlist gates what's permitted; unknown types currently stringify defensively).
3. Add a branch to `spreadsheet/formatter.ts::formatValue` — typed values usually short-circuit *before* the number-format dispatch (so `currency` doesn't apply a `$` mask to a boolean / date / etc.).
4. In `Cell.svelte`: add a `let is<Variant> = $derived(cell != null && typeof cell.computedValue === "<variant>")`, then `class:<variant>={is<Variant>}` on `.cell-value`.
5. Add a CSS rule `.cell-value.<variant>` in `Cell.svelte`'s `<style>` block. Place it **before** the `.h-left / .h-center / .h-right` block so explicit `hAlign` still wins via document-order specificity (single-class selectors all tie on specificity).
6. Decide whether `selectionStats` (in `spreadsheet.ts`) should include the variant — it currently filters by `typeof v === "number"`, so booleans are excluded (matches Google Sheets — wrap in `SUM(...)` to coerce).
7. Spec at `specs/sheet.cell.<variant>.md` (note: `cell.` prefix, not `format.`) + index entry + `// [sheet.cell.<variant>]` tag at the implementation sites.
8. Browser test mirroring `Cell.boolean.test.ts` — seed the cell store directly with a `CellData` carrying the typed value, since formula-based producers may not exist yet at consumer-side time.

### Popover / dropdown gotchas

The toolbar + Format menu have a dozen popovers. Three landmines, learned the hard way:

- **Never put `opacity` on a popover's ancestor.** `opacity < 1` cascades to every descendant and CSS has no way to "reset" it on a child. If you want to fade a disabled toolbar, fade the buttons individually (`.toolbar-btn`, `.toolbar-divider`, …) — not `.toolbar` itself. Popovers mount inside `.popover-host` which sits outside that selector list and stays fully opaque.
- **Popovers extending below the toolbar need a higher stacking context than the grid's sticky column headers.** The toolbar carries `position: relative; z-index: 50` and the Format menu root carries `z-index: 100` for exactly this reason. A bare `z-index: 20` on the popover itself isn't enough because its stacking context ancestor (the toolbar) has to outrank `.column-header`'s `z-index: 2` in the root stacking context.
- **Popovers near the right edge of the toolbar / right edge of the Format menu spill off-screen.** Every popover has `use:keepInViewport` (see `Toolbar.svelte` / `FormatMenu.svelte`) — a Svelte action that measures the rect after mount and flips `left: 0 → right: 0` (or `left: 100% → right: 100%` for submenus) when it'd overflow. Apply it to new popovers too.

Mutual exclusion: toolbar tracks a single `openPicker` state variable and outside-click / Escape dismiss handlers. New dropdowns should slot into the same state — opening one auto-closes any other.

## Interaction specs

Every user-visible format rule has a spec at `specs/sheet.format.*.md`, indexed in `specs/INDEX.md`. Implementation sites carry `// [sheet.format.<slug>]` one-line tags. The `specs/CLAUDE.md` workflow applies — grep `[sheet.` against `frontend/src/` and compare to `ls specs/sheet.*.md` before committing format work.

Open scoping questions and deferred work live in `TODO-styling.md` at the repo root. The "Deferred follow-ups" rollup near the top of that doc is the canonical "what's left" view.
