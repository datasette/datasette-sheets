// Pure unit tests for ``lib/spreadsheet/keymap.ts`` — the
// ``matches`` predicate, ``dispatchKeydown`` walk order, and a sanity
// pass over every ``cellNavBindings`` entry. [CELL-GRID-08]
//
// No Svelte mount and no real ``KeyboardEvent``: we synthesise plain
// objects with the four fields ``matches`` reads (``key``,
// ``metaKey``, ``ctrlKey``, ``shiftKey``, ``altKey``). Component-level
// "Cmd+B sets bold on A1" coverage lives in ``Cell.keyboard.test.ts``.

import { describe, expect, test } from "vitest";
import {
  cellNavBindings,
  dispatchKeydown,
  isPrintableEditTrigger,
  matches,
  type CellKeydownContext,
  type KeyBinding,
} from "../keymap";

interface FakeKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function evt(init: FakeKey): KeyboardEvent {
  // Minimal stub — ``matches`` only reads these five fields.
  // ``preventDefault`` / ``stopPropagation`` are tracked here for
  // tests that exercise full ``exec`` paths against real bindings.
  let prevented = false;
  let stopped = false;
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    get defaultPrevented() {
      return prevented;
    },
    get propagationStopped() {
      return stopped;
    },
  } as unknown as KeyboardEvent;
}

describe("matches", () => {
  test("plain key matches case-insensitively", () => {
    expect(matches(evt({ key: "a" }), { key: "a" })).toBe(true);
    expect(matches(evt({ key: "A" }), { key: "a" })).toBe(true);
    expect(matches(evt({ key: "A" }), { key: "A" })).toBe(true);
  });

  test("required modifiers are AND-ed", () => {
    expect(
      matches(evt({ key: "x", metaKey: true, shiftKey: true }), {
        key: "x",
        mods: ["meta", "shift"],
      }),
    ).toBe(true);
    // Missing shift fails.
    expect(
      matches(evt({ key: "x", metaKey: true }), {
        key: "x",
        mods: ["meta", "shift"],
      }),
    ).toBe(false);
  });

  test("`meta` accepts metaKey OR ctrlKey", () => {
    expect(
      matches(evt({ key: "b", metaKey: true }), { key: "b", mods: ["meta"] }),
    ).toBe(true);
    expect(
      matches(evt({ key: "b", ctrlKey: true }), { key: "b", mods: ["meta"] }),
    ).toBe(true);
    expect(matches(evt({ key: "b" }), { key: "b", mods: ["meta"] })).toBe(
      false,
    );
  });

  test("`not` modifiers reject when present", () => {
    expect(
      matches(evt({ key: "b", metaKey: true, shiftKey: false }), {
        key: "b",
        mods: ["meta"],
        not: ["shift"],
      }),
    ).toBe(true);
    expect(
      matches(evt({ key: "b", metaKey: true, shiftKey: true }), {
        key: "b",
        mods: ["meta"],
        not: ["shift"],
      }),
    ).toBe(false);
  });

  test("space + no-mods matches the Space bindings' shape", () => {
    // Both Space bindings use ``not: ["meta", "alt"]``.
    expect(matches(evt({ key: " " }), { key: " ", not: ["meta", "alt"] })).toBe(
      true,
    );
    expect(
      matches(evt({ key: " ", metaKey: true }), {
        key: " ",
        not: ["meta", "alt"],
      }),
    ).toBe(false);
    expect(
      matches(evt({ key: " ", altKey: true }), {
        key: " ",
        not: ["meta", "alt"],
      }),
    ).toBe(false);
    // Shift on Space is fine — neither of the two Space bindings
    // forbids shift, so the original handler accepted Shift+Space too.
    expect(
      matches(evt({ key: " ", shiftKey: true }), {
        key: " ",
        not: ["meta", "alt"],
      }),
    ).toBe(true);
  });
});

