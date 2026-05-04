<script lang="ts">
  // [sheet.cell.context-menu]
  //
  // Right-click menu for a cell. Extracted from Grid.svelte during
  // cell-grid-04 — Grid.svelte just hands over the click coords +
  // selection range and the cellId of the right-clicked cell, and
  // this component subscribes to the stores it needs to compute the
  // conditional flags (``isSqlCell``, ``dropdownRuleId``) at render
  // time. The pre-existing pattern of pre-computing those at
  // contextmenu-handler time tightly coupled Grid.svelte to every
  // store the menu might want to peek at; this scopes the coupling
  // here instead.
  import { cells } from "../stores/spreadsheet";
  import { activeSheetId } from "../stores/persistence";
  import {
    dropdownRulesById,
    openDropdownRulesPanel,
  } from "../stores/dropdownRules";
  import {
    sheetFilter,
    filterCellMap,
    createFilter,
    removeFilter,
  } from "../stores/filter";
  import { toggleFormatFlag, clearAllFormat } from "../formatCommands";
  import { parseSqlCall, refreshSqlCell } from "../sql";
  import {
    buildApiUrl,
    copyToClipboard,
    defineNamedRangeFromRange,
  } from "../cellMenuActions";
  import type { CellId } from "../spreadsheet/types";

  interface Props {
    /** Viewport coordinates for the menu's top-left corner. */
    x: number;
    y: number;
    /** A1 string of the current selection (single cell or bounding box). */
    range: string;
    /** The right-clicked cell — used to compute conditional menu items. */
    cellId: CellId;
    database: string;
    workbookId: string;
    /** Cut/Copy/Paste come from SheetsPage so the menu reuses the same
     *  payload-building / clipboard-applying logic that Cmd+C/X/V uses. */
    onCut: () => Promise<void>;
    onCopy: () => Promise<void>;
    onPaste: () => Promise<void>;
    onClose: () => void;
  }

  let {
    x,
    y,
    range,
    cellId,
    database,
    workbookId,
    onCut,
    onCopy,
    onPaste,
    onClose,
  }: Props = $props();

  // Re-derive conditional flags from the right-clicked cell on every
  // change of $cells / cellId — cheap (two map lookups) and keeps the
  // rule that "no work happens until the menu opens" fully local.
  let cell = $derived($cells.get(cellId));
  let sqlCall = $derived(cell?.rawValue ? parseSqlCall(cell.rawValue) : null);
  let isSqlCell = $derived(sqlCall !== null);
  // [sheet.data.dropdown]
  let dropdownRuleId = $derived(
    cell?.format.controlType === "dropdown"
      ? (cell.format.dropdownRuleId ?? null)
      : null,
  );
  let hasDropdownRule = $derived(
    dropdownRuleId !== null && $dropdownRulesById.has(dropdownRuleId),
  );

  // [sheet.data.dropdown] Open the rule editor side panel for the
  // right-clicked cell's dropdown rule.
  function editDropdownFromMenu(): void {
    const ruleId = dropdownRuleId;
    onClose();
    if (!ruleId) return;
    openDropdownRulesPanel(ruleId);
  }

  // [sheet.named-range.define-from-context]
  function defineNamedRangeFromMenu(): void {
    const r = range;
    onClose();
    defineNamedRangeFromRange(r);
  }

  // [sheet.filter.create] [sheet.filter.delete]
  // Filter affordances. Show "Create filter" when no filter exists,
  // "Remove filter" when the right-clicked cell falls inside the
  // current filter rectangle. Hide both states (no entry) when a
  // filter exists but the click landed outside it — there's nothing
  // sensible to do from here. The user can still click a chevron in
  // the filter row to reach Phase C/D affordances.
  let cellInsideFilter = $derived($filterCellMap.has(cellId));
  let canCreateFilter = $derived($sheetFilter === null);

  async function createFilterFromMenu(): Promise<void> {
    const r = range;
    onClose();
    const sheetId = $activeSheetId;
    if (!sheetId) return;
    try {
      await createFilter(database, workbookId, sheetId, r);
    } catch (e) {
      alert(
        `Failed to create filter: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function removeFilterFromMenu(): Promise<void> {
    onClose();
    const sheetId = $activeSheetId;
    if (!sheetId) return;
    try {
      await removeFilter(database, workbookId, sheetId);
    } catch (e) {
      alert(
        `Failed to remove filter: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // [sheet.cell.sql-array-formula]
  function refreshSqlFromMenu(): void {
    if (!cell || !sqlCall) return;
    const rawValue = cell.rawValue;
    onClose();
    refreshSqlCell(cellId, rawValue);
  }

  function apiUrlForMenu(): string | null {
    return buildApiUrl({
      database,
      workbookId,
      sheetId: $activeSheetId,
      range,
    });
  }

  // [sheet.cell.copy-api-url]
  async function copyApiUrlFromMenu(): Promise<void> {
    const url = apiUrlForMenu();
    onClose();
    if (!url) return;
    const result = await copyToClipboard(url);
    if (!result.ok) {
      alert(`Failed to copy URL: ${result.error.message}`);
    }
  }

  // [sheet.cell.open-api-url]
  function openApiUrlFromMenu(): void {
    const url = apiUrlForMenu();
    onClose();
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  // [sheet.cell.copy-reference]
  async function copyReferenceFromMenu(): Promise<void> {
    const ref = range;
    onClose();
    const result = await copyToClipboard(ref);
    if (!result.ok) {
      alert(`Failed to copy reference: ${result.error.message}`);
    }
  }

  async function runMenuAction(fn: () => Promise<void>): Promise<void> {
    onClose();
    try {
      await fn();
    } catch (e) {
      alert(
        `Menu action failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="row-menu popover"
  style="top: {y}px; left: {x}px"
  onclick={(e) => e.stopPropagation()}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="row-menu-section">{range}</div>
  <div class="row-menu-divider" role="separator"></div>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => runMenuAction(onCut)}
    data-cell-id="cut"
  >
    Cut
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => runMenuAction(onCopy)}
    data-cell-id="copy"
  >
    Copy
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => runMenuAction(onPaste)}
    data-cell-id="paste"
  >
    Paste
  </button>
  <div class="row-menu-divider" role="separator"></div>
  <!-- [sheet.cell.format-submenu] — quick format actions inline. The
       full surface lives in the header's Format menu; this is the
       common-case subset users reach for on right-click. -->
  <div class="row-menu-section">Format</div>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => {
      toggleFormatFlag("bold");
      onClose();
    }}
    data-cell-id="format-bold"
  >
    Bold
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => {
      toggleFormatFlag("italic");
      onClose();
    }}
    data-cell-id="format-italic"
  >
    Italic
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => {
      toggleFormatFlag("underline");
      onClose();
    }}
    data-cell-id="format-underline"
  >
    Underline
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={() => {
      clearAllFormat();
      onClose();
    }}
    data-cell-id="format-clear"
  >
    Clear formatting
  </button>
  <div class="row-menu-divider" role="separator"></div>
  <button
    type="button"
    class="row-menu-item"
    onclick={copyReferenceFromMenu}
    data-cell-id="copy-reference"
  >
    Copy reference
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={defineNamedRangeFromMenu}
    data-cell-id="define-named-range"
  >
    Define named range…
  </button>
  {#if canCreateFilter}
    <!-- [sheet.filter.create] -->
    <button
      type="button"
      class="row-menu-item"
      onclick={createFilterFromMenu}
      data-cell-id="create-filter"
    >
      Create filter
    </button>
  {:else if cellInsideFilter}
    <!-- [sheet.filter.delete] -->
    <button
      type="button"
      class="row-menu-item"
      onclick={removeFilterFromMenu}
      data-cell-id="remove-filter"
    >
      Remove filter
    </button>
  {/if}
  {#if hasDropdownRule}
    <!-- [sheet.data.dropdown] -->
    <button
      type="button"
      class="row-menu-item"
      onclick={editDropdownFromMenu}
      data-cell-id="edit-dropdown"
    >
      Edit dropdown…
    </button>
  {/if}
  <div class="row-menu-divider" role="separator"></div>
  <button
    type="button"
    class="row-menu-item"
    onclick={copyApiUrlFromMenu}
    data-cell-id="copy-api-url"
  >
    Copy API URL
  </button>
  <button
    type="button"
    class="row-menu-item"
    onclick={openApiUrlFromMenu}
    data-cell-id="open-api-url"
  >
    Open API URL in new tab
  </button>
  {#if isSqlCell}
    <div class="row-menu-divider" role="separator"></div>
    <!-- [sheet.cell.sql-array-formula] -->
    <button
      type="button"
      class="row-menu-item"
      onclick={refreshSqlFromMenu}
      data-cell-id="refresh-sql"
    >
      Refresh data
    </button>
  {/if}
</div>

<style>
  /* Right-click menu styling — mirrors Grid.svelte's row/col header
     menus (same ``.row-menu`` class). Positioned in the viewport with
     fixed coords so it's not clipped by grid-container's overflow. */
  .row-menu {
    position: fixed;
    padding: 4px 0;
    min-width: 160px;
    z-index: var(--z-grid-menu);
  }

  .row-menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--sheet-text, #111);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .row-menu-item:hover {
    background: var(--sheet-active-bg, #e8edf2);
  }

  .row-menu-divider {
    height: 1px;
    background: var(--sheet-border-light, #eee);
    margin: 4px 0;
  }

  /* Section label — used for the range header at the top of the
     menu and the "Format" subheading. Monospace + sheet font so it
     reads like the cell-reference label in the formula bar. */
  .row-menu-section {
    padding: 6px 12px 4px;
    font-family: var(--sheet-font, monospace);
    font-size: 12px;
    font-weight: 700;
    color: var(--sheet-text-secondary, #666);
  }
</style>
