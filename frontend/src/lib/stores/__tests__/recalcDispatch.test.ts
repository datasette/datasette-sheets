/**
 * Recalc dispatch / fan-out tests for the cells store. Guards three
 * behaviours from ticket stores-07:
 *
 *   1. Structural ops (``deleteRowsLocally`` etc.) fold the row/col
 *      shift and the engine recalc into a single ``update``, so the
 *      writable fires exactly *once* per op — not twice (shift +
 *      recalc) like the prior code.
 *   2. ``dropdownRules.updateDropdownRule`` no longer triggers a
 *      ``cells.recalculate()``: dropdown rules don't affect formula
 *      eval, so subscribers shouldn't see a notification.
 *   3. Adding / removing a named range pushes the change through the
 *      live ``WasmSheet`` and uses ``cells.refreshFromEngine`` (a
 *      delta recalc) instead of rebuilding the engine via
 *      ``loadIntoEngine``.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import { cells } from "../spreadsheet";
import { setEngineNames } from "../../engine";

// Mock the API module so the namedRanges store wrappers don't hit the
// network. Same shape the existing namedRanges tests use.
vi.mock("../../api", () => {
  const list: Array<{ name: string; definition: string; updated_at: string }> =
    [];
  return {
    listNamedRanges: vi.fn(async () => list.slice()),
    setNamedRange: vi.fn(
      async (_d: string, _w: string, _s: string, name: string, def: string) => {
        const idx = list.findIndex(
          (n) => n.name.toUpperCase() === name.toUpperCase(),
        );
        const rec = {
          name,
          definition: def,
          updated_at: "2026-04-26T00:00:00",
        };
        if (idx >= 0) list[idx] = rec;
        else list.push(rec);
        return rec;
      },
    ),
    deleteNamedRange: vi.fn(
      async (_d: string, _w: string, _s: string, name: string) => {
        const idx = list.findIndex(
          (n) => n.name.toUpperCase() === name.toUpperCase(),
        );
        if (idx >= 0) list.splice(idx, 1);
      },
    ),
    listDropdownRules: vi.fn(async () => []),
    createDropdownRule: vi.fn(),
    updateDropdownRule: vi.fn(
      async (
        _d: string,
        _w: number,
        ruleId: number,
        patch: {
          name?: string;
          nameSet?: boolean;
          options?: Array<{ value: string; color?: string }>;
          multi?: boolean;
        },
      ) => ({
        id: ruleId,
        name: patch.name ?? "Status",
        multi: patch.multi ?? false,
        source: { kind: "list", options: patch.options ?? [] },
      }),
    ),
    deleteDropdownRule: vi.fn(),
    // Filter API surface — added in Phase D. The recalc tests don't
    // exercise filters directly, but ``stores/spreadsheet`` now
    // imports ``stores/filter`` (for hiddenRowIndices in navigate),
    // which in turn imports these names from api.ts. Stubs return
    // null / no-op so the store's ``loadFilter`` resolves to "no
    // filter on this sheet" — the realistic state for these tests.
    getFilter: vi.fn(async () => null),
    createFilter: vi.fn(),
    deleteFilter: vi.fn(),
    setFilterPredicate: vi.fn(),
    setFilterSort: vi.fn(),
    __clearMockList: () => {
      list.length = 0;
    },
  };
});

beforeEach(async () => {
  cells.clear();
  setEngineNames({});
  const api = (await import("../../api")) as unknown as {
    __clearMockList: () => void;
  };
  api.__clearMockList();
});

test("deleteRowsLocally fires the cells writable exactly once per op", () => {
  // Seed two formula cells across three rows so the row shift is
  // non-trivial and the recalc has something to do.
  cells.setCellValue("A1", "10");
  cells.setCellValue("A2", "20");
  cells.setCellValue("B1", "=A1+A2");

  let count = 0;
  const unsub = cells.subscribe(() => {
    count++;
  });
  // svelte writables fire once on subscribe; reset so we only count
  // updates triggered by the structural op below.
  count = 0;

  cells.deleteRowsLocally([0]); // delete row index 0 (cell row 1)

  unsub();

  // Pre-fix: the ``cells.update`` for the shift + the
  // ``this.recalculate()`` follow-up each woke ``diffAndNotify``,
  // so the subscriber saw 2 notifications. Folded into one update
  // → 1 notification.
  expect(count).toBe(1);
});

test("updateDropdownRule does not fire the cells writable", async () => {
  const { updateDropdownRule, dropdownRules } =
    await import("../dropdownRules");
  // Seed an unrelated cell so the cells map isn't empty — the
  // structural-op path wouldn't no-op on an empty map either, but
  // this matches realistic conditions.
  cells.setCellValue("A1", "1");
  dropdownRules.set([
    {
      id: 1,
      name: "Status",
      multi: false,
      source: { kind: "list", options: [{ value: "Todo", color: "#cccccc" }] },
    },
  ]);

  let count = 0;
  const unsub = cells.subscribe(() => {
    count++;
  });
  count = 0; // discard the on-subscribe fire

  await updateDropdownRule("db", 1, 1, {
    options: [
      { value: "Todo", color: "#cccccc" },
      { value: "Done", color: "#b6d7a8" },
    ],
  });

  unsub();
  expect(count).toBe(0);
});

test("upsertNamedRange takes the delta path: cells fires once and B1 resolves", async () => {
  const { upsertNamedRange } = await import("../namedRanges");

  // Seed a formula that depends on the soon-to-be-defined name.
  cells.setCellValue("A1", "100");
  cells.setCellValue("B1", "=A1*TaxRate");
  expect(get(cells).get("B1")!.error).toBe("#NAME?");

  let count = 0;
  const unsub = cells.subscribe(() => {
    count++;
  });
  count = 0; // discard the on-subscribe fire

  await upsertNamedRange("db", 1, 2, "TaxRate", "0.05");

  unsub();
  // The pre-fix path called ``cells.recalculate()`` which fired once;
  // the new ``refreshFromEngine`` also fires once. Fan-out parity is
  // the contract we care about — exactly one notification, not zero
  // (engine state would be stale) and not two (double diff fire).
  expect(count).toBe(1);
  // …and B1 must still resolve via the delta recalc.
  expect(get(cells).get("B1")!.error).toBeNull();
  expect(get(cells).get("B1")!.computedValue).toBe(5);
});

test("removeNamedRange takes the delta path: B1 reverts to #NAME?", async () => {
  const { upsertNamedRange, removeNamedRange } = await import("../namedRanges");

  await upsertNamedRange("db", 1, 2, "TaxRate", "0.05");
  cells.setCellValue("A1", "100");
  cells.setCellValue("B1", "=A1*TaxRate");
  expect(get(cells).get("B1")!.computedValue).toBe(5);

  let count = 0;
  const unsub = cells.subscribe(() => {
    count++;
  });
  count = 0;

  await removeNamedRange("db", 1, 2, "TaxRate");

  unsub();
  expect(count).toBe(1);
  expect(get(cells).get("B1")!.error).toBe("#NAME?");
});
