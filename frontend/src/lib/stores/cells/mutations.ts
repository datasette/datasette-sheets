/**
 * Free-function mutations on the cells writable. No ``this``-bound
 * methods — every helper takes its dependencies as imports so a
 * destructured ``const { setCellValue } = cells`` can never silently
 * break a binding.
 *
 * [STORES-05] Split out of the monolithic ``createCellStore``.
 */
import type { CellData, CellFormat, CellId } from "../../spreadsheet/types";
import { createDefaultFormat } from "../../spreadsheet/formatter";
import { resetEngine, setAndRecalculate, rawInput } from "../../engine";
import { syncSqlCell } from "../../sql";
import {
  cellsWritable,
  markFormulaErrors,
  mergeComputedIntoCells,
  reloadIntoEngineAndMerge,
} from "./store";

/** Set a single cell's raw value (and trigger a delta recalc). */
export function setCellValue(cellId: CellId, rawValue: string): void {
  // [perf] Route ``=SQL(...)`` commits through the pin overlay
  // BEFORE the engine runs, so the recalc below sees the pinned
  // array. [sheet.cell.sql-array-formula]
  syncSqlCell(cellId, rawValue);

  cellsWritable.update((cells) => {
    const newCells = new Map(cells);
    const existingCell = newCells.get(cellId);
    const format = existingCell?.format ?? createDefaultFormat();

    newCells.set(cellId, {
      rawValue,
      computedValue: null,
      formula: rawValue.startsWith("=") ? rawValue : null,
      format,
      error: null,
      // Raw write clears any prior typed override on the cell —
      // matches the server's upsertCell behaviour (typed_kind goes
      // back to NULL, opting back into engine auto-classification).
      // [sheet.cell.force-text]
    });

    // [perf] Delta-recalc: reuse the long-lived WasmSheet and pass
    // just this one change. The engine's DAG propagates to
    // dependents; ``get_all`` returns the full computed state.
    // No ``new WasmSheet()`` alloc here — see ``loadIntoEngine``
    // vs ``setAndRecalculate`` in engine.ts. This is the
    // keystroke-commit hot path; cutting the alloc + the double
    // fan-out is the single biggest latency + heap win.
    try {
      const computed = setAndRecalculate([[cellId, rawInput(rawValue)]]);
      mergeComputedIntoCells(newCells, computed);
    } catch (e) {
      markFormulaErrors(newCells, e instanceof Error ? e.message : "Error");
    }

    return newCells;
  });
}

/** Set a single cell's raw value AS A LITERAL STRING — installs a
 *  typed override that bypasses the engine's auto-classification on
 *  every recalc. The frontend producer is the leading-' force-text
 *  UX in Cell.svelte; clipboard paste and any future affordances
 *  (column-type hints, "Format → Plain text" toggle) plug into the
 *  same helper. [sheet.cell.force-text] */
export function setCellValueAsString(cellId: CellId, rawValue: string): void {
  syncSqlCell(cellId, rawValue);

  cellsWritable.update((cells) => {
    const newCells = new Map(cells);
    const existingCell = newCells.get(cellId);
    const format = existingCell?.format ?? createDefaultFormat();

    newCells.set(cellId, {
      rawValue,
      computedValue: null,
      // Force-text always reads as a literal — never a formula, even
      // if it starts with ``=`` (the user can escape an ``=`` by
      // prefixing ``'`` per Excel/Sheets convention).
      formula: null,
      format,
      error: null,
      typedKind: "string",
    });

    try {
      const computed = setAndRecalculate([
        [cellId, { kind: "string", value: rawValue }],
      ]);
      mergeComputedIntoCells(newCells, computed);
    } catch (e) {
      markFormulaErrors(newCells, e instanceof Error ? e.message : "Error");
    }

    return newCells;
  });
}

/** Update multiple cells then recalculate once (for SSE batch apply).
 *
 *  Each change is ``[cellId, rawValue]`` for the legacy raw shape, or
 *  ``[cellId, rawValue, kind]`` to carry an explicit kind discriminator
 *  through. The kind is echoed from the SSE cell-update event so a
 *  remote force-text write installs the same typed override locally.
 *  [sheet.cell.force-text] */
