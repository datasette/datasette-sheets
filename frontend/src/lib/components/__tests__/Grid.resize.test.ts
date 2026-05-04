import { beforeEach, expect, test } from "vitest";
import { tick } from "svelte";
import { get } from "svelte/store";
import { render } from "vitest-browser-svelte";
import Grid from "../Grid.svelte";
import {
  cells,
  columnWidths,
  selectedCell,
  selectedCells,
  selectionAnchor,
  setColumnWidth,
} from "../../stores/spreadsheet";

// [tests-12] Mouse-drag resize for a column header. Auto-fit on
// double-click is covered in Grid.autofit.test.ts; this file pins
// down the click-and-drag path which previously only had e2e
// coverage. The resize-end teardown (mouseup → cursor reset, listener
// removal) is the bit most likely to leak — exercise it here.
// [sheet.column.resize-drag]

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  // Reset every tested column to a known starting width so widths
  // don't bleed across tests.
  for (const col of ["A", "B", "C"]) setColumnWidth(col, 100);
});

async function flushFrames() {
  await Promise.resolve();
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
}

function getResizeHandle(col: string): HTMLElement {
  const headers = document.querySelectorAll<HTMLElement>(".column-header");
  for (const header of headers) {
    const label = header.querySelector(".column-label");
    if (label?.textContent?.trim() === col) {
      const handle = header.querySelector<HTMLElement>(".resize-handle");
      if (!handle) throw new Error(`No .resize-handle in column ${col}`);
      return handle;
    }
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

test("dragging the resize handle by +50px sets columnWidths[B] to original + 50", async () => {
  render(Grid, { props: {} });
  await flushFrames();

  const handle = getResizeHandle("B");
  const startWidth = get(columnWidths)["B"];
  expect(startWidth).toBe(100);

  // mousedown on the handle records start state and binds window
  // mousemove / mouseup listeners.
  fireMouse(handle, "mousedown", { clientX: 200, button: 0 });
  await tick();

  // mousemove dispatched on the window — the listener was attached
  // there in handleResizeStart.
  fireMouse(window, "mousemove", { clientX: 250, button: 0 });
  await tick();

  expect(get(columnWidths)["B"]).toBe(startWidth + 50);

  // mouseup tears the listener down and clears the cursor override.
  fireMouse(window, "mouseup", { clientX: 250, button: 0 });
  await tick();

  // After mouseup, further mousemoves should NOT keep changing width.
  fireMouse(window, "mousemove", { clientX: 400, button: 0 });
  await tick();
  expect(get(columnWidths)["B"]).toBe(startWidth + 50);
  // body cursor override is cleared on mouseup.
  expect(document.body.style.cursor).toBe("");
});

test("dragging negative delta shrinks the column", async () => {
  setColumnWidth("C", 200);
  render(Grid, { props: {} });
  await flushFrames();

  const handle = getResizeHandle("C");
  fireMouse(handle, "mousedown", { clientX: 300, button: 0 });
  fireMouse(window, "mousemove", { clientX: 240, button: 0 });
  await tick();

  expect(get(columnWidths)["C"]).toBe(140);

  fireMouse(window, "mouseup", { clientX: 240, button: 0 });
});

test("the resize subscription updates the columnWidths store (the same store enableAutoSave watches for _columnWidthsDirty)", async () => {
  // The actual ``_columnWidthsDirty`` flag is a private field on the
  // persistence module — flipped by the ``columnWidths.subscribe``
  // installed in ``enableAutoSave``. Asserting the store updates is
  // the publicly observable wire: if this update fires, the dirty
  // flag is guaranteed to flip on the next save flush.
  render(Grid, { props: {} });
  await flushFrames();

  let updates = 0;
  const unsub = columnWidths.subscribe(() => {
    updates++;
  });
  // Reset the initial-emit count so we only count *changes*.
  const baseline = updates;

  const handle = getResizeHandle("A");
  fireMouse(handle, "mousedown", { clientX: 100, button: 0 });
  fireMouse(window, "mousemove", { clientX: 130, button: 0 });
  await tick();
  fireMouse(window, "mouseup", { clientX: 130, button: 0 });

  expect(updates).toBeGreaterThan(baseline);
  expect(get(columnWidths)["A"]).toBe(130);
  unsub();
});
