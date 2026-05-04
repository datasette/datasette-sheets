import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  editingCell,
  editValue,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import { namedRanges } from "../../stores/namedRanges";
import { setEngineNames } from "../../engine";
import type { CellId } from "../../spreadsheet/types";

// These tests exercise the named-range autocomplete popup end-to-end:
// real Rust WASM engine for ref-kind detection, real Svelte component,
// real keyboard events.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
  editValue.set("");
  namedRanges.set([]);
  setEngineNames({});
});

function defineName(name: string, definition: string) {
  namedRanges.update((list) => [
    ...list,
    { name, definition, updated_at: "2026-04-19T00:00:00" },
  ]);
}

async function startEditing(cellId: CellId) {
  cells.setCellValue(cellId, "");
  selectedCell.set(cellId);
  selectionAnchor.set(cellId);
  selectedCells.set(new Set([cellId]));
  editingCell.set(cellId);
  editValue.set("");
  render(Cell, { props: { cellId } });
  // The input mounts with focus via the use:focusOnMount action, but
  // give the event loop one tick so userEvent can find it.
  await new Promise((r) => setTimeout(r, 0));
}

function items(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".autocomplete-item"),
  );
}

test("typing a prefix that matches a defined name opens the popup", async () => {
  defineName("TaxRate", "0.05");
  defineName("Revenue", "=A1:A10");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=Tax");

  const rows = items();
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent?.trim()).toBe("TaxRate");
});

test("no popup when the prefix doesn't match any name", async () => {
  defineName("TaxRate", "0.05");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=Xyz");

  expect(items()).toHaveLength(0);
});

test("Enter commits the highlighted suggestion without leaving edit mode", async () => {
  defineName("TaxRate", "0.05");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=Tax");
  await userEvent.keyboard("{Enter}");

  // editValue holds the completed name, cell is still in edit mode.
  const state = {
    editing: document.querySelector<HTMLInputElement>(".cell-input")?.value,
  };
  expect(state.editing).toBe("=TaxRate");
});

test("Escape dismisses the popup without modifying the input", async () => {
  defineName("TaxRate", "0.05");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=Tax");
  await userEvent.keyboard("{Escape}");

  expect(items()).toHaveLength(0);
  const input = document.querySelector<HTMLInputElement>(".cell-input");
  expect(input?.value).toBe("=Tax");
});

test("Arrow keys move the highlight and Enter picks the selected row", async () => {
  // The test writes directly into the store so the match order is
  // the insertion order (the production path sorts via localeCompare
  // in upsertNamedRange; bypassing that here keeps the test
  // self-contained).
  defineName("Alpha", "1");
  defineName("Algorithm", "2");
  defineName("Beta", "3");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=Al");
  expect(items().map((e) => e.textContent?.trim())).toEqual([
    "Alpha",
    "Algorithm",
  ]);

  await userEvent.keyboard("{ArrowDown}");
  const active = items().filter((e) => e.classList.contains("active"));
  expect(active).toHaveLength(1);
  expect(active[0].textContent?.trim()).toBe("Algorithm");

  await userEvent.keyboard("{Enter}");
  const input = document.querySelector<HTMLInputElement>(".cell-input");
  expect(input?.value).toBe("=Algorithm");
});

// Regression: typing ``=sum(A:A`` popped up autocomplete on the
// trailing ``A`` (matching ``aaa`` named range, ``AVERAGE``, etc.)
// even though the grammar requires a cell ref right after ``:``,
// not a named identifier. Accepting a suggestion would have
// produced e.g. ``=sum(A:AVERAGE`` which doesn't parse. The fix
// bails out of ``getPartialAtCursor`` when the char before the
// partial is ``:``.
test("no popup after `:` — trailing half of a range ref", async () => {
  defineName("aaa", "=B1");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=sum(A:A");

  expect(items()).toHaveLength(0);
});

test("no popup in mid-range partial like `=A1:A`", async () => {
  defineName("Algorithm", "=B1");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=A1:A");

  expect(items()).toHaveLength(0);
});

// But a partial that follows something *other* than ``:`` (e.g.
// an operator) should still trigger autocomplete.
test("popup fires after `+`, not suppressed by the `:` guard", async () => {
  defineName("Algorithm", "=B1");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=1+Al");

  const rows = items();
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent?.trim()).toBe("Algorithm");
});

// Regression: the popup used to capture the input's bounding rect
// once at open-time and never update — scrolling the page (or the
// grid container) left the popup floating over an unrelated cell.
// The fix is the ``anchorTo`` action, which re-reads the anchor's
// rect on every scroll / resize / anchor-resize.
test("popup follows the input when the page scrolls", async () => {
  defineName("TaxRate", "0.05");

  await startEditing("A1" as CellId);
  await userEvent.keyboard("=Tax");

  const popup = document.querySelector<HTMLElement>(".autocomplete-popup");
  expect(popup).toBeTruthy();
  const input = document.querySelector<HTMLInputElement>(".cell-input");
  expect(input).toBeTruthy();

  const beforeTop = parseFloat(popup!.style.top);
  const beforeLeft = parseFloat(popup!.style.left);
  // The action runs an immediate measure, then a rAF re-measure to
  // pick up paint-time width — both should already have run by here.
  const inputRect = input!.getBoundingClientRect();
  expect(beforeTop).toBeCloseTo(inputRect.bottom, 0);
  expect(beforeLeft).toBeLessThanOrEqual(inputRect.left);

  // Force the input to a new screen position by translating its
  // editing wrapper. The anchor's bounding rect changes; the
  // ``ResizeObserver`` on the anchor (or the dispatched scroll
  // event below) re-runs ``reposition``.
  const wrapper = document.querySelector<HTMLElement>(".formula-edit-wrapper");
  expect(wrapper).toBeTruthy();
  wrapper!.style.transform = "translate(60px, 80px)";
  // Dispatch scroll with capture: the action subscribes via
  // ``addEventListener("scroll", …, true)`` so any element scroll
  // re-pins the popup.
  window.dispatchEvent(new Event("scroll"));

  // Two rAFs to let the action re-measure with the new rect.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  const afterRect = input!.getBoundingClientRect();
  const afterTop = parseFloat(popup!.style.top);
  const afterLeft = parseFloat(popup!.style.left);
  expect(afterTop).toBeCloseTo(afterRect.bottom, 0);
  expect(afterLeft).toBeLessThanOrEqual(afterRect.left);
  // And the values must have actually moved — not silently held the
  // initial coords.
  expect(afterTop).not.toBeCloseTo(beforeTop, 0);
});

// Regression: ``="asdf a"`` popped autocomplete on the trailing ``a``
// (AVERAGE / AND / ABS all start with A), even though the caret was
// inside a string literal and no completion was syntactically valid
// there. The fix is an ``isCursorInString`` guard in
// ``updateAutocomplete`` that short-circuits before prefix scanning.
// [sheet.editing.formula-string-coloring]
test("no popup when the cursor is inside a string literal", async () => {
  await startEditing("A1" as CellId);
  // Keyboard type the whole formula; the closing quote is auto-typed
  // so the caret ends up *inside* the string, right after ``a``.
  await userEvent.keyboard(`="asdf a"`);
  // Move the caret one left so it sits between ``a`` and ``"``.
  await userEvent.keyboard("{ArrowLeft}");
  // Type another letter inside the string to re-run updateAutocomplete.
  await userEvent.keyboard("b");

  expect(items()).toHaveLength(0);
});
