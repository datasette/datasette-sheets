import { describe, expect, test } from "vitest";
import {
  AUTOFIT_DEFAULT_STYLES,
  AUTOFIT_HEADER_EXTRA,
  AUTOFIT_MIN_WIDTH,
  AUTOFIT_VIEWPORT_FRACTION,
  composeCellFont,
  measureColumnAutoFit,
  readAutoFitStyles,
  type AutoFitStyles,
  type MeasureContext,
} from "../autofit";
import { createDefaultFormat } from "../formatter";
import type { CellData, CellFormat } from "../types";

// Pure-helper unit tests — no Svelte component, no real canvas. The
// autofit helper takes its measurement context as a parameter so we
// can drop in a tiny stub whose `width` is a deterministic function
// of the current `font` string + the input text. That lets us assert
// "bold should produce a larger width" without depending on whether
// the headless browser ships Courier New, which is the kind of flake
// the move out of Grid.svelte was meant to eliminate.

interface StubMetrics {
  /** Per-px contribution of each character. Default: 7 px. */
  charPx: number;
  /** Multiplier applied when the canvas font string contains `700`. */
  boldMul: number;
  /** Multiplier applied when the canvas font string starts with `italic`. */
  italicMul: number;
  /** Per-px override that takes precedence over `charPx` whenever the
   *  font string carries an explicit pixel size — lets a test assert
   *  "an 18pt cell measures wider than a 13px cell". */
  pxFromFont: boolean;
}

const DEFAULT_STUB_METRICS: StubMetrics = {
  charPx: 7,
  boldMul: 1.2,
  italicMul: 1.05,
  pxFromFont: true,
};

function makeStubCtx(metrics: Partial<StubMetrics> = {}): MeasureContext {
  const m = { ...DEFAULT_STUB_METRICS, ...metrics };
  let font = "";
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    measureText(text: string) {
      let w = text.length * m.charPx;
      if (m.pxFromFont) {
        // `composeCellFont` always emits `… <px>px <family>`. Pull the
        // px size out and scale the per-char width by it / 13 so a
        // larger font yields a proportionally larger width. Falls
        // back to the base if there's no match.
        const match = font.match(/(\d+(?:\.\d+)?)px/);
        if (match) w = (text.length * parseFloat(match[1]!) * m.charPx) / 13;
      }
      if (font.includes("700")) w *= m.boldMul;
      if (font.startsWith("italic")) w *= m.italicMul;
      return { width: w };
    },
  };
}

function cell(rawValue: string, format: Partial<CellFormat> = {}): CellData {
  return {
    rawValue,
    computedValue: rawValue,
    formula: null,
    format: { ...createDefaultFormat(), ...format },
    error: null,
  };
}

describe("composeCellFont", () => {
  test("default format → normal 400 baseFontSize family", () => {
    const out = composeCellFont(createDefaultFormat(), AUTOFIT_DEFAULT_STYLES);
    expect(out).toBe(
      `normal 400 ${AUTOFIT_DEFAULT_STYLES.baseFontSize} ${AUTOFIT_DEFAULT_STYLES.fontFamily}`,
    );
  });

  test("bold format → weight 700", () => {
    const out = composeCellFont(
      { ...createDefaultFormat(), bold: true },
      AUTOFIT_DEFAULT_STYLES,
    );
    expect(out).toContain(" 700 ");
  });

  test("italic format → italic style", () => {
    const out = composeCellFont(
      { ...createDefaultFormat(), italic: true },
      AUTOFIT_DEFAULT_STYLES,
    );
    expect(out.startsWith("italic ")).toBe(true);
  });

  test("explicit fontSize overrides base size (pt → px conversion)", () => {
    const out = composeCellFont(
      { ...createDefaultFormat(), fontSize: 18 },
      AUTOFIT_DEFAULT_STYLES,
    );
    // 18pt × 96/72 = 24px exactly.
    expect(out).toContain("24px");
    expect(out).not.toContain(AUTOFIT_DEFAULT_STYLES.baseFontSize);
  });
});

