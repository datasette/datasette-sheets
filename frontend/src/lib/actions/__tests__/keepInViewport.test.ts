import { afterEach, beforeEach, expect, test } from "vitest";
import { keepInViewport } from "../keepInViewport";

// Pure DOM tests for the shared `keepInViewport` Svelte action.
// The action measures a popover's bounding rect and flips its
// horizontal anchor when it would spill off the right edge of the
// viewport. Two anchor modes:
//
//   - "host"    : popover is positioned with `left: 0` against a
//                 trigger button. Overflow flips it to `right: 0`.
//   - "submenu" : popover is offset to the side of its host with
//                 `left: 100%; margin-left: 2px`. Overflow flips it
//                 to `right: 100%; margin-right: 2px`.
//
// The action must also re-clamp on window resize / scroll, otherwise
// a popover near the right edge that's open during a resize stays in
// its first-paint position.

let host: HTMLElement;
let popover: HTMLElement;
let cleanup: { destroy(): void } | null;

beforeEach(() => {
  host = document.createElement("div");
  host.style.position = "absolute";
  host.style.top = "0";
  document.body.appendChild(host);
  popover = document.createElement("div");
  popover.style.position = "absolute";
  popover.style.width = "240px";
  popover.style.height = "60px";
  host.appendChild(popover);
  cleanup = null;
});

afterEach(() => {
  cleanup?.destroy();
  host.remove();
});

function attach(opts?: Parameters<typeof keepInViewport>[1]) {
  // Svelte action signature returns `{ update?, destroy? }`. We
  // capture the destroy hook so afterEach can clean up the window
  // listeners the action installs.
  const ret = keepInViewport(popover, opts);
  cleanup = ret;
  return ret;
}

test("host anchor leaves left:0 untouched when the popover fits", () => {
  // Popover starts well inside the viewport.
  host.style.left = "10px";
  popover.style.left = "0";
  attach();
  expect(popover.style.left).toBe("");
  expect(popover.style.right).toBe("");
});

test("host anchor flips left -> right:0 when the popover overflows the right edge", () => {
  // Park the host near the right edge so the 240px popover spills.
  host.style.left = `${window.innerWidth - 50}px`;
  popover.style.left = "0";
  attach();
  expect(popover.style.left).toBe("auto");
  expect(popover.style.right).toBe("0px");
});

test("submenu anchor flips left:100% -> right:100% and swaps the side margin", () => {
  // Submenus default to opening to the RIGHT of their host with a
  // 2px gap. When the host is itself near the right edge, the
  // submenu overflows and must flip to the LEFT — and the margin
  // has to follow it from `marginLeft` to `marginRight` or the
  // submenu visibly butts against its parent row.
  host.style.left = `${window.innerWidth - 50}px`;
  popover.style.left = "100%";
  popover.style.marginLeft = "2px";
  attach({ anchor: "submenu" });
  expect(popover.style.left).toBe("auto");
  expect(popover.style.right).toBe("100%");
  expect(popover.style.marginLeft).toBe("0px");
  expect(popover.style.marginRight).toBe("2px");
});

test("re-measures and re-clamps on window resize", async () => {
  // Open the popover with plenty of room (no flip).
  host.style.left = "10px";
  popover.style.left = "0";
  attach();
  expect(popover.style.right).toBe("");

  // Shrink the viewport so the popover would now spill.
  // jsdom-style fallback: directly drive the resize listener by
  // dispatching the event after moving the host. We can't actually
  // resize the test browser window, but we CAN simulate the same
  // signal — a layout change that pushes the rect past
  // `window.innerWidth - 4` — by moving the host.
  host.style.left = `${window.innerWidth - 50}px`;
  window.dispatchEvent(new Event("resize"));

  expect(popover.style.left).toBe("auto");
  expect(popover.style.right).toBe("0px");
});

test("destroy() removes the resize listener", () => {
  host.style.left = "10px";
  popover.style.left = "0";
  const ret = attach();
  ret.destroy();
  cleanup = null;

  // After destroy, a resize that would otherwise re-clamp must NOT
  // touch the popover's inline styles.
  host.style.left = `${window.innerWidth - 50}px`;
  popover.style.left = "0";
  popover.style.right = "";
  window.dispatchEvent(new Event("resize"));
  expect(popover.style.right).toBe("");
});

test("edge: 'bottom' clamps the bottom edge", () => {
  // Park the popover so the rect spills past the bottom.
  host.style.left = "10px";
  host.style.top = `${window.innerHeight - 30}px`;
  popover.style.top = "0";
  attach({ edge: "bottom" });
  expect(popover.style.top).toBe("auto");
  expect(popover.style.bottom).toBe("0px");
});
