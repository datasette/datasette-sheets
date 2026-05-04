import { describe, expect, test } from "vitest";
import { parseClipboardData, buildCopyPayload } from "../clipboard";

function dt(html: string): DataTransfer {
  const d = new DataTransfer();
  d.setData("text/html", html);
  return d;
}

describe("parseClipboardData — text styling extraction", () => {
  test("picks up font-weight:bold", () => {
    const html = `<table><tr><td style="font-weight:bold">hi</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].bold).toBe(true);
  });

  test("picks up font-style:italic", () => {
    const html = `<table><tr><td style="font-style:italic">hi</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].italic).toBe(true);
  });

  test("picks up text-decoration:underline", () => {
    const html = `<table><tr><td style="text-decoration:underline">hi</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].underline).toBe(true);
  });

  test("picks up text-decoration:line-through", () => {
    const html = `<table><tr><td style="text-decoration:line-through">hi</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].strikethrough).toBe(true);
  });

  test("picks up underline + line-through together", () => {
    const html = `<table><tr><td style="text-decoration:underline line-through">hi</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].underline).toBe(true);
    expect(grid[0][0].strikethrough).toBe(true);
  });

  test("picks up <i> / <em> / <u> / <s> tags", () => {
    const html =
      `<table><tr>` +
      `<td><i>x</i></td><td><em>x</em></td>` +
      `<td><u>x</u></td><td><s>x</s></td><td><del>x</del></td>` +
      `</tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].italic).toBe(true);
    expect(grid[0][1].italic).toBe(true);
    expect(grid[0][2].underline).toBe(true);
    expect(grid[0][3].strikethrough).toBe(true);
    expect(grid[0][4].strikethrough).toBe(true);
  });

  test("plain td has no style flags", () => {
    const html = `<table><tr><td>plain</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].bold).toBeUndefined();
    expect(grid[0][0].italic).toBeUndefined();
    expect(grid[0][0].underline).toBeUndefined();
    expect(grid[0][0].strikethrough).toBeUndefined();
  });

  test("picks up color / background / text-align / font-size", () => {
    const html =
      `<table><tr><td style="color:#ff0000;background-color:#00ff00;` +
      `text-align:center;font-size:14pt">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].textColor).toBe("#ff0000");
    expect(grid[0][0].fillColor).toBe("#00ff00");
    expect(grid[0][0].hAlign).toBe("center");
    expect(grid[0][0].fontSize).toBe(14);
  });

  test("font-size in px converts to pt", () => {
    const html = `<table><tr><td style="font-size:16px">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].fontSize).toBe(12); // 16px * 0.75 = 12pt
  });

  test("text-align:justify is dropped (not a supported hAlign)", () => {
    const html = `<table><tr><td style="text-align:justify">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].hAlign).toBeUndefined();
  });

  test("background shorthand also sets fillColor", () => {
    const html = `<table><tr><td style="background:#aabbcc">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].fillColor).toBe("#aabbcc");
  });

  test("font-weight:600 (semibold) registers as bold", () => {
    const html = `<table><tr><td style="font-weight:600">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].bold).toBe(true);
  });

  test("font-weight:500 is not bold", () => {
    const html = `<table><tr><td style="font-weight:500">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].bold).toBeFalsy();
  });

  test("font-weight:bolder registers as bold", () => {
    const html = `<table><tr><td style="font-weight:bolder">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].bold).toBe(true);
  });

  test("text-decoration-line:underline picked up as underline", () => {
    const html = `<table><tr><td style="text-decoration-line:underline">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].underline).toBe(true);
  });

  test("text-decoration-color alone does not imply underline / strike", () => {
    const html = `<table><tr><td style="text-decoration-color:red">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].underline).toBeFalsy();
    expect(grid[0][0].strikethrough).toBeFalsy();
  });

  test("text-decoration-thickness with `underline-thick` doesn't false-positive", () => {
    // Exotic but legal — a `text-decoration-thickness` value should
    // never feed into our underline detection.
    const html = `<table><tr><td style="text-decoration-thickness:underline-thick">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].underline).toBeFalsy();
  });

  test("background:url(...) does not set fillColor", () => {
    const html = `<table><tr><td style="background:url(x.png) center">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].fillColor).toBeUndefined();
  });

  test("background:rgba(...) preserves fillColor", () => {
    const html = `<table><tr><td style="background:rgba(0,0,0,0.5)">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].fillColor).toBe("rgba(0,0,0,0.5)");
  });

  test("background:red (named colour) preserves fillColor", () => {
    const html = `<table><tr><td style="background:red">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].fillColor).toBe("red");
  });

  test("background-color wins over a multi-part background shorthand", () => {
    // background-color is the long-form name and should be picked up
    // verbatim regardless of whether the shorthand is also colour-shaped.
    const html = `<table><tr><td style="background-color:#112233;background:url(x.png)">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].fillColor).toBe("#112233");
  });
});

