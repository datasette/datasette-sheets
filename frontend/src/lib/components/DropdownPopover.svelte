<script lang="ts">
  /**
   * Portal popover for dropdown cells. Renders position: fixed
   * anchored to the active dropdown cell's bounding rect (the cell
   * itself has ``overflow: hidden`` so an in-cell popover would
   * clip). Subscribes to ``dropdownPopoverFor`` — when set, mounts
   * the popover; when null, the wrapper renders nothing.
   *
   * Keyboard: ↑ / ↓ move highlight, Enter selects (single closes,
   * multi keeps the popover open and toggles), Space toggles in
   * multi mode, Escape closes. Outside-click closes too.
   *
   * For multi-select, every option is shown with a leading checkmark
   * slot (filled when selected); single-select highlights the
   * currently-selected option but doesn't show the checkmark column.
   * [sheet.data.dropdown]
   */
  import { onMount, onDestroy, tick } from "svelte";
  import { derived, get } from "svelte/store";
  import {
    dropdownPopoverFor,
    closeDropdownPopover,
    dropdownRulesById,
    openDropdownRulesPanel,
    splitMultiValue,
    joinMultiValue,
  } from "../stores/dropdownRules";
  import {
    cells,
    cellStore,
    pushUndo,
    selectedCell,
  } from "../stores/spreadsheet";
  import { markCellDirty, flushSave } from "../stores/persistence";
  import type { CellData, CellId } from "../spreadsheet/types";

  /** Anchor rect for the popover, recomputed on open + on
   *  scroll/resize so the popover follows the cell. */
  let anchor: { top: number; left: number; bottom: number } | null =
    $state(null);
  let popoverEl: HTMLElement | null = $state(null);
  let highlightIndex = $state(0);

  // Reactive: which cell is the popover currently for? Subscribe
  // to the per-cell store so a value mutation (e.g. clicking an
  // option in multi-select mode) feeds straight back into the
  // popover's ``selectedSet`` without a stale read. ``cellStore``
  // is what ``Cell.svelte`` uses for the same reason — the bare
  // ``cells.getCell`` call is a one-shot map lookup, not a store
  // subscription, so it never refreshes.
  const activeCellStore = derived<typeof dropdownPopoverFor, CellData | null>(
    dropdownPopoverFor,
    ($id, set) => {
      if (!$id) {
        set(null);
        return;
      }
      return cellStore($id).subscribe((value) => set(value ?? null));
    },
    null,
  );
  let activeCellId = $derived($dropdownPopoverFor);
  let activeCell = $derived($activeCellStore);
  let activeRule = $derived(
    activeCell?.format.dropdownRuleId
      ? ($dropdownRulesById.get(activeCell.format.dropdownRuleId) ?? null)
      : null,
  );
  let options = $derived(activeRule?.source.options ?? []);
  let isMulti = $derived(activeRule?.multi ?? false);
  let selectedSet = $derived.by(() => {
    if (!activeCell) return new Set<string>();
    const raw = activeCell.rawValue ?? "";
    if (raw === "") return new Set<string>();
    if (isMulti) return new Set(splitMultiValue(raw));
    return new Set([raw]);
  });

  async function measureAnchor(cellId: CellId): Promise<void> {
    await tick();
    const el = document.querySelector(
      `[data-cell-id="${cellId}"]`,
    ) as HTMLElement | null;
    if (!el) {
      anchor = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    anchor = { top: rect.top, left: rect.left, bottom: rect.bottom };
  }

  function close() {
    closeDropdownPopover();
  }

  // Write a single option's value into the cell and (single mode)
  // close the popover. Multi mode toggles + leaves the popover
  // open. [sheet.data.dropdown]
  function pickOption(value: string) {
    const id = activeCellId;
    if (!id) return;
    pushUndo();
    markCellDirty(id);
    if (isMulti) {
      const next = new Set(selectedSet);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      // Preserve the option-list order so a popover round-trip
      // doesn't shuffle the cell value.
      const ordered = options.map((o) => o.value).filter((v) => next.has(v));
      cells.setCellValue(id, joinMultiValue(ordered));
      flushSave();
    } else {
      cells.setCellValue(id, value);
      flushSave();
      close();
    }
  }

  // [sheet.data.dropdown] Hand off to the rule editor side panel
  // for the active rule. Closes the popover so the editor isn't
  // covered by it.
  function editRule() {
    if (!activeRule) return;
    closeDropdownPopover();
    openDropdownRulesPanel(activeRule.id);
  }

  // Clear the cell's value (any dropdown mode).
  function clearValue() {
    const id = activeCellId;
    if (!id) return;
    pushUndo();
    markCellDirty(id);
    cells.setCellValue(id, "");
    flushSave();
    if (!isMulti) close();
  }

  function handleKey(e: KeyboardEvent) {
    if (!activeCellId) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      // Restore focus to the cell so subsequent arrows / typing work.
      const cellEl = document.querySelector(
        `[data-cell-id="${activeCellId}"]`,
      ) as HTMLElement | null;
      cellEl?.focus();
      return;
    }
    if (options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      highlightIndex = (highlightIndex + 1) % options.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      highlightIndex = (highlightIndex - 1 + options.length) % options.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const opt = options[highlightIndex];
      if (opt) pickOption(opt.value);
    } else if (e.key === " " && isMulti) {
      e.preventDefault();
      e.stopPropagation();
      const opt = options[highlightIndex];
      if (opt) pickOption(opt.value);
    }
  }

  function handleDocumentClick(e: MouseEvent) {
    if (!activeCellId || !popoverEl) return;
    const target = e.target as Node;
    if (popoverEl.contains(target)) return;
    // Click on the trigger cell shouldn't close — the cell itself
    // re-opens immediately, causing a flicker. Detect by checking
    // whether the click landed on the active cell's DOM node.
    const cellEl = document.querySelector(`[data-cell-id="${activeCellId}"]`);
    if (cellEl && cellEl.contains(target)) return;
    close();
  }

  function handleScrollOrResize() {
    if (activeCellId) void measureAnchor(activeCellId);
  }

  // Imperative subscriptions instead of reactive ``$:`` blocks so
  // the linter doesn't flag the popover-open path as a possible
  // infinite loop (it isn't — ``measureAnchor`` writes ``anchor``,
  // ``positionStyle`` reads it, but neither feeds back into
  // ``activeCellId``).
  onMount(() => {
    const unsubPopover = dropdownPopoverFor.subscribe((id) => {
      if (id) {
        highlightIndex = 0;
        void measureAnchor(id);
      } else {
        anchor = null;
      }
    });
    const unsubSelected = selectedCell.subscribe((sel) => {
      const active = get(dropdownPopoverFor);
      if (active && sel !== null && sel !== active) close();
    });
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("mousedown", handleDocumentClick, true);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      unsubPopover();
      unsubSelected();
    };
  });
  onDestroy(() => {
    document.removeEventListener("keydown", handleKey, true);
    document.removeEventListener("mousedown", handleDocumentClick, true);
    window.removeEventListener("resize", handleScrollOrResize);
    window.removeEventListener("scroll", handleScrollOrResize, true);
  });

  // Expose the cell-anchor info as inline style for the popover.
  // Top-anchored just below the cell, left-aligned to the cell's
  // left edge, with a viewport clamp so wide popovers don't spill.
  let positionStyle = $derived.by(() => {
    if (!anchor) return "display: none;";
    const popoverWidth = 220; // matches min-width below
    const left = Math.min(
      Math.max(4, anchor.left),
      window.innerWidth - popoverWidth - 4,
    );
    return `top: ${anchor.bottom + 2}px; left: ${left}px;`;
  });
