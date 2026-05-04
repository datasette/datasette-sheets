<script lang="ts">
  /**
   * Side-panel editor for dropdown rules. Mirrors the layout of
   * ``NamedRangesPanel.svelte``: a list of existing rules with edit
   * + delete buttons, plus a draft form for create / edit. Saving
   * applies the dropdown format to the current cell selection (when
   * the panel was opened from the Format menu) so creating a new
   * rule and applying it to a range is one trip.
   *
   * Comma in option values is rejected client-side too — the server
   * also rejects, this just spares a round-trip and surfaces the
   * error inline. [sheet.data.dropdown]
   */
  import { tick, onMount, onDestroy } from "svelte";
  import {
    dropdownRules,
    dropdownRulesPanel,
    closeDropdownRulesPanel,
    createDropdownRule,
    updateDropdownRule,
    deleteDropdownRule,
  } from "../stores/dropdownRules";
  import { applyFormat } from "../formatCommands";
  import type { DropdownOption } from "../spreadsheet/types";
  import { DROPDOWN_PALETTE } from "../spreadsheet/palettes";
  import ColorPicker from "./ColorPicker.svelte";

  let { database, workbookId }: { database: string; workbookId: number } =
    $props();

  function defaultColor(index: number): string {
    return DROPDOWN_PALETTE[index % DROPDOWN_PALETTE.length];
  }

  // ---- Editor state -----------------------------------------------------
  // ``editingId`` non-null = editing an existing rule; null = create mode.
  let editingId: number | null = $state(null);
  let name: string = $state("");
  let multi: boolean = $state(false);
  let options: DropdownOption[] = $state([]);
  let error: string | null = $state(null);
  let saving = $state(false);
  let pickerOpenFor: number | null = $state(null); // option index whose color picker is open

  let panelState = $derived($dropdownRulesPanel);

  /** When the panel state changes (open / switch rule), repopulate
   *  the form from the matching record. ``ruleId === null`` opens a
   *  blank form for create. */
  $effect(() => {
    if (panelState) {
      syncForm(panelState.ruleId);
    }
  });

  function syncForm(ruleId: number | null) {
    error = null;
    pickerOpenFor = null;
    if (ruleId === null) {
      editingId = null;
      name = "";
      multi = false;
      options = [
        { value: "Option 1", color: defaultColor(0) },
        { value: "Option 2", color: defaultColor(1) },
      ];
      return;
    }
    const record = $dropdownRules.find((r) => r.id === ruleId);
    if (!record) {
      // Stale ruleId (e.g. deleted from another tab). Fall back to
      // create mode rather than crashing.
      editingId = null;
      name = "";
      multi = false;
      options = [
        { value: "Option 1", color: defaultColor(0) },
        { value: "Option 2", color: defaultColor(1) },
      ];
      return;
    }
    editingId = record.id;
    name = record.name ?? "";
    multi = record.multi;
    options = record.source.options.map((o) => ({ ...o }));
  }

  function addOption() {
    options = [
      ...options,
      {
        value: `Option ${options.length + 1}`,
        color: defaultColor(options.length),
      },
    ];
  }

  function removeOption(index: number) {
    options = options.filter((_, i) => i !== index);
    if (pickerOpenFor === index) pickerOpenFor = null;
  }

  function setOptionColor(index: number, color: string) {
    options = options.map((o, i) => (i === index ? { ...o, color } : o));
    pickerOpenFor = null;
  }

  /** Wrapper around ``ColorPicker`` whose ``onchange`` callback fires
   *  with ``string | null``. Dropdown chips are non-nullable (we
   *  render the picker with ``nullable={false}``), but the callback
   *  type is shared, so we coerce ``null → defaultColor`` defensively. */
  function handleColorChange(index: number, color: string | null) {
    setOptionColor(index, color ?? defaultColor(index));
  }

  // [page-toolbar-09] Click-outside dismissal for the per-row color
  // picker. Without this, scrolling the panel or rearranging options
  // could leave a stale popover anchored to a swatch that has moved.
  // We use ``mousedown`` capture so the dismissal lands before any
  // child mousedown logic that might rely on the picker being open.
  let panelRef: HTMLElement | null = $state(null);
  function handleDocMouseDown(e: MouseEvent) {
    if (pickerOpenFor === null || !panelRef) return;
    const target = e.target as Node | null;
    if (!target) return;
    // Outside the whole panel — let the panel's own dismiss handle it.
    if (!panelRef.contains(target)) return;
    // Inside the panel: close the picker iff the click landed outside
    // the open color cell. Lets users click swatches inside the
    // popover (handled by ColorPicker → ``change`` event) without
    // dismissing first.
    const openCell = panelRef.querySelector(
      `.color-cell[data-picker-index="${pickerOpenFor}"]`,
    );
    if (openCell && openCell.contains(target)) return;
    pickerOpenFor = null;
  }

  onMount(() => {
    document.addEventListener("mousedown", handleDocMouseDown, true);
  });
  onDestroy(() => {
    document.removeEventListener("mousedown", handleDocMouseDown, true);
  });

  function validate(): string | null {
    if (options.length === 0) return "At least one option is required.";
    const seen = new Set<string>();
    for (const o of options) {
      const v = o.value.trim();
      if (!v) return "Option values cannot be blank.";
      if (v.includes(",")) return "Option values cannot contain ','.";
      if (seen.has(v)) return `Duplicate option value: ${v}`;
      seen.add(v);
    }
    return null;
  }

  // [sheet.data.dropdown] Save (create or update). On a fresh
  // create, also apply the dropdown format to the current selection
  // — opening the editor from the Format menu means the user wants
  // to use the rule, not just define it.
  async function save() {
    const trimmedOptions = options
      .map((o) => ({ value: o.value.trim(), color: o.color }))
      .filter((o) => o.value !== "");
    options = trimmedOptions;
    const errMsg = validate();
    if (errMsg) {
      error = errMsg;
      return;
    }
    saving = true;
    error = null;
    try {
      let ruleId = editingId;
      const trimmedName = name.trim();
      if (editingId === null) {
        const created = await createDropdownRule(database, workbookId, {
          name: trimmedName || undefined,
          multi,
          options: trimmedOptions,
        });
        ruleId = created.id;
        // Auto-apply to the current selection so the user can create
        // and use a rule in one trip from the Format menu.
        applyFormat({ controlType: "dropdown", dropdownRuleId: created.id });
      } else {
        await updateDropdownRule(database, workbookId, editingId, {
          name: trimmedName || undefined,
          nameSet: true,
          multi,
          options: trimmedOptions,
        });
      }
      closeDropdownRulesPanel();
      void ruleId; // currently unused after the auto-apply branch
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save dropdown rule";
    } finally {
      saving = false;
    }
  }

  // [sheet.data.dropdown] Hard-delete. Cells that reference this
  // rule render as plain text (the chip cell branch fails the rule
  // lookup) until the user changes their format, matching the spec.
  async function remove() {
    if (editingId === null) return;
    if (
      !confirm(
        "Delete this dropdown rule? Cells using it will revert to plain text on next render.",
      )
    )
      return;
    try {
      await deleteDropdownRule(database, workbookId, editingId);
      closeDropdownRulesPanel();
    } catch (e) {
      alert(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeDropdownRulesPanel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
  }

  let nameInput: HTMLInputElement | null = $state(null);
  $effect(() => {
    if (panelState) {
      void tick().then(() => nameInput?.focus());
    }
  });
</script>

{#if panelState}
  <div
    class="dropdown-rule-panel"
    role="dialog"
    aria-label="Dropdown rule editor"
    tabindex="-1"
    onkeydown={handleKeydown}
    bind:this={panelRef}
  >
    <header class="panel-header">
      <h3>{editingId ? "Edit dropdown" : "New dropdown"}</h3>
      <button
        type="button"
        class="icon-btn"
        onclick={closeDropdownRulesPanel}
        title="Close"
        aria-label="Close dropdown rule editor"
      >
        ×
      </button>
    </header>

    <div class="editor">
      <label class="field">
        <span>Name (optional)</span>
        <input
          bind:this={nameInput}
          type="text"
          bind:value={name}
          placeholder="e.g. Status"
          disabled={saving}
        />
      </label>

      <label class="field checkbox-field">
        <input type="checkbox" bind:checked={multi} disabled={saving} />
        <span>Allow multiple selections</span>
      </label>

      <div class="options-section">
        <div class="options-header">
          <span>Options</span>
        </div>
        <ul class="options-list">
          {#each options as option, i (i)}
            <li class="option-row">
              <div class="color-cell" data-picker-index={i}>
                <button
                  type="button"
                  class="color-swatch"
                  style="background: {option.color};"
                  aria-label="Pick color"
                  onclick={() =>
                    (pickerOpenFor = pickerOpenFor === i ? null : i)}
                  disabled={saving}
                ></button>
                {#if pickerOpenFor === i}
                  <!-- [page-toolbar-09] Reuse the shared ColorPicker
                       so chrome (custom-hex input, a11y) lives in
                       one place. Pastel palette + non-nullable: chip
                       cells must always have a color. -->
                  <div class="color-picker-anchor">
                    <ColorPicker
                      palette={DROPDOWN_PALETTE}
                      nullable={false}
                      value={option.color}
                      label="Pick chip color"
                      onchange={(color) => handleColorChange(i, color)}
                    />
                  </div>
                {/if}
              </div>
              <input
                type="text"
                class="option-value"
                bind:value={option.value}
                placeholder="Option value"
                disabled={saving}
              />
              <button
                type="button"
                class="icon-btn small"
                onclick={() => removeOption(i)}
                title="Delete option"
                aria-label="Delete option"
                disabled={saving || options.length === 1}
              >
                ×
              </button>
            </li>
          {/each}
        </ul>
        <button
          type="button"
          class="add-option-btn"
          onclick={addOption}
          disabled={saving}
        >
          + Add option
        </button>
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <div class="actions">
        {#if editingId}
          <button
            type="button"
            class="btn danger"
            onclick={remove}
            disabled={saving}
          >
            Delete
          </button>
        {/if}
        <div class="actions-right">
          <button
            type="button"
            class="btn cancel"
            onclick={closeDropdownRulesPanel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn primary"
            onclick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : editingId ? "Save" : "Done"}
          </button>
        </div>
      </div>
    </div>

    {#if $dropdownRules.length > 0 && editingId === null}
      <div class="existing">
        <div class="existing-header">Existing dropdowns</div>
        <ul class="existing-list">
          {#each $dropdownRules as rule (rule.id)}
            <li class="existing-row">
              <button
                type="button"
                class="existing-pick"
                onclick={() => syncForm(rule.id)}
              >
                <span class="existing-name">{rule.name || "(unnamed)"}</span>
                <span class="existing-meta"
                  >{rule.source.options.length} option{rule.source.options
                    .length === 1
                    ? ""
                    : "s"}{rule.multi ? " · multi" : ""}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .dropdown-rule-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 320px;
    max-width: 100%;
    background: var(--sheet-surface, #fff);
    border-left: 1px solid var(--sheet-border-strong, #ccc);
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    z-index: var(--z-panel, 900);
    font-size: 13px;
    color: var(--sheet-text, #111);
    overflow-y: auto;
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
  .icon-btn:hover:not(:disabled) {
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
  }

  .field {
    display: block;
    margin-bottom: 12px;
  }
  .field span {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--sheet-text, #111);
  }
  .field input[type="text"] {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    font-size: 13px;
    box-sizing: border-box;
    background: var(--sheet-surface, #fff);
  }
  .field input[type="text"]:focus {
    outline: none;
    border-color: var(--sheet-accent, #276890);
  }
  .checkbox-field {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .checkbox-field span {
    margin: 0;
    font-weight: 400;
  }

  .options-section {
    margin-top: 8px;
  }
  .options-header {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--sheet-text, #111);
  }
  .options-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .option-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .color-cell {
    position: relative;
  }
  .color-swatch {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    cursor: pointer;
    padding: 0;
  }
  .color-swatch:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  /* [page-toolbar-09] Wraps the shared ColorPicker so its absolute
     positioning anchors to the swatch cell. The picker itself
     supplies its own popover chrome (border + shadow via the shared
     .popover primitive). */
  .color-picker-anchor {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--sheet-surface, #fff);
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: var(--sheet-radius-md, 4px);
    box-shadow: var(--sheet-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.12));
    z-index: 10;
  }
  .option-value {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    font-size: 13px;
    box-sizing: border-box;
  }
  .option-value:focus {
    outline: none;
    border-color: var(--sheet-accent, #276890);
  }
  .add-option-btn {
    padding: 6px 10px;
    background: transparent;
    border: 1px dashed var(--sheet-border-strong, #ccc);
    border-radius: 4px;
    color: var(--sheet-text-secondary, #666);
    font-size: 13px;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .add-option-btn:hover:not(:disabled) {
    color: var(--sheet-text, #111);
    background: var(--sheet-header-bg, #f0f3f5);
  }

  .error {
    color: var(--sheet-error, #d00);
    font-size: 12px;
    margin: 8px 0 0;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
  }
  .actions-right {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .btn.danger {
    background: var(--sheet-surface, #fff);
    color: var(--sheet-error, #d00);
    border: 1px solid var(--sheet-error, #d00);
    border-radius: 4px;
    padding: 5px 12px;
    font: inherit;
    cursor: pointer;
  }
  .btn.danger:hover:not(:disabled) {
    background: var(--sheet-error, #d00);
    color: #fff;
  }

  .existing {
    padding: 10px 14px 14px;
    border-top: 1px solid var(--sheet-border, #ddd);
  }
  .existing-header {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--sheet-text-secondary, #666);
  }
  .existing-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .existing-row {
    display: flex;
  }
  .existing-pick {
    flex: 1;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 6px 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font: inherit;
    color: inherit;
  }
  .existing-pick:hover {
    background: var(--sheet-header-bg, #f0f3f5);
    border-color: var(--sheet-border, #ddd);
  }
  .existing-name {
    font-weight: 600;
    font-size: 13px;
  }
  .existing-meta {
    font-size: 11px;
    color: var(--sheet-text-secondary, #666);
  }
</style>
