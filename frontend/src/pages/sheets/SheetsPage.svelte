<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Toolbar from "../../lib/components/Toolbar.svelte";
  import FormulaBar from "../../lib/components/FormulaBar.svelte";
  import Grid from "../../lib/components/Grid.svelte";
  import StatusBar from "../../lib/components/StatusBar.svelte";
  import SheetTabs from "../../lib/components/SheetTabs.svelte";
  import NamedRangesPanel from "../../lib/components/NamedRangesPanel.svelte";
  import FormatMenu from "../../lib/components/FormatMenu.svelte";
  import DropdownPopover from "../../lib/components/DropdownPopover.svelte";
  import FilterColumnPopover from "../../lib/components/FilterColumnPopover.svelte";
  import { filterPopover, closeFilterPopover } from "../../lib/stores/filter";
  import {
    createViewDialog,
    closeCreateViewDialog,
  } from "../../lib/stores/createView";
  import CreateViewDialog from "../../lib/components/CreateViewDialog.svelte";
  import DropdownRuleEditor from "../../lib/components/DropdownRuleEditor.svelte";
  import {
    namedRangesPanel,
    openNamedRangesPanel,
    closeNamedRangesPanel,
  } from "../../lib/stores/namedRanges";
  import {
    setDatabase,
    setWorkbookId,
    initWorkbook,
    enableAutoSave,
    setClientId,
    saveStatus,
  } from "../../lib/stores/persistence";
  import {
    debugMode,
    debugLogLength,
    clearDebugLog,
    formatDebugLog,
  } from "../../lib/stores/debug";
  import { activeUsers } from "../../lib/stores/presence";
  import {
    handleCopy,
    handleCut,
    handlePaste,
    copyFromMenu,
    cutFromMenu,
    pasteFromMenu,
  } from "../../lib/clipboard/sheetClipboard";
  import { installDocumentShortcuts } from "../../lib/sheetKeyboard";
  import { installSheetLifecycle } from "../../lib/sheetLifecycle";
  import { updateWorkbook } from "../../lib/api";

  interface Props {
    database: string;
    workbookId: number;
    workbookName?: string;
  }

  // ``workbookName`` is rebound locally after a successful rename, so
  // it's pulled in as ``$bindable``. The parent (``index.ts``) doesn't
  // bind, so the write stays internal — same shape used by other
  // self-renaming subtrees.
  let { database, workbookId, workbookName = $bindable("") }: Props = $props();

  let loading = $state(true);
  let error: string | null = $state(null);
  let connected = $state(false);
  let teardownLifecycle: (() => void) | null = null;
  let teardownShortcuts: (() => void) | null = null;

  // Inline workbook-name editing. `editingName` is the draft; `workbookName`
  // is the committed value that also ends up in <title>.
  let editingName: string | null = $state(null);
  let savingName = $state(false);

  function beginEditName() {
    editingName = workbookName;
  }

  function cancelEditName() {
    editingName = null;
  }

  // [sheet.workbook.rename]
  async function saveName() {
    if (editingName === null) return;
    const next = editingName.trim();
    if (!next || next === workbookName) {
      editingName = null;
      return;
    }
    savingName = true;
    try {
      const updated = await updateWorkbook(database, workbookId, {
        name: next,
      });
      workbookName = updated.name;
      document.title = `${updated.name} - Sheets`;
      editingName = null;
    } catch (e) {
      alert(
        `Failed to rename workbook: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      savingName = false;
    }
  }

  function onNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditName();
    }
  }

  const clientId = crypto.randomUUID();

  // Copy log → OS clipboard + clear button state. Kept inline so
  // the button is self-contained (no extra store round-trips).
  let debugCopyFeedback: string | null = $state(null);
  async function copyDebugLog() {
    try {
      await navigator.clipboard.writeText(formatDebugLog());
      debugCopyFeedback = "copied";
    } catch {
      debugCopyFeedback = "copy failed";
    }
    setTimeout(() => {
      debugCopyFeedback = null;
    }, 1500);
  }

  onMount(async () => {
    setDatabase(database);
    setWorkbookId(workbookId);
    setClientId(clientId);

    // Document listeners go up first so any cell interaction that
    // can race with the load (e.g. an autofocused cell firing a
    // paste before init resolves) still finds the handlers wired.
    document.addEventListener("copy", handleCopy);
    document.addEventListener("cut", handleCut);
    document.addEventListener("paste", handlePaste);
    teardownShortcuts = installDocumentShortcuts();

    // SSE + presence + cleanup interval. Subscribes to
    // ``activeSheetId`` so the connect/reconnect happens after
    // ``initWorkbook`` populates it.
    teardownLifecycle = installSheetLifecycle({
      database,
      workbookId,
      clientId,
      onConnectedChange: (v) => {
        connected = v;
      },
    });

    try {
      await initWorkbook();
      enableAutoSave();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load sheets";
      console.error("Sheets init error:", e);
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    teardownLifecycle?.();
    teardownLifecycle = null;
    teardownShortcuts?.();
    teardownShortcuts = null;
    document.removeEventListener("copy", handleCopy);
    document.removeEventListener("cut", handleCut);
    document.removeEventListener("paste", handlePaste);
  });
</script>

{#if loading}
  <div class="sheets-loading">Loading spreadsheet...</div>
{:else if error}
  <div class="sheets-error">Error: {error}</div>
{:else}
  <div class="sheets-root">
    <div class="sheet-header">
      <div class="workbook-name">
        {#if editingName !== null}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="workbook-name-input"
            type="text"
            bind:value={editingName}
            onkeydown={onNameKeydown}
            disabled={savingName}
            autofocus
          />
          <button
            type="button"
            class="name-btn primary"
            onclick={saveName}
            disabled={savingName || !editingName.trim()}
            title="Save (Enter)"
          >
            {savingName ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            class="name-btn"
            onclick={cancelEditName}
            disabled={savingName}
            title="Cancel (Esc)"
          >
            Cancel
          </button>
        {:else}
          <h1 class="workbook-name-text" title={workbookName}>
            {workbookName}
          </h1>
          <button
            type="button"
            class="name-btn icon"
            onclick={beginEditName}
            title="Rename workbook"
            aria-label="Rename workbook"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path
                d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"
              />
            </svg>
          </button>
        {/if}
      </div>
      <!-- [sheet.format.menu] -->
      <FormatMenu />
      <div class="header-spacer"></div>
      <!-- [sheet.named-range.header-button] -->
      <button
        type="button"
        class="name-btn"
        onclick={() => openNamedRangesPanel()}
        title="Named ranges"
      >
        Named ranges
      </button>
      <!-- [sheet.save.indicator] -->
      <!-- ``data-save-status`` is always present so e2e tests can poll it
           via a stable locator (see ``e2e/helpers.ts::waitForAutoSave``). -->
      <span class="save-indicator-slot" data-save-status={$saveStatus}>
        {#if $saveStatus === "saving"}
          <span class="save-indicator saving" aria-live="polite">Saving…</span>
        {:else if $saveStatus === "saved"}
          <span class="save-indicator saved" aria-live="polite">✓ Saved</span>
        {/if}
      </span>
      <!-- [sheet.presence.avatar-strip] -->
      <div class="active-users">
        {#each $activeUsers as user (user.actor)}
          <div
            class="user-avatar"
            title={user.displayName}
            style="border-color: {user.color}"
          >
            {#if user.profilePictureUrl}
              <img src={user.profilePictureUrl} alt={user.displayName} />
            {:else}
              <span class="user-initial" style="background: {user.color}"
                >{user.displayName.charAt(0).toUpperCase()}</span
              >
            {/if}
          </div>
        {/each}
      </div>
      <!-- [sheet.presence.connection-dot] -->
      {#if connected}
        <span
          class="connection-dot connected"
          title="Connected — live updates active"
        ></span>
      {:else}
        <span
          class="connection-dot disconnected"
          title="Disconnected — reconnecting..."
        ></span>
      {/if}
      <!-- Debug toggle + log-copy. When off: a faint bug icon that
           flips debug on. When on: pill with event count + copy /
           clear buttons. Log is capped at 200 events in-memory. -->
      <div class="debug-widget" class:on={$debugMode}>
        <button
          type="button"
          class="debug-toggle"
          title={$debugMode ? "Turn debug off" : "Turn debug on"}
          aria-pressed={$debugMode}
          onclick={() => debugMode.update((v) => !v)}
        >
          🐛{$debugMode ? ` ${$debugLogLength}` : ""}
        </button>
        {#if $debugMode}
          <button
            type="button"
            class="debug-btn"
            title="Copy debug log to clipboard"
            onclick={copyDebugLog}
          >
            {debugCopyFeedback ?? "copy"}
          </button>
          <button
            type="button"
            class="debug-btn"
            title="Clear debug log"
            onclick={clearDebugLog}
          >
            clear
          </button>
        {/if}
      </div>
    </div>
    <div class="sheet-container">
      <Toolbar />
      <FormulaBar {database} {workbookId} />
      <Grid
        {database}
        {workbookId}
        onCutFromMenu={cutFromMenu}
        onCopyFromMenu={copyFromMenu}
        onPasteFromMenu={pasteFromMenu}
      />
      <StatusBar />
      <SheetTabs />
    </div>
    {#if $namedRangesPanel}
      <!-- [sheet.named-range.panel] -->
      <NamedRangesPanel
        {database}
        {workbookId}
        initialName={$namedRangesPanel.initialName ?? ""}
        initialDefinition={$namedRangesPanel.initialDefinition ?? ""}
        onClose={closeNamedRangesPanel}
      />
    {/if}
    <!-- [sheet.data.dropdown] Portal popover for dropdown cells.
         Self-mounts when ``dropdownPopoverFor`` is non-null. -->
    <DropdownPopover />
    <!-- [sheet.data.dropdown] Side-panel editor for dropdown rules.
         Self-mounts when ``dropdownRulesPanel`` is non-null. -->
    <DropdownRuleEditor {database} {workbookId} />
    <!-- [sheet.filter.column-popover] Portal popover for the filter
         chevron. Mounts when ``filterPopover`` is non-null. -->
    {#if $filterPopover}
      <FilterColumnPopover
        colIdx={$filterPopover.colIdx}
        anchorRect={$filterPopover.anchorRect}
        {database}
        {workbookId}
      />
    {/if}
    <!-- [sheet.filter.create-view] Single dialog mount, summoned by
         either the formula-bar's "Create view" button or the filter
         popover's "Create view…" row. ``range`` is supplied by the
         opener via the ``createViewDialog`` store. -->
    {#if $createViewDialog}
      <CreateViewDialog
        range={$createViewDialog.range}
        {database}
        {workbookId}
        onClose={closeCreateViewDialog}
      />
    {/if}
  </div>
{/if}

<svelte:window
  onclick={() => $filterPopover && closeFilterPopover()}
  onkeydown={(e) =>
    e.key === "Escape" && $filterPopover && closeFilterPopover()}
/>

<style>
  :global(.sheets-app-container) {
    /* Spreadsheet color palette — matches Datasette UI */
    --sheet-bg: #f8fafb;
    --sheet-surface: #fff;
    --sheet-header-bg: #f0f3f5;
    --sheet-hover-bg: #f5f7f9;
    --sheet-selected-bg: #e8f0f6;
    --sheet-highlight-bg: #e0e8ef;
    --sheet-active-bg: #e8edf2;
    --sheet-active-hover: #dce3ea;
    --sheet-border: #ddd;
    --sheet-border-strong: #ccc;
    --sheet-border-light: #eee;
    --sheet-text: #111a35;
    --sheet-text-secondary: #666;
    --sheet-accent: #276890;
    --sheet-error: #d00;
    --sheet-font: "Courier New", Courier, monospace;
    /* Density — tuned to match Google Sheets (~22px rows / 13px
       text). Adjust here to retune the whole grid; Cell.svelte and
       Grid.svelte only read these vars. */
    --sheet-row-height: 22px;
    --sheet-header-height: 22px;
    --sheet-row-header-width: 38px;
    --sheet-font-size: 13px;
    --sheet-cell-padding-x: 5px;
    /* Shape */
    --sheet-radius-sm: 3px;
    --sheet-radius-md: 4px;
    /* Shadows — named by visual weight, not component */
    --sheet-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.12);
    --sheet-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
    --sheet-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.15);
    /* Z-index scale — see frontend/CLAUDE.md "Popover / dropdown
       gotchas". The toolbar at --z-toolbar establishes a stacking
       context so popovers inside it only need a small local z.
       Popovers *outside* that context (Format menu, formula-bar
       menu) must sit at --z-popover to beat sticky headers. */
    --z-grid-menu: 200;
    --z-toolbar: 50;
    --z-popover: 100;
    --z-panel: 900;
    --z-modal: 1000;
  }

  :global(.sheets-app-container *) {
    box-sizing: border-box;
  }

  .sheets-root {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu,
      sans-serif;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    gap: 8px;
  }

  .header-spacer {
    flex: 1;
  }

  .workbook-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .workbook-name-text {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--sheet-text, #111);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40ch;
  }

  .workbook-name-input {
    font-size: 18px;
    font-weight: 600;
    padding: 2px 6px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    min-width: 240px;
    color: var(--sheet-text, #111);
    background: var(--sheet-surface, #fff);
    font-family: inherit;
  }

  .workbook-name-input:focus {
    outline: none;
    border-color: var(--sheet-accent, #276890);
  }

  .name-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 10px;
    background: var(--sheet-surface, #fff);
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--sheet-text, #111);
    cursor: pointer;
  }

  .name-btn:hover:not(:disabled) {
    background: var(--sheet-header-bg, #f0f3f5);
  }

  .name-btn.icon {
    padding: 4px;
    color: var(--sheet-text-secondary, #666);
    border-color: transparent;
  }

  .name-btn.icon:hover:not(:disabled) {
    color: var(--sheet-text, #111);
    border-color: var(--sheet-border-strong, #ccc);
  }

  .name-btn.primary {
    background: var(--sheet-accent, #276890);
    color: #fff;
    border-color: var(--sheet-accent, #276890);
  }

  .name-btn.primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .name-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .active-users {
    display: flex;
    align-items: center;
    gap: -4px;
  }

  .user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: -4px;
    background: #fff;
    flex-shrink: 0;
  }

  .user-avatar:first-child {
    margin-left: 0;
  }

  .user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .user-initial {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .connection-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .connection-dot.connected {
    background: #2ecc71;
  }

  .connection-dot.disconnected {
    background: #e74c3c;
    animation: pulse-red 1.5s infinite;
  }

  @keyframes pulse-red {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .save-indicator {
    font-size: 12px;
    color: var(--sheet-text-secondary, #666);
    padding: 2px 8px;
    white-space: nowrap;
  }

  .save-indicator.saved {
    color: #2a7a3e;
  }

  .debug-widget {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    font-size: 11px;
    color: var(--sheet-text-secondary, #666);
  }

  .debug-toggle {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-family: inherit;
    color: var(--sheet-text-secondary, #666);
    cursor: pointer;
    opacity: 0.45;
  }

  .debug-widget.on .debug-toggle {
    opacity: 1;
    color: var(--sheet-text, #111);
    border-color: var(--sheet-border-strong, #ccc);
    background: var(--sheet-active-bg, #e8edf2);
  }

  .debug-toggle:hover {
    opacity: 1;
  }

  .debug-btn {
    border: 1px solid var(--sheet-border-strong, #ccc);
    background: var(--sheet-surface, #fff);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-family: inherit;
    color: var(--sheet-text-secondary, #666);
    cursor: pointer;
  }

  .debug-btn:hover {
    background: var(--sheet-header-bg, #f0f3f5);
    color: var(--sheet-text, #111);
  }

  .sheet-container {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Everything else in the sheet column is fixed-height; only the Grid's
     scroll container below grows into the remaining space. */
  .sheet-container :global(> *) {
    flex: 0 0 auto;
  }
  .sheet-container :global(.grid-container) {
    flex: 1 1 auto;
    min-height: 0;
  }

  .sheets-loading {
    padding: 2rem;
    text-align: center;
    color: var(--sheet-text-secondary);
    font-family: var(--sheet-font);
  }

  .sheets-error {
    padding: 2rem;
    text-align: center;
    color: var(--sheet-error);
    font-family: var(--sheet-font);
  }
</style>
