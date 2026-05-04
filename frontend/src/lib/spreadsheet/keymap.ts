// Cell nav-mode keyboard shortcut registry.
//
// The actual dispatcher in ``Cell.svelte::handleCellKeydown`` was
// 186 lines of hand-rolled ``if (...) return;`` blocks where the
// binding inventory was inseparable from its precedence — see
// CELL-GRID-08. This module turns that inventory into a list:
//
//   1. ``KeyMatch`` declares which event a binding consumes
//      (``key`` + required / forbidden modifier flags).
//   2. ``KeyBinding<Ctx>`` pairs that match with an ``exec`` closure
//      that is responsible for its OWN ``preventDefault`` /
//      ``stopPropagation`` calls — different bindings have different
//      propagation needs (e.g. arrow extend doesn't stopPropagation,
//      Cmd+B does), and the original code carried that asymmetry.
//      Forcing every binding through one ``preventDefault +
//      stopPropagation`` would change behaviour.
//   3. ``dispatchKeydown`` walks the list in declaration order and
//      stops at the first ``"handled"`` result. ``"passthrough"``
//      means "I matched the event but don't want to consume it" —
//      used by the Space bindings, which split the original nested
//      Space handler into one binding for "active dropdown cell" and
//      one for "selection contains a checkbox", with the former
//      passing through when its specific guard fails.
//
// Bindings live as named factories that take a ``KeydownContext``
// (built fresh per keystroke from the component's reactive state)
// so the logic is testable without mounting Svelte.
//
// All ``[sheet.…]`` spec tags from the original handler are
// preserved on the binding objects via the ``id`` field — ``keymap``
// becomes the canonical place to find which spec tag implements
// which keystroke.

import type { CellId } from "./types";

// Modifier flags supported by ``KeyMatch``.  ``meta`` matches
// ``e.metaKey || e.ctrlKey`` (Cmd on macOS, Ctrl elsewhere) — the
// original handler always treated those as a single class.
export type ModFlag = "meta" | "shift" | "alt";

export interface KeyMatch {
  /** Exact ``e.key`` match. Compared case-insensitively to mirror
   * the original handler's tolerance for Cmd+Shift+x vs Cmd+Shift+X.
   */
  key: string;
  /** Modifiers that MUST be present. ``meta`` accepts metaKey OR ctrlKey. */
  mods?: ModFlag[];
  /** Modifiers that MUST NOT be present. */
  not?: ModFlag[];
}

export type ExecResult = "handled" | "passthrough";

export interface KeyBinding<Ctx> {
  /** Spec tag (``sheet.<area>.<slug>``) — see specs/INDEX.md. */
  id: string;
  match: KeyMatch;
  /** Run the binding. Responsible for calling ``preventDefault`` /
   * ``stopPropagation`` as appropriate — the dispatcher itself does
   * NOT touch the event. Returns ``"handled"`` to stop walking the
   * list, ``"passthrough"`` to let later bindings (or the
   * printable-key fallback) try. */
  exec: (ctx: Ctx) => ExecResult;
}

/** Pure event matcher. Exported for tests + so the dispatcher
 *  doesn't ship two grammars. */
export function matches(e: KeyboardEvent, m: KeyMatch): boolean {
  if (e.key.toLowerCase() !== m.key.toLowerCase()) return false;
  const meta = e.metaKey || e.ctrlKey;
  for (const mod of m.mods ?? []) {
    if (mod === "meta" && !meta) return false;
    if (mod === "shift" && !e.shiftKey) return false;
    if (mod === "alt" && !e.altKey) return false;
  }
  for (const mod of m.not ?? []) {
    if (mod === "meta" && meta) return false;
    if (mod === "shift" && e.shiftKey) return false;
    if (mod === "alt" && e.altKey) return false;
  }
  return true;
}

/**
 * Walk ``bindings`` in declaration order. First binding whose
 * ``match`` accepts the event is invoked; if it returns
 * ``"handled"`` the dispatcher stops. ``"passthrough"`` continues
 * the walk so the next matching binding (or, for unmatched events,
 * the caller's fallback path) can take over. Returns ``true`` iff
 * something handled the event.
 */
