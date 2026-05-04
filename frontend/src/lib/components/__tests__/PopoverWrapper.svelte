<script lang="ts">
  // Test-only wrapper: mounts both Toolbar and FormatMenu side-by-side
  // so a single test can drive cross-component popover interactions.
  // [page-toolbar-04]
  import Toolbar from "../Toolbar.svelte";
  import FormatMenu from "../FormatMenu.svelte";
</script>

<div class="popover-wrapper-root">
  <FormatMenu />
  <Toolbar />
</div>
