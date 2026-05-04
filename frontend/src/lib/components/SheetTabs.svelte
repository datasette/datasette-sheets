<script lang="ts">
  import {
    sheets,
    activeSheetId,
    switchSheet,
    addSheet,
    deleteSheet,
    renameSheet,
    setSheetColor,
    getColorPalette,
    reorderSheets,
    moveSheet,
  } from "../stores/persistence";

  let editingTabId: string | null = $state(null);
  let editingName = $state("");
  // Set briefly when Escape cancels a rename so the implicit blur
  // that fires when the input unmounts can't re-enter commit-on-blur
  // and save the discarded text. Cleared the moment commitRename
  // observes it.
  let cancelingRename = false;
  // Tab context menu lives outside the tab DOM (``overflow-x: auto``
  // on ``.tabs-scroll`` clips ::after/pseudo menus vertically too),
  // so we render it as a ``position: fixed`` pop-up anchored to the
  // right-click coordinates — mirrors Grid.svelte's row/col menus.
  let tabMenu: { id: string; name: string; x: number; y: number } | null =
    $state(null);
  let showColorPicker = $state(false);

  // Drag-reorder state. ``draggingId`` is the tab whose native drag
  // operation started; ``dropTargetId`` + ``dropSide`` describe where
  // the pointer currently is over *another* tab so we can paint the
  // indicator bar on the right side of the target.
  let draggingId: string | null = $state(null);
  let dropTargetId: string | null = $state(null);
  let dropSide: "before" | "after" = $state("before");

  // [sheet.tabs.click-switch]
  function handleTabClick(id: string) {
    if (editingTabId === id) return;
    tabMenu = null;
    showColorPicker = false;
    switchSheet(id);
  }

  // [sheet.tabs.add]
  function handleAddSheet() {
    addSheet();
  }

  // [sheet.tabs.right-click-menu]
  function handleContextMenu(e: MouseEvent, id: string, name: string) {
    e.preventDefault();
    // Toggle closed if right-clicking the same tab.
    if (tabMenu && tabMenu.id === id) {
      tabMenu = null;
      showColorPicker = false;
      return;
    }
    tabMenu = { id, name, x: e.clientX, y: e.clientY };
    showColorPicker = false;
  }

  // [sheet.tabs.double-click-rename]
  function startRename(id: string, currentName: string) {
    editingTabId = id;
    editingName = currentName;
    tabMenu = null;
  }

  // [sheet.tabs.rename-commit]
  function commitRename() {
    if (cancelingRename) {
      cancelingRename = false;
      editingTabId = null;
      return;
    }
    if (editingTabId && editingName.trim()) {
      renameSheet(editingTabId, editingName.trim());
    }
    editingTabId = null;
  }

  function cancelRename() {
    cancelingRename = true;
    editingTabId = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelRename();
    }
  }

  // [sheet.tabs.delete]
  function handleDelete(id: string, name: string) {
    // Destructive + server-roundtrip: gate behind a native confirm.
    // Always close the menu even on cancel so the UI doesn't get
    // stuck open if the user backs out.
    tabMenu = null;
    if (!window.confirm(`Delete sheet "${name}"? This can't be undone.`)) {
      return;
    }
    deleteSheet(id);
  }

  // [sheet.tabs.color-picker]
  function handleColorClick() {
    showColorPicker = !showColorPicker;
  }

  function handleSetColor(id: string, color: string) {
    setSheetColor(id, color);
    showColorPicker = false;
    tabMenu = null;
  }

  function handleOutsideClick() {
    if (tabMenu) {
      tabMenu = null;
      showColorPicker = false;
    }
  }

  // [sheet.tabs.drag-reorder]
  function handleDragStart(e: DragEvent, id: string) {
    if (editingTabId === id || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    draggingId = id;
    // Payload is the sheet id — we don't read it back (Svelte state
    // is simpler) but DnD spec requires *some* data to be set or
    // Firefox suppresses the drag.
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(e: DragEvent, targetId: string) {
    if (!draggingId || draggingId === targetId) {
      dropTargetId = null;
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    dropSide = e.clientX < mid ? "before" : "after";
    dropTargetId = targetId;
  }

  function handleDragLeave(e: DragEvent, targetId: string) {
    // Only clear if we actually left this element (dragleave fires on
    // children too). Comparing relatedTarget lets us ignore the
    // inner-span transitions.
    const related = e.relatedTarget as Node | null;
    if (
      dropTargetId === targetId &&
      (!related || !(e.currentTarget as HTMLElement).contains(related))
    ) {
      dropTargetId = null;
    }
  }

  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const source = draggingId;
    const target = dropTargetId ?? targetId;
    const side = dropSide;
    draggingId = null;
    dropTargetId = null;
    if (!source || source === target) return;
    const order = $sheets.map((s) => s.id);
    const fromIdx = order.indexOf(source);
    if (fromIdx < 0) return;
    order.splice(fromIdx, 1);
    let toIdx = order.indexOf(target);
    if (toIdx < 0) return;
    if (side === "after") toIdx += 1;
    order.splice(toIdx, 0, source);
    void reorderSheets(order);
  }

  function handleDragEnd() {
    draggingId = null;
    dropTargetId = null;
  }

  // [sheet.tabs.move-left-right]
  function handleMove(id: string, direction: -1 | 1) {
    tabMenu = null;
    showColorPicker = false;
    void moveSheet(id, direction);
  }

  let tabIndex = $derived(
    tabMenu ? $sheets.findIndex((s) => s.id === tabMenu?.id) : -1,
  );

  const palette = getColorPalette();
</script>

<svelte:window onclick={handleOutsideClick} />

<div class="sheet-tabs">
  <button
    class="add-tab"
    onclick={handleAddSheet}
    title="Add sheet"
    aria-label="Add sheet"
  >
    +
  </button>
  <div class="tabs-scroll">
    {#each $sheets as sheet (sheet.id)}
      <div
        class="tab"
        class:active={sheet.id === $activeSheetId}
        class:dragging={draggingId === sheet.id}
        class:drop-before={dropTargetId === sheet.id && dropSide === "before"}
        class:drop-after={dropTargetId === sheet.id && dropSide === "after"}
        style="--tab-color: {sheet.color}"
        draggable={editingTabId !== sheet.id}
        ondragstart={(e) => handleDragStart(e, sheet.id)}
        ondragover={(e) => handleDragOver(e, sheet.id)}
        ondragleave={(e) => handleDragLeave(e, sheet.id)}
        ondrop={(e) => handleDrop(e, sheet.id)}
        ondragend={handleDragEnd}
        onclick={(e) => {
          e.stopPropagation();
          handleTabClick(sheet.id);
        }}
        oncontextmenu={(e) => {
          e.stopPropagation();
          handleContextMenu(e, sheet.id, sheet.name);
        }}
        ondblclick={(e) => {
          e.stopPropagation();
          startRename(sheet.id, sheet.name);
        }}
        role="tab"
        tabindex="0"
        onkeydown={(e) => {
          if (e.key === "Enter") handleTabClick(sheet.id);
        }}
      >
        <span class="tab-color-dot" style="background: {sheet.color}"></span>
        {#if editingTabId === sheet.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename-input"
            bind:value={editingName}
            onblur={commitRename}
            onkeydown={handleRenameKeydown}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <span class="tab-name">{sheet.name}</span>
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if tabMenu}
  {@const menu = tabMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="context-menu"
    style="top: {menu.y}px; left: {menu.x}px"
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <button class="menu-item" onclick={() => startRename(menu.id, menu.name)}>
      Rename
    </button>
    <button class="menu-item" onclick={handleColorClick}> Color </button>
    <!-- [sheet.tabs.move-left-right] -->
    <button
      class="menu-item"
      disabled={tabIndex <= 0}
      onclick={() => handleMove(menu.id, -1)}
    >
      Move left
    </button>
    <button
      class="menu-item"
      disabled={tabIndex < 0 || tabIndex >= $sheets.length - 1}
      onclick={() => handleMove(menu.id, 1)}
    >
      Move right
    </button>
    {#if $sheets.length > 1}
      <div class="menu-sep" role="separator"></div>
      <button
        class="menu-item danger"
        onclick={() => handleDelete(menu.id, menu.name)}
      >
        Delete
      </button>
    {/if}

    {#if showColorPicker}
      <div class="color-picker">
        {#each palette as color (color)}
          <button
            class="color-swatch"
            class:active={$sheets.find((s) => s.id === menu.id)?.color ===
              color}
            style="background: {color}"
            onclick={() => handleSetColor(menu.id, color)}
            title={color}
          ></button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .sheet-tabs {
    display: flex;
    align-items: flex-end;
    gap: 0;
    margin-top: 8px;
    padding: 0 0 0 4px;
    user-select: none;
  }

  .tabs-scroll {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    flex: 1;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 14px;
    font-size: 13px;
    font-family: var(--sheet-font);
    color: var(--sheet-text);
    background: var(--sheet-active-bg);
    border: 1px solid var(--sheet-border);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    white-space: nowrap;
    min-width: 60px;
  }

  .tab:hover {
    background: var(--sheet-header-bg);
  }

  .tab.active {
    background: var(--sheet-surface);
    border-bottom: 1px solid #fff;
    margin-bottom: -1px;
    font-weight: 600;
    z-index: 1;
  }

  /* [sheet.tabs.drag-reorder] — fade the source tab while dragging
     and paint a 2px accent indicator bar on the side of the target
     where the drop will land. Positioned absolutely against .tab so
     the bar spans the full tab height without pushing siblings. */
  .tab.dragging {
    opacity: 0.4;
  }

  .tab.drop-before::before,
  .tab.drop-after::after {
    content: "";
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;
    background: var(--sheet-accent);
    pointer-events: none;
    z-index: 2;
  }

  .tab.drop-before::before {
    left: -2px;
  }

  .tab.drop-after::after {
    right: -2px;
  }

  .tab-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tab-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-rename-input {
    width: 80px;
    border: 1px solid var(--sheet-border-strong);
    border-radius: 2px;
    padding: 0 4px;
    font-size: 13px;
    font-family: var(--sheet-font);
    background: var(--sheet-surface);
    outline: none;
  }

  .add-tab {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    margin-right: 6px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
    font-weight: 500;
    font-family: var(--sheet-font);
    color: var(--sheet-text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .add-tab:hover {
    background: var(--sheet-active-bg);
    color: var(--sheet-text);
  }

  /* ``position: fixed`` + click-coord anchoring so the menu escapes
     ``.tabs-scroll``'s ``overflow-x: auto`` (which implicitly clips
     vertically too). Translated upward so it opens above the click
     point — the tab bar sits at the bottom of the viewport. */
  .context-menu {
    position: fixed;
    transform: translateY(-100%);
    margin-top: -4px;
    background: var(--sheet-surface);
    border: 1px solid var(--sheet-border);
    border-radius: var(--sheet-radius-md);
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.12);
    z-index: var(--z-modal);
    min-width: 120px;
    padding: 4px 0;
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 5px 12px;
    font-size: 13px;
    font-family: var(--sheet-font);
    color: var(--sheet-text);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--sheet-active-bg);
  }

  .menu-item:disabled {
    color: var(--sheet-text-secondary);
    cursor: default;
    opacity: 0.6;
  }

  .menu-item.danger {
    color: var(--sheet-error);
  }

  .menu-sep {
    height: 1px;
    background: var(--sheet-border-light);
    margin: 4px 0;
  }

  .color-picker {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    flex-wrap: wrap;
    max-width: 140px;
    border-top: 1px solid var(--sheet-border-light);
  }

  .color-swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .color-swatch:hover {
    border-color: var(--sheet-text);
  }

  .color-swatch.active {
    border-color: var(--sheet-text);
    box-shadow: 0 0 0 1px #fff inset;
  }
</style>
