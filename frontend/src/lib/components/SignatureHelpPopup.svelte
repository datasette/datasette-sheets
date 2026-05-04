<script lang="ts">
  import type { FnInfo } from "../spreadsheet/formula-helpers";
  import { anchorTo } from "../actions/anchorTo";

  /** Returns the input element to anchor above; the action follows
   *  scroll / resize / anchor-resize so the popup tracks the input
   *  rather than freezing at its initial coordinates. */
  let {
    info,
    argIndex,
    getAnchor,
  }: {
    info: FnInfo;
    argIndex: number;
    getAnchor: () => HTMLElement | null;
  } = $props();

  /**
   * Whether a given param in the signature is the "current" one.
   * The repeatable tail param stays active for every arg past the
   * last non-repeatable one.
   */
  function isActive(index: number, argIdx: number, params: FnInfo["params"]) {
    if (index === argIdx) return true;
    const last = params.length - 1;
    if (index === last && params[last].repeatable && argIdx >= last)
      return true;
    return false;
  }
</script>

<div
  class="signature-popup"
  use:anchorTo={{ getAnchor, placement: "above" }}
  role="tooltip"
  aria-label="Function help"
>
  <div class="signature">
    <span class="fn-name">{info.name}</span
    >(<!--
   -->{#each info.params as p, i (i)}<span
        class="param"
        class:active={isActive(i, argIndex, info.params)}
        class:optional={p.optional}
        >{p.repeatable ? "…" : ""}{p.name}{p.optional && !p.repeatable
          ? "?"
          : ""}</span
      >{#if i < info.params.length - 1},
      {/if}{/each}<!--
 -->)
  </div>
  {#if info.summary}
    <div class="summary">{info.summary}</div>
  {/if}
</div>

<style>
  .signature-popup {
    position: fixed;
    z-index: var(--z-modal);
    background: #202124;
    color: #fff;
    border-radius: var(--sheet-radius-md);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    padding: 6px 10px;
    font-size: 12px;
    max-width: 360px;
    pointer-events: none;
    /* anchor-at-top: Cell.svelte passes ``top`` = input rect.top, then
       this translate pulls the popup up above the input. */
    transform: translateY(-100%) translateY(-4px);
  }
  .signature {
    font-family: "Courier New", Courier, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fn-name {
    font-weight: 600;
  }
  .param.optional {
    opacity: 0.72;
  }
  .param.active {
    font-weight: 700;
    text-decoration: underline;
    opacity: 1;
  }
  .summary {
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.72);
    line-height: 1.35;
  }
</style>
