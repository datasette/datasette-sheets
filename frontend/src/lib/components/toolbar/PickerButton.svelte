<script lang="ts">
  /**
   * Toolbar picker button. [page-toolbar-02]
   *
   * Wraps the ``popover-host`` + trigger ``<button>`` + caret pattern
   * shared by every toolbar dropdown (textColor / fillColor /
   * numberFormat / wrap / borders). The trigger glyph goes in the
   * ``glyph`` snippet; the popover content goes in the default
   * ``children`` snippet and is only mounted when ``open`` is true.
   *
   * Open state is owned by the global ``openOverlay`` store (see
   * ``stores/openOverlay.ts``) — opening this picker auto-closes any
   * other overlay. The host (Toolbar.svelte) maps its ``Picker``
   * union to the canonical ``"toolbar:<picker>"`` ids and passes the
   * derived ``open`` boolean down. Click handling lives here so the
   * trigger element can be forwarded to the store for focus return.
   * [page-toolbar-10]
   *
   * The trigger button reuses ``IconButton`` so the depressed /
   * hover / no-selection-fade visuals all stay in one place.
   */
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";
  import { TOOLBAR_ICONS, type ToolbarIconName } from "./icons";
  import { toggleOverlay } from "../../stores/openOverlay";

  let {
    overlayId,
    open,
    title,
    ariaLabel = undefined,
    extraClass = "",
    glyph = null,
    glyphSnippet,
    children,
  }: {
    /** Canonical overlay id, e.g. ``"toolbar:textColor"``. */
    overlayId: string;
    /** Derived from ``$openOverlay === overlayId`` by the host. */
    open: boolean;
    title: string;
    /** Optional accessible-name override. Defaults to ``title``. */
    ariaLabel?: string | undefined;
    /** Extra classes on the trigger button (``color-btn`` for the
     *  colour pickers — adjusts width/padding for the stacked glyph). */
    extraClass?: string;
    /** Default trigger glyph — render the named bootstrap-icon. Pickers
     *  with a richer trigger (the colour-strip stacks) leave this
     *  unset and supply their own ``glyphSnippet``. */
    glyph?: ToolbarIconName | null;
    /** Optional snippet that replaces the default bootstrap-icon glyph
     *  — used by the colour pickers to stack the icon over a colour
     *  strip. */
    glyphSnippet?: Snippet;
    children?: Snippet;
  } = $props();

  function handleClick(e: MouseEvent) {
    toggleOverlay(overlayId, e.currentTarget as HTMLElement);
  }
</script>

<div class="popover-host">
  <IconButton
    {title}
    {ariaLabel}
    {extraClass}
    expanded={open}
    onclick={handleClick}
  >
    {#if glyphSnippet}
      {@render glyphSnippet()}
    {:else if glyph}
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
        {@html TOOLBAR_ICONS[glyph]}
      </svg>
    {/if}
    <svg
      class="caret"
      xmlns="http://www.w3.org/2000/svg"
      width="8"
      height="8"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"
      />
    </svg>
  </IconButton>
  {#if open}
    {@render children?.()}
  {/if}
</div>

<style>
  /* Popover-hosting container. Keeps the dropdown positioned
     relative to its trigger button, and also lets the root click-
     outside handler see the popover DOM as part of the toolbar. */
  .popover-host {
    position: relative;
    display: inline-flex;
  }

  /* The slotted caret icon ends up inside the IconButton's ``<button>``,
     so the IconButton's scope owns the rule normally. But Svelte
     bubbles slot content into the *parent* component's CSS scope, so
     ``.caret`` needs to live here (where the slot content is authored). */
  .caret {
    width: 8px;
    height: 8px;
    margin-left: 1px;
    opacity: 0.55;
    flex-shrink: 0;
  }
</style>