describe("measureColumnAutoFit", () => {
  const styles: AutoFitStyles = {
    baseFontSize: "13px",
    fontFamily: "Courier New, monospace",
    padX: 5,
  };

  function fmt(c: CellData): string {
    return c.error ?? String(c.computedValue ?? "");
  }

  test("empty column floors at AUTOFIT_MIN_WIDTH", () => {
    const ctx = makeStubCtx();
    // Header `"A"` width: 1 × 7 = 7 px + 2*5 + 14 = 31 px. Floors at 40.
    const w = measureColumnAutoFit("A", {
      rows: [1, 2, 3],
      getCell: () => null,
      formatValue: fmt,
      styles,
      viewportWidth: 10000,
      ctx,
    });
    expect(w).toBe(AUTOFIT_MIN_WIDTH);
  });

  test("header reserves at least 2*padX + headerExtra + label width", () => {
    // Use a long column-letter substitute via measuring "AAAA" width
    // through the same stub. Real letters are A–O so we sanity-check
    // the formula on a tall stub character count instead.
    const ctx = makeStubCtx({ charPx: 10 });
    const w = measureColumnAutoFit("Z", {
      rows: [],
      getCell: () => null,
      formatValue: fmt,
      styles,
      viewportWidth: 10000,
      ctx,
    });
    // Header text "Z" → 1 × 10 = 10 px text + 2*5 + 14 = 34 px. Floors at MIN.
    expect(w).toBe(AUTOFIT_MIN_WIDTH);

    // Bigger label width forces above the floor.
    const wide = makeStubCtx({ charPx: 50 });
    const w2 = measureColumnAutoFit("Z", {
      rows: [],
      getCell: () => null,
      formatValue: fmt,
      styles,
      viewportWidth: 10000,
      ctx: wide,
    });
    expect(w2).toBeGreaterThanOrEqual(
      2 * styles.padX + AUTOFIT_HEADER_EXTRA + 50,
    );
  });

  test("widest cell drives the column width", () => {
    const map = new Map<string, CellData>([
      ["A1", cell("hi")],
      ["A2", cell("very long content here")],
      ["A3", cell("x")],
    ]);
    const ctx = makeStubCtx();
    const w = measureColumnAutoFit("A", {
      rows: [1, 2, 3],
      getCell: (id) => map.get(id) ?? null,
      formatValue: fmt,
      styles,
      viewportWidth: 100000,
      ctx,
    });
    // "very long content here" = 22 chars × 7 = 154 + 2*5 = 164.
    expect(w).toBe(22 * 7 + 2 * styles.padX);
  });

  test("bold cell measures wider than an unbolded one", () => {
    const plain = new Map<string, CellData>([["A1", cell("HELLO")]]);
    const bold = new Map<string, CellData>([
      ["A1", cell("HELLO", { bold: true })],
    ]);
    const opts = {
      rows: [1] as const,
      formatValue: fmt,
      styles,
      viewportWidth: 100000,
      ctx: makeStubCtx(),
    };
    const wPlain = measureColumnAutoFit("A", {
      ...opts,
      getCell: (id) => plain.get(id) ?? null,
    });
    const wBold = measureColumnAutoFit("A", {
      ...opts,
      getCell: (id) => bold.get(id) ?? null,
      ctx: makeStubCtx(), // fresh ctx — `font` is stateful
    });
    expect(wBold).toBeGreaterThan(wPlain);
  });

  test("italic cell measures wider than a non-italic one", () => {
    const plain = new Map<string, CellData>([["A1", cell("HELLO")]]);
    const italic = new Map<string, CellData>([
      ["A1", cell("HELLO", { italic: true })],
    ]);
    const opts = {
      rows: [1] as const,
      formatValue: fmt,
      styles,
      viewportWidth: 100000,
    };
    const wPlain = measureColumnAutoFit("A", {
      ...opts,
      getCell: (id) => plain.get(id) ?? null,
      ctx: makeStubCtx(),
    });
    const wItalic = measureColumnAutoFit("A", {
      ...opts,
      getCell: (id) => italic.get(id) ?? null,
      ctx: makeStubCtx(),
    });
    expect(wItalic).toBeGreaterThan(wPlain);
  });

  test("fontSize: 18pt measures wider than default", () => {
    const small = new Map<string, CellData>([["A1", cell("HELLO")]]);
    const big = new Map<string, CellData>([
      ["A1", cell("HELLO", { fontSize: 18 })],
    ]);
    const opts = {
      rows: [1] as const,
      formatValue: fmt,
      styles,
      viewportWidth: 100000,
    };
    const wSmall = measureColumnAutoFit("A", {
      ...opts,
      getCell: (id) => small.get(id) ?? null,
      ctx: makeStubCtx(),
    });
    const wBig = measureColumnAutoFit("A", {
      ...opts,
      getCell: (id) => big.get(id) ?? null,
      ctx: makeStubCtx(),
    });
    expect(wBig).toBeGreaterThan(wSmall);
  });

  test("padding scales with --sheet-cell-padding-x (no magic 16)", () => {
    // Long enough content that the cell-text branch dominates over
    // both the header and the MIN floor at every padX choice we test
    // — that way the difference between two runs is just the padding.
    const map = new Map<string, CellData>([["A1", cell("x".repeat(20))]]);
    const opts = {
      rows: [1] as const,
      getCell: (id: string) => map.get(id) ?? null,
      formatValue: fmt,
      viewportWidth: 100000,
    };
    const tight = measureColumnAutoFit("A", {
      ...opts,
      styles: { ...styles, padX: 2 },
      ctx: makeStubCtx(),
    });
    const loose = measureColumnAutoFit("A", {
      ...opts,
      styles: { ...styles, padX: 12 },
      ctx: makeStubCtx(),
    });
    // Difference in cell-side padding (2 * (12 - 2)) round-trips
    // through the result exactly — no hidden +16 anywhere.
    expect(loose - tight).toBe(2 * (12 - 2));
  });

  test("viewport cap clamps at AUTOFIT_VIEWPORT_FRACTION × viewportWidth", () => {
    const huge = "x".repeat(10_000);
    const map = new Map<string, CellData>([["A1", cell(huge)]]);
    const w = measureColumnAutoFit("A", {
      rows: [1],
      getCell: (id) => map.get(id) ?? null,
      formatValue: fmt,
      styles,
      viewportWidth: 1000,
      ctx: makeStubCtx(),
    });
    expect(w).toBe(1000 * AUTOFIT_VIEWPORT_FRACTION);
  });

  test("error string is measured (caller passes it via formatValue)", () => {
    // The caller (Grid.svelte) chooses whether to surface `cell.error`
    // before falling back to formatValue. The helper trusts whatever
    // string the caller hands back, including an error message.
    const errorCell: CellData = {
      ...cell(""),
      computedValue: null,
      error: "#REF!",
    };
    const map = new Map([["A1", errorCell]]);
    const w = measureColumnAutoFit("A", {
      rows: [1],
      getCell: (id) => map.get(id) ?? null,
      formatValue: (c) => c.error ?? "",
      styles,
      viewportWidth: 100000,
      ctx: makeStubCtx(),
    });
    // "#REF!" = 5 chars × 7 = 35 + 2*5 = 45 (above MIN of 40).
    expect(w).toBe(5 * 7 + 2 * styles.padX);
  });
});

describe("readAutoFitStyles", () => {
  test("null root returns the documented defaults", () => {
    expect(readAutoFitStyles(null)).toEqual(AUTOFIT_DEFAULT_STYLES);
  });

  test("undefined root returns the documented defaults", () => {
    expect(readAutoFitStyles(undefined)).toEqual(AUTOFIT_DEFAULT_STYLES);
  });

  test("reads --sheet-font / --sheet-font-size / --sheet-cell-padding-x off a real element", () => {
    const el = document.createElement("div");
    el.style.setProperty("--sheet-font", "Helvetica, sans-serif");
    el.style.setProperty("--sheet-font-size", "16px");
    el.style.setProperty("--sheet-cell-padding-x", "9px");
    document.body.appendChild(el);
    try {
      const styles = readAutoFitStyles(el);
      expect(styles.fontFamily).toBe("Helvetica, sans-serif");
      expect(styles.baseFontSize).toBe("16px");
      expect(styles.padX).toBe(9);
    } finally {
      el.remove();
    }
  });

  test("missing CSS vars fall back to defaults per-field", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    try {
      const styles = readAutoFitStyles(el);
      expect(styles).toEqual(AUTOFIT_DEFAULT_STYLES);
    } finally {
      el.remove();
    }
  });
});
