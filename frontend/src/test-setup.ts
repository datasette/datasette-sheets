// Global test setup — runs before every test in every spec.
//
// [TESTS-10] Reset the spreadsheet selection / cell store so a test
// that forgets the four-line reset still starts from a clean slate.
// Individual spec files can layer additional ``beforeEach`` calls
// (vitest stacks them in registration order); this file owns the
// baseline that every browser test depends on.
//
// Note: this only resets the singletons that are universally used
// (``cells``, the three selection stores). Other modules with their
// own per-test state (``editingCell``, ``dropdownRules``, the
// persistence module's ``resetPersistenceStateForTests``) stay in
// each spec's ``beforeEach`` because not every test needs them and
// pulling them all in here would create circular ordering concerns.
//
// We use dynamic ``import()`` inside the hook so this file does not
// pre-resolve ``stores/spreadsheet`` (or its transitive deps) at
// setup-load time — that would defeat ``vi.mock(...)`` calls in
// individual specs that target those transitive modules.

import { beforeEach } from "vitest";

beforeEach(async () => {
  const { cells, selectedCell, selectedCells, selectionAnchor } =
    await import("./lib/stores/spreadsheet");
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
});
