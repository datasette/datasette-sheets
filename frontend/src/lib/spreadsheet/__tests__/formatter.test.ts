import { describe, expect, test } from "vitest";
import {
  createDefaultFormat,
  formatValue,
  hasNonDefaultFormat,
} from "../formatter";
import type { CellFormat } from "../types";

describe("hasNonDefaultFormat", () => {
  test("default format is considered default", () => {
    expect(hasNonDefaultFormat(createDefaultFormat())).toBe(false);
  });

  test("non-general type is non-default", () => {
    const f: CellFormat = { ...createDefaultFormat(), type: "currency" };
    expect(hasNonDefaultFormat(f)).toBe(true);
  });

  test.each<[keyof CellFormat, unknown]>([
    ["bold", true],
    ["italic", true],
    ["underline", true],
    ["strikethrough", true],
    ["textColor", "#f00"],
    ["fillColor", "#ff0"],
    ["hAlign", "center"],
    ["vAlign", "top"],
    ["wrap", "wrap"],
    ["fontSize", 14],
  ])("field %s makes format non-default", (key, value) => {
    const f = { ...createDefaultFormat(), [key]: value } as CellFormat;
    expect(hasNonDefaultFormat(f)).toBe(true);
  });

  test("empty borders object is still default", () => {
    const f: CellFormat = { ...createDefaultFormat(), borders: {} };
    expect(hasNonDefaultFormat(f)).toBe(false);
  });

  test("borders with at least one edge is non-default", () => {
    const f: CellFormat = {
      ...createDefaultFormat(),
      borders: { bottom: { style: "solid", color: "#000" } },
    };
    expect(hasNonDefaultFormat(f)).toBe(true);
  });

  test("falsy flags treated as default (undefined / false)", () => {
    const f: CellFormat = {
      ...createDefaultFormat(),
      bold: false,
      italic: undefined,
    };
    expect(hasNonDefaultFormat(f)).toBe(false);
  });
});

describe("formatValue — existing types still work", () => {
  test("general number", () => {
    expect(formatValue(100, createDefaultFormat())).toBe("100");
  });
  test("currency", () => {
    expect(
      formatValue(1234.5, { ...createDefaultFormat(), type: "currency" }),
    ).toBe("$1,234.50");
  });
  test("percentage", () => {
    expect(
      formatValue(0.25, {
        ...createDefaultFormat(),
        type: "percentage",
        decimals: 1,
      }),
    ).toBe("25.0%");
  });
});

describe("formatValue — extended types", () => {
  test("scientific with 2 decimals", () => {
    expect(
      formatValue(1234, {
        ...createDefaultFormat(),
        type: "scientific",
        decimals: 2,
      }),
    ).toBe("1.23e+3");
  });

  test("scientific with 0 decimals", () => {
    expect(
      formatValue(1234, {
        ...createDefaultFormat(),
        type: "scientific",
        decimals: 0,
      }),
    ).toBe("1e+3");
  });

  test("scientific with negative values", () => {
    expect(
      formatValue(-0.00123, {
        ...createDefaultFormat(),
        type: "scientific",
        decimals: 2,
      }),
    ).toBe("-1.23e-3");
  });

  test("date renders a parseable date string", () => {
    // Use a local-date format (`Apr 21, 2026`) rather than the ISO
    // shortform — ISO `YYYY-MM-DD` parses as UTC midnight and then
    // shifts by the runner's local offset, which makes the rendered
    // day flaky across timezones.
    const out = formatValue("Apr 21, 2026", {
      ...createDefaultFormat(),
      type: "date",
    });
    expect(out).toMatch(/Apr 21.*2026/);
  });

  test("date falls back to raw value on unparseable input", () => {
    const out = formatValue("not-a-date", {
      ...createDefaultFormat(),
      type: "date",
    });
    expect(out).toBe("not-a-date");
  });

  test("time renders HH:MM:SS from a parseable datetime", () => {
    // Local format, no "Z" — otherwise the 15:14 UTC time shifts by
    // the runner's offset (PDT would show 8:14:59).
    const out = formatValue("Apr 21, 2026 15:14:59", {
      ...createDefaultFormat(),
      type: "time",
    });
    // Browser locale for en-US uses "3:14:59 PM".
    expect(out).toMatch(/3:14:59/);
  });

  test("datetime renders both components", () => {
    // Local datetime — no "Z" — to avoid timezone drift on the runner.
    const out = formatValue("Apr 21, 2026 15:14:00", {
      ...createDefaultFormat(),
      type: "datetime",
    });
    expect(out).toMatch(/Apr 21.*2026.*3:14/);
  });

  test("date on empty value returns empty string", () => {
    expect(formatValue(null, { ...createDefaultFormat(), type: "date" })).toBe(
      "",
    );
  });

  // [sheet.cell.boolean]
  test("boolean true renders as TRUE", () => {
    expect(formatValue(true, createDefaultFormat())).toBe("TRUE");
  });

  test("boolean false renders as FALSE", () => {
    expect(formatValue(false, createDefaultFormat())).toBe("FALSE");
  });

  test("boolean ignores number-format mask (currency would lie)", () => {
    expect(
      formatValue(true, { ...createDefaultFormat(), type: "currency" }),
    ).toBe("TRUE");
  });
});