export function dispatchKeydown<Ctx>(
  e: KeyboardEvent,
  ctx: Ctx,
  bindings: ReadonlyArray<KeyBinding<Ctx>>,
): boolean {
  for (const b of bindings) {
    if (!matches(e, b.match)) continue;
    if (b.exec(ctx) === "handled") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cell nav-mode binding context + binding list.
// ---------------------------------------------------------------------------

/**
 * Everything a cell-nav binding needs to do its job. Built fresh
 * inside ``Cell.svelte::handleCellKeydown`` from the component's
 * current reactive state and store-bound helpers, so each binding
 * only sees an immutable snapshot of "what's the world like at the
 * moment this key was pressed".
 */
export interface CellKeydownContext {
  /** The original event — bindings own their preventDefault /
   * stopPropagation calls, and the arrow handler also reads
   * ``shiftKey`` / ``metaKey`` to choose its branch. */
  event: KeyboardEvent;
  /** The cell that received the keydown. */
  cellId: CellId;

  // --- reactive state snapshot ---
  isDropdown: boolean;
  isCheckbox: boolean;
  /** The far-edge cell of the current selection, or null. Used as
   * the navigation origin for shift-arrow extend so successive
   * extends keep walking outward from the previous extent.
   * [sheet.navigation.shift-arrow-extend] */
  selectionFarEdge: CellId | null;

  // --- predicates ---
  /** Walks ``$selectedCells`` looking for a checkbox-formatted cell.
   * O(n) per Space press today (see ticket secondary issue #2);
   * accepted for now because typical selections are tiny and the
   * walk only runs on the actual Space keystroke. */
  hasCheckboxInSelection: () => boolean;

  // --- helpers / commands ---
  /** Component-local — opens the dropdown popover anchored on the
   * current cell. Includes the spill-member guard and selection-
   * sync that the click-driven path also uses. */
  handleDropdownOpen: () => void;
  /** Component-local — drops the cell into edit mode, optionally
   * pre-filling the input with ``initialValue``. */
  startEditing: (initialValue?: string) => void;
  /** Component-local — scroll-into-view + focus a target cell.
   * Required for nav keystrokes that move focus. */
  focusCell: (id: CellId) => void;

  // store-bound helpers (from stores/spreadsheet.ts)
  navigate: (
    from: CellId,
    dir: "up" | "down" | "left" | "right",
    jumpEdge: boolean,
  ) => CellId;
  selectSingle: (id: CellId) => void;
  selectRange: (id: CellId, opts?: { keepActive?: boolean }) => void;

  // command surface (from formatCommands.ts + stores)
  toggleFormatFlag: (
    flag: "bold" | "italic" | "underline" | "strikethrough",
  ) => void;
  clearAllFormat: () => void;
  toggleCheckboxes: () => void;
  clearDropdownStep: () => void;
  flushSave: () => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
}

const ARROW_DIR: Record<string, "up" | "down" | "left" | "right" | undefined> =
  {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

/**
 * The full nav-mode binding inventory, in precedence order.
 *
 * Notes on what each binding does to the event:
 *
 *   * Format toggles, undo/redo, dropdown / checkbox Space:
 *     ``preventDefault`` + ``stopPropagation``.
 *   * Tab and the Enter/F2 edit entries: ``preventDefault`` only
 *     (no stopPropagation in the original handler — preserved).
 *   * Backspace / Delete: ``preventDefault`` only (no stop).
 *   * Arrow keys (move OR shift-extend): ``preventDefault`` only
 *     (no stop).
 *
 * If you reorder this list, you change precedence — the original
 * handler's order is preserved verbatim, including the subtle
 * dropdown-vs-checkbox-vs-printable-key chain.
 */
export const cellNavBindings: ReadonlyArray<KeyBinding<CellKeydownContext>> = [
  // [sheet.editing.f2-or-enter] [sheet.data.dropdown]
  // Enter on a dropdown cell opens the popover; F2 always drops to
  // the raw text editor (escape hatch to bypass the dropdown UI).
  {
    id: "sheet.editing.f2-or-enter",
    match: { key: "Enter" },
    exec: (ctx) => {
      ctx.event.preventDefault();
      if (ctx.isDropdown) {
        ctx.handleDropdownOpen();
        return "handled";
      }
      ctx.startEditing();
      return "handled";
    },
  },
  {
    id: "sheet.editing.f2-or-enter",
    match: { key: "F2" },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.startEditing();
      return "handled";
    },
  },

  // [sheet.undo.cmd-z] [sheet.undo.redo]
  // Cmd+Z = undo, Cmd+Shift+Z OR Cmd+Y = redo. The original handler
  // wrapped this as a single ``if (cmd && (key=z || key=y))`` block;
  // splitting it into three bindings here keeps one event = one row
  // in the inventory.
  {
    id: "sheet.undo.cmd-z",
    match: { key: "z", mods: ["meta"], not: ["shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.undo();
      return "handled";
    },
  },
  {
    id: "sheet.undo.redo",
    match: { key: "z", mods: ["meta", "shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.redo();
      return "handled";
    },
  },
  {
    id: "sheet.undo.redo",
    match: { key: "y", mods: ["meta"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.redo();
      return "handled";
    },
  },

  // [sheet.format.bold-toggle]
  {
    id: "sheet.format.bold-toggle",
    match: { key: "b", mods: ["meta"], not: ["shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.toggleFormatFlag("bold");
      return "handled";
    },
  },

  // [sheet.format.italic-toggle]
  {
    id: "sheet.format.italic-toggle",
    match: { key: "i", mods: ["meta"], not: ["shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.toggleFormatFlag("italic");
      return "handled";
    },
  },

  // [sheet.format.underline-toggle]
  {
    id: "sheet.format.underline-toggle",
    match: { key: "u", mods: ["meta"], not: ["shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.toggleFormatFlag("underline");
      return "handled";
    },
  },

  // [sheet.format.strikethrough-toggle]
  // Cmd+Shift+X. ``matches`` is case-insensitive, so this catches
  // both "x" and "X" the way the original ``e.key === "x" || ...``
  // disjunction did.
  {
    id: "sheet.format.strikethrough-toggle",
    match: { key: "x", mods: ["meta", "shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.toggleFormatFlag("strikethrough");
      return "handled";
    },
  },

  // [sheet.format.clear]
  // Cmd+\ — Google-Sheets default for "clear all formatting on the
  // selection".
  {
    id: "sheet.format.clear",
    match: { key: "\\", mods: ["meta"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.event.stopPropagation();
      ctx.clearAllFormat();
      return "handled";
    },
  },

  // [sheet.data.dropdown] Space on a dropdown cell opens the
  // popover, but ONLY when the active cell is not a checkbox AND
  // the selection doesn't contain any checkbox cells. Otherwise
  // checkbox-batch-toggle wins (next binding). If neither guard
  // matches, the binding passes through and Space ends up unbound
  // for this keystroke (matches the original nested-if behaviour).
  {
    id: "sheet.data.dropdown.space-opens",
    match: { key: " ", not: ["meta", "alt"] },
    exec: (ctx) => {
      if (ctx.isDropdown && !ctx.isCheckbox && !ctx.hasCheckboxInSelection()) {
        ctx.event.preventDefault();
        ctx.event.stopPropagation();
        ctx.handleDropdownOpen();
        return "handled";
      }
      return "passthrough";
    },
  },

  // [sheet.format.checkbox] Space toggles every checkbox cell in
  // the selection. Mixed selections only flip the checkbox-formatted
  // cells; cells with any other format aren't disturbed.
  // Single-cell focus on a non-checkbox cell falls through (Space
  // is otherwise unbound at this layer).
  {
    id: "sheet.format.checkbox.space-toggles",
    match: { key: " ", not: ["meta", "alt"] },
    exec: (ctx) => {
      if (ctx.isCheckbox || ctx.hasCheckboxInSelection()) {
        ctx.event.preventDefault();
        ctx.event.stopPropagation();
        ctx.toggleCheckboxes();
        ctx.flushSave();
        return "handled";
      }
      return "passthrough";
    },
  },

  // [sheet.delete.delete-key-clears] [sheet.data.dropdown]
  // Backspace / Delete: clear selected cells. Dropdown cells get a
  // two-step dance: first press clears the value, second press (when
  // already empty) drops the dropdown format itself so the cell
  // reverts to plain text. Per-cell — a multi-selection with both
  // filled + empty dropdown cells does both in one keystroke.
  //
  // NOTE: original handler ``preventDefault``-only, no
  // ``stopPropagation``. Preserved verbatim.
  {
    id: "sheet.delete.delete-key-clears",
    match: { key: "Backspace" },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.clearDropdownStep();
      return "handled";
    },
  },
  {
    id: "sheet.delete.delete-key-clears",
    match: { key: "Delete" },
    exec: (ctx) => {
      ctx.event.preventDefault();
      ctx.clearDropdownStep();
      return "handled";
    },
  },

  // NOTE: ``[sheet.editing.type-replaces]`` (printable-character
  // fallback → enter edit mode seeded with the typed char) lives
  // outside the registry because it matches "any character that's
  // also not consumed by a binding above". Express it with the
  // ``isPrintableEditTrigger`` predicate at the bottom of this
  // file; ``Cell.svelte``'s dispatcher calls it after
  // ``dispatchKeydown`` returns false.

  // [sheet.navigation.tab-nav-move]
  // Tab moves right, Shift+Tab moves left. ``preventDefault`` only
  // (no stopPropagation), preserving the original.
  {
    id: "sheet.navigation.tab-nav-move",
    match: { key: "Tab", not: ["shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      const targetId = ctx.navigate(ctx.cellId, "right", false);
      ctx.selectSingle(targetId);
      ctx.focusCell(targetId);
      return "handled";
    },
  },
  {
    id: "sheet.navigation.tab-nav-move",
    match: { key: "Tab", mods: ["shift"] },
    exec: (ctx) => {
      ctx.event.preventDefault();
      const targetId = ctx.navigate(ctx.cellId, "left", false);
      ctx.selectSingle(targetId);
      ctx.focusCell(targetId);
      return "handled";
    },
  },

  // [sheet.navigation.shift-arrow-extend] [sheet.navigation.shift-arrow-jump-extend]
  // Arrow / Shift+Arrow / Cmd+Arrow / Cmd+Shift+Arrow.
  //
  // The original handler computed the move direction from a single
  // map and then branched on shift/meta inside one ``if (map[key])``
  // block. Rather than expanding that into 16 bindings, we leave
  // it as one binding per direction with the shift/meta logic
  // inside ``exec`` (which already needs the event for the same
  // reason).
  ...(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const).map(
    (key) =>
      ({
        id: "sheet.navigation.shift-arrow-extend",
        match: { key },
        exec: (ctx: CellKeydownContext) => {
          ctx.event.preventDefault();
          const dir = ARROW_DIR[ctx.event.key]!;
          const meta = ctx.event.metaKey || ctx.event.ctrlKey;
          const shift = ctx.event.shiftKey;

          if (shift) {
            // Navigate from the current far edge (opposite corner from
            // the anchor), not from the active cell. Matches Google
            // Sheets: click B2, Cmd+Shift+Down extends to B6 with the
            // active cell still on B2; a second Cmd+Shift+Down keeps
            // walking from B6.
            const fromCell = ctx.selectionFarEdge ?? ctx.cellId;
            const targetId = ctx.navigate(fromCell, dir, meta);
            ctx.selectRange(targetId, { keepActive: true });
            // Don't move keyboard focus — the active cell hasn't changed.
          } else {
            const targetId = ctx.navigate(ctx.cellId, dir, meta);
            ctx.selectSingle(targetId);
            ctx.focusCell(targetId);
          }
          return "handled";
        },
      }) satisfies KeyBinding<CellKeydownContext>,
  ),
];

/**
 * Should the printable-key fallback fire for this event?
 *
 * Mirrors the original handler's
 * ``e.key.length === 1 && /^[a-zA-Z0-9=]$/.test(e.key) && !meta && !ctrl && !alt``
 * predicate verbatim — narrower than the Google-Sheets "any
 * printable char" rule, but expanding the alphabet is a deliberate
 * behaviour change deferred from this refactor (see CELL-GRID-08
 * "secondary issues" #5).
 */
export function isPrintableEditTrigger(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key.length !== 1) return false;
  // ``'`` joins the trigger set so the leading-' force-text UX
  // ([sheet.cell.force-text]) is reachable from nav mode. Without
  // this, typing ' into a selected cell does nothing — users would
  // have to F2-then-' which kills the convention's main appeal.
  return /^[a-zA-Z0-9=']$/.test(e.key);
}
