<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import { cells, selectedCell, selectedCells } from "../stores/spreadsheet";
  import { applyFormat, clearAllFormat } from "../formatCommands";
  import { keepInViewport } from "../actions/keepInViewport";
  import { hoverIntent } from "../actions/hoverIntent";
  import { openDropdownRulesPanel } from "../stores/dropdownRules";
  import {
    openOverlay,
    toggleOverlay,
    closeOverlay,
  } from "../stores/openOverlay";
  import type { CellFormat, CellBorders } from "../spreadsheet/types";

  /**
   * Top-level Format menu. Opens a single popover with nested
   * submenus (Number / Text / Alignment / Wrapping / Borders / Font
   * size), mirroring Google Sheets' Format menu.
   *
   * Commands dispatch through the same `formatCommands.ts` helpers
   * the toolbar uses — one source of truth.
   */

  // [page-toolbar-04] Open state lives in the global openOverlay
  // store, so opening this menu auto-closes any toolbar popover and
  // vice versa.
  const OVERLAY_ID = "format-menu";
  let open = $derived($openOverlay === OVERLAY_ID);
  let openSub: string | null = $state(null);
  let rootRef: HTMLElement | null = $state(null);
  let popoverRef: HTMLElement | null = $state(null);

  // Reset the submenu cursor when the menu closes — otherwise the
  // last-hovered submenu would re-mount the next time the user opens
  // the menu, which feels stale.
  $effect(() => {
    if (!open) openSub = null;
  });

  // [page-toolbar-10] Forward the trigger so any close path returns
  // focus to the Format button instead of falling through to <body>.
  function toggle(e: MouseEvent) {
    toggleOverlay(OVERLAY_ID, e.currentTarget as HTMLElement);
  }

  function close() {
    closeOverlay(OVERLAY_ID);
  }

  function handleDocClick(e: MouseEvent) {
    if (!open || !rootRef) return;
    if (!rootRef.contains(e.target as Node)) close();
  }

  // [page-toolbar-07] Keyboard navigation helpers. Top-level rows are
  // tagged ``data-menu-row="top"``; submenu rows ``data-menu-row="sub"``.
  // We query the live DOM rather than maintaining a parallel array
  // because the row set is conditional on which submenu is open.
  function topLevelRows(): HTMLElement[] {
    if (!popoverRef) return [];
    return Array.from(
      popoverRef.querySelectorAll<HTMLElement>('[data-menu-row="top"]'),
    );
  }

  function submenuRows(): HTMLElement[] {
    if (!popoverRef) return [];
    return Array.from(
      popoverRef.querySelectorAll<HTMLElement>('[data-menu-row="sub"]'),
    );
  }

  function focusedTopIndex(): number {
    const rows = topLevelRows();
    return rows.findIndex((r) => r === document.activeElement);
  }

  function focusedSubIndex(): number {
    const rows = submenuRows();
    return rows.findIndex((r) => r === document.activeElement);
  }

  function inSubmenu(): boolean {
    return openSub !== null && focusedSubIndex() !== -1;
  }

  /** ``data-submenu`` attribute on the top-level row whose host owns
   *  a submenu. ``null`` for direct-action rows (Checkbox, Dropdown,
   *  Clear formatting). */
  function submenuIdAt(idx: number): string | null {
    const rows = topLevelRows();
    if (idx < 0 || idx >= rows.length) return null;
    return rows[idx].dataset.submenu ?? null;
  }

  async function focusTopRow(idx: number): Promise<void> {
    const rows = topLevelRows();
    if (rows.length === 0) return;
    const i = ((idx % rows.length) + rows.length) % rows.length;
    rows[i].focus();
    await tick();
  }

  async function focusFirstSubRow(): Promise<void> {
    await tick();
    const rows = submenuRows();
    if (rows.length > 0) rows[0].focus();
  }

  // [page-toolbar-07] Local Esc handler — two-stage dismiss.
  // First Esc collapses an open submenu (if any) and returns focus
  // to its top-level row. A second Esc closes the menu entirely.
  // SheetsPage's document-level handler also calls
  // ``closeAnyOverlay()``, but having it here too means the menu
  // closes even if the global handler is unmounted (test harness,
  // future re-org). We deliberately do NOT ``stopPropagation`` —
  // policy is "one Esc dismisses every transient piece of state",
  // including the clipboard mark.
  async function handleKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      if (openSub !== null) {
        // First Esc: collapse the submenu, refocus its parent row.
        const sub = openSub;
        openSub = null;
        await tick();
        const rows = topLevelRows();
        const parent = rows.find((r) => r.dataset.submenu === sub);
        parent?.focus();
        e.preventDefault();
        return;
      }
      close();
      e.preventDefault();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (inSubmenu()) {
        const rows = submenuRows();
        const i = focusedSubIndex();
        rows[(i + 1) % rows.length]?.focus();
      } else {
        const i = focusedTopIndex();
        await focusTopRow(i === -1 ? 0 : i + 1);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (inSubmenu()) {
        const rows = submenuRows();
        const i = focusedSubIndex();
        rows[(i - 1 + rows.length) % rows.length]?.focus();
      } else {
        const i = focusedTopIndex();
        await focusTopRow(i === -1 ? 0 : i - 1);
      }
      return;
    }

    if (e.key === "ArrowRight") {
      // Open the submenu (if the focused top-level row owns one) and
      // focus the first submenu row.
      const i = focusedTopIndex();
      const sub = submenuIdAt(i);
      if (sub !== null) {
        e.preventDefault();
        openSub = sub;
        await focusFirstSubRow();
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      // Collapse the submenu (if open) and refocus its parent row.
      if (openSub !== null) {
        e.preventDefault();
        const sub = openSub;
        openSub = null;
        await tick();
        const parent = topLevelRows().find((r) => r.dataset.submenu === sub);
        parent?.focus();
      }
      return;
    }

    if (e.key === "Tab") {
      // [page-toolbar-07] Trap Tab inside the menu. Without this, Tab
      // walks out to the rest of the toolbar / page mid-menu, leaving
      // the popover open behind the new focus target. We cycle within
      // the currently-active row group (submenu rows when a submenu is
      // open, otherwise top-level rows).
      const rows = inSubmenu() ? submenuRows() : topLevelRows();
      if (rows.length === 0) return;
      const cur = rows.findIndex((r) => r === document.activeElement);
      e.preventDefault();
      if (e.shiftKey) {
        const next = cur <= 0 ? rows.length - 1 : cur - 1;
        rows[next].focus();
      } else {
        const next = cur === -1 || cur === rows.length - 1 ? 0 : cur + 1;
        rows[next].focus();
      }
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleDocClick, true);
    document.addEventListener("keydown", handleKey);
  });
  onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick, true);
    document.removeEventListener("keydown", handleKey);
  });

  // [perf] No ``cells.recalculate()`` after ``applyFormat`` — same
  // rule as Toolbar.svelte. Format is display-only,
  // ``setCellFormat`` already wakes per-cell subscribers, and the
  // menu-driven path used to force a full WASM rebuild per click
  // for nothing. ``clearAllFormat`` itself recalcs once at the end
  // (type may revert), so ``runClear`` doesn't need to either.
  function run(partial: Partial<CellFormat>) {
    applyFormat(partial);
    close();
  }

  function runClear() {
    clearAllFormat();
    close();
  }

  // [sheet.data.dropdown] Open the rule editor side panel. If the
  // active cell already references a rule, open in edit mode for
  // that rule; otherwise open in create mode (auto-applies the new
  // rule to the current selection on save).
  function openDropdownEditor() {
    const sel = get(selectedCells);
    const target = sel.size > 0 ? [...sel][0] : get(selectedCell);
    const cell = target ? cells.getCell(target) : null;
    const existingId =
      cell?.format.controlType === "dropdown"
        ? (cell.format.dropdownRuleId ?? null)
        : null;
    openDropdownRulesPanel(existingId);
    close();
  }

  /** Build a "full-cell" border preset object for the current color /
   *  style choice. We keep defaults baked in — the toolbar's
   *  BorderPicker is where the fine-grained controls live; this menu
   *  offers the quick presets. */
  function bordersPreset(
    which: "all" | "outer" | "top" | "bottom" | "clear",
  ): CellBorders | undefined {
    if (which === "clear") return undefined;
    const edge = { style: "solid" as const, color: "#000000" };
    if (which === "all" || which === "outer") {
      return { top: edge, right: edge, bottom: edge, left: edge };
    }
    if (which === "top") return { top: edge };
    if (which === "bottom") return { bottom: edge };
    return undefined;
  }
