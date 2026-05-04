<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { derived } from "svelte/store";
  import { cellStore, selectedCell, undo, redo } from "../stores/spreadsheet";
  import type { CellData } from "../spreadsheet/types";
  import {
    applyFormat,
    toggleFormatFlag,
    clearAllFormat,
  } from "../formatCommands";
  import { keepInViewport } from "../actions/keepInViewport";
  import { openOverlay, closeOverlay } from "../stores/openOverlay";
  import ColorPicker from "./ColorPicker.svelte";
  import BorderPicker from "./BorderPicker.svelte";
  import IconButton from "./toolbar/IconButton.svelte";
  import PickerButton from "./toolbar/PickerButton.svelte";
  import Icon from "./toolbar/Icon.svelte";
  import type { CellBorders } from "../spreadsheet/types";

  /** Buttons are disabled when nothing is selected — matches GSheets,
   *  avoids no-op clicks landing unexpectedly when the user thinks
   *  something is selected but isn't. */
  let disabled = $derived(!$selectedCell);

  /** Which toolbar picker is currently open. Backed by the global
   *  ``openOverlay`` store so opening any toolbar popover auto-closes
   *  every *other* popover in the app (Format menu, formula-bar
   *  dropdown, etc.) — and vice versa. [page-toolbar-04] */
  type Picker = "textColor" | "fillColor" | "numberFormat" | "wrap" | "borders";
  const PICKER_IDS: Record<Picker, string> = {
    textColor: "toolbar:textColor",
    fillColor: "toolbar:fillColor",
    numberFormat: "toolbar:numberFormat",
    wrap: "toolbar:wrap",
    borders: "toolbar:borders",
  };

  let openPicker = $derived.by(() => {
    const cur = $openOverlay;
    if (!cur) return null;
    for (const k of Object.keys(PICKER_IDS) as Picker[]) {
      if (PICKER_IDS[k] === cur) return k;
    }
    return null;
  });

  let rootRef: HTMLElement | null = $state(null);

  function closePickers() {
    if (openPicker) closeOverlay(PICKER_IDS[openPicker]);
  }

  function handleDocClick(e: MouseEvent) {
    if (!rootRef) return;
    // Only act when one of OUR pickers is open — otherwise leave the
    // store alone so we don't stomp on overlays owned by other
    // components (e.g. the FormatMenu sets the store while its
    // popover sits outside our rootRef).
    if (!openPicker) return;
    if (!rootRef.contains(e.target as Node)) {
      closePickers();
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleDocClick, true);
  });
  onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick, true);
  });

  // [perf] No ``cells.recalculate()`` after these: format is
  // display-only, ``formatValue`` is pure JS, and ``setCellFormat``
  // already makes a new cell object so per-cell subscribers wake and
  // re-render. The old calls were forcing a full WASM rebuild per
  // click for nothing.

  // [sheet.format.currency]
  function formatAsCurrency() {
    applyFormat({ type: "currency", decimals: 2 });
  }

  // [sheet.format.number]
  function formatAsNumber() {
    applyFormat({ type: "number", decimals: 2 });
  }

  // [sheet.format.percentage]
  function formatAsPercentage() {
    applyFormat({ type: "percentage", decimals: 1 });
  }

  // [sheet.format.decimal-increase]
  function increaseDecimal() {
    const d = activeFormat?.decimals ?? 2;
    applyFormat({ decimals: Math.min(d + 1, 10) });
  }
  // [sheet.format.decimal-decrease]
  function decreaseDecimal() {
    const d = activeFormat?.decimals ?? 2;
    applyFormat({ decimals: Math.max(d - 1, 0) });
  }

  // [sheet.format.menu] number-format dropdown entries
  const NUMBER_FORMAT_ENTRIES: Array<{
    id: string;
    label: string;
    partial: Partial<import("../spreadsheet/types").CellFormat>;
  }> = [
    { id: "general", label: "Automatic", partial: { type: "general" } },
    {
      id: "number",
      label: "Number (1,000.00)",
      partial: { type: "number", decimals: 2 },
    },
    {
      id: "percent",
      label: "Percent (10.0%)",
      partial: { type: "percentage", decimals: 1 },
    },
    {
      id: "scientific",
      label: "Scientific (1.00e+3)",
      partial: { type: "scientific", decimals: 2 },
    },
    {
      id: "currency",
      label: "Currency ($1,234.00)",
      partial: { type: "currency", decimals: 2, currencySymbol: "$" },
    },
    { id: "date", label: "Date (Apr 21, 2026)", partial: { type: "date" } },
    { id: "time", label: "Time (3:14:59 PM)", partial: { type: "time" } },
    {
      id: "datetime",
      label: "Date time",
      partial: { type: "datetime" },
    },
  ];

  function applyNumberFormat(
    partial: Partial<(typeof NUMBER_FORMAT_ENTRIES)[0]["partial"]>,
  ) {
    // [perf] No ``cells.recalculate()`` — see comment above the
    // format* helpers. Format changes don't need engine work.
    applyFormat(partial);
    closePickers();
  }

  // [sheet.format.font-size]
  const DEFAULT_FONT_SIZE = 10;
  const MIN_FONT_SIZE = 6;
  const MAX_FONT_SIZE = 72;

  function clampSize(n: number): number {
    if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
    return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
  }

  function setFontSize(size: number) {
    applyFormat({ fontSize: clampSize(size) });
  }

  function bumpFontSize(delta: number) {
    const current = activeFormat?.fontSize ?? DEFAULT_FONT_SIZE;
    setFontSize(current + delta);
  }

  function handleFontSizeInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) setFontSize(v);
  }

  // [sheet.format.text-color]
  function setTextColor(color: string | null) {
    applyFormat({ textColor: color ?? undefined });
    closePickers();
  }
  // [sheet.format.fill-color]
  function setFillColor(color: string | null) {
    applyFormat({ fillColor: color ?? undefined });
    closePickers();
  }

  // [sheet.format.wrap]
  function setWrap(v: "overflow" | "wrap" | "clip") {
    applyFormat({ wrap: v });
    closePickers();
  }

  // [sheet.format.borders]
  function setBorders(payload: CellBorders | null) {
    applyFormat({ borders: payload ?? undefined });
    closePickers();
  }

  // [sheet.format.h-align]
  function setHAlign(v: "left" | "center" | "right") {
    applyFormat({ hAlign: v });
  }
  // [sheet.format.v-align]
  function setVAlign(v: "top" | "middle" | "bottom") {
    applyFormat({ vAlign: v });
  }

  // [sheet.format.bold-toggle]
  const toggleBold = () => toggleFormatFlag("bold");
  // [sheet.format.italic-toggle]
  const toggleItalic = () => toggleFormatFlag("italic");
  // [sheet.format.underline-toggle]
  const toggleUnderline = () => toggleFormatFlag("underline");
  // [sheet.format.strikethrough-toggle]
  const toggleStrikethrough = () => toggleFormatFlag("strikethrough");

  // [perf] Subscribe to just the active cell's store, not the global
  // ``$cells`` map. Previously every cell mutation re-invalidated the
  // entire 1100-line toolbar reactivity, because ``$cells.get(...)``
  // treats any map change as a dep change. Now the toolbar only wakes
  // when the selected cell's data reference changes, or when
  // ``selectedCell`` itself changes.
  //
  // Under runes, we flatten the "store-of-stores" via ``derived`` so
  // the reactive surface is a single ``CellData | null`` store —
  // mirrors the ``activeCellStore`` pattern in DropdownPopover.svelte.
  const activeCellStore = derived<typeof selectedCell, CellData | null>(
    selectedCell,
    ($id, set) => {
      if (!$id) {
        set(null);
        return;
      }
      return cellStore($id).subscribe((value) => set(value ?? null));
    },
    null,
  );
  let activeCell = $derived($activeCellStore);
  let activeFormat = $derived(activeCell?.format ?? null);