describe("buildCopyPayload — text styling emission", () => {
  test("emits font-style:italic for italic cells", () => {
    const { html } = buildCopyPayload([[{ value: "hi", italic: true }]]);
    expect(html).toContain("font-style:italic");
  });

  test("emits text-decoration:underline for underlined cells", () => {
    const { html } = buildCopyPayload([[{ value: "hi", underline: true }]]);
    expect(html).toContain("text-decoration:underline");
  });

  test("stacks underline + line-through in one declaration", () => {
    const { html } = buildCopyPayload([
      [{ value: "hi", underline: true, strikethrough: true }],
    ]);
    expect(html).toContain("text-decoration:underline line-through");
  });

  test("no decoration property on plain cells", () => {
    const { html } = buildCopyPayload([[{ value: "hi" }]]);
    expect(html).not.toContain("text-decoration");
    expect(html).not.toContain("font-style:italic");
  });

  test("round-trip: emitted style parses back to same flags", () => {
    const { html } = buildCopyPayload([
      [
        {
          value: "hi",
          bold: true,
          italic: true,
          underline: true,
          strikethrough: true,
        },
      ],
    ]);
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0]).toMatchObject({
      value: "hi",
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
    });
  });

  test("emits inline color / background-color / text-align / font-size", () => {
    const { html } = buildCopyPayload([
      [
        {
          value: "hi",
          textColor: "#ff0000",
          fillColor: "#00ff00",
          hAlign: "center",
          fontSize: 18,
        },
      ],
    ]);
    expect(html).toContain("color:#ff0000");
    expect(html).toContain("background-color:#00ff00");
    expect(html).toContain("text-align:center");
    expect(html).toContain("font-size:18pt");
  });

  test("round-trip: color + fill + align + size survive", () => {
    const { html } = buildCopyPayload([
      [
        {
          value: "hi",
          textColor: "#123456",
          fillColor: "#fedcba",
          hAlign: "right",
          fontSize: 24,
        },
      ],
    ]);
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0]).toMatchObject({
      value: "hi",
      textColor: "#123456",
      fillColor: "#fedcba",
      hAlign: "right",
      fontSize: 24,
    });
  });

  test("explicit hAlign wins over numeric auto-right in outbound HTML", () => {
    const { html } = buildCopyPayload([
      [{ value: "42", numeric: true, hAlign: "left" }],
    ]);
    expect(html).toContain("text-align:left");
    expect(html).not.toContain("text-align:right");
  });
});

// [sheet.data.dropdown] Round-trip the dropdown control format +
// rule id through the HTML clipboard payload so intra-app paste
// can spread the dropdown formatting (Google-Sheets-style "copy
// the cell to apply the dropdown to a range").
describe("buildCopyPayload + parseClipboardData — dropdown round-trip", () => {
  test("emits data-sheets-control-type + data-sheets-dropdown-rule-id", () => {
    const { html } = buildCopyPayload([
      [
        {
          value: "Doing",
          controlType: "dropdown",
          dropdownRuleId: "rule-abc",
        },
      ],
    ]);
    expect(html).toContain('data-sheets-control-type="dropdown"');
    expect(html).toContain('data-sheets-dropdown-rule-id="rule-abc"');
  });

  test("parses both attrs back out", () => {
    const html =
      `<table><tr><td data-sheets-control-type="dropdown" ` +
      `data-sheets-dropdown-rule-id="rule-xyz">Done</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].controlType).toBe("dropdown");
    expect(grid[0][0].dropdownRuleId).toBe("rule-xyz");
    expect(grid[0][0].value).toBe("Done");
  });

  test("absent attrs round-trip as undefined", () => {
    const html = `<table><tr><td>plain</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].controlType).toBeUndefined();
    expect(grid[0][0].dropdownRuleId).toBeUndefined();
  });

  test("unknown control-type value is treated as absent", () => {
    const html = `<table><tr><td data-sheets-control-type="bogus">x</td></tr></table>`;
    const { grid } = parseClipboardData(dt(html));
    expect(grid[0][0].controlType).toBeUndefined();
  });
});

describe("parseClipboardData — HTML / plain priority + fallbacks", () => {
  test("mixed text/html + text/plain prefers HTML", () => {
    // Browsers usually populate both payloads on a copy from a
    // spreadsheet — the HTML branch must win so we keep styling
    // and table structure instead of falling back to TSV.
    const d = new DataTransfer();
    d.setData(
      "text/html",
      `<table><tr><td style="font-weight:bold">html-wins</td></tr></table>`,
    );
    d.setData("text/plain", "plain-loses");
    const { grid } = parseClipboardData(d);
    expect(grid).toHaveLength(1);
    expect(grid[0][0].value).toBe("html-wins");
    expect(grid[0][0].bold).toBe(true);
  });

  test("HTML with no <table> falls back to text/plain", () => {
    // `parseHtmlTable` returns null when the document has no table
    // element, so the plain-text branch takes over. Common shape: a
    // paragraph copied out of a non-table page.
    const d = new DataTransfer();
    d.setData("text/html", `<p>just a paragraph, no table here</p>`);
    d.setData("text/plain", "fallback\tvalue");
    const { grid } = parseClipboardData(d);
    expect(grid).toEqual([[{ value: "fallback" }, { value: "value" }]]);
  });

  test("HTML with a <table> followed by stray text picks the table", () => {
    // `querySelector("table")` returns the first match — any text
    // appended after the table is ignored.
    const d = new DataTransfer();
    d.setData(
      "text/html",
      `<table><tr><td>cell</td></tr></table><p>stray trailing text</p>`,
    );
    const { grid } = parseClipboardData(d);
    expect(grid).toEqual([[expect.objectContaining({ value: "cell" })]]);
  });

  test("empty clipboard returns {grid: []} without throwing", () => {
    // No HTML, no plain text — neither branch fires and the caller
    // gets an empty grid back. Pin this so accidental future short-
    // circuits don't start throwing on an empty paste event.
    const d = new DataTransfer();
    expect(() => parseClipboardData(d)).not.toThrow();
    const { grid } = parseClipboardData(d);
    expect(grid).toEqual([]);
  });
});
