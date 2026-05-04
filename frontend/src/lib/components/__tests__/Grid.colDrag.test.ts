/**
 * [sheet.column.drag-reorder] Drag-reorder gesture coverage.
 *
 * Focuses on the gesture's visual state machine:
 *   - Below the 4px threshold the drag is a no-op (existing
 *     column-select still works).
 *   - At/past the threshold the drop indicator mounts, the source
 *     column header gets the .dragging class, and the body cursor
 *     flips to ``grabbing``.
 *   - Mouseup tears the visual state down regardless of where the
 *     pointer landed.
 *   - Modifier-key gestures (shift/cmd-click) suppress the drag arm
 *     so multi-column selection still works.
 *
 * The end-to-end persistence + SSE round-trip lives in
 * e2e/col-move.spec.ts (att um1r4ehw); persistence.moveCols would
 * try to hit the live API and isn't useful to mock here.
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { tick } from "svelte";
import { get } from "svelte/store";
import { render } from "vitest-browser-svelte";
import Grid from "../Grid.svelte";
import {
  cells,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import { headerSelection, selectedCols } from "../../stores/headerSelection";

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  headerSelection.clear("col");
  headerSelection.clear("row");
  document.body.style.cursor = "";
});

afterEach(() => {
  document.body.style.cursor = "";
});

async function flushFrames() {
  await Promise.resolve();
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
}

function getColumnHeader(col: string): HTMLElement {
  const headers = document.querySelectorAll<HTMLElement>(".column-header");
  for (const header of headers) {
    const label = header.querySelector(".column-label");
    if (label?.textContent?.trim() === col) return header;
  }
  throw new Error(`No column header for ${col}`);
}

function fireMouse(
  target: EventTarget,
  type: "mousedown" | "mousemove" | "mouseup",
  init: MouseEventInit,
): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}

test("below the 4px threshold the drag stays disarmed", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const headerD = getColumnHeader("D");
  const rect = headerD.getBoundingClientRect();
  fireMouse(headerD, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  // 2px move — under the 4px threshold. armed should stay false →
  // no .col-drop-indicator, no .dragging class.
  fireMouse(window, "mousemove", {
    clientX: rect.left + 7,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  expect(document.querySelector(".col-drop-indicator")).toBeNull();
  expect(headerD.classList.contains("dragging")).toBe(false);
  expect(document.body.style.cursor).not.toBe("grabbing");

  // Mouseup tears down state cleanly.
  fireMouse(window, "mouseup", {
    clientX: rect.left + 7,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();
});

test("crossing the threshold mounts the indicator + fades source col", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const headerD = getColumnHeader("D");
  const rect = headerD.getBoundingClientRect();

  fireMouse(headerD, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  // 50px to the left — well past the threshold and into B/C territory.
  fireMouse(window, "mousemove", {
    clientX: rect.left - 50,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  expect(document.querySelector(".col-drop-indicator")).not.toBeNull();
  expect(headerD.classList.contains("dragging")).toBe(true);
  expect(document.body.style.cursor).toBe("grabbing");

  // Mouseup outside any commitable gap (back to source) clears state.
  // The persistence call may reject (no backend); the test catches
  // the unhandled rejection from window.alert and verifies the visual
  // teardown still ran.
  const origAlert = window.alert;
  window.alert = () => {};
  try {
    fireMouse(window, "mouseup", {
      clientX: rect.left + 5, // back near the source col
      clientY: rect.top + 10,
      button: 0,
    });
    await flushFrames();
  } finally {
    window.alert = origAlert;
  }

  expect(document.querySelector(".col-drop-indicator")).toBeNull();
  expect(headerD.classList.contains("dragging")).toBe(false);
  expect(document.body.style.cursor).not.toBe("grabbing");
});

test("shift-mousedown does not arm the reorder drag", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const headerD = getColumnHeader("D");
  const rect = headerD.getBoundingClientRect();

  fireMouse(headerD, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
    shiftKey: true,
  });
  await tick();

  // Even a big move shouldn't arm the reorder drag — shift-click is
  // a select-extension gesture, not a drag.
  fireMouse(window, "mousemove", {
    clientX: rect.left - 100,
    clientY: rect.top + 10,
    button: 0,
    shiftKey: true,
  });
  await tick();

  expect(document.querySelector(".col-drop-indicator")).toBeNull();
  expect(headerD.classList.contains("dragging")).toBe(false);

  fireMouse(window, "mouseup", {
    clientX: rect.left - 100,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();
});

test("right-click never arms the drag (button !== 0)", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const headerD = getColumnHeader("D");
  const rect = headerD.getBoundingClientRect();

  fireMouse(headerD, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 2,
  });
  await tick();

  // No window listeners were attached — a subsequent mousemove
  // should be inert.
  fireMouse(window, "mousemove", {
    clientX: rect.left - 100,
    clientY: rect.top + 10,
    button: 2,
  });
  await tick();

  expect(document.querySelector(".col-drop-indicator")).toBeNull();
  expect(headerD.classList.contains("dragging")).toBe(false);
});

// ───── Multi-column drag (att ortkjljr) ───────────────────────────

test("mousedown inside a contiguous multi-col selection drags the whole block", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Pre-select B:D (idx 1..3) by simulating shift-click on the
  // headerSelection store. (Click+shift-click via fireMouse would
  // tangle with the drag flow we're testing.)
  headerSelection.setAxis("col", {
    selected: new Set([1, 2, 3]),
    anchor: 1,
    farEdge: 3,
  });
  await tick();

  const headerC = getColumnHeader("C"); // idx 2 — middle of B:D
  const headerB = getColumnHeader("B");
  const headerD = getColumnHeader("D");
  const rect = headerC.getBoundingClientRect();

  fireMouse(headerC, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  // Cross the threshold so the drag arms.
  fireMouse(window, "mousemove", {
    clientX: rect.left - 50,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  // All three source headers fade — drag block is B:D, not just C.
  expect(headerB.classList.contains("dragging")).toBe(true);
  expect(headerC.classList.contains("dragging")).toBe(true);
  expect(headerD.classList.contains("dragging")).toBe(true);

  // Selection survived (no startDrag-collapse to single col).
  expect([...get(selectedCols)].sort()).toEqual([1, 2, 3]);

  // Tear down without committing (release back near source).
  const origAlert = window.alert;
  window.alert = () => {};
  try {
    fireMouse(window, "mouseup", {
      clientX: rect.left + 5,
      clientY: rect.top + 10,
      button: 0,
    });
    await flushFrames();
  } finally {
    window.alert = origAlert;
  }
});

test("mousedown outside the selection falls back to single-col drag", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Pre-select B:D, but click E (idx 4 — outside the selection).
  headerSelection.setAxis("col", {
    selected: new Set([1, 2, 3]),
    anchor: 1,
    farEdge: 3,
  });
  await tick();

  const headerB = getColumnHeader("B");
  const headerE = getColumnHeader("E");
  const rect = headerE.getBoundingClientRect();

  fireMouse(headerE, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();
  fireMouse(window, "mousemove", {
    clientX: rect.left - 50,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  // Only E (the clicked col) gets the dragging class — single-col mode.
  expect(headerE.classList.contains("dragging")).toBe(true);
  expect(headerB.classList.contains("dragging")).toBe(false);

  fireMouse(window, "mouseup", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();
});

test("mousedown on a non-contiguous selection falls back to single-col drag", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Non-contiguous: B and D selected, but not C.
  headerSelection.setAxis("col", {
    selected: new Set([1, 3]),
    anchor: 1,
    farEdge: 3,
  });
  await tick();

  const headerB = getColumnHeader("B");
  const headerD = getColumnHeader("D");
  const rect = headerB.getBoundingClientRect();

  fireMouse(headerB, "mousedown", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();
  fireMouse(window, "mousemove", {
    clientX: rect.left + 50,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();

  // Single-col fallback: only B gets the dragging class.
  expect(headerB.classList.contains("dragging")).toBe(true);
  expect(headerD.classList.contains("dragging")).toBe(false);

  fireMouse(window, "mouseup", {
    clientX: rect.left + 5,
    clientY: rect.top + 10,
    button: 0,
  });
  await tick();
});
