import { describe, expect, test } from "vitest";
import { parseClipboardData } from "../clipboard";

function dt(text: string): DataTransfer {
  const d = new DataTransfer();
  d.setData("text/plain", text);
  return d;
}

describe("parsePlainText — row & whitespace preservation", () => {
  test("TSV: empty middle rows survive as a single blank cell", () => {
    // Three rows where the middle is intentionally blank — must
    // come back as 3 rows, not 2, so the destination grid stays
    // aligned with the source. The TSV branch fires because at
    // least one line has a tab.
    const { grid } = parseClipboardData(dt("a\tb\n\nc\td"));
    expect(grid).toHaveLength(3);
    expect(grid[0]).toEqual([{ value: "a" }, { value: "b" }]);
    expect(grid[1]).toEqual([{ value: "" }]);
    expect(grid[2]).toEqual([{ value: "c" }, { value: "d" }]);
  });

  test("TSV: cell whitespace is preserved (no .trim() on cells)", () => {
    const { grid } = parseClipboardData(dt("  hello  \tworld"));
    expect(grid[0][0].value).toBe("  hello  ");
    expect(grid[0][1].value).toBe("world");
  });

  test("TSV: explicit blank cells survive as empty strings", () => {
    // `"a\t\tb"`.split("\t") → ["a", "", "b"]. Confirms we don't
    // accidentally collapse runs of tabs.
    const { grid } = parseClipboardData(dt("a\t\tb"));
    expect(grid).toHaveLength(1);
    expect(grid[0]).toEqual([{ value: "a" }, { value: "" }, { value: "b" }]);
  });

  test("TSV: a single trailing newline is stripped (no phantom row)", () => {
    const { grid } = parseClipboardData(dt("a\tb\nc\td\n"));
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([{ value: "a" }, { value: "b" }]);
    expect(grid[1]).toEqual([{ value: "c" }, { value: "d" }]);
  });

  test("markdown table parses correctly with separator row", () => {
    const { grid } = parseClipboardData(dt("|a|b|\n|-|-|\n|c|d|"));
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([{ value: "a" }, { value: "b" }]);
    expect(grid[1]).toEqual([{ value: "c" }, { value: "d" }]);
  });

  test("markdown table accepts alignment-colon separators", () => {
    const { grid } = parseClipboardData(dt("| a | b |\n|:--|--:|\n| c | d |"));
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([{ value: "a" }, { value: "b" }]);
    expect(grid[1]).toEqual([{ value: "c" }, { value: "d" }]);
  });

  test("pipe in plain text without a separator row stays single-cell", () => {
    // No tab, no markdown shape → the single-cell branch keeps
    // the full text untouched. A pasted regex like `^a|b$` should
    // not be silently mangled.
    const { grid } = parseClipboardData(dt("a|b"));
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(1);
    expect(grid[0][0].value).toBe("a|b");
  });

  test("single-cell paste preserves leading / trailing spaces", () => {
    const { grid } = parseClipboardData(dt("  hello  "));
    expect(grid).toHaveLength(1);
    expect(grid[0][0].value).toBe("  hello  ");
  });

  test("plain TSV: a\\tb\\n1\\t2 parses to a 2x2 grid", () => {
    const { grid } = parseClipboardData(dt("a\tb\n1\t2"));
    expect(grid).toEqual([
      [{ value: "a" }, { value: "b" }],
      [{ value: "1" }, { value: "2" }],
    ]);
  });

  test("markdown table with leading + trailing pipes parses", () => {
    const { grid } = parseClipboardData(dt("| a | b |\n|---|---|\n| 1 | 2 |"));
    expect(grid).toEqual([
      [{ value: "a" }, { value: "b" }],
      [{ value: "1" }, { value: "2" }],
    ]);
  });

  test("markdown table without leading pipe stays single-cell (contract)", () => {
    // The detector requires line 0 to start with `|` AND line 1 to be
    // a real `|---|---|` separator. Tables without the surrounding
    // pipes (some renderers emit `a | b\n--- | ---\n1 | 2`) fall
    // through to the single-cell branch. Pin the contract so a future
    // detector tweak doesn't quietly break TSV-shaped pastes that
    // happen to contain pipes.
    const { grid } = parseClipboardData(dt("a | b\n---|---\n1 | 2"));
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(1);
    expect(grid[0][0].value).toBe("a | b\n---|---\n1 | 2");
  });

  test("CSV is NOT auto-detected — pasted as a single cell (contract)", () => {
    // CSV parsing requires real quoted-field handling that the
    // plain-text fallback intentionally doesn't do. Until/unless we
    // add it, comma-separated text stays a single-cell paste so the
    // user gets their content back verbatim instead of a half-broken
    // grid.
    const { grid } = parseClipboardData(dt("a,b\n1,2"));
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(1);
    expect(grid[0][0].value).toBe("a,b\n1,2");
  });
});
