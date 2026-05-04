<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    cells,
    selectedCell,
    selectedCells,
    editingCell,
    editValue,
    parseCellId,
    COLUMNS,
  } from "../stores/spreadsheet";
  import { activeSheetId } from "../stores/persistence";
  import { activeView, removeView } from "../stores/views";
  import { keepInViewport } from "../actions/keepInViewport";
  import {
    openOverlay,
    toggleOverlay,
    closeOverlay,
  } from "../stores/openOverlay";
  import { openCreateViewDialog } from "../stores/createView";
  import { sheetFilter } from "../stores/filter";

  interface Props {
    database?: string;
    workbookId?: number;
  }

  let { database = "", workbookId = 0 }: Props = $props();

  let cell = $derived($selectedCell ? $cells.get($selectedCell) : null);
  let displayFormula = $derived(cell?.rawValue ?? "");

  let isRange = $derived($selectedCells.size > 1);
  // [sheet.formula-bar.label]
  let rangeLabel = $derived.by(() => {
    if ($selectedCells.size <= 1) return $selectedCell ?? "";
    let minCol = Infinity,
      maxCol = -1,
      minRow = Infinity,
      maxRow = -1;
    for (const id of $selectedCells) {
      const { colIndex, row } = parseCellId(id);
      if (colIndex < minCol) minCol = colIndex;
      if (colIndex > maxCol) maxCol = colIndex;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
    const topLeft = `${COLUMNS[minCol]}${minRow}`;
    const bottomRight = `${COLUMNS[maxCol]}${maxRow}`;
    return topLeft === bottomRight ? topLeft : `${topLeft}:${bottomRight}`;
  });

  // [page-toolbar-04] Cell-reference dropdown state lives in the
  // global ``openOverlay`` store so opening it auto-closes any other
  // popover (toolbar pickers, Format menu) and vice versa.
  const OVERLAY_ID = "formula-bar:cell-ref";
  let menuOpen = $derived($openOverlay === OVERLAY_ID);
  let rootRef: HTMLElement | null = $state(null);

  // [page-toolbar-08] Mousedown-capture + ``contains`` dismiss, mirroring
  // Toolbar / FormatMenu. The previous ``<svelte:window on:click>``
  // approach fired on every click anywhere in the document, including
  // clicks INSIDE the menu, and forced every menu item to carry
  // ``stopPropagation`` to opt out. ``mousedown`` capture also closes
  // before focus changes, so a click on a future text input inside the
  // menu wouldn't blur-then-close.
  function handleDocMouseDown(e: MouseEvent) {
    if (!menuOpen || !rootRef) return;
    if (!rootRef.contains(e.target as Node)) closeMenu();
  }

  // [page-toolbar-08] Local Esc handler — belt-and-braces close so the
  // menu dismisses even when SheetsPage's global Esc handler isn't
  // mounted (tests, future re-org). Same policy as FormatMenu: do NOT
  // ``stopPropagation`` so one Esc still clears every transient piece
  // of state.
  function handleKey(e: KeyboardEvent) {
    if (menuOpen && e.key === "Escape") closeMenu();
  }

  onMount(() => {
    document.addEventListener("mousedown", handleDocMouseDown, true);
    document.addEventListener("keydown", handleKey);
  });
  onDestroy(() => {
    document.removeEventListener("mousedown", handleDocMouseDown, true);
    document.removeEventListener("keydown", handleKey);
  });

  // View mode display
  let inViewMode = $derived($activeView !== null);
  let viewLabel = $derived($activeView?.view_name ?? "");

  // [sheet.formula-bar.live-sync]
  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if ($selectedCell) {
      editValue.set(target.value);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && $selectedCell) {
      cells.setCellValue($selectedCell, $editValue);
      editingCell.set(null);
    }
  }

  // [sheet.editing.formula-bar]
  function handleFocus() {
    if ($selectedCell) {
      editingCell.set($selectedCell);
      editValue.set(cell?.rawValue ?? "");
    }
  }

  // [sheet.formula-bar.dropdown]
  function toggleMenu(e: MouseEvent | KeyboardEvent) {
    // [page-toolbar-08] The menu sits inside ``.cell-reference`` for
    // CSS positioning, so menu-item clicks bubble up here. Each item's
    // handler already calls ``closeMenu`` — if we ran ``toggleOverlay``
    // on the bubbled click we'd immediately reopen what just closed.
    // Skip when the click originated inside the menu.
    if (e.target instanceof Element && e.target.closest(".cell-menu") !== null)
      return;
    // [page-toolbar-10] Forward the trigger element so any close path
    // (item select, Esc, outside-click) returns focus to the
    // cell-reference button instead of <body>.
    toggleOverlay(OVERLAY_ID, e.currentTarget as HTMLElement);
  }

  function closeMenu() {
    closeOverlay(OVERLAY_ID);
  }

  async function copyApiUrl() {
    if (!$selectedCell || !$activeSheetId) return;
    const base = `${window.location.origin}/${database}/-/sheets/api/workbooks/${workbookId}/sheets/${$activeSheetId}/data`;
    const url = isRange
      ? `${base}?range=${rangeLabel}`
      : `${base}/${$selectedCell}`;
    await navigator.clipboard.writeText(url);
    closeMenu();
  }

  // [sheet.filter.create-view] Range pre-fill cascade: explicit
  // selection > active filter rectangle > empty (the dialog
  // surfaces a validation error so the user types one). Keeps the
  // existing behavior for non-filter sheets and gives the formula-
  // bar trigger feature parity with the popover entry below.
  function rangeForCreateView(): string {
    if ($selectedCells.size > 1) return rangeLabel;
    const f = $sheetFilter;
    if (f) {
      const left = COLUMNS[f.min_col];
      const right = COLUMNS[f.max_col];
      if (left && right) {
        return `${left}${f.min_row + 1}:${right}${f.max_row + 1}`;
      }
    }
    return rangeLabel;
  }

  function openCreateDialog() {
    closeMenu();
    openCreateViewDialog(rangeForCreateView());
  }

  function viewInDatasette() {
    if (!$activeView) return;
    window.open(`/${database}/${$activeView.view_name}`, "_blank");
    closeMenu();
  }

  async function handleDeleteView() {
    if (!$activeView || !$activeSheetId) return;
    if (
      !confirm(
        `Delete view "${$activeView.view_name}"? This will drop the SQL view.`,
      )
    )
      return;
    try {
      await removeView(database, workbookId, $activeSheetId, $activeView.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to delete view: ${msg}`);
      return;
    }
    closeMenu();
  }
</script>

<div class="formula-bar" bind:this={rootRef}>
  <div
    class="cell-reference"
    onclick={toggleMenu}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMenu(e);
      }
    }}
    role="button"
    tabindex="-1"
  >
    {#if inViewMode}
      <span class="cell-ref-text view-name" style="color: {$activeView?.color}"
        >{viewLabel}</span
      >
    {:else}
      <span class="cell-ref-text">{rangeLabel}</span>
    {/if}
    <span class="cell-ref-chevron">▾</span>

    {#if menuOpen}
      <div class="cell-menu popover" use:keepInViewport>
        {#if inViewMode}
          <div class="menu-label">{$activeView?.view_name}</div>
          <button class="cell-menu-item" onclick={viewInDatasette}>
            View in Datasette
          </button>
          <button class="cell-menu-item danger" onclick={handleDeleteView}>
            Delete view
          </button>
        {:else if $selectedCell}
          <button class="cell-menu-item" onclick={copyApiUrl}>
            {isRange ? "Copy range API URL" : "Copy cell API URL"}
          </button>
          {#if isRange}
            <button class="cell-menu-item" onclick={openCreateDialog}>
              Create view...
            </button>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
  <div class="formula-icon">
    <span>fx</span>
  </div>
  <input
    type="text"
    class="formula-input"
    value={$editingCell === $selectedCell ? $editValue : displayFormula}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onfocus={handleFocus}
    placeholder="Enter value or formula"
  />
</div>

<style>
  .formula-bar {
    display: flex;
    align-items: stretch;
    height: 30px;
    border-bottom: 1px solid var(--sheet-border);
    background: var(--sheet-surface);
  }

  .cell-reference {
    min-width: 72px;
    padding: 0 6px 0 10px;
    font-size: 13px;
    font-weight: 600;
    border-right: 1px solid var(--sheet-border);
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--sheet-header-bg);
    color: var(--sheet-text);
    font-family: var(--sheet-font);
    cursor: pointer;
    position: relative;
    user-select: none;
  }

  .cell-reference:hover {
    background: var(--sheet-active-bg);
  }

  .cell-ref-text {
    flex: 1;
  }

  .cell-ref-text.view-name {
    font-weight: 700;
  }

  .cell-ref-chevron {
    font-size: 9px;
    color: var(--sheet-text-secondary);
  }

  .cell-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: var(--z-popover);
    min-width: 170px;
    padding: 4px 0;
  }

  .menu-label {
    padding: 6px 12px 4px;
    font-size: 11px;
    font-weight: 700;
    color: var(--sheet-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .cell-menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--sheet-text);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .cell-menu-item:hover {
    background: var(--sheet-active-bg);
  }

  .cell-menu-item.danger {
    color: var(--sheet-error);
  }

  .formula-icon {
    padding: 0 10px;
    font-size: 13px;
    font-style: italic;
    color: var(--sheet-text-secondary);
    border-right: 1px solid var(--sheet-border);
    display: flex;
    align-items: center;
    font-family: var(--sheet-font);
  }

  .formula-input {
    flex: 1;
    border: none;
    outline: none;
    padding: 0 10px;
    font-size: 13px;
    font-family: var(--sheet-font);
    background: var(--sheet-surface);
    color: var(--sheet-text);
  }

  .formula-input::placeholder {
    color: var(--sheet-border-strong);
  }
</style>
