/**
 * Svelte action: clamp a popover so it stays inside the viewport.
 *
 * Two anchor modes capture the two layouts we use:
 *
 *   "host"     — popover is positioned relative to a trigger button
 *                with ``left: 0`` (toolbar dropdowns, FormulaBar
 *                cell-menu, the Format menu root). On overflow we
 *                flip to ``right: 0`` so the popover stretches LEFT
 *                from the host's right edge.
 *
 *   "submenu"  — popover is offset to the SIDE of its host with
 *                ``left: 100%; margin-left: 2px`` (Format menu
 *                submenus). On overflow we flip to ``right: 100%``
 *                and swap the margin to ``margin-right: 2px`` so the
 *                submenu opens to the LEFT of its parent row.
 *
 * The ``edge`` option controls which axes are clamped — ``right``
 * (default) handles the toolbar's right-edge spill, ``bottom``
 * handles popovers near the bottom of a small viewport, ``both``
 * does both.
 *
 * Re-measures on mount, on the next animation frame (in case layout
 * shifted between mount and paint), and on window scroll / resize.
 *
 * Spec: every popover that opens from a host on the right side of
 * the toolbar / Format menu must use this action so it doesn't spill
 * off-screen — see frontend/CLAUDE.md "Popover / dropdown gotchas".
 */

export type KeepInViewportAnchor = "host" | "submenu";
export type KeepInViewportEdge = "right" | "bottom" | "both";

export interface KeepInViewportOptions {
  anchor?: KeepInViewportAnchor;
  edge?: KeepInViewportEdge;
}

const VIEWPORT_MARGIN = 4;

export function keepInViewport(
  node: HTMLElement,
  opts: KeepInViewportOptions = {},
) {
  let anchor: KeepInViewportAnchor = opts.anchor ?? "host";
  let edge: KeepInViewportEdge = opts.edge ?? "right";

  function check() {
    // Reset every property we might have set so we measure the
    // default (un-flipped) layout. Otherwise a prior overflow flip
    // would mask the natural rect on a re-check.
    node.style.left = "";
    node.style.right = "";
    node.style.top = "";
    node.style.bottom = "";
    if (anchor === "submenu") {
      node.style.marginLeft = "";
      node.style.marginRight = "";
    }

    const rect = node.getBoundingClientRect();

    if (edge === "right" || edge === "both") {
      if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
        if (anchor === "submenu") {
          node.style.left = "auto";
          node.style.right = "100%";
          node.style.marginLeft = "0";
          node.style.marginRight = "2px";
        } else {
          node.style.left = "auto";
          node.style.right = "0";
        }
      }
    }

    if (edge === "bottom" || edge === "both") {
      if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
        node.style.top = "auto";
        node.style.bottom = "0";
      }
    }
  }

  // Measure synchronously after mount, then again on the next frame
  // in case layout shifted between mount and paint.
  check();
  const raf = requestAnimationFrame(check);

  window.addEventListener("resize", check);
  // ``scroll`` with capture: true so we react to ANY scrollable
  // ancestor scrolling — not just the window.
  window.addEventListener("scroll", check, true);

  return {
    update(next: KeepInViewportOptions = {}) {
      anchor = next.anchor ?? "host";
      edge = next.edge ?? "right";
      check();
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", check);
      window.removeEventListener("scroll", check, true);
    },
  };
}