describe("dispatchKeydown", () => {
  // A miniature fake context — only the fields the tests actually
  // exercise.
  function fakeCtx(over: Partial<CellKeydownContext> = {}): CellKeydownContext {
    return {
      event: evt({ key: "x" }),
      cellId: "A1" as CellKeydownContext["cellId"],
      isDropdown: false,
      isCheckbox: false,
      selectionFarEdge: null,
      hasCheckboxInSelection: () => false,
      handleDropdownOpen: () => {},
      startEditing: () => {},
      focusCell: () => {},
      navigate: ((id) => id) as CellKeydownContext["navigate"],
      selectSingle: () => {},
      selectRange: () => {},
      toggleFormatFlag: () => {},
      clearAllFormat: () => {},
      toggleCheckboxes: () => {},
      clearDropdownStep: () => {},
      flushSave: () => {},
      pushUndo: () => {},
      undo: () => {},
      redo: () => {},
      ...over,
    };
  }

  test("returns false when no binding matches", () => {
    const e = evt({ key: "Q" });
    expect(dispatchKeydown(e, fakeCtx(), [])).toBe(false);
  });

  test("first matching binding that returns 'handled' wins", () => {
    const calls: string[] = [];
    const bindings: KeyBinding<CellKeydownContext>[] = [
      {
        id: "first",
        match: { key: "a" },
        exec: () => {
          calls.push("first");
          return "handled";
        },
      },
      {
        id: "second",
        match: { key: "a" },
        exec: () => {
          calls.push("second");
          return "handled";
        },
      },
    ];
    expect(dispatchKeydown(evt({ key: "a" }), fakeCtx(), bindings)).toBe(true);
    expect(calls).toEqual(["first"]);
  });

  test("'passthrough' continues to the next matching binding", () => {
    const calls: string[] = [];
    const bindings: KeyBinding<CellKeydownContext>[] = [
      {
        id: "first",
        match: { key: " " },
        exec: () => {
          calls.push("first");
          return "passthrough";
        },
      },
      {
        id: "second",
        match: { key: " " },
        exec: () => {
          calls.push("second");
          return "handled";
        },
      },
    ];
    expect(dispatchKeydown(evt({ key: " " }), fakeCtx(), bindings)).toBe(true);
    expect(calls).toEqual(["first", "second"]);
  });

  test("dispatcher does not touch preventDefault / stopPropagation itself", () => {
    // Bindings own their own propagation calls. A binding that
    // doesn't call them should leave the event untouched even when
    // it returns ``"handled"`` — the original handler had several
    // such asymmetries (Backspace = preventDefault only, no stop;
    // arrow keys = preventDefault only, no stop) that the
    // dispatcher must not paper over.
    const e = evt({ key: "k" });
    const bindings: KeyBinding<CellKeydownContext>[] = [
      {
        id: "silent",
        match: { key: "k" },
        exec: () => "handled",
      },
    ];
    dispatchKeydown(e, fakeCtx(), bindings);
    expect(
      (e as unknown as { defaultPrevented: boolean }).defaultPrevented,
    ).toBe(false);
    expect(
      (e as unknown as { propagationStopped: boolean }).propagationStopped,
    ).toBe(false);
  });
});

