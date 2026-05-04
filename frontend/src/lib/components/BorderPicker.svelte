<script lang="ts">
  import type { BorderStyle, CellBorders } from "../spreadsheet/types";

  /**
   * Border preset picker. Calls `onchange` with a partial update —
   * a new `CellBorders` object (or `null` to clear every edge).
   *
   * The parent component is responsible for positioning this popover
   * and for threading the change into every selected cell.
   */

  let {
    color = $bindable("#000000"),
    style = $bindable("solid"),
    onchange,
  }: {
    color?: string;
    style?: BorderStyle;
    onchange?: (payload: CellBorders | null) => void;
  } = $props();

  function edge() {
    return { style, color };
  }

  const PRESETS: Array<{
    id: string;
    label: string;
    make: () => CellBorders | null;
  }> = [
    {
      id: "all",
      label: "All",
      make: () => ({
        top: edge(),
        right: edge(),
        bottom: edge(),
        left: edge(),
      }),
    },
    {
      id: "outer",
      label: "Outer (same as All on a single cell)",
      make: () => ({
        top: edge(),
        right: edge(),
        bottom: edge(),
        left: edge(),
      }),
    },
    {
      id: "top",
      label: "Top",
      make: () => ({ top: edge() }),
    },
    {
      id: "right",
      label: "Right",
      make: () => ({ right: edge() }),
    },
    {
      id: "bottom",
      label: "Bottom",
      make: () => ({ bottom: edge() }),
    },
    {
      id: "left",
      label: "Left",
      make: () => ({ left: edge() }),
    },
    {
      id: "horizontal",
      label: "Top + bottom",
      make: () => ({ top: edge(), bottom: edge() }),
    },
    {
      id: "vertical",
      label: "Left + right",
      make: () => ({ left: edge(), right: edge() }),
    },
    {
      id: "clear",
      label: "Clear",
      make: () => null,
    },
  ];

  function pick(make: () => CellBorders | null) {
    onchange?.(make());
  }
</script>

<div class="border-picker popover" role="menu" aria-label="Border style">
  <div class="controls">
    <label class="ctl">
      Color
      <input type="color" bind:value={color} aria-label="Border color" />
    </label>
    <label class="ctl">
      Style
      <select bind:value={style} aria-label="Border style">
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
    </label>
  </div>
  <div class="presets">
    {#each PRESETS as p (p.id)}
      <button
        type="button"
        class="preset-item"
        role="menuitem"
        title={p.label}
        onclick={() => pick(p.make)}
      >
        {p.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .border-picker {
    min-width: 220px;
    padding: 8px;
    font-family: var(--sheet-font);
    font-size: 12px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .ctl {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .ctl input[type="color"] {
    width: 24px;
    height: 20px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
  }

  .ctl select {
    padding: 2px 4px;
    font: inherit;
  }

  .presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
  }

  .preset-item {
    padding: 6px 8px;
    background: transparent;
    border: 1px solid var(--sheet-border, #ddd);
    border-radius: 3px;
    cursor: pointer;
    color: var(--sheet-text);
    font: inherit;
    text-align: left;
  }
  .preset-item:hover,
  .preset-item:focus {
    background: var(--sheet-active-bg, #eef1f4);
  }
</style>
