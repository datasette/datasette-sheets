/**
 * Unit tests for the named-range engine bridge.
 *
 * Exercises two things without touching the Datasette backend:
 *
 *   1. ``setEngineName`` / ``removeEngineName`` — applying a name to
 *      the in-memory WASM engine makes formulas that reference it
 *      resolve, and removing it returns ``#NAME?`` to dependents.
 *   2. The store helpers in ``namedRanges.ts`` that wrap the API —
 *      verified with a mocked API module so we don't need a server.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import { cells } from "../spreadsheet";
import { setEngineName, removeEngineName, setEngineNames } from "../../engine";

// Mock the API module so the store tests below don't hit the network.
// Every wrapper returns a synthetic record so we can drive upsert /
// remove against the real store wiring (engine + cells.recalculate).
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
          updated_at: "2026-04-19T00:00:00",
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
    // Filter API surface — added in Phase D. ``stores/spreadsheet``
    // imports ``stores/filter`` (for hiddenRowIndices in navigate)
    // which imports these names. Stubs are no-ops here.
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
  // Clear the in-memory list behind the mocked API.
  const api = (await import("../../api")) as unknown as {
    __clearMockList: () => void;
  };
  api.__clearMockList();
});

test("setEngineName makes a name-referencing formula resolve", () => {
  cells.setCellValue("A1", "100");
  cells.setCellValue("B1", "=A1*TaxRate");
  // Without the name, B1 can't evaluate.
  const before = get(cells).get("B1")!;
  expect(before.error).toBe("#NAME?");

  setEngineName("TaxRate", "0.05");
  cells.recalculate();

  const after = get(cells).get("B1")!;
  expect(after.error).toBeNull();
  expect(after.computedValue).toBe(5);
});

test("removeEngineName returns #NAME? to dependents on the next recalc", () => {
  setEngineName("TaxRate", "0.05");
  cells.setCellValue("A1", "100");
  cells.setCellValue("B1", "=A1*TaxRate");
  expect(get(cells).get("B1")!.computedValue).toBe(5);

  removeEngineName("TaxRate");
  cells.recalculate();

  const after = get(cells).get("B1")!;
  expect(after.error).toBe("#NAME?");
});

test("setEngineNames replaces the whole map — names not in the new map are dropped", () => {
  setEngineName("Alpha", "1");
  setEngineName("Beta", "2");
  cells.setCellValue("A1", "=Alpha+Beta");
  cells.recalculate();
  expect(get(cells).get("A1")!.computedValue).toBe(3);

  // New load: only Alpha survives.
  setEngineNames({ Alpha: "10" });
  cells.recalculate();
  expect(get(cells).get("A1")!.error).toBe("#NAME?");
});

test("upsertNamedRange stores uppercase in the map and refreshes dependents", async () => {
  const { upsertNamedRange, namedRanges } = await import("../namedRanges");

  cells.setCellValue("A1", "100");
  cells.setCellValue("B1", "=A1*taxrate");
  expect(get(cells).get("B1")!.error).toBe("#NAME?");

  await upsertNamedRange("db", "wb", "sheet", "TaxRate", "0.05");

  // Store holds the new entry…
  const list = get(namedRanges);
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe("TaxRate");
  // …and the formula (using lowercase `taxrate`) resolves.
  expect(get(cells).get("B1")!.computedValue).toBe(5);
});

test("removeNamedRange drops the row and recomputes dependents", async () => {
  const { upsertNamedRange, removeNamedRange, namedRanges } =
    await import("../namedRanges");

  await upsertNamedRange("db", "wb", "sheet", "TaxRate", "0.05");
  cells.setCellValue("A1", "100");
  cells.setCellValue("B1", "=A1*TaxRate");
  expect(get(cells).get("B1")!.computedValue).toBe(5);

  await removeNamedRange("db", "wb", "sheet", "TaxRate");

  expect(get(namedRanges)).toHaveLength(0);
  expect(get(cells).get("B1")!.error).toBe("#NAME?");
});

test("loadNamedRanges pushes the server list into the engine", async () => {
  // Seed the mock's in-memory list by upserting, then simulate a fresh
  // sheet load via loadNamedRanges.
  const api = await import("../../api");
  await (
    api.setNamedRange as unknown as (
      d: string,
      w: string,
      s: string,
      n: string,
      def: string,
    ) => Promise<void>
  )("db", "wb", "sheet", "Revenue", "=A1:A3");

  // Reset engine state so the load actually has to do work.
  setEngineNames({});
  cells.setCellValue("A1", "10");
  cells.setCellValue("A2", "20");
  cells.setCellValue("A3", "30");
  cells.setCellValue("B1", "=SUM(Revenue)");
  cells.recalculate();
  expect(get(cells).get("B1")!.error).toBe("#NAME?");

  const { loadNamedRanges } = await import("../namedRanges");
  await loadNamedRanges("db", "wb", "sheet");

  expect(get(cells).get("B1")!.computedValue).toBe(60);
});
