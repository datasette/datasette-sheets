<script lang="ts">
  // [sheet.filter.column-popover]
  //
  // Phase D: filter-by-values list is now functional. Sort buttons
  // remain disabled placeholders until Phase E.
  //
  // Outside-click + Escape dismiss come from SheetsPage's
  // ``svelte:window`` — same pattern the column / row context menus
  // use, so the popover doesn't have to duplicate the global click
  // handler.
  import { keepInViewport } from "../actions/keepInViewport";
  import {
    sheetFilter,
    closeFilterPopover,
    distinctValuesForColumn,
    setFilterPredicate,
    setFilterSort,
  } from "../stores/filter";
  import { cells } from "../stores/spreadsheet";
  import { COLUMNS } from "../stores/spreadsheet";
  import { activeSheetId, getClientId } from "../stores/persistence";
  import { openCreateViewDialog } from "../stores/createView";
  import { formatValue } from "../spreadsheet/formatter";
  import type { CellId } from "../spreadsheet/types";
  import { get } from "svelte/store";

  interface Props {
    colIdx: number;
    anchorRect: DOMRect;
    /** Database + workbookId come from SheetsPage when the popover
     *  is mounted. They're optional in tests that mount the popover
     *  in isolation — the OK button is gated on both being non-empty. */
    database?: string;
    workbookId?: number;
  }
  let { colIdx, anchorRect, database = "", workbookId = 0 }: Props = $props();

  let filter = $derived($sheetFilter);
  let columnLetter = $derived(COLUMNS[colIdx] ?? `Col ${colIdx}`);

  // Header label = the display value of the filter's header-row cell
  // for this column, falling back to the column letter when the
  // header is blank or out of range. Mirrors what the user sees as
  // the bold header in the grid, so the popover title reads as
  // "{column name}" rather than "{A,B,C…}".
  let headerLabel = $derived.by(() => {
    if (!filter) return columnLetter;
    const col = COLUMNS[colIdx];
    if (!col) return columnLetter;
    const cell = $cells.get(`${col}${filter.min_row + 1}` as CellId);
    if (!cell) return columnLetter;
    const display = cell.error
      ? cell.error
      : formatValue(cell.computedValue, cell.format);
    return display || columnLetter;
  });

  // Distinct display strings the column produces. Re-derives when
  // the cells map changes — the popover stays accurate even if a
  // cell value lands via SSE while the popover is open.
  let allValues = $derived(distinctValuesForColumn(filter, $cells, colIdx));

  // Currently-persisted hidden list for this column, used to seed
  // the staged checkbox state when the popover opens.
  let persistedHidden = $derived.by(() => {
    if (!filter) return new Set<string>();
    const p = filter.predicates?.[String(colIdx)];
    return new Set<string>(p?.hidden ?? []);
  });

  // Local search filter over the value list — purely a UI affordance,
  // doesn't affect which values match the predicate.
  let search = $state("");
  // Staged "hidden" set — the user toggles checkboxes locally;
  // hitting OK persists, Cancel discards. Empty initially; seeded
  // by the $effect below from ``persistedHidden`` when the popover
  // mounts and whenever the column changes (popovers can be reused
  // across columns if the user clicks chevron after chevron).
  let stagedHidden = $state<Set<string>>(new Set());
  $effect(() => {
    // Re-seed when the column or persisted hidden list changes.
    void colIdx;
    stagedHidden = new Set(persistedHidden);
  });

  let filteredValues = $derived.by(() => {
    if (!search) return allValues;
    const q = search.toLowerCase();
    return allValues.filter((v) => v.value.toLowerCase().includes(q));
  });
  let checkedCount = $derived(allValues.length - stagedHidden.size);

  function toggleValue(value: string, checked: boolean) {
    const next = new Set(stagedHidden);
    if (checked) next.delete(value);
    else next.add(value);
    stagedHidden = next;
  }

  function selectAll() {
    stagedHidden = new Set();
  }
  function clearAll() {
    stagedHidden = new Set(allValues.map((v) => v.value));
  }

  let saving = $state(false);
  let errorMessage = $state<string | null>(null);

  async function handleApply() {
    if (!filter || !database || !workbookId) {
      closeFilterPopover();
      return;
    }
    const sheetId = get(activeSheetId);
    if (!sheetId) {
      closeFilterPopover();
      return;
    }
    saving = true;
    errorMessage = null;
    try {
      // Empty staged set ⇒ remove the predicate entirely; non-empty
      // ⇒ persist the list. Either way the server returns the
      // updated FilterRecord and the store splices it.
      const hiddenList = stagedHidden.size === 0 ? null : [...stagedHidden];
      await setFilterPredicate(
        database,
        workbookId,
        sheetId,
        colIdx,
        hiddenList,
        getClientId(),
      );
      closeFilterPopover();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function handleCancel() {
    closeFilterPopover();
  }

  // [sheet.filter.create-view] Build the filter's A1 range from
  // ``min_row..max_row`` x ``min_col..max_col`` and hand it to the
  // shared Create-View dialog. Closes the popover so the dialog
  // isn't competing with it for the foreground.
  function handleCreateView() {
    if (!filter) return;
    const left = COLUMNS[filter.min_col];
    const right = COLUMNS[filter.max_col];
    if (!left || !right) {
      closeFilterPopover();
      return;
    }
    const range = `${left}${filter.min_row + 1}:${right}${filter.max_row + 1}`;
    openCreateViewDialog(range);
    closeFilterPopover();
  }

  // [sheet.filter.sort-asc] [sheet.filter.sort-desc]
  async function handleSort(direction: "asc" | "desc") {
    if (!filter || !database || !workbookId) {
      closeFilterPopover();
      return;
    }
    const sheetId = get(activeSheetId);
    if (!sheetId) return;
    saving = true;
    errorMessage = null;
    try {
      await setFilterSort(
        database,
        workbookId,
        sheetId,
        colIdx,
        direction,
        getClientId(),
      );
      closeFilterPopover();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="filter-popover popover"
  use:keepInViewport
  style:top="{anchorRect.bottom + 4}px"
  style:left="{anchorRect.left}px"
  onclick={(e) => e.stopPropagation()}
  oncontextmenu={(e) => e.preventDefault()}
  data-cell-id="filter-popover"
>
  <div class="filter-popover-header">
    <span class="filter-popover-col">{headerLabel}</span>
    <button
      type="button"
      class="filter-popover-close"
      onclick={handleCancel}
      title="Close"
      aria-label="Close"
    >
      ×
    </button>
  </div>

  <div class="filter-popover-section">
    <button
      type="button"
      class="filter-popover-row"
      onclick={() => handleSort("asc")}
      disabled={saving || !filter}
      data-cell-id="filter-sort-asc"
    >
      Sort A → Z
    </button>
    <button
      type="button"
      class="filter-popover-row"
      onclick={() => handleSort("desc")}
      disabled={saving || !filter}
      data-cell-id="filter-sort-desc"
    >
      Sort Z → A
    </button>
  </div>

  <div class="filter-popover-divider" role="separator"></div>

  <!-- [sheet.filter.create-view] One-click entry into the
       Create-View dialog with the filter's rectangle pre-filled. -->
  <div class="filter-popover-section">
    <button
      type="button"
      class="filter-popover-row"
      onclick={handleCreateView}
      disabled={saving || !filter}
      data-cell-id="filter-create-view"
    >
      Create view…
    </button>
  </div>

  <div class="filter-popover-divider" role="separator"></div>

  <!-- [sheet.filter.value-toggle] Filter by values — distinct
       display strings observed in the column's data range, each
       toggleable via a checkbox. Local staged state persists to
       the server when the user clicks OK; Cancel discards. -->
  <div class="filter-popover-section filter-popover-values">
    <input
      type="text"
      class="filter-popover-search"
      placeholder="Search values"
      bind:value={search}
      data-cell-id="filter-values-search"
    />
    <div class="filter-popover-list-actions">
      <button
        type="button"
        class="filter-popover-link"
        onclick={selectAll}
        data-cell-id="filter-select-all"
      >
        Select all
      </button>
      <span class="filter-popover-list-sep">·</span>
      <button
        type="button"
        class="filter-popover-link"
        onclick={clearAll}
        data-cell-id="filter-clear-all"
      >
        Clear
      </button>
      <span
        class="filter-popover-list-count"
        data-cell-id="filter-displaying-count"
      >
        Displaying {checkedCount}
      </span>
    </div>
    <div class="filter-popover-list">
      {#if filteredValues.length === 0}
        <div class="filter-popover-empty">No matching values</div>
      {:else}
        {#each filteredValues as v (v.value)}
          <label class="filter-popover-list-row">
            <input
              type="checkbox"
              checked={!stagedHidden.has(v.value)}
              onchange={(e) =>
                toggleValue(
                  v.value,
                  (e.currentTarget as HTMLInputElement).checked,
                )}
              data-cell-id={`filter-value-${v.value || "blank"}`}
            />
            <span class={v.value === "" ? "filter-popover-blank" : ""}>
              {v.value === "" ? "(Blanks)" : v.value}
            </span>
            <span
              class="filter-popover-list-count-badge"
              data-cell-id={`filter-value-count-${v.value || "blank"}`}
            >
              {v.count}
            </span>
          </label>
        {/each}
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <div class="filter-popover-error" role="alert">{errorMessage}</div>
  {/if}

  <div class="filter-popover-footer">
    <button
      type="button"
      class="filter-btn-secondary"
      onclick={handleCancel}
      data-cell-id="filter-cancel"
      disabled={saving}
    >
      Cancel
    </button>
    <button
      type="button"
      class="filter-btn-primary"
      onclick={handleApply}
      disabled={saving || !filter}
      data-cell-id="filter-ok"
    >
      {saving ? "Saving…" : "OK"}
    </button>
  </div>

  {#if filter && filter.sort_col_idx === colIdx}
    <div class="filter-popover-active-sort">
      Sorted: {filter.sort_direction === "asc" ? "A → Z" : "Z → A"}
    </div>
  {/if}
</div>

<style>
  .filter-popover {
    position: fixed;
    background: var(--sheet-surface, #fff);
    border: 1px solid var(--sheet-border-strong, #c0c0c0);
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    min-width: 240px;
    padding: 6px 0;
    z-index: var(--z-grid-menu, 100);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
    color: var(--sheet-text, #111);
  }
  .filter-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px 8px;
    border-bottom: 1px solid var(--sheet-border-light, #eee);
  }
  .filter-popover-col {
    font-family: var(--sheet-font, monospace);
    font-weight: 700;
    font-size: 12px;
    color: var(--sheet-text-secondary, #666);
  }
  .filter-popover-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--sheet-text-muted, #5f6b7a);
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
  }
  .filter-popover-close:hover {
    color: var(--sheet-text, #111);
  }
  .filter-popover-section {
    padding: 4px 0;
  }
  .filter-popover-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .filter-popover-row:hover:not(:disabled) {
    background: var(--sheet-active-bg, #e8edf2);
  }
  .filter-popover-row:disabled {
    color: var(--sheet-text-muted, #9aa3ad);
    cursor: not-allowed;
  }
  .filter-popover-divider {
    height: 1px;
    background: var(--sheet-border-light, #eee);
    margin: 4px 0;
  }
  .filter-popover-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 12px 4px;
  }
  .filter-btn-secondary,
  .filter-btn-primary {
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    border: 1px solid var(--sheet-border-strong, #c0c0c0);
    background: var(--sheet-surface, #fff);
    color: var(--sheet-text, #111);
  }
  .filter-btn-primary {
    background: var(--sheet-filter-border, #1a7f37);
    color: #fff;
    border-color: var(--sheet-filter-border, #1a7f37);
  }
  .filter-btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .filter-btn-secondary:hover {
    background: var(--sheet-active-bg, #e8edf2);
  }
  .filter-popover-active-sort {
    padding: 4px 12px 0;
    font-size: 11px;
    color: var(--sheet-text-muted, #5f6b7a);
    font-style: italic;
  }
  .filter-popover-values {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 220px;
  }
  .filter-popover-search {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px;
    border: 1px solid var(--sheet-border-strong, #c0c0c0);
    border-radius: 4px;
    font: inherit;
    background: var(--sheet-surface, #fff);
    color: inherit;
  }
  .filter-popover-list-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--sheet-text-muted, #5f6b7a);
  }
  .filter-popover-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--sheet-link, #1a73e8);
    font: inherit;
    text-decoration: underline;
  }
  .filter-popover-link:hover {
    text-decoration: none;
  }
  .filter-popover-list-sep {
    color: var(--sheet-text-muted, #5f6b7a);
  }
  .filter-popover-list-count {
    margin-left: auto;
  }
  .filter-popover-list {
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--sheet-border-light, #eee);
    border-radius: 4px;
    padding: 4px 0;
  }
  .filter-popover-list-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .filter-popover-list-row:hover {
    background: var(--sheet-active-bg, #e8edf2);
  }
  .filter-popover-blank {
    color: var(--sheet-text-muted, #9aa3ad);
    font-style: italic;
  }
  .filter-popover-list-count-badge {
    margin-left: auto;
    font-size: 11px;
    color: var(--sheet-text-muted, #5f6b7a);
    font-variant-numeric: tabular-nums;
  }
  .filter-popover-empty {
    padding: 8px 12px;
    color: var(--sheet-text-muted, #9aa3ad);
    font-style: italic;
    text-align: center;
    font-size: 12px;
  }
  .filter-popover-error {
    padding: 4px 12px;
    color: var(--sheet-error, #d00);
    font-size: 12px;
  }
</style>