describe("cellNavBindings inventory", () => {
  test("every binding has a non-empty id and an exec", () => {
    expect(cellNavBindings.length).toBeGreaterThan(0);
    for (const b of cellNavBindings) {
      expect(typeof b.id).toBe("string");
      expect(b.id.length).toBeGreaterThan(0);
      expect(typeof b.exec).toBe("function");
      expect(typeof b.match.key).toBe("string");
      expect(b.match.key.length).toBeGreaterThan(0);
    }
  });

  test("every spec id used in handleCellKeydown today is represented", () => {
    // The original handler carried these ``[sheet.…]`` tags as
    // comments. Each must still be discoverable in the registry so
    // grep'ing for a spec id lands here.
    const ids = new Set(cellNavBindings.map((b) => b.id));
    const expected = [
      "sheet.editing.f2-or-enter",
      "sheet.undo.cmd-z",
      "sheet.undo.redo",
      "sheet.format.bold-toggle",
      "sheet.format.italic-toggle",
      "sheet.format.underline-toggle",
      "sheet.format.strikethrough-toggle",
      "sheet.format.clear",
      "sheet.data.dropdown.space-opens",
      "sheet.format.checkbox.space-toggles",
      "sheet.delete.delete-key-clears",
      "sheet.navigation.tab-nav-move",
      "sheet.navigation.shift-arrow-extend",
    ];
    for (const id of expected) {
      expect(ids.has(id), `binding id "${id}" missing from registry`).toBe(
        true,
      );
    }
  });

  test("no two bindings can both 'handle' the same canonical event", () => {
    // Smoke check on precedence: synthesise the canonical event for
    // each binding and walk the list. The first binding that
    // accepts MUST be the one whose match we built — otherwise the
    // declaration order is wrong.
    const checks: Array<{ id: string; e: KeyboardEvent }> = [
      { id: "sheet.editing.f2-or-enter", e: evt({ key: "Enter" }) },
      { id: "sheet.editing.f2-or-enter", e: evt({ key: "F2" }) },
      { id: "sheet.undo.cmd-z", e: evt({ key: "z", metaKey: true }) },
      {
        id: "sheet.undo.redo",
        e: evt({ key: "z", metaKey: true, shiftKey: true }),
      },
      { id: "sheet.undo.redo", e: evt({ key: "y", metaKey: true }) },
      { id: "sheet.format.bold-toggle", e: evt({ key: "b", metaKey: true }) },
      { id: "sheet.format.italic-toggle", e: evt({ key: "i", metaKey: true }) },
      {
        id: "sheet.format.underline-toggle",
        e: evt({ key: "u", metaKey: true }),
      },
      {
        id: "sheet.format.strikethrough-toggle",
        e: evt({ key: "x", metaKey: true, shiftKey: true }),
      },
      { id: "sheet.format.clear", e: evt({ key: "\\", metaKey: true }) },
      { id: "sheet.delete.delete-key-clears", e: evt({ key: "Backspace" }) },
      { id: "sheet.delete.delete-key-clears", e: evt({ key: "Delete" }) },
      { id: "sheet.navigation.tab-nav-move", e: evt({ key: "Tab" }) },
      {
        id: "sheet.navigation.tab-nav-move",
        e: evt({ key: "Tab", shiftKey: true }),
      },
      {
        id: "sheet.navigation.shift-arrow-extend",
        e: evt({ key: "ArrowUp" }),
      },
      {
        id: "sheet.navigation.shift-arrow-extend",
        e: evt({ key: "ArrowDown", shiftKey: true, metaKey: true }),
      },
    ];

    for (const { id, e } of checks) {
      const first = cellNavBindings.find((b) => matches(e, b.match));
      expect(
        first?.id,
        `expected first match for ${e.key} (meta=${e.metaKey} shift=${e.shiftKey}) to be "${id}"`,
      ).toBe(id);
    }
  });
});

describe("isPrintableEditTrigger", () => {
  test("plain letters / digits / equals trigger edit", () => {
    expect(isPrintableEditTrigger(evt({ key: "a" }))).toBe(true);
    expect(isPrintableEditTrigger(evt({ key: "Z" }))).toBe(true);
    expect(isPrintableEditTrigger(evt({ key: "5" }))).toBe(true);
    expect(isPrintableEditTrigger(evt({ key: "=" }))).toBe(true);
  });

  test("modifier-held printable keys do NOT trigger edit", () => {
    expect(isPrintableEditTrigger(evt({ key: "a", metaKey: true }))).toBe(
      false,
    );
    expect(isPrintableEditTrigger(evt({ key: "a", ctrlKey: true }))).toBe(
      false,
    );
    expect(isPrintableEditTrigger(evt({ key: "a", altKey: true }))).toBe(false);
  });

  test("multi-char keys (named keys) do not trigger edit", () => {
    expect(isPrintableEditTrigger(evt({ key: "ArrowDown" }))).toBe(false);
    expect(isPrintableEditTrigger(evt({ key: "Enter" }))).toBe(false);
    expect(isPrintableEditTrigger(evt({ key: "Tab" }))).toBe(false);
  });

  test("' triggers edit (force-text producer); other punctuation does not", () => {
    // [sheet.cell.force-text] joined ' to the allowlist so the
    // leading-' force-text UX is reachable directly from nav mode.
    // CELL-GRID-08 secondary issue #5 — making every printable trigger
    // — is still a separate follow-up; '-' and '.' continue to
    // require F2 first.
    expect(isPrintableEditTrigger(evt({ key: "'" }))).toBe(true);
    expect(isPrintableEditTrigger(evt({ key: "-" }))).toBe(false);
    expect(isPrintableEditTrigger(evt({ key: "." }))).toBe(false);
  });

  test("space does not trigger edit (handled by dropdown / checkbox bindings)", () => {
    expect(isPrintableEditTrigger(evt({ key: " " }))).toBe(false);
  });
});
