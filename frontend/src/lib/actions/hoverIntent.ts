/**
 * Svelte action: schedule a callback after the cursor has been outside
 * the host element for a short "intent delay". Cancel the timer if the
 * cursor re-enters before it fires.
 *
 * Used by FormatMenu to decide when a submenu has been "abandoned":
 * the per-host ``mouseenter`` toggles fire as the user sweeps from one
 * top-level row to the next, but moving the cursor OUT of the menu
 * entirely needs a small delay so a momentary out-and-back doesn't
 * collapse the open submenu.
 *
 * Default delay is 300ms — the well-trodden "intent delay" used by
 * GMail / GSheets. Caller can override via ``opts.delay``.
 *
 * The action installs ``mouseenter`` and ``mouseleave`` on the host
 * itself and clears any pending timer on destroy so navigation away
 * never fires a stale callback.
 */

export interface HoverIntentOptions {
  /** Fired ``delay`` ms after the cursor leaves the host. */
  onIntent: () => void;
  /** Intent delay in ms. Default 300. */
  delay?: number;
}

export function hoverIntent(node: HTMLElement, opts: HoverIntentOptions) {
  let onIntent = opts.onIntent;
  let delay = opts.delay ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function handleEnter(): void {
    cancel();
  }

  function handleLeave(): void {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      onIntent();
    }, delay);
  }

  node.addEventListener("mouseenter", handleEnter);
  node.addEventListener("mouseleave", handleLeave);

  return {
    update(next: HoverIntentOptions): void {
      onIntent = next.onIntent;
      delay = next.delay ?? 300;
    },
    destroy(): void {
      cancel();
      node.removeEventListener("mouseenter", handleEnter);
      node.removeEventListener("mouseleave", handleLeave);
    },
  };
}