</script>

<!-- [sheet.format.toolbar-layout] -->
<div class="toolbar" class:no-selection={disabled} bind:this={rootRef}>
  <div class="toolbar-group">
    <IconButton
      name="undo"
      title="Undo (Ctrl+Z)"
      ariaLabel="Undo"
      onclick={undo}
    />
    <IconButton
      name="redo"
      title="Redo (Ctrl+Y)"
      ariaLabel="Redo"
      onclick={redo}
    />
    <span class="toolbar-divider" aria-hidden="true"></span>
    <IconButton title="Format as Currency" onclick={formatAsCurrency}>
      <span class="text-glyph">$</span>
    </IconButton>
    <IconButton title="Format as Percentage" onclick={formatAsPercentage}>
      <span class="text-glyph">%</span>
    </IconButton>
    <IconButton title="Format as Number" onclick={formatAsNumber}>
      <span class="text-glyph">.0</span>
    </IconButton>
    <IconButton
      title="Decrease decimal places"
      ariaLabel="Decrease decimal places"
      onclick={decreaseDecimal}
    >
      <span class="text-glyph">.0←</span>
    </IconButton>
    <IconButton
      title="Increase decimal places"
      ariaLabel="Increase decimal places"
      onclick={increaseDecimal}
    >
      <span class="text-glyph">.0→</span>
    </IconButton>
    <PickerButton
      overlayId={PICKER_IDS.numberFormat}
      open={openPicker === "numberFormat"}
      title="More number formats"
      ariaLabel="More number formats"
      glyph="numberFormat"
    >
      <div class="popover number-format-popover" role="menu" use:keepInViewport>
        {#each NUMBER_FORMAT_ENTRIES as entry (entry.id)}
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            onclick={() => applyNumberFormat(entry.partial)}
          >
            {entry.label}
          </button>
        {/each}
      </div>
    </PickerButton>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <div class="font-size-stepper" role="group" aria-label="Font size">
      <IconButton
        title="Decrease font size"
        ariaLabel="Decrease font size"
        extraClass="stepper-btn"
        onclick={() => bumpFontSize(-1)}
      >
        <span class="text-glyph">−</span>
      </IconButton>
      <input
        type="number"
        class="font-size-input"
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        value={activeFormat?.fontSize ?? DEFAULT_FONT_SIZE}
        onchange={handleFontSizeInput}
        aria-label="Font size"
      />
      <IconButton
        title="Increase font size"
        ariaLabel="Increase font size"
        extraClass="stepper-btn"
        onclick={() => bumpFontSize(1)}
      >
        <span class="text-glyph">+</span>
      </IconButton>
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <IconButton
      name="bold"
      title="Bold (Ctrl+B)"
      ariaLabel="Bold"
      pressed={!!activeFormat?.bold}
      onclick={toggleBold}
    />
    <IconButton
      name="italic"
      title="Italic (Ctrl+I)"
      ariaLabel="Italic"
      pressed={!!activeFormat?.italic}
      onclick={toggleItalic}
    />
    <IconButton
      name="underline"
      title="Underline (Ctrl+U)"
      ariaLabel="Underline"
      pressed={!!activeFormat?.underline}
      onclick={toggleUnderline}
    />
    <IconButton
      name="strikethrough"
      title="Strikethrough (Ctrl+Shift+X)"
      ariaLabel="Strikethrough"
      pressed={!!activeFormat?.strikethrough}
      onclick={toggleStrikethrough}
    />
    <span class="toolbar-divider" aria-hidden="true"></span>
    <PickerButton
      overlayId={PICKER_IDS.textColor}
      open={openPicker === "textColor"}
      title="Text color"
      ariaLabel="Text color"
      extraClass="color-btn"
    >
      {#snippet glyphSnippet()}
        <span class="color-stack">
          <Icon name="textColor" />
          <span
            class="color-strip"
            class:set={!!activeFormat?.textColor}
            style={activeFormat?.textColor
              ? `background: ${activeFormat.textColor};`
              : ""}
            aria-hidden="true"
          ></span>
        </span>
      {/snippet}
      <div class="popover-anchor" use:keepInViewport>
        <ColorPicker
          value={activeFormat?.textColor ?? null}
          label="Text color"
          onchange={setTextColor}
        />
      </div>
    </PickerButton>
    <PickerButton
      overlayId={PICKER_IDS.fillColor}
      open={openPicker === "fillColor"}
      title="Fill color"
      ariaLabel="Fill color"
      extraClass="color-btn"
    >
      {#snippet glyphSnippet()}
        <span class="color-stack">
          <Icon name="fillColor" />
          <span
            class="color-strip"
            class:set={!!activeFormat?.fillColor}
            style={activeFormat?.fillColor
              ? `background: ${activeFormat.fillColor};`
              : ""}
            aria-hidden="true"
          ></span>
        </span>
      {/snippet}
      <div class="popover-anchor" use:keepInViewport>
        <ColorPicker
          value={activeFormat?.fillColor ?? null}
          label="Fill color"
          onchange={setFillColor}
        />
      </div>
    </PickerButton>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <IconButton
      name="alignLeft"
      title="Align left"
      ariaLabel="Align left"
      pressed={activeFormat?.hAlign === "left"}
      onclick={() => setHAlign("left")}
    />
    <IconButton
      name="alignCenter"
      title="Align center"
      ariaLabel="Align center"
      pressed={activeFormat?.hAlign === "center"}
      onclick={() => setHAlign("center")}
    />
    <IconButton
      name="alignRight"
      title="Align right"
      ariaLabel="Align right"
      pressed={activeFormat?.hAlign === "right"}
      onclick={() => setHAlign("right")}
    />
    <span class="toolbar-divider" aria-hidden="true"></span>
    <IconButton
      name="alignTop"
      title="Align top"
      ariaLabel="Align top"
      pressed={activeFormat?.vAlign === "top"}
      onclick={() => setVAlign("top")}
    />
    <IconButton
      name="alignMiddle"
      title="Align middle"
      ariaLabel="Align middle"
      pressed={activeFormat?.vAlign === "middle"}
      onclick={() => setVAlign("middle")}
    />
    <IconButton
      name="alignBottom"
      title="Align bottom"
      ariaLabel="Align bottom"
      pressed={activeFormat?.vAlign === "bottom"}
      onclick={() => setVAlign("bottom")}
    />
    <span class="toolbar-divider" aria-hidden="true"></span>
    <PickerButton
      overlayId={PICKER_IDS.borders}
      open={openPicker === "borders"}
      title="Borders"
      ariaLabel="Borders"
      glyph="borders"
    >
      <div class="popover-anchor" use:keepInViewport>
        <BorderPicker onchange={setBorders} />
      </div>
    </PickerButton>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <PickerButton
      overlayId={PICKER_IDS.wrap}
      open={openPicker === "wrap"}
      title="Wrapping"
      ariaLabel="Wrapping"
      glyph="wrap"
    >
      <div class="popover number-format-popover" role="menu" use:keepInViewport>
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          class:selected={!activeFormat?.wrap ||
            activeFormat.wrap === "overflow"}
          onclick={() => setWrap("overflow")}
        >
          Overflow (into empty neighbours)
        </button>
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          class:selected={activeFormat?.wrap === "wrap"}
          onclick={() => setWrap("wrap")}
        >
          Wrap (grow row)
        </button>
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          class:selected={activeFormat?.wrap === "clip"}
          onclick={() => setWrap("clip")}
        >
          Clip (hide overflow)
        </button>
      </div>
    </PickerButton>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <IconButton
      name="eraser"
      title="Clear formatting (Ctrl+\)"
      ariaLabel="Clear formatting"
      onclick={clearAllFormat}
    />
  </div>
</div>

<style>
  /* Google-Sheets-style toolbar: flat, no card chrome, same background as
     the formula bar below so they read as one continuous strip. */
  .toolbar {
    display: flex;
    align-items: center;
    padding: 4px 6px;
    background: var(--sheet-header-bg);
    border-bottom: 1px solid var(--sheet-border);
    gap: 4px;
    min-height: 36px;
    flex-wrap: wrap;
    /* Create a stacking context above the grid so popovers that
       extend below the toolbar (wrap, borders, color, number-format)
       paint on top of the sticky column-header row instead of
       getting clipped behind it. The toolbar itself doesn't visually
       overlap the grid — only its open popovers do. */
    position: relative;
    z-index: var(--z-toolbar);
  }

  /* When no cell is selected the format commands no-op. We used to
     set ``opacity: 0.65`` on the whole toolbar but that cascades
     onto the absolutely-positioned popovers (text color, borders,
     wrap, etc.), making them semi-transparent against the grid once
     opened. CSS has no way to restore opacity on a child. Instead,
     fade the individual button content via a dedicated class that
     only touches inline content — pickers that mount inside the
     popover-host aren't direct children of the faded targets and
     stay fully opaque. The ``:global`` is needed because the actual
     ``<button>`` element lives inside ``IconButton.svelte``'s scope. */
  .toolbar.no-selection :global(.toolbar-btn),
  .toolbar.no-selection .toolbar-divider,
  .toolbar.no-selection .font-size-input {
    opacity: 0.65;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* Wrapper that anchors a picker popover to a toolbar button. The
     floating surface style (background/border/shadow) comes from the
     shared .popover primitive applied on the child ColorPicker /
     BorderPicker root, or from .number-format-popover below. */
  .popover-anchor {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    z-index: 20;
  }

  /* Picker glyph stack — used by the text/fill colour buttons.
     Slotted into PickerButton's ``glyph`` slot, so its styles live
     here in the parent scope. */
  .color-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    line-height: 0;
  }

  /* Thin horizontal bar right below the glyph. When no color is set
     we hide it entirely — GSheets does the same. Previously we
     rendered a 1px-bordered transparent bar which read visually as
     an em-dash between the glyph and the caret. */
  .color-strip {
    display: block;
    width: 14px;
    height: 3px;
    border-radius: 1px;
    background: transparent;
    visibility: hidden;
  }

  .color-strip.set {
    visibility: visible;
    border: 1px solid rgba(0, 0, 0, 0.15);
  }

  /* Text glyphs ($ % .0 …) sit inside an IconButton's default slot —
     IconButton's box is 28x28 with flex centring, so this span
     just inherits font from the button. Kept as a class for parity
     with the SVG glyph wrappers. */
  .text-glyph {
    display: inline-block;
  }

  .font-size-stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  /* Stepper buttons are narrower than the rest of the toolbar.
     ``IconButton`` adds the modifier class via ``extraClass``, but
     the ``<button>`` element sits inside the child's CSS scope so
     we need ``:global`` to reach it. */
  :global(.toolbar-btn.stepper-btn) {
    width: 22px;
    font-size: 14px;
    font-weight: 600;
  }

  .font-size-input {
    width: 38px;
    height: 24px;
    border: 1px solid var(--sheet-border-strong, #ccc);
    border-radius: 3px;
    background: var(--sheet-surface);
    color: var(--sheet-text);
    font: inherit;
    font-size: 12px;
    text-align: center;
    padding: 0 2px;
  }

  /* Hide the default spinner on WebKit — our own +/- buttons are
     the canonical controls. */
  .font-size-input::-webkit-outer-spin-button,
  .font-size-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .font-size-input {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .number-format-popover {
    /* Positioned directly rather than via .popover-anchor — the
       toolbar button here IS the anchor (no ColorPicker-style
       wrapper in between), so the popover owns its own
       absolute-positioning. Same offset as .popover-anchor so the
       visual alignment matches other toolbar popovers. */
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    z-index: 20;
    min-width: 200px;
    padding: 4px 0;
    font-family: var(--sheet-font);
    font-size: 12px;
  }

  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--sheet-text);
    cursor: pointer;
    font: inherit;
  }
  .menu-item:hover,
  .menu-item:focus {
    background: var(--sheet-active-bg, #eef1f4);
  }

  .menu-item.selected::before {
    content: "✓ ";
    margin-right: 4px;
    color: var(--sheet-accent, #276890);
  }

  .toolbar-divider {
    display: inline-block;
    width: 1px;
    height: 18px;
    background: var(--sheet-border-strong);
    margin: 0 4px;
  }
</style>