export function setCellValueBatch(
  changes: ([CellId, string] | [CellId, string, "raw" | "string"])[],
): void {
  for (const change of changes) {
    syncSqlCell(change[0], change[1]);
  }

  cellsWritable.update((cells) => {
    const newCells = new Map(cells);
    for (const change of changes) {
      const cellId = change[0];
      const rawValue = change[1];
      const kind = change.length === 3 ? change[2] : "raw";
      const existingCell = newCells.get(cellId);
      const format = existingCell?.format ?? createDefaultFormat();
      newCells.set(cellId, {
        rawValue,
        computedValue: null,
        // Force-text always reads as a literal — never a formula.
        formula:
          kind === "string" ? null : rawValue.startsWith("=") ? rawValue : null,
        format,
        error: null,
        typedKind: kind === "string" ? "string" : undefined,
      });
    }

    // [perf] Same delta path as ``setCellValue`` — the engine
    // accepts N changes in one go and recalcs just the affected
    // subgraph.
    try {
      const computed = setAndRecalculate(
        changes.map((change) => {
          const cellId = change[0];
          const rawValue = change[1];
          const kind = change.length === 3 ? change[2] : "raw";
          return kind === "string"
            ? [cellId, { kind: "string", value: rawValue }]
            : [cellId, rawInput(rawValue)];
        }),
      );
      mergeComputedIntoCells(newCells, computed);
    } catch (e) {
      markFormulaErrors(newCells, e instanceof Error ? e.message : "Error");
    }

    return newCells;
  });
}

/** Merge a partial format into a single cell. */
export function setCellFormat(
  cellId: CellId,
  format: Partial<CellFormat>,
): void {
  cellsWritable.update((cells) => {
    const newCells = new Map(cells);
    const existingCell = newCells.get(cellId);

    if (existingCell) {
      newCells.set(cellId, {
        ...existingCell,
        format: { ...existingCell.format, ...format },
      });
    } else {
      newCells.set(cellId, {
        rawValue: "",
        computedValue: null,
        formula: null,
        format: { ...createDefaultFormat(), ...format },
        error: null,
      });
    }

    return newCells;
  });
}

/**
 * Replace a cell's format with the default, dropping every
 * previously-set attribute. Used by the SSE path when a remote
 * client clears formatting — `setCellFormat` merges, so spreading
 * the default wouldn't actually clear bool flags like `bold` that
 * the default omits.
 */
export function resetCellFormat(cellId: CellId): void {
  cellsWritable.update((cells) => {
    const existing = cells.get(cellId);
    if (!existing) return cells;
    const next = new Map(cells);
    next.set(cellId, { ...existing, format: createDefaultFormat() });
    return next;
  });
}

/**
 * Full-sheet rebuild — reloads every raw value into a fresh
 * ``WasmSheet`` via ``loadIntoEngine``. Reserved for paths where
 * the cell topology changes en masse (initial load, sheet switch,
 * undo/redo restore). The keystroke hot path uses ``setCellValue``
 * / ``setCellValueBatch`` above, which only send deltas;
 * structural row/col ops fold the recalc into their own
 * ``update`` so the diff fires once.
 */
export function recalculate(): void {
  cellsWritable.update((cells) => {
    const newCells = new Map(cells);
    reloadIntoEngineAndMerge(newCells);
    return newCells;
  });
}

/**
 * Replace the cells map and rebuild the engine in a single
 * ``update``. Used by undo/redo restore: the prior code did
 * ``cells.set(map)`` + ``cells.recalculate()`` which fired
 * ``diffAndNotify`` twice — every per-cell subscriber woke up
 * once for the bare-text restore and again for the recomputed
 * values. Folding both into one ``update`` keeps the fan-out at
 * one notification per restore.
 */
export function replaceAndRecalculate(map: Map<CellId, CellData>): void {
  cellsWritable.update(() => {
    const newCells = new Map(map);
    reloadIntoEngineAndMerge(newCells);
    return newCells;
  });
}

/**
 * [perf] Pull current engine state into the cells map without
 * re-loading every cell or rebuilding the engine. The use case
 * is host-injected pin updates (``=SQL(…)`` resolving): the
 * engine already has the new pin via ``pinValue``, but the
 * cells map is stale. Calling ``recalculate()`` here would
 * rebuild the WasmSheet + re-apply pins for nothing.
 *
 * ``setAndRecalculate([])`` re-runs the engine's recalc against
 * the existing state and returns the full computed map; we
 * merge that into the cells map immutably (per-cell refs only
 * change for cells whose computed value moved).
 */
export function refreshFromEngine(): void {
  cellsWritable.update((cells) => {
    const newCells = new Map(cells);
    try {
      const computed = setAndRecalculate([]);
      mergeComputedIntoCells(newCells, computed);
    } catch (e) {
      markFormulaErrors(newCells, e instanceof Error ? e.message : "Error");
    }
    return newCells;
  });
}

/** Drop every cell and reset the WASM engine. Used on sheet switch
 *  + tests' ``beforeEach``. */
export function clearCells(): void {
  // [perf] Engine is shared across recalcs now (see ``setCellValue``
  // comment); explicitly reset it so stale cells from a previous
  // sheet / test don't bleed through the next ``setAndRecalculate``.
  cellsWritable.set(new Map());
  resetEngine();
}