</script>

<div class="format-menu-root" bind:this={rootRef}>
  <button
    type="button"
    class="menu-btn"
    class:active={open}
    onclick={(e) => toggle(e)}
    aria-haspopup="true"
    aria-expanded={open ? "true" : "false"}
  >
    Format
  </button>
  {#if open}
    <div
      class="menu-popover popover"
      role="menu"
      aria-label="Format"
      bind:this={popoverRef}
      use:keepInViewport
      use:hoverIntent={{
        onIntent: () => {
          openSub = null;
        },
      }}
    >
      <!-- Number submenu -->
      <div
        class="submenu-host"
        role="none"
        onmouseenter={() => (openSub = "number")}
      >
        <button
          type="button"
          class="menu-row"
          role="menuitem"
          tabindex="-1"
          data-menu-row="top"
          data-submenu="number"
          aria-haspopup="menu"
          aria-expanded={openSub === "number" ? "true" : "false"}
          onclick={() => (openSub = "number")}
        >
          Number <span class="chevron">▸</span>
        </button>
        {#if openSub === "number"}
          <div
            class="submenu popover"
            role="menu"
            use:keepInViewport={{ anchor: "submenu" }}
          >
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "general" })}
            >
              Automatic
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "number", decimals: 2 })}
            >
              Number
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "percentage", decimals: 1 })}
            >
              Percent
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "scientific", decimals: 2 })}
            >
              Scientific
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() =>
                run({ type: "currency", decimals: 2, currencySymbol: "$" })}
            >
              Currency
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "date" })}
            >
              Date
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "time" })}
            >
              Time
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ type: "datetime" })}
            >
              Date time
            </button>
          </div>
        {/if}
      </div>

      <!-- Text submenu -->
      <div
        class="submenu-host"
        role="none"
        onmouseenter={() => (openSub = "text")}
      >
        <button
          type="button"
          class="menu-row"
          role="menuitem"
          tabindex="-1"
          data-menu-row="top"
          data-submenu="text"
          aria-haspopup="menu"
          aria-expanded={openSub === "text" ? "true" : "false"}
          onclick={() => (openSub = "text")}
        >
          Text <span class="chevron">▸</span>
        </button>
        {#if openSub === "text"}
          <div
            class="submenu popover"
            role="menu"
            use:keepInViewport={{ anchor: "submenu" }}
          >
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ bold: true })}
            >
              Bold
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ italic: true })}
            >
              Italic
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ underline: true })}
            >
              Underline
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ strikethrough: true })}
            >
              Strikethrough
            </button>
          </div>
        {/if}
      </div>

      <!-- Alignment submenu -->
      <div
        class="submenu-host"
        role="none"
        onmouseenter={() => (openSub = "align")}
      >
        <button
          type="button"
          class="menu-row"
          role="menuitem"
          tabindex="-1"
          data-menu-row="top"
          data-submenu="align"
          aria-haspopup="menu"
          aria-expanded={openSub === "align" ? "true" : "false"}
          onclick={() => (openSub = "align")}
        >
          Alignment <span class="chevron">▸</span>
        </button>
        {#if openSub === "align"}
          <div
            class="submenu popover"
            role="menu"
            use:keepInViewport={{ anchor: "submenu" }}
          >
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ hAlign: "left" })}
            >
              Left
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ hAlign: "center" })}
            >
              Center
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ hAlign: "right" })}
            >
              Right
            </button>
            <div class="menu-sep" role="separator"></div>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ vAlign: "top" })}
            >
              Top
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ vAlign: "middle" })}
            >
              Middle
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ vAlign: "bottom" })}
            >
              Bottom
            </button>
          </div>
        {/if}
      </div>

      <!-- Wrapping submenu -->
      <div
        class="submenu-host"
        role="none"
        onmouseenter={() => (openSub = "wrap")}
      >
        <button
          type="button"
          class="menu-row"
          role="menuitem"
          tabindex="-1"
          data-menu-row="top"
          data-submenu="wrap"
          aria-haspopup="menu"
          aria-expanded={openSub === "wrap" ? "true" : "false"}
          onclick={() => (openSub = "wrap")}
        >
          Wrapping <span class="chevron">▸</span>
        </button>
        {#if openSub === "wrap"}
          <div
            class="submenu popover"
            role="menu"
            use:keepInViewport={{ anchor: "submenu" }}
          >
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ wrap: "overflow" })}
            >
              Overflow
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ wrap: "wrap" })}
            >
              Wrap
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ wrap: "clip" })}
            >
              Clip
            </button>
          </div>
        {/if}
      </div>

      <!-- Borders submenu -->
      <div
        class="submenu-host"
        role="none"
        onmouseenter={() => (openSub = "borders")}
      >
        <button
          type="button"
          class="menu-row"
          role="menuitem"
          tabindex="-1"
          data-menu-row="top"
          data-submenu="borders"
          aria-haspopup="menu"
          aria-expanded={openSub === "borders" ? "true" : "false"}
          onclick={() => (openSub = "borders")}
        >
          Borders <span class="chevron">▸</span>
        </button>
        {#if openSub === "borders"}
          <div
            class="submenu popover"
            role="menu"
            use:keepInViewport={{ anchor: "submenu" }}
          >
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ borders: bordersPreset("all") })}
            >
              All
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ borders: bordersPreset("top") })}
            >
              Top
            </button>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ borders: bordersPreset("bottom") })}
            >
              Bottom
            </button>
            <div class="menu-sep" role="separator"></div>
            <button
              class="menu-row"
              role="menuitem"
              tabindex="-1"
              data-menu-row="sub"
              onclick={() => run({ borders: undefined })}
            >
              Clear borders
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-sep" role="separator"></div>
      <!-- [sheet.format.checkbox] -->
      <button
        class="menu-row"
        role="menuitem"
        tabindex="-1"
        data-menu-row="top"
        onclick={() => run({ controlType: "checkbox" })}
      >
        Checkbox
      </button>
      <!-- [sheet.data.dropdown] Open the rule editor side panel.
           If the active cell already has a dropdown rule, edit it;
           otherwise open in create mode. -->
      <button
        class="menu-row"
        role="menuitem"
        tabindex="-1"
        data-menu-row="top"
        onclick={openDropdownEditor}
      >
        Dropdown…
      </button>

      <div class="menu-sep" role="separator"></div>
      <button
        class="menu-row danger"
        role="menuitem"
        tabindex="-1"
        data-menu-row="top"
        onclick={runClear}
      >
        Clear formatting
      </button>
    </div>
  {/if}
