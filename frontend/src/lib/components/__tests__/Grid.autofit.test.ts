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

// Integration test for the auto-fit-on-double-click gesture, focused
// on the bug fixed in CELL-GRID-06: a bold cell genuinely demands
// more horizontal space, so auto-fit should produce a wider column
// when the contents are bolded than when they aren't. The pre-fix
// implementation used a hardcoded `13px Courier New` and ignored
// `cell.format`, so both runs returned the same width.
// [sheet.column.auto-fit-double-click]

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  // Reset column A back to its default width so no test bleeds.
  setColumnWidth("A", 100);
});

async function flushFrames() {
  // Two rAFs + ticks instead of a 50 ms sleep — deterministic across
  // CI variance. See the matching helper in
  // ``Grid.virtualization.test.ts`` for the full reasoning.
  await Promise.resolve();
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await tick();
}

function getResizeHandle(col: string): HTMLElement {
  // The column header for ``col`` carries a `.resize-handle` div on
  // its right edge. Test ids aren't applied to the headers, so query
  // by index — column A is the first header.
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

function dblclick(el: HTMLElement) {
  el.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
}

test("double-click resize handle changes column width", async () => {
  cells.setCellValue(
    "A1",
    "this is a long enough string to force the column wider",
  );
  render(Grid, { props: {} });
  await flushFrames();

  const before = get(columnWidths)["A"];
  expect(before).toBe(100);

  dblclick(getResizeHandle("A"));
  await tick();

  const after = get(columnWidths)["A"];
  expect(after).not.toBe(before);
  expect(after).toBeGreaterThan(before);
});

test("double-click on an empty column floors at the minimum (40)", async () => {
  // No cells set — every row is empty, so the column should fit just
  // its header label. Header width for "A" + padding is below the
  // 40 px floor, so the result should clamp to 40.
  setColumnWidth("A", 250); // start wide so the auto-fit clearly shrinks it
  render(Grid, { props: {} });
  await flushFrames();

  dblclick(getResizeHandle("A"));
  await tick();

  expect(get(columnWidths)["A"]).toBe(40);
});

test("larger fontSize auto-fits to a wider column", async () => {
  // Same string twice; the only difference is `fontSize`. The pre-fix
  // measurement code used a hardcoded `13px` and ignored the format,
  // so both runs would have produced the same width. With the fix the
  // 24pt-ish (32px) cell measures roughly 2.5× wider.
  //
  // (We use fontSize rather than `bold` here on purpose: headless
  // chromium frequently has no `Courier New` bold variant installed,
  // so the canvas falls back to the regular weight and bold metrics
  // collapse to the plain measurement. Pixel-size differences are
  // immune to that — they always change the canvas measureText output.)
  const text = "FONT SIZE MEASUREMENT TARGET";

  // Run 1 — plain.
  cells.setCellValue("A1", text);
  const { unmount: unmountPlain } = render(Grid, { props: {} });
  await flushFrames();
  dblclick(getResizeHandle("A"));
  await tick();
  const widthPlain = get(columnWidths)["A"]!;
  unmountPlain();

  // Reset and run 2 — 24pt.
  cells.clear();
  setColumnWidth("A", 100);
  cells.setCellValue("A1", text);
  cells.update((map) => {
    const c = map.get("A1");
    if (c) {
      const next = new Map(map);
      next.set("A1", { ...c, format: { ...c.format, fontSize: 24 } });
      return next;
    }
    return map;
  });
  render(Grid, { props: {} });
  await flushFrames();
  dblclick(getResizeHandle("A"));
  await tick();
  const widthBig = get(columnWidths)["A"]!;

  expect(widthBig).toBeGreaterThan(widthPlain);
});
