import { describe, expect, test } from "vitest";
import { buildCellInlineStyle } from "../cell-style";
import type { CellStyleInputs } from "../cell-style";

function inputs(overrides: Partial<CellStyleInputs> = {}): CellStyleInputs {
  return {
    refColor: null,
    remoteCursor: null,
    remoteSelection: null,
    viewMeta: null,
    fillColor: null,
    borders: null,
    isEditing: false,
    ...overrides,
  };
}

describe("buildCellInlineStyle", () => {
  test("idle cell with nothing set emits an empty string", () => {
    expect(buildCellInlineStyle(inputs())).toBe("");
  });

  test("ref-highlighted cell emits --ref-color", () => {
    const out = buildCellInlineStyle(inputs({ refColor: "#ff8800" }));
    expect(out).toBe("--ref-color: #ff8800;");
  });

  test("ref-color is suppressed while editing (parity with old template)", () => {
    const out = buildCellInlineStyle(
      inputs({ refColor: "#ff8800", isEditing: true }),
    );
    expect(out).toBe("");
  });

  test("remote cursor wins over remote selection for --remote-color", () => {
    const out = buildCellInlineStyle(
      inputs({
        remoteCursor: { color: "#0000ff" },
        remoteSelection: { color: "#00ff00" },
      }),
    );
    expect(out).toBe("--remote-color: #0000ff;");
  });

  test("remote selection alone emits --remote-color", () => {
    const out = buildCellInlineStyle(
      inputs({ remoteSelection: { color: "#00ff00" } }),
    );
    expect(out).toBe("--remote-color: #00ff00;");
  });

  test("viewMeta emits --view-color", () => {
    const out = buildCellInlineStyle(
      inputs({ viewMeta: { color: "#6366f1" } }),
    );
    expect(out).toBe("--view-color: #6366f1;");
  });

  test("fillColor emits --cell-fill (no raw `background:`)", () => {
    const out = buildCellInlineStyle(inputs({ fillColor: "#fef08a" }));
    expect(out).toBe("--cell-fill: #fef08a;");
    expect(out).not.toContain("background:");
  });

  test("borders emit --cell-border-<side> shorthand strings", () => {
    const out = buildCellInlineStyle(
      inputs({
        borders: {
          top: { style: "solid", color: "#ff0000" },
          bottom: { style: "dashed", color: "#00ff00" },
        },
      }),
    );
    expect(out).toContain("--cell-border-top: 1.5px solid #ff0000;");
    expect(out).toContain("--cell-border-bottom: 1.5px dashed #00ff00;");
    expect(out).not.toContain("--cell-border-right");
    expect(out).not.toContain("--cell-border-left");
    // No raw `border-*:` shorthands should leak — those would beat
    // the .view-edge-* / .clipboard-edge-* class rules.
    expect(out).not.toMatch(/(^|;\s*)border-(top|right|bottom|left):/);
  });

  test("border on a view-edge side is dropped so the dashed edge stays visible", () => {
    const out = buildCellInlineStyle(
      inputs({
        borders: {
          top: { style: "solid", color: "#ff0000" },
          right: { style: "solid", color: "#ff0000" },
        },
        viewEdgeTop: true,
      }),
    );
    expect(out).not.toContain("--cell-border-top");
    expect(out).toContain("--cell-border-right: 1.5px solid #ff0000;");
  });

  test("border on a clipboard-edge side is dropped", () => {
    const out = buildCellInlineStyle(
      inputs({
        borders: { left: { style: "solid", color: "#ff0000" } },
        clipboardEdgeLeft: true,
      }),
    );
    expect(out).not.toContain("--cell-border-left");
  });

  test("fill + borders + view + ref combine in one declaration string", () => {
    const out = buildCellInlineStyle(
      inputs({
        refColor: "#ff8800",
        viewMeta: { color: "#6366f1" },
        fillColor: "#fef08a",
        borders: { bottom: { style: "solid", color: "#000000" } },
      }),
    );
    expect(out).toBe(
      "--ref-color: #ff8800;" +
        "--view-color: #6366f1;" +
        "--cell-fill: #fef08a;" +
        "--cell-border-bottom: 1.5px solid #000000;",
    );
  });
});
