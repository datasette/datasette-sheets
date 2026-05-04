<script lang="ts">
  import { createView } from "../api";
  import { parseRange } from "../engine";
  import { activeSheet, activeSheetId } from "../stores/persistence";
  import { loadViews } from "../stores/views";

  let {
    range = $bindable(""),
    database,
    workbookId,
    onClose,
  }: {
    range: string;
    database: string;
    workbookId: number;
    onClose: () => void;
  } = $props();

  // [sheet.filter.create-view] Suggest a view-name from the active
  // sheet's name on first mount so users with a "Customers" sheet
  // get ``customers`` pre-filled. Pure suggestion — server-side
  // ``validate_view_name`` is the authoritative check.
  function suggestViewName(rawName: string | undefined): string {
    if (!rawName) return "";
    const cleaned = rawName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
    if (!cleaned) return "";
    const safe = /^[0-9]/.test(cleaned) ? `view_${cleaned}` : cleaned;
    return safe.toLowerCase();
  }
  let viewName = $state(suggestViewName($activeSheet?.name));
  let useHeaders = $state(true);
  let enableTriggers = $state(false);
  let enableInsert = $state(false);
  let enableUpdate = $state(false);
  let enableDelete = $state(false);
  let deleteMode: "clear" | "shift" = $state("clear");
  let error: string | null = $state(null);
  let creating = $state(false);

  // Range parsing is delegated to the Rust engine (lotus-core) via WASM so
  // the backend (lotus.parse_range) and frontend use the exact same
  // grammar. Only unbounded ranges (`A:F`, `A1:F`) allow INSERT — bounded
  // ranges can't accept appended rows.
  let parsed = $derived(parseRange(range));
  let rangeValid = $derived(parsed !== null);
  let isUnbounded = $derived(parsed?.unbounded ?? false);
  let isBounded = $derived(parsed !== null && !parsed.unbounded);

  // Auto-clear enableInsert if the user edits the range into a bounded shape.
  $effect(() => {
    if (!isUnbounded && enableInsert) enableInsert = false;
  });

  function onToggleTriggers(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    enableInsert = checked && isUnbounded;
    enableUpdate = checked;
    enableDelete = checked;
  }

  function suggestUnboundRange(): string {
    // Strip the trailing digits off the end cell, e.g. A1:F10 → A1:F.
    // The engine doesn't offer a "make this unbounded" helper — this is
    // a purely cosmetic nudge on top of the normalized text.
    const src = parsed?.normalized ?? range.trim().toUpperCase();
    const m = src.match(/^([A-Z]+\d*:[A-Z]+)\d+$/);
    return m ? m[1] : src;
  }

  function makeRangeUnbounded() {
    range = suggestUnboundRange();
  }

  async function handleCreate() {
    if (!viewName.trim() || !$activeSheetId) return;
    error = null;
    creating = true;
    try {
      await createView(database, workbookId, $activeSheetId, {
        view_name: viewName.trim(),
        range,
        use_headers: useHeaders,
        enable_insert: enableTriggers && enableInsert && isUnbounded,
        enable_update: enableTriggers && enableUpdate,
        enable_delete: enableTriggers && enableDelete,
        delete_mode: deleteMode,
      });
      await loadViews(database, workbookId, $activeSheetId);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to create view";
    } finally {
      creating = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && viewName.trim()) handleCreate();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose}>
  <div
    class="dialog"
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <h3>Create View</h3>
    <p class="desc">
      Create a SQL view from the selected range. The view will be queryable in
      Datasette.
    </p>

    <label class="field">
      <span>Range</span>
      <input
        type="text"
        bind:value={range}
        class:invalid={!rangeValid}
        placeholder="e.g. A1:F or A:F"
      />
    </label>

    <label class="field">
      <span>View name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={viewName}
        placeholder="e.g. students"
        autofocus
      />
    </label>

    <label class="checkbox">
      <input type="checkbox" bind:checked={useHeaders} />
      <span>Use first row as column headers</span>
    </label>

    <label class="checkbox">
      <input
        type="checkbox"
        bind:checked={enableTriggers}
        onchange={onToggleTriggers}
      />
      <span>Make view writable (add <code>INSTEAD OF</code> triggers)</span>
    </label>

    {#if enableTriggers}
      <div class="trigger-group">
        <p class="hint">
          A <code>_sheet_row</code> column is added so <code>UPDATE</code>/<code
            >DELETE</code
          >
          can identify which sheet row to modify.
        </p>
        <label class="checkbox" class:disabled={!isUnbounded}>
          <input
            type="checkbox"
            bind:checked={enableInsert}
            disabled={!isUnbounded}
          />
          <span><code>INSERT</code> — append a new row to the sheet</span>
        </label>
        {#if !isUnbounded}
          <p class="hint nudge">
            <code>INSERT</code> requires an unbounded range (e.g.
            <code>A1:F</code>
            or
            <code>A:F</code>) so new rows have somewhere to go.
            {#if isBounded}
              <button
                type="button"
                class="inline-link"
                onclick={makeRangeUnbounded}
              >
                Change to <code>{suggestUnboundRange()}</code>
              </button>
            {/if}
          </p>
        {/if}
        <label class="checkbox">
          <input type="checkbox" bind:checked={enableUpdate} />
          <span><code>UPDATE</code> — edit cells in an existing row</span>
        </label>
        <label class="checkbox">
          <input type="checkbox" bind:checked={enableDelete} />
          <span><code>DELETE</code> — remove a row</span>
        </label>
        {#if enableDelete}
          <div class="delete-mode">
            <label class="radio">
              <input type="radio" bind:group={deleteMode} value="clear" />
              <span>Clear row (cells become empty, leaves a gap)</span>
            </label>
            <label class="radio">
              <input type="radio" bind:group={deleteMode} value="shift" />
              <span>Shift subsequent rows up (close the gap)</span>
            </label>
          </div>
        {/if}
      </div>
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="actions">
      <button class="btn" onclick={onClose}>Cancel</button>
      <button
        class="btn primary"
        onclick={handleCreate}
        disabled={!viewName.trim() || !rangeValid || creating}
      >
        {creating ? "Creating..." : "Create"}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
  }

  .dialog {
    background: var(--sheet-surface, #fff);
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 8px;
    padding: 20px 24px;
    width: 460px;
    max-width: calc(100vw - 40px);
    box-shadow: var(--sheet-shadow-lg);
  }

  h3 {
    margin: 0 0 4px;
    font-size: 16px;
    color: var(--sheet-text, #111);
  }

  .desc {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--sheet-text-secondary, #666);
  }

  .field {
    display: block;
    margin-bottom: 12px;
  }

  .field span {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--sheet-text, #111);
  }

  .field input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    font-size: 14px;
    font-family: var(--sheet-font, monospace);
    box-sizing: border-box;
  }

  .field input:focus {
    outline: none;
    border-color: var(--sheet-accent, #276890);
  }

  .field input.invalid {
    border-color: var(--sheet-error, #d00);
  }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--sheet-text, #111);
    cursor: pointer;
  }

  .checkbox input[type="checkbox"] {
    margin: 1px 0 0;
    flex: 0 0 auto;
  }

  .checkbox span {
    white-space: nowrap;
  }

  .checkbox code,
  .hint code {
    font-family: var(--sheet-font, monospace);
    font-size: 12px;
    padding: 1px 4px;
    background: var(--sheet-header-bg, #f0f3f5);
    border-radius: 3px;
    white-space: nowrap;
  }

  .trigger-group {
    margin: 0 0 12px 12px;
    padding: 6px 10px;
    border-left: 2px solid var(--sheet-border-strong, #ccc);
  }

  .trigger-group .checkbox {
    margin-bottom: 6px;
  }

  .checkbox.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--sheet-text-secondary, #666);
    line-height: 1.4;
  }

  .hint.nudge {
    margin: -2px 0 8px 24px;
    white-space: normal;
  }

  .inline-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--sheet-accent, #276890);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }

  .delete-mode {
    margin: 0 0 8px 24px;
    padding: 6px 10px;
    border-left: 2px solid var(--sheet-border-strong, #ccc);
  }

  .radio {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 13px;
    color: var(--sheet-text, #111);
    cursor: pointer;
  }

  .radio input[type="radio"] {
    margin: 2px 0 0;
    flex: 0 0 auto;
  }

  .radio span {
    white-space: normal;
  }

  .error {
    color: var(--sheet-error, #d00);
    font-size: 13px;
    margin-bottom: 12px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* Buttons: .btn / .btn.primary are inherited from shared.css */
</style>
