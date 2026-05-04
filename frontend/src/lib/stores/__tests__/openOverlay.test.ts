import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import {
  openOverlay,
  requestOverlay,
  toggleOverlay,
  closeOverlay,
  closeAnyOverlay,
  _resetOverlayTriggerForTests,
} from "../openOverlay";

beforeEach(() => {
  openOverlay.set(null);
  _resetOverlayTriggerForTests();
});

/** Wait one animation frame so the focus-return rAF callback runs. */
function nextFrame(): Promise<void> {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}

// Locks down the core invariant: only one overlay id can be open at a
// time. Opening a second id implicitly closes the first — that's the
// whole point of the store. [page-toolbar-04]
test("requestOverlay replaces the currently-open id", () => {
  requestOverlay("toolbar:textColor");
  expect(get(openOverlay)).toBe("toolbar:textColor");

  requestOverlay("format-menu");
  expect(get(openOverlay)).toBe("format-menu");
});

test("toggleOverlay opens when nothing is open", () => {
  toggleOverlay("toolbar:wrap");
  expect(get(openOverlay)).toBe("toolbar:wrap");
});

test("toggleOverlay closes when the same id is already open", () => {
  toggleOverlay("toolbar:wrap");
  toggleOverlay("toolbar:wrap");
  expect(get(openOverlay)).toBe(null);
});

test("toggleOverlay swaps to a different id", () => {
  toggleOverlay("toolbar:textColor");
  toggleOverlay("toolbar:fillColor");
  expect(get(openOverlay)).toBe("toolbar:fillColor");
});

// closeOverlay is id-scoped — calling it for an id that isn't the
// current one is a no-op, so a stale "close" call from a popover
// that's already been replaced doesn't accidentally clobber the new
// owner. [page-toolbar-04]
test("closeOverlay only closes when the id matches", () => {
  requestOverlay("format-menu");
  closeOverlay("toolbar:wrap"); // wrong id — nothing happens
  expect(get(openOverlay)).toBe("format-menu");

  closeOverlay("format-menu");
  expect(get(openOverlay)).toBe(null);
});

test("closeAnyOverlay clears whatever is open", () => {
  requestOverlay("toolbar:borders");
  closeAnyOverlay();
  expect(get(openOverlay)).toBe(null);

  // Idempotent — calling on an already-closed store is fine.
  closeAnyOverlay();
  expect(get(openOverlay)).toBe(null);
});

// [page-toolbar-10] Focus-return contract. Caller hands a trigger
// element when opening; any close path returns DOM focus to it.
// rAF-deferred so the tests have to wait one frame.

function makeTrigger(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = "trigger";
  document.body.appendChild(btn);
  return btn;
}

test("closeOverlay focuses the registered trigger", async () => {
  const trigger = makeTrigger();
  try {
    requestOverlay("toolbar:textColor", trigger);
    closeOverlay("toolbar:textColor");
    await nextFrame();
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
  }
});

test("toggleOverlay close path focuses the registered trigger", async () => {
  const trigger = makeTrigger();
  try {
    toggleOverlay("toolbar:wrap", trigger);
    toggleOverlay("toolbar:wrap"); // close
    await nextFrame();
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
  }
});

test("closeAnyOverlay focuses the registered trigger", async () => {
  const trigger = makeTrigger();
  try {
    requestOverlay("format-menu", trigger);
    closeAnyOverlay();
    await nextFrame();
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
  }
});

test("opening a different overlay focuses the previous trigger", async () => {
  // Mutual-exclusion swap: when overlay A is replaced by B, focus
  // returns to A's trigger. (B's own trigger usually already has
  // focus from the click that opened it, but we don't fight for it
  // here — the rAF runs after the synchronous click handler.)
  const triggerA = makeTrigger();
  const triggerB = makeTrigger();
  try {
    requestOverlay("toolbar:textColor", triggerA);
    requestOverlay("format-menu", triggerB);
    await nextFrame();
    expect(document.activeElement).toBe(triggerA);
  } finally {
    triggerA.remove();
    triggerB.remove();
  }
});

test("close without a registered trigger is a no-op for focus", async () => {
  // No trigger passed — nothing to focus, ``document.activeElement``
  // stays as <body> (the default).
  const before = document.activeElement;
  requestOverlay("toolbar:wrap");
  closeOverlay("toolbar:wrap");
  await nextFrame();
  expect(document.activeElement).toBe(before);
});

test("close skips focus when the trigger has been detached", async () => {
  const trigger = makeTrigger();
  requestOverlay("toolbar:wrap", trigger);
  trigger.remove(); // simulate dismount before close (e.g. nav)
  closeOverlay("toolbar:wrap");
  await nextFrame();
  // No throw, no focus on the detached node — it's not in the DOM.
  expect(document.activeElement).not.toBe(trigger);
});
