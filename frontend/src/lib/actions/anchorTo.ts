/**
 * Svelte action: pin a fixed-positioned popover to a moving anchor
 * element and keep it pinned across scroll / resize / anchor-resize.
 *
 * Used by Cell.svelte's autocomplete + signature-help popups, which
 * sit inside the grid container. The first paint computes the
 * anchor's bounding rect and writes ``top`` / ``left`` inline; if the
 * grid scrolls, the window resizes, or the anchor itself changes
 * size, this action re-runs the computation so the popup tracks the
 * anchor instead of floating over an unrelated cell.
 *
 * The "right edge of the viewport" clamp is rolled in here too: a
 * popover anchored at ``rect.left`` with its own width can spill off
 * the right edge of the viewport on a narrow window. We measure the
 * popover's own width and pin its right edge at most
 * ``viewportWidth - VIEWPORT_MARGIN``.
 *
 * Distinct from ``keepInViewport`` because that action is purpose-
 * built for popovers ``position: absolute`` -ly anchored to a host
 * element via ``left: 0`` / ``left: 100%``; this one is for
 * ``position: fixed`` popovers positioned by viewport coordinates.
 */

import { tick } from "svelte";

export type AnchorPlacement = "below" | "above";

export interface AnchorToOptions {
  /** Returns the element to pin to. May return null while the anchor
   *  is mounting or briefly unmounted (e.g. between input rebinds);
   *  the action skips the reposition in that case. */
  getAnchor: () => HTMLElement | null;
  /** ``below`` pins the popover's top to the anchor's ``bottom``;
   *  ``above`` pins it to the anchor's ``top`` (the consumer's CSS
   *  transform pulls the popover above). Defaults to ``below``. */
  placement?: AnchorPlacement;
}

const VIEWPORT_MARGIN = 4;

export function anchorTo(node: HTMLElement, opts: AnchorToOptions) {
  let getAnchor = opts.getAnchor;
  let placement: AnchorPlacement = opts.placement ?? "below";
  let anchorObserver: ResizeObserver | null = null;
  let observedAnchor: HTMLElement | null = null;

  function reposition() {
    const a = getAnchor();
    if (!a) return;
    const r = a.getBoundingClientRect();
    const top = placement === "above" ? r.top : r.bottom;
    let left = r.left;

    // Right-edge clamp. Measure the popover's own width and pull it
    // back leftward if it would spill past the viewport edge. We
    // tolerate a one-frame "off by N px" the very first reposition
    // since ``offsetWidth`` is zero before the popover paints — the
    // ``rAF`` re-check below catches that.
    const popWidth = node.offsetWidth;
    if (popWidth > 0) {
      const maxLeft = window.innerWidth - popWidth - VIEWPORT_MARGIN;
      if (left > maxLeft) left = Math.max(VIEWPORT_MARGIN, maxLeft);
    }

    node.style.top = `${top}px`;
    node.style.left = `${left}px`;

    // Keep a ResizeObserver on the live anchor — the input grows in
    // edit-mode auto-widen (Cell.svelte::editContentWidth), so the
    // anchor's ``rect.left`` / ``rect.bottom`` shift even without a
    // scroll or window-resize event.
    if (a !== observedAnchor) {
      if (anchorObserver) anchorObserver.disconnect();
      anchorObserver = new ResizeObserver(reposition);
      anchorObserver.observe(a);
      observedAnchor = a;
    }
  }

  reposition();
  // ``offsetWidth`` is zero on the first synchronous paint pass —
  // re-measure once the popup has its real width so the right-edge
  // clamp applies on the very first frame.
  const raf = requestAnimationFrame(reposition);
  // ``tick()`` lets Svelte flush any pending DOM updates (e.g. the
  // popup's children that determine its width) before we re-clamp.
  tick().then(reposition);

  // Capture: catch grid-container scroll, not just window scroll.
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  return {
    update(next: AnchorToOptions) {
      getAnchor = next.getAnchor;
      placement = next.placement ?? "below";
      reposition();
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      if (anchorObserver) anchorObserver.disconnect();
    },
  };
}
