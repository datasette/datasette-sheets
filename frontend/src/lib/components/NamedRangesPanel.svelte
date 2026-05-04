<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import {
    namedRanges,
    upsertNamedRange,
    removeNamedRange,
  } from "../stores/namedRanges";
  import { activeSheetId } from "../stores/persistence";

  let {
    database,
    workbookId,
    onClose,
    initialName = "",
    initialDefinition = "",
  }: {
    database: string;
    workbookId: string;
    onClose: () => void;
    /** Prefill the editor when the panel opens (e.g. from the cell
     * context-menu "Define named range" command). */
    initialName?: string;
    initialDefinition?: string;
  } = $props();

  // Editor state. When ``editingOriginalName`` is non-null we're
  // editing an existing row (a rename triggers a delete-then-set to
  // match the engine's case-insensitive-but-name-bound storage).
  // ``initialName`` / ``initialDefinition`` are intentionally sampled
  // at component-init time only — the panel remounts on each open
  // (parent gates with ``{#if $namedRangesPanel}``), matching the
  // legacy Svelte-4 behaviour. ``untrack`` silences the
  // ``state_referenced_locally`` warning.
  let name: string = $state(untrack(() => initialName));
  let definition: string = $state(untrack(() => initialDefinition));
  let editingOriginalName: string | null = $state(null);
  let error: string | null = $state(null);
  let saving = $state(false);
  /** True whenever the user should see the editor (add or edit). If
   * false, only the list of existing names is visible. */
  let editorOpen: boolean = $state(
    untrack(() => initialName !== "" || initialDefinition !== ""),
  );

  let nameInput: HTMLInputElement | null = $state(null);

  onMount(async () => {
    if (editorOpen) {
      await tick();
      // Focus the empty field so Tab/Enter works the way the user
      // expects. Name is empty when coming from the context menu (we
      // only prefill the definition from selection), definition is
      // empty when the user clicked "Add" without a selection.
      if (!name && nameInput) nameInput.focus();
    }
  });

  function startAdd() {
    name = "";
    definition = "";
    editingOriginalName = null;
    error = null;
    editorOpen = true;
    tick().then(() => nameInput?.focus());
  }

  function startEdit(record: { name: string; definition: string }) {
    name = record.name;
    definition = record.definition;
    editingOriginalName = record.name;
    error = null;
    editorOpen = true;
    tick().then(() => nameInput?.focus());
  }

  function cancelEdit() {
    name = "";
    definition = "";
    editingOriginalName = null;
    error = null;
    editorOpen = false;
  }

  // [sheet.named-range.save]
  async function save() {
    if (!$activeSheetId) return;
    const trimmedName = name.trim();
    const trimmedDef = definition.trim();
    if (!trimmedName || !trimmedDef) {
      error = "Name and definition are both required";
      return;
    }
    saving = true;
    error = null;
    try {
      // Rename: upserting under the new name leaves the old name
      // behind, so explicitly remove the old row first. Case-only
      // renames (``Foo`` → ``FOO``) don't need this since the engine
      // compares case-insensitively.
      if (
        editingOriginalName &&
        editingOriginalName.toUpperCase() !== trimmedName.toUpperCase()
      ) {
        await removeNamedRange(
          database,
          workbookId,
          $activeSheetId,
          editingOriginalName,
        );
      }
      await upsertNamedRange(
        database,
        workbookId,
        $activeSheetId,
        trimmedName,
        trimmedDef,
      );
      cancelEdit();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save named range";
    } finally {
      saving = false;
    }
  }

  // [sheet.named-range.delete]
  async function remove(targetName: string) {
    if (!$activeSheetId) return;
    if (!confirm(`Delete named range “${targetName}”?`)) return;
    try {
      await removeNamedRange(database, workbookId, $activeSheetId, targetName);
      if (editingOriginalName === targetName) cancelEdit();
    } catch (e) {
      alert(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (editorOpen) cancelEdit();
      else onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      save();
    }
  }
</script>

<div
  class="named-ranges-panel"
  role="dialog"
  aria-label="Named ranges"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  <header class="panel-header">
    <h3>Named ranges</h3>
    <button
      type="button"
      class="icon-btn"
      onclick={onClose}
      title="Close"
      aria-label="Close named ranges panel"
    >
      ×
    </button>
  </header>

  {#if editorOpen}
    <div class="editor">
      <label class="field">
        <span>Name</span>
        <input
          type="text"
          bind:this={nameInput}
          bind:value={name}
          placeholder="e.g. TaxRate"
          disabled={saving}
        />
      </label>
      <label class="field">
        <span>Range or value</span>
        <input
          type="text"
          bind:value={definition}
          placeholder="e.g. A1:A10 or 0.05"
          disabled={saving}
        />
      </label>
      {#if error}
        <div class="error">{error}</div>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="btn cancel"
          onclick={cancelEdit}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn primary"
          onclick={save}
          disabled={saving || !name.trim() || !definition.trim()}
        >
          {saving ? "Saving…" : editingOriginalName ? "Save" : "Done"}
        </button>
      </div>
    </div>
  {:else}
    <button type="button" class="add-btn" onclick={startAdd}>
      + Add a range
    </button>
  {/if}

  {#if $namedRanges.length === 0 && !editorOpen}
    <p class="empty">No named ranges yet.</p>
  {:else if $namedRanges.length > 0}
    <ul class="name-list">
      {#each $namedRanges as record (record.name)}
        <li class="name-row" class:active={editingOriginalName === record.name}>
          <div class="name-content" data-testid="named-range-row">
            <span class="name-name">{record.name}</span>
            <span class="name-def">{record.definition}</span>
          </div>
          <button
            type="button"
            class="icon-btn small"
            onclick={() => startEdit(record)}
            title="Edit"
            aria-label="Edit {record.name}"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path
                d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"
              />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn small"
            onclick={() => remove(record.name)}
            title="Delete"
            aria-label="Delete {record.name}"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path
                d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"
              />
              <path
                d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"
              />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .named-ranges-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 260px;
    max-width: 100%;
    background: var(--sheet-surface, #fff);
    border-left: 1px solid var(--sheet-border-strong, #ccc);
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    z-index: var(--z-panel);
    font-size: 13px;
    color: var(--sheet-text, #111);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--sheet-border, #ddd);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 4px;
    font-size: 18px;
    line-height: 1;
    width: 26px;
    height: 26px;
    cursor: pointer;
    color: var(--sheet-text-secondary, #666);
    padding: 0;
  }

  .icon-btn:hover {
    background: var(--sheet-header-bg, #f0f3f5);
    color: var(--sheet-text, #111);
  }

  .icon-btn.small {
    width: 22px;
    height: 22px;
    font-size: 15px;
  }

  .editor {
    padding: 12px 14px;
    border-bottom: 1px solid var(--sheet-border-light, #eee);
    background: var(--sheet-bg, #f8fafb);
  }

  .field {
    display: block;
    margin-bottom: 10px;
  }

  .field span {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--sheet-text, #111);
  }

  .field input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    font-size: 13px;
    font-family: var(--sheet-font, monospace);
    box-sizing: border-box;
    background: var(--sheet-surface, #fff);
  }

  .field input:focus {
    outline: none;
    border-color: var(--sheet-accent, #276890);
  }

  .error {
    color: var(--sheet-error, #d00);
    font-size: 12px;
    margin-bottom: 8px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  /* Buttons: .btn / .btn.primary are inherited from shared.css */

  .add-btn {
    margin: 10px 14px;
    padding: 8px 10px;
    background: transparent;
    border: 1px dashed var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    color: var(--sheet-text-secondary, #666);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }

  .add-btn:hover {
    color: var(--sheet-text, #111);
    background: var(--sheet-header-bg, #f0f3f5);
  }

  .empty {
    margin: 0 14px;
    padding: 20px 0;
    text-align: center;
    color: var(--sheet-text-secondary, #666);
    font-size: 12px;
  }

  .name-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
  }

  .name-row {
    display: flex;
    align-items: center;
    padding: 4px 6px 4px 10px;
    gap: 2px;
  }

  .name-row:hover {
    background: var(--sheet-header-bg, #f0f3f5);
  }

  .name-row.active {
    background: var(--sheet-selected-bg, #e8f0f6);
  }

  .name-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 2px 4px;
    min-width: 0;
  }

  .name-name {
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .name-def {
    font-family: var(--sheet-font, monospace);
    font-size: 11px;
    color: var(--sheet-text-secondary, #666);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
