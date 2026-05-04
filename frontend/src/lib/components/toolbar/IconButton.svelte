<script lang="ts">
  /**
   * Toolbar icon button. [page-toolbar-02]
   *
   * Renders ``<button class="toolbar-btn icon-btn">`` with the named
   * 16x16 bootstrap-icon SVG inside (or custom children if the call
   * site needs to stack extras like a colour strip). The
   * active/depressed state class (``.active``) lives on the button
   * itself — that's deliberate: the host stylesheet keys depressed
   * visuals off ``.toolbar-btn.active``, and we want the same wiring
   * after extraction so the no-selection fade + hover/active rules
   * still cascade.
   *
   * The default ``children`` snippet is the visual content. When
   * omitted, we render the registered 16x16 icon for ``name``. Picker
   * buttons (text / fill color, number format, wrap, borders) inject
   * their own children — the icon + caret combo, or the
   * icon-over-colour-strip stack — so they don't get a free icon
   * they'd then have to override.
   *
   * The button base styles (sizing, hover, depressed) live here so
   * every toolbar button paints identically whether it's a plain
   * ``IconButton`` or the trigger inside ``PickerButton``. The
   * Toolbar.svelte stylesheet keeps the no-selection fade rule,
   * which targets descendants via a ``:global(.toolbar-btn)``
   * selector since this button is in a child component scope.
   */
  import type { Snippet } from "svelte";
  import { TOOLBAR_ICONS, type ToolbarIconName } from "./icons";

  let {
    name = null,
    title,
    pressed = undefined,
    ariaLabel = undefined,
    expanded = undefined,
    extraClass = "",
    onclick,
    children,
  }: {
    name?: ToolbarIconName | null;
    title: string;
    /** Tracks ``activeFormat?.<flag>`` etc. — controls ``.active`` class
     *  AND ``aria-pressed``. Toggle buttons (bold/italic/…) rely on
     *  this; momentary buttons (undo/redo/eraser) leave it
     *  ``undefined`` so no aria-pressed attribute is emitted. */
    pressed?: boolean | undefined;
    /** Optional override of the button's accessible name. Defaults to
     *  ``title`` — most call sites want them identical. */
    ariaLabel?: string | undefined;
    /** ``aria-expanded`` for picker triggers. Picker buttons use this
     *  to advertise their open state. Plain toggle buttons leave it
     *  ``undefined``. */
    expanded?: boolean | undefined;
    /** Extra class names applied to the button (e.g. ``color-btn``). */
    extraClass?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  } = $props();

  let ariaPressedAttr = $derived(
    (pressed === undefined ? undefined : pressed ? "true" : "false") as
      | "true"
      | "false"
      | undefined,
  );
  let ariaExpandedAttr = $derived(
    (expanded === undefined ? undefined : expanded ? "true" : "false") as
      | "true"
      | "false"
      | undefined,
  );
</script>

<button
  type="button"
  class="toolbar-btn icon-btn {extraClass}"
  class:active={pressed === true || expanded === true}
  {onclick}
  {title}
  aria-label={ariaLabel ?? title}
  aria-pressed={ariaPressedAttr}
  aria-expanded={ariaExpandedAttr}
>
  {#if children}{@render children()}{:else if name}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <!-- TOOLBAR_ICONS values are static build-time constants. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html TOOLBAR_ICONS[name]}
    </svg>
  {/if}
</button>

<style>
  /* Base toolbar button — flat, 28x28, hoverable. Kept here so the
     PickerButton trigger (which renders an IconButton internally) and
     plain icon buttons paint identically. The ``.color-btn`` modifier
     widens the button so the colour strip + caret both fit. */
  .toolbar-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--sheet-text);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--sheet-font);
    padding: 0;
  }

  .toolbar-btn:hover {
    background: var(--sheet-active-bg);
  }

  .toolbar-btn:active {
    background: var(--sheet-active-hover);
  }

  /* Depressed state — the active cell has this format flag on, OR a
     picker is open. Mirrors Google Sheets: toggle buttons look
     "sunken" when the active cell carries the format. */
  .toolbar-btn.active {
    background: var(--sheet-active-hover, #d4dce4);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .icon-btn {
    color: var(--sheet-text);
  }

  .icon-btn :global(svg) {
    display: block;
  }

  /* Color button: main glyph with a thin strip of the chosen color
     UNDER it (stacked), plus a small caret to the right. Mirrors the
     Google Sheets pattern so users can see the "last-picked" color
     at a glance. */
  .toolbar-btn.color-btn {
    width: auto;
    padding: 0 3px 0 4px;
    gap: 1px;
  }
</style>
