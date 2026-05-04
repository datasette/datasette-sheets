/**
 * Single-arbiter store for popover / dropdown mutual exclusion across
 * the whole sheets app. [page-toolbar-04]
 *
 * Each popover owner derives its local "am I open?" boolean from
 * ``$openOverlay === "<my-id>"``. Opening a new overlay implicitly
 * closes whatever was open, because the store only ever holds one
 * id at a time.
 *
 * Conventions for ids:
 *   "toolbar:<picker>"   — Toolbar.svelte popovers (textColor, fillColor,
 *                          numberFormat, wrap, borders)
 *   "format-menu"        — header Format menu
 *   "formula-bar:cell-ref" — formula-bar's cell-reference dropdown
 *   "sheet-tabs:<id>"    — SheetTabs right-click context menu (one per tab)
 *
 * Modal panels (NamedRangesPanel, DropdownRuleEditor) intentionally do
 * NOT live in this store — they're modals, not popovers, and shouldn't
 * be auto-closed when a popover opens. Same for ``dropdownPopoverFor``,
 * which is keyed by cell id and has its own dismiss semantics
 * (selection-change auto-close); we treat it as a separate slot.
 *
 * Focus return on close [page-toolbar-10]: callers may pass the
 * trigger element when opening (``requestOverlay`` / ``toggleOverlay``).
 * Whenever the overlay slot transitions away from that id — Esc,
 * outside-click, picking an item, or another overlay opening — the
 * recorded trigger gets focused on the next animation frame. That
 * keeps keyboard / AT focus anchored on the button the user actually
 * interacted with instead of falling through to ``<body>``.
 *
 * The rAF defer is necessary: synchronous ``focus()`` while the
 * popover is still in the DOM no-ops in some browsers when the
 * removed-on-close subtree contained the previously-focused node.
 */
import { writable } from "svelte/store";

export type OverlayId = string;

export const openOverlay = writable<OverlayId | null>(null);

/**
 * Trigger element registered alongside the currently-open id, if the
 * caller provided one. Cleared whenever the open id changes.
 */
let activeTrigger: HTMLElement | null = null;

function returnFocus(el: HTMLElement | null): void {
  if (!el) return;
  // rAF: see file header — synchronous focus during close races the
  // popover unmount in some browsers. Also guards against the trigger
  // having been detached in the interim.
  requestAnimationFrame(() => {
    if (el.isConnected) el.focus();
  });
}

/** Open the overlay with this id, implicitly closing any other.
 *  Optional ``trigger`` — when provided, focus returns to it on any
 *  close (Esc, outside-click, replacement, item select). */
export function requestOverlay(
  id: OverlayId,
  trigger?: HTMLElement | null,
): void {
  const prev = activeTrigger;
  activeTrigger = trigger ?? null;
  openOverlay.set(id);
  // If a different overlay was open with its own trigger, restore that
  // trigger's focus — but only if we're not handing focus to the new
  // overlay's own popover (which would steal it back). We rely on the
  // trigger being a button: most popovers are item-driven so focus
  // doesn't move there automatically, and the user just clicked the
  // new trigger anyway.
  if (prev && prev !== activeTrigger) returnFocus(prev);
}

/** Toggle: if ``id`` is already open, close it; otherwise open it
 *  (closing whatever was open before). When opening, ``trigger`` is
 *  recorded for focus return on close. */
export function toggleOverlay(
  id: OverlayId,
  trigger?: HTMLElement | null,
): void {
  let willClose = false;
  openOverlay.update((cur) => {
    if (cur === id) {
      willClose = true;
      return null;
    }
    return id;
  });
  if (willClose) {
    const t = activeTrigger;
    activeTrigger = null;
    returnFocus(t);
  } else {
    const prev = activeTrigger;
    activeTrigger = trigger ?? null;
    if (prev && prev !== activeTrigger) returnFocus(prev);
  }
}

/** Close ``id`` only if it's the one currently open. Safe to call
 *  unconditionally — it's a no-op if a different overlay has since
 *  taken the slot. */
export function closeOverlay(id: OverlayId): void {
  let didClose = false;
  openOverlay.update((cur) => {
    if (cur === id) {
      didClose = true;
      return null;
    }
    return cur;
  });
  if (didClose) {
    const t = activeTrigger;
    activeTrigger = null;
    returnFocus(t);
  }
}

/** Close whatever overlay is open. Used by the global Esc handler. */
export function closeAnyOverlay(): void {
  let didClose = false;
  openOverlay.update((cur) => {
    if (cur !== null) didClose = true;
    return null;
  });
  if (didClose) {
    const t = activeTrigger;
    activeTrigger = null;
    returnFocus(t);
  }
}

/** Test-only: reset the trigger registry. The store's
 *  ``openOverlay.set(null)`` in test ``beforeEach`` blocks does not
 *  go through our setters, so it can't clear ``activeTrigger`` —
 *  this helper closes that gap without leaking the variable to
 *  production callers. */
export function _resetOverlayTriggerForTests(): void {
  activeTrigger = null;
}