</div>

<style>
  .format-menu-root {
    position: relative;
    display: inline-flex;
    /* Stacking context above the toolbar so the Format menu's
       popover + submenus paint on top of any open toolbar popovers
       and the grid. */
    z-index: var(--z-popover);
  }

  .menu-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--sheet-radius-sm);
    font: inherit;
    color: var(--sheet-text);
    cursor: pointer;
  }
  .menu-btn:hover {
    background: var(--sheet-active-bg, #e8edf2);
  }
  .menu-btn.active {
    background: var(--sheet-active-hover, #d4dce4);
    border-color: var(--sheet-border-strong, #ccc);
  }

  .menu-popover {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    min-width: 200px;
    padding: 4px 0;
    font-family: var(--sheet-font);
    font-size: 13px;
    z-index: var(--z-popover);
  }

  .submenu-host {
    position: relative;
  }

  .menu-row {
    display: block;
    width: 100%;
    padding: 6px 14px;
    background: transparent;
    border: none;
    text-align: left;
    color: var(--sheet-text);
    font: inherit;
    cursor: pointer;
  }
  .menu-row:hover,
  .menu-row:focus {
    background: var(--sheet-active-bg, #eef1f4);
  }
  .menu-row.danger {
    color: var(--sheet-error, #b00);
  }

  .chevron {
    float: right;
    margin-left: 12px;
    opacity: 0.55;
  }

  .menu-sep {
    height: 1px;
    background: var(--sheet-border, #e5e7eb);
    margin: 4px 0;
  }

  .submenu {
    position: absolute;
    top: 0;
    left: 100%;
    min-width: 160px;
    margin-left: 2px;
    padding: 4px 0;
    z-index: calc(var(--z-popover) + 1);
  }
</style>
