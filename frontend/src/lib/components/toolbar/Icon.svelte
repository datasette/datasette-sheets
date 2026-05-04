<script lang="ts">
  /**
   * Render a 16x16 toolbar icon by name. [page-toolbar-02]
   *
   * Used directly only by call sites that need to embed the icon
   * inside richer markup (e.g. the colour-strip stack inside the
   * text/fill colour pickers). For plain icon buttons just pass
   * ``name="…"`` to ``IconButton``.
   */
  import { TOOLBAR_ICONS, type ToolbarIconName } from "./icons";

  let { name }: { name: ToolbarIconName } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="16"
  height="16"
  fill="currentColor"
  viewBox="0 0 16 16"
  aria-hidden="true"
>
  <!-- TOOLBAR_ICONS values are static, build-time constants. Safe to
       inject as raw markup; no user input flows through here. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html TOOLBAR_ICONS[name]}
</svg>
