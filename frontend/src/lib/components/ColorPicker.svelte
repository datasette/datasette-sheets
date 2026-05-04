<script lang="ts">
  import { CATEGORICAL_PALETTE } from "../spreadsheet/palettes";

  /**
   * Color picker dropdown. 12-swatch palette, an optional reset button
   * that clears the color, and a custom-hex input. Calls `onchange`
   * with `string | null` — null means "unset this color" (theme
   * default).
   *
   * Not a standalone popup — the caller is responsible for mounting
   * / unmounting and for positioning. We render as a simple
   * absolute-positioned block; the parent wraps it in a
   * `position:relative` container.
   *
   * Callers can pass their own ``palette`` (e.g. the pastel chip
   * palette used by ``DropdownRuleEditor``) while keeping the rest
   * of the chrome (custom-hex input, reset, a11y) shared.
   * [page-toolbar-09]
   */

  let {
    value = null,
    label = "",
    palette = CATEGORICAL_PALETTE,
    nullable = true,
    onchange,
  }: {
    /** Currently-selected color, used to show the "active" swatch
     *  highlight. `null` means "no color set" (reset swatch is active). */
    value?: string | null;
    label?: string;
    /** Override the swatch palette. Defaults to ``CATEGORICAL_PALETTE``. */
    palette?: readonly string[];
    /** When ``false``, hide the reset swatch. Use for contexts where
     *  "no color" isn't a meaningful state (e.g. dropdown chips, where
     *  every option must have a color). [page-toolbar-09] */
    nullable?: boolean;
    onchange?: (color: string | null) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  // Captures the initial prop value as the form-input default. The
  // input is user-controlled after that — we don't want a parent
  // value flip to clobber what they're typing.
  let customHex = $state(value ?? "#000000");

  function choose(c: string | null) {
    onchange?.(c);
  }

  function applyCustom() {
    const v = customHex.trim();
    if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)) {
      onchange?.(v);
    }
  }

  /** Svelte action: select the input's contents on first focus so
   *  click-to-edit-hex lands with the existing value highlighted. */
  function bindHex(node: HTMLInputElement) {
    node.addEventListener("focus", () => node.select(), { once: true });
  }
</script>

<div
  class="color-picker popover"
  role="dialog"
  aria-label={label || "Color picker"}
>
  <div class="palette" role="radiogroup">
    {#if nullable}
      <button
        type="button"
        class="swatch reset"
        class:selected={value === null}
        onclick={() => choose(null)}
        title="Reset (default color)"
        aria-label="Reset to default"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" width="12" height="12">
          <line
            x1="2"
            y1="14"
            x2="14"
            y2="2"
            stroke="#b00"
            stroke-width="1.5"
          />
        </svg>
      </button>
    {/if}
    {#each palette as color (color)}
      <button
        type="button"
        class="swatch"
        class:selected={value?.toLowerCase() === color.toLowerCase()}
        style="background: {color}"
        onclick={() => choose(color)}
        title={color}
        aria-label={color}
      ></button>
    {/each}
  </div>

  <div class="custom">
    <label class="custom-label">
      Custom
      <input
        use:bindHex
        bind:value={customHex}
        type="text"
        class="custom-input"
        placeholder="#ff0000"
        spellcheck="false"
        onkeydown={(e) => e.key === "Enter" && applyCustom()}
      />
    </label>
    <button
      type="button"
      class="custom-apply"
      onclick={applyCustom}
      aria-label="Apply custom color"
    >
      Apply
    </button>
  </div>
</div>

<style>
  .color-picker {
    padding: 8px;
    min-width: 164px;
    font-family: var(--sheet-font);
    font-size: 12px;
  }

  .palette {
    display: grid;
    grid-template-columns: repeat(6, 22px);
    gap: 4px;
    margin-bottom: 8px;
  }

  .swatch {
    width: 22px;
    height: 22px;
    border: 1px solid var(--sheet-border, #ccc);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .swatch.selected {
    outline: 2px solid var(--sheet-accent, #276890);
    outline-offset: 1px;
  }

  .swatch.reset {
    background: var(--sheet-surface, #fff);
  }

  .custom {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .custom-label {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .custom-input {
    flex: 1;
    min-width: 0;
    padding: 3px 5px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 3px;
    font: inherit;
  }

  .custom-apply {
    padding: 3px 8px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    background: var(--sheet-header-bg, #eef1f4);
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }

  .custom-apply:hover {
    background: var(--sheet-active-bg, #d4dce4);
  }
</style>