</script>

{#if activeCellId && activeRule}
  <div
    bind:this={popoverEl}
    class="dropdown-popover popover"
    role="listbox"
    aria-label={activeRule.name || "Dropdown options"}
    style={positionStyle}
  >
    {#if options.length === 0}
      <div class="empty">No options yet</div>
    {/if}
    {#each options as option, i (option.value)}
      <button
        type="button"
        class="popover-row"
        class:highlighted={i === highlightIndex}
        role="option"
        aria-selected={selectedSet.has(option.value)}
        onclick={() => pickOption(option.value)}
        onmouseenter={() => (highlightIndex = i)}
      >
        {#if isMulti}
          <span class="check-slot" aria-hidden="true">
            {#if selectedSet.has(option.value)}✓{/if}
          </span>
        {/if}
        <span class="option-chip" style="background: {option.color};"
          >{option.value}</span
        >
      </button>
    {/each}
    {#if selectedSet.size > 0}
      <div class="popover-sep" role="separator"></div>
      <button type="button" class="popover-row clear-row" onclick={clearValue}>
        Clear value
      </button>
    {/if}
    <div class="popover-sep" role="separator"></div>
    <!-- [sheet.data.dropdown] -->
    <button type="button" class="popover-row edit-row" onclick={editRule}>
      Edit dropdown…
    </button>
  </div>
{/if}

<style>
  .dropdown-popover {
    position: fixed;
    min-width: 220px;
    max-width: 320px;
    padding: 4px 0;
    /* Sits above panel + grid headers but below modals. Matches
       the convention used by Format menu / autocomplete. */
    z-index: var(--z-popover, 100);
    font-family: var(--sheet-font, monospace);
    font-size: 13px;
    background: var(--sheet-surface, #fff);
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: var(--sheet-radius-md, 4px);
    box-shadow: var(--sheet-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.12));
    color: var(--sheet-text, #111);
    max-height: 280px;
    overflow-y: auto;
  }

  .popover-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    background: transparent;
    border: none;
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .popover-row.highlighted,
  .popover-row:hover,
  .popover-row:focus {
    background: var(--sheet-active-bg, #eef1f4);
    outline: none;
  }
  .popover-row.clear-row,
  .popover-row.edit-row {
    color: var(--sheet-text-secondary, #666);
    font-size: 12px;
  }

  .check-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--sheet-accent, #276890);
    font-weight: 700;
  }

  .option-chip {
    display: inline-block;
    padding: 1px 10px;
    border-radius: 9999px;
    font-size: 12px;
    line-height: 16px;
    color: #1a1a1a;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .popover-sep {
    height: 1px;
    background: var(--sheet-border-light, #eee);
    margin: 4px 0;
  }

  .empty {
    padding: 8px 12px;
    color: var(--sheet-text-secondary, #666);
    font-size: 12px;
    text-align: center;
  }
</style>
