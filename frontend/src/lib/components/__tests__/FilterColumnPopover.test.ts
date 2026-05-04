/**
 * FilterColumnPopover tests — Phase C.
 *
 * Chrome-only verification (sort + filter-by-values are wired in
 * Phase D / E). Confirms the popover renders the placeholder rows,
 * Cancel + × close it, and the active-sort indicator appears when
 * the active filter has a sort on the popover's column.
 */
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import FilterColumnPopover from "../FilterColumnPopover.svelte";
import {
  filterPopover,
  sheetFilter,
  type FilterMeta,
} from "../../stores/filter";
import { createViewDialog } from "../../stores/createView";

afterEach(() => {
  filterPopover.set(null);
  sheetFilter.set(null);
  createViewDialog.set(null);
});

const SAMPLE: FilterMeta = {
  id: 1,
  min_row: 1,
  min_col: 1,
  max_row: 4,
  max_col: 3,
  sort_col_idx: null,
  sort_direction: null,
  predicates: {},
};

const RECT = {
  bottom: 100,
  top: 80,
  left: 200,
  right: 220,
  width: 20,
  height: 20,
  x: 200,
  y: 80,
  toJSON: () => ({}),
} as DOMRect;

// [sheet.filter.column-popover]
test("renders functional sort + filter-by-values UI", async () => {
  sheetFilter.set(SAMPLE);
  render(FilterColumnPopover, {
    props: { colIdx: 1, anchorRect: RECT },
  });
  // Phase E: sort buttons are enabled when a filter is set.
  const asc = page
    .getByTestId("filter-sort-asc")
    .element() as HTMLButtonElement;
  const desc = page
    .getByTestId("filter-sort-desc")
    .element() as HTMLButtonElement;
  expect(asc.disabled).toBe(false);
  expect(desc.disabled).toBe(false);
  // Phase D: filter-by-values UI is functional. The OK button is
  // enabled (no in-flight save, filter set), the search box exists,
  // and Select all / Clear shortcuts render.
  const ok = page.getByTestId("filter-ok").element() as HTMLButtonElement;
  expect(ok.disabled).toBe(false);
  expect(
    page.getByTestId("filter-values-search").element() as HTMLInputElement,
  ).toBeDefined();
  expect(
    page.getByTestId("filter-select-all").element() as HTMLButtonElement,
  ).toBeDefined();
});

// [sheet.filter.column-popover]
test("Cancel button closes the popover via filterPopover store", async () => {
  sheetFilter.set(SAMPLE);
  filterPopover.set({ colIdx: 1, anchorRect: RECT });
  render(FilterColumnPopover, {
    props: { colIdx: 1, anchorRect: RECT },
  });
  const cancel = page
    .getByTestId("filter-cancel")
    .element() as HTMLButtonElement;
  cancel.click();
  // Microtask flush before reading the store.
  await Promise.resolve();
  // ``closeFilterPopover`` clears the store.
  let snapshot: unknown = "unset";
  filterPopover.subscribe((v) => (snapshot = v))();
  expect(snapshot).toBeNull();
});

// [sheet.filter.column-popover]
test("active-sort indicator appears when filter sort matches the column", () => {
  sheetFilter.set({ ...SAMPLE, sort_col_idx: 1, sort_direction: "asc" });
  render(FilterColumnPopover, {
    props: { colIdx: 1, anchorRect: RECT },
  });
  const popover = page.getByTestId("filter-popover").element();
  expect(popover.textContent).toContain("Sorted");
  expect(popover.textContent).toContain("A → Z");
});

// [sheet.filter.column-popover]
test("active-sort indicator hidden when sort applies to a different column", () => {
  sheetFilter.set({ ...SAMPLE, sort_col_idx: 2, sort_direction: "desc" });
  render(FilterColumnPopover, {
    props: { colIdx: 1, anchorRect: RECT },
  });
  const popover = page.getByTestId("filter-popover").element();
  expect(popover.textContent).not.toContain("Sorted");
});

// [sheet.filter.create-view]
test("Create view… opens the shared dialog with the filter's range", async () => {
  // Filter rectangle B2:D5 (min_col=1 max_col=3 min_row=1 max_row=4)
  // ⇒ A1 string is "B2:D5".
  sheetFilter.set(SAMPLE);
  filterPopover.set({ colIdx: 1, anchorRect: RECT });
  render(FilterColumnPopover, {
    props: { colIdx: 1, anchorRect: RECT },
  });
  const btn = page
    .getByTestId("filter-create-view")
    .element() as HTMLButtonElement;
  expect(btn).toBeDefined();
  expect(btn.disabled).toBe(false);
  btn.click();
  await Promise.resolve();
  let dialogSnap: { range: string } | null = null;
  createViewDialog.subscribe((v) => (dialogSnap = v))();
  expect(dialogSnap).not.toBeNull();
  expect(dialogSnap!.range).toBe("B2:D5");
  // Popover dismisses so the dialog isn't competing with it.
  let popoverSnap: unknown = "unset";
  filterPopover.subscribe((v) => (popoverSnap = v))();
  expect(popoverSnap).toBeNull();
});

// [sheet.filter.column-icon] (covered indirectly: clicking opens popover)
test("clicking inside the popover does not close it", async () => {
  sheetFilter.set(SAMPLE);
  filterPopover.set({ colIdx: 1, anchorRect: RECT });
  render(FilterColumnPopover, {
    props: { colIdx: 1, anchorRect: RECT },
  });
  const popover = page.getByTestId("filter-popover").element() as HTMLElement;
  popover.click(); // body of popover, not Cancel
  await Promise.resolve();
  let snapshot: unknown = "unset";
  filterPopover.subscribe((v) => (snapshot = v))();
  expect(snapshot).not.toBeNull();
});
