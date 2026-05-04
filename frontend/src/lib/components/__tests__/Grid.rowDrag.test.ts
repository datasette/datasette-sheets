/**
 * [sheet.row.drag-reorder] Drag-reorder gesture coverage on the
 * row axis. Mirror of Grid.colDrag.test.ts.
 *
 * Focuses on the gesture's visual state machine (drop-indicator
 * mount, source-row .dragging class, body cursor). The end-to-end
 * persistence + SSE round-trip lives in e2e/row-move.spec.ts.
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
import { headerSelection, selectedRows } from "../../stores/headerSelection";

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

/** Get the row header for a 1-based display row (matches Grid's
 *  template). e.g. getRowHeader(3) returns the header showing "3". */
function getRowHeader(displayRow: number): HTMLElement {
  const headers = document.querySelectorAll<HTMLElement>(".row-header");
  for (const header of headers) {
    if (header.textContent?.trim() === String(displayRow)) return header;
  }
  throw new Error(`No row header for display row ${displayRow}`);
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

  const header = getRowHeader(4);
  const rect = header.getBoundingClientRect();
  fireMouse(header, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();

  // 2px move — under threshold.
  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 7,
    button: 0,
  });
  await tick();

  expect(document.querySelector(".row-drop-indicator")).toBeNull();
  expect(header.classList.contains("dragging")).toBe(false);
  expect(document.body.style.cursor).not.toBe("grabbing");

  fireMouse(window, "mouseup", {
    clientX: rect.left + 10,
    clientY: rect.top + 7,
    button: 0,
  });
  await tick();
});

test("crossing the threshold mounts the indicator + fades source row", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const header = getRowHeader(4);
  const rect = header.getBoundingClientRect();

  fireMouse(header, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();

  // 50px down — past the threshold and into a different row.
  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 50,
    button: 0,
  });
  await tick();

  expect(document.querySelector(".row-drop-indicator")).not.toBeNull();
  expect(header.classList.contains("dragging")).toBe(true);
  expect(document.body.style.cursor).toBe("grabbing");

  // Mouseup back near source — visual state tears down regardless
  // of whether the move commits (server may reject; alert may fire).
  const origAlert = window.alert;
  window.alert = () => {};
  try {
    fireMouse(window, "mouseup", {
      clientX: rect.left + 10,
      clientY: rect.top + 5,
      button: 0,
    });
    await flushFrames();
  } finally {
    window.alert = origAlert;
  }

  expect(document.querySelector(".row-drop-indicator")).toBeNull();
  expect(header.classList.contains("dragging")).toBe(false);
  expect(document.body.style.cursor).not.toBe("grabbing");
});

test("shift-mousedown does not arm the reorder drag", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const header = getRowHeader(4);
  const rect = header.getBoundingClientRect();

  fireMouse(header, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
    shiftKey: true,
  });
  await tick();
  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 100,
    button: 0,
    shiftKey: true,
  });
  await tick();

  expect(document.querySelector(".row-drop-indicator")).toBeNull();
  expect(header.classList.contains("dragging")).toBe(false);

  fireMouse(window, "mouseup", {
    clientX: rect.left + 10,
    clientY: rect.top + 100,
    button: 0,
  });
  await tick();
});

test("right-click never arms the drag (button !== 0)", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const header = getRowHeader(4);
  const rect = header.getBoundingClientRect();

  fireMouse(header, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 2,
  });
  await tick();

  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 100,
    button: 2,
  });
  await tick();

  expect(document.querySelector(".row-drop-indicator")).toBeNull();
  expect(header.classList.contains("dragging")).toBe(false);
});

// ───── Multi-row drag ──────────────────────────────────────────

test("mousedown inside a contiguous multi-row selection drags the whole block", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  // Pre-select rows 2..4 (1-based) via the headerSelection store.
  headerSelection.setAxis("row", {
    selected: new Set([2, 3, 4]),
    anchor: 2,
    farEdge: 4,
  });
  await tick();

  const header3 = getRowHeader(3); // middle of the selection
  const header2 = getRowHeader(2);
  const header4 = getRowHeader(4);
  const rect = header3.getBoundingClientRect();

  fireMouse(header3, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();
  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 50,
    button: 0,
  });
  await tick();

  // All three source headers fade — drag block is rows 2..4.
  expect(header2.classList.contains("dragging")).toBe(true);
  expect(header3.classList.contains("dragging")).toBe(true);
  expect(header4.classList.contains("dragging")).toBe(true);

  // Selection survived (no startDrag-collapse to single row).
  expect([...get(selectedRows)].sort((a, b) => a - b)).toEqual([2, 3, 4]);

  const origAlert = window.alert;
  window.alert = () => {};
  try {
    fireMouse(window, "mouseup", {
      clientX: rect.left + 10,
      clientY: rect.top + 5,
      button: 0,
    });
    await flushFrames();
  } finally {
    window.alert = origAlert;
  }
});

test("mousedown outside the selection falls back to single-row drag", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  headerSelection.setAxis("row", {
    selected: new Set([2, 3, 4]),
    anchor: 2,
    farEdge: 4,
  });
  await tick();

  const header2 = getRowHeader(2);
  const header6 = getRowHeader(6);
  const rect = header6.getBoundingClientRect();

  fireMouse(header6, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();
  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 50,
    button: 0,
  });
  await tick();

  expect(header6.classList.contains("dragging")).toBe(true);
  expect(header2.classList.contains("dragging")).toBe(false);

  fireMouse(window, "mouseup", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();
});

test("mousedown on a non-contiguous selection falls back to single-row drag", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  headerSelection.setAxis("row", {
    selected: new Set([2, 4]),
    anchor: 2,
    farEdge: 4,
  });
  await tick();

  const header2 = getRowHeader(2);
  const header4 = getRowHeader(4);
  const rect = header2.getBoundingClientRect();

  fireMouse(header2, "mousedown", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();
  fireMouse(window, "mousemove", {
    clientX: rect.left + 10,
    clientY: rect.top + 50,
    button: 0,
  });
  await tick();

  expect(header2.classList.contains("dragging")).toBe(true);
  expect(header4.classList.contains("dragging")).toBe(false);

  fireMouse(window, "mouseup", {
    clientX: rect.left + 10,
    clientY: rect.top + 5,
    button: 0,
  });
  await tick();
});
