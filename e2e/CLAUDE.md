# e2e/ — Playwright End-to-End Tests

Browser tests that verify the full stack: Datasette backend + Svelte frontend + WASM engine + SSE collaboration.

**Scope split**: component/store/WASM logic that doesn't need the
backend lives in `frontend/src/**/__tests__/*.test.ts` under vitest
browser mode (much faster, no Datasette). Add a spec here only when
it exercises persistence, SSE, multi-client collaboration, or a
server-side code path.

## Running

```bash
npx playwright test              # All tests (auto-spawns Datasette on :8484)
npx playwright test e2e/smoke.spec.ts   # Single file
npx playwright test --headed     # Watch in browser
npx playwright test --debug      # Step-by-step debugger
```

Playwright auto-spawns a fresh Datasette server on port 8484 (`reuseExistingServer: false`). No manual process management needed.

## Test Files

| File | Coverage |
|------|----------|
| `smoke.spec.ts` | Page loads, data entry + formulas, keyboard nav |
| `persistence.spec.ts` | Data survives reload, formatting survives, multi-sheet |
| `collaboration.spec.ts` | Two-browser live sync, formula recalc, SSE indicator, rapid edits |
| `paste.spec.ts` | HTML table, offset paste, TSV, Google Sheets bold, `<th>` bold, persistence |
| `bold.spec.ts` | Bold survives reload, bold broadcasts via SSE (local-only Cmd+B behaviour is covered by vitest — `frontend/src/lib/components/__tests__/Cell.bold.test.ts`) |
| `delete.spec.ts` | Single cell delete persists, range delete persists |
| `row-delete.spec.ts` | Row header right-click/drag-select/shift-click + confirm + SSE propagation |
| `col-delete.spec.ts` | Column-header equivalents |
| `col-move.spec.ts` | Column drag-reorder: persistence, formula rewrite end-to-end, no-op drop, multi-col block, cross-client SSE |
| `row-move.spec.ts` | Row drag-reorder: same surface as `col-move.spec.ts` on the row axis |
| `idle-network.spec.ts` | Zero API requests when idle (single tab, after edit, two tabs, after remote edit) |
| `formula-edit.spec.ts` | Edit-input auto-widen (hugs content, caps at 80vw), focus-ring outline, signature-help popup (position + aliases + close rules), merged autocomplete, arrow-key ref pointing (boundaries + sig-help refresh + `Cmd+ArrowRight` safety), Escape priority (sig-help one-press vs. autocomplete swallow) |

## Helpers (`helpers.ts`)

```typescript
gotoSheets(page)                    // Navigate to /$db/-/sheets, wait for load
getCell(page, "A1")                 // Locator for a cell by ID
selectCell(page, "A1")              // Click to select
typeInCell(page, "A1", "hello")     // Type + Enter to commit
expectCellValue(page, "A1", "hello") // Assert display value (5s timeout)
fillCells(page, {A1: "x", B1: "y"}) // Batch fill
waitForAutoSave(page, timeout?)     // Poll [data-save-status] for "idle"
```

## Collaboration Tests Pattern

Uses two independent browser contexts to simulate two users:

```typescript
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
// Both navigate to same sheet, edits propagate via SSE
```

## Notes

- Tests share server state (same on-disk DB) — collaboration tests
  create fresh sheet tabs to avoid stale data. ``gotoSheets`` defaults
  to a unique ``E2E-${ts}-${rand}`` workbook name so tests stay
  independent; pass an explicit ``name`` only when a test asserts on
  the workbook's title. (Playwright runs ``workers: 1`` /
  ``fullyParallel: false`` — multi-worker isolation would require a
  per-worker DB and is deferred until there's a flake budget for it.)
- `force: true` on click actions to bypass any debug-bar overlays from dev dependencies.
- `waitForAutoSave(page)` polls the `[data-save-status]` attribute on the
  save indicator slot until it returns to `"idle"` — defaults to a 5s
  upper bound. Pass a higher timeout only if you've measured a real
  long save (e.g. SSE round-trip with extra latency budget). Use it
  before recording network requests, before `page.reload()`, or after
  a programmatic mutation that doesn't block on `Enter` (paste, format,
  column-resize drag, sheet switch).
- **Header right-click menus** (`.row-menu`) are fixed-position siblings of the grid. Target via `locator(".row-menu-item.danger")`. The row menu and column menu share CSS — `col-delete.spec.ts` uses the same locator.
- **Right-click drag-select** for row/column headers uses `page.mouse.move` + `mouse.down`/`mouse.up` — Playwright's `locator.click({button:'right'})` fires `contextmenu` but doesn't simulate dragging.
- **POST helpers in `helpers.ts`** must include `/create` in the URL (`…/api/workbooks/create`), not bare `…/api/workbooks`. The plugin router doesn't dispatch on HTTP method, so bare `/workbooks` hits the GET list handler and returns 200 with no side effect.

## What NOT to do

- Don't stage e2e probes in `/tmp` and `cp` them in. Write the file
  directly in `e2e/` and delete it after the investigation. The
  user has corrected this.
