import { describe, expect, test } from "vitest";
import { cellId, colToIndex, indexToCol, parseCellIdRaw } from "../engine";

// These tests pin the engine-backed coordinate helpers (``parseCellIdRaw``,
// ``cellId``, ``indexToCol``, ``colToIndex``) — they're the canonical
// JS surface for the A1 grammar. The current grid only renders 15 columns
// (A–O), so callers that hand-rolled ``match(/^[A-Z]+/)`` regexes never
// exercised the multi-letter path. Cover it here so a future grid
// expansion past Z is one constant change away rather than a silent
// data-loss bug.

describe("indexToCol / colToIndex", () => {
  test("single-letter columns round-trip", () => {
    for (let i = 0; i < 26; i++) {
      const letters = indexToCol(i);
      expect(letters.length).toBe(1);
      expect(colToIndex(letters)).toBe(i);
    }
  });

  test("AA is index 26 and round-trips", () => {
    expect(indexToCol(26)).toBe("AA");
    expect(colToIndex("AA")).toBe(26);
  });

  test("ZZ is index 701 and round-trips", () => {
    expect(indexToCol(701)).toBe("ZZ");
    expect(colToIndex("ZZ")).toBe(701);
  });

  test("AAA is index 702 and round-trips", () => {
    expect(indexToCol(702)).toBe("AAA");
    expect(colToIndex("AAA")).toBe(702);
  });
});

describe("parseCellIdRaw / cellId round-trip", () => {
  test("A1 parses to row 0, col 0", () => {
    expect(parseCellIdRaw("A1")).toEqual({ row: 0, col: 0 });
    expect(cellId(0, 0)).toBe("A1");
  });

  test("AA1 parses past the single-letter wall (col 26)", () => {
    expect(parseCellIdRaw("AA1")).toEqual({ row: 0, col: 26 });
    expect(cellId(0, 26)).toBe("AA1");
  });

  test("ZZ100 round-trips", () => {
    expect(parseCellIdRaw("ZZ100")).toEqual({ row: 99, col: 701 });
    expect(cellId(99, 701)).toBe("ZZ100");
  });

  test("AAA1 round-trips", () => {
    expect(parseCellIdRaw("AAA1")).toEqual({ row: 0, col: 702 });
    expect(cellId(0, 702)).toBe("AAA1");
  });

  test("garbage input returns null without throwing", () => {
    expect(parseCellIdRaw("")).toBeNull();
    expect(parseCellIdRaw("1A")).toBeNull();
    expect(parseCellIdRaw("not-a-cell-id")).toBeNull();
  });
});
