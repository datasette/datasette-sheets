/**
 * Parse clipboard data into a 2D grid of cell values with optional styling.
 * Tries HTML table first (from Google Sheets, Excel, Obsidian, etc.),
 * then falls back to TSV/plain text.
 */

export interface ClipboardCell {
  value: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** CSS color read from `color:` inline style. */
  textColor?: string;
  /** CSS color read from `background-color:` / `background:` inline style. */
  fillColor?: string;
  /** Horizontal alignment (``left | center | right``). */
  hAlign?: "left" | "center" | "right";
  /** Font size in points parsed from `font-size:` inline style. */
  fontSize?: number;
  /** Raw formula text (starting with `=`) when the source cell carried
   *  one and the clipboard came from another datasette-sheets tab.
   *  Read out of `data-sheets-formula` on the pasted HTML; absent for
   *  paste from external apps. */
  formula?: string;
  /** Interactive control format (``"checkbox"`` /
   *  ``"dropdown"``). Read out of ``data-sheets-control-type`` on
   *  the pasted HTML; absent for paste from external apps.
   *  [sheet.format.checkbox] [sheet.data.dropdown] */
  controlType?: "checkbox" | "dropdown";
  /** When ``controlType === "dropdown"``, the workbook-scoped rule
   *  id whose options gate this cell. Only meaningful on intra-app
   *  paste — external apps drop this attr. Pasting across workbooks
   *  also fails to resolve (the destination workbook has its own
   *  rule namespace) and the cell will degrade to plain text on the
   *  next render. [sheet.data.dropdown] */
  dropdownRuleId?: number;
}

/** A cell being *written* to the clipboard. `numeric` controls right-align
 *  on paste targets that honor it (Excel/Google Sheets style numbers).
 *  `formula` rides on the html payload (per-td `data-sheets-formula`)
 *  so the receiving paste handler can shift refs relative to the
 *  source anchor. Plain text stays the computed value — external
 *  apps see clean numbers/strings. */
export interface CopyCell {
  value: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  textColor?: string;
  fillColor?: string;
  hAlign?: "left" | "center" | "right";
  fontSize?: number;
  numeric?: boolean;
  formula?: string;
  /** Interactive control format. Round-trips via the
   *  ``data-sheets-control-type`` attribute.
   *  [sheet.format.checkbox] [sheet.data.dropdown] */
  controlType?: "checkbox" | "dropdown";
  /** Rule id for ``controlType: "dropdown"`` cells. Round-trips
   *  via ``data-sheets-dropdown-rule-id``. Only resolves inside the
   *  source workbook. [sheet.data.dropdown] */
  dropdownRuleId?: number;
}

/**
 * Parse an HTML string containing a <table> into a 2D array of cells with styling.
 * Uses DOMParser (no script execution — safe for untrusted HTML).
 *
 * Extracts bold from:
 * - <th> elements (headers are bold by default)
 * - inline style font-weight:bold / font-weight:700
 * - <b> or <strong> wrapping the content
 */
function parseHtmlTable(html: string): ParsedClipboard | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;

  const sourceAnchor =
    table.getAttribute("data-sheets-source-anchor") ?? undefined;

  const rows: ClipboardCell[][] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const row: ClipboardCell[] = [];
    for (const cell of tr.querySelectorAll("th, td")) {
      const el = cell as HTMLElement;
      const value = (el.textContent ?? "").trim();

      // Detect text styling from inline style, semantic tags, and
      // nested elements. GSheets emits inline styles; Excel/Numbers
      // prefer the tag soup; hand-authored HTML could be either.
      const style = el.getAttribute("style") ?? "";
      const decls = parseInlineStyle(style);

      const isBoldStyle = isBoldFontWeight(decls.get("font-weight"));
      const isTh = el.tagName === "TH";
      const hasBoldChild = el.querySelector("b, strong") !== null;
      const bold = isBoldStyle || isTh || hasBoldChild;

      const isItalicStyle = decls.get("font-style") === "italic";
      const hasItalicChild = el.querySelector("i, em") !== null;
      const italic = isItalicStyle || hasItalicChild;

      // Look up the exact `text-decoration` shorthand (or the
      // long-form `text-decoration-line`). Subproperties like
      // `text-decoration-color` / `-thickness` / `-style` carry
      // colours / lengths / line styles, never `underline` or
      // `line-through`, so we ignore them.
      const decoration =
        decls.get("text-decoration") ?? decls.get("text-decoration-line") ?? "";
      const isUnderlineStyle = /\bunderline\b/i.test(decoration);
      const hasUnderlineChild = el.querySelector("u") !== null;
      const underline = isUnderlineStyle || hasUnderlineChild;

      const isStrikeStyle = /\bline-through\b/i.test(decoration);
      const hasStrikeChild = el.querySelector("s, strike, del") !== null;
      const strikethrough = isStrikeStyle || hasStrikeChild;

      // Additional styling read off the inline style attribute.
      const textColor = decls.get("color");
      const bgShorthand = decls.get("background");
      const fillColor =
        decls.get("background-color") ??
        (bgShorthand && isColorLikeValue(bgShorthand)
          ? bgShorthand
          : undefined);
      const textAlignRaw = decls.get("text-align");
      const hAlign: "left" | "center" | "right" | undefined =
        textAlignRaw === "left" ||
        textAlignRaw === "center" ||
        textAlignRaw === "right"
          ? textAlignRaw
          : undefined;
      const fontSizeRaw = decls.get("font-size");
      const fontSize = fontSizeRaw ? parsePointSize(fontSizeRaw) : undefined;

      const formula = el.getAttribute("data-sheets-formula") ?? undefined;
      const controlTypeRaw =
        el.getAttribute("data-sheets-control-type") ?? undefined;
      const controlType: "checkbox" | "dropdown" | undefined =
        controlTypeRaw === "checkbox"
          ? "checkbox"
          : controlTypeRaw === "dropdown"
            ? "dropdown"
            : undefined;
      // ``data-sheets-dropdown-rule-id`` was emitted as a digit string;
      // parse back to a number so the rule lookup keys match the
      // store's number-keyed map.
      const dropdownRuleIdRaw = el.getAttribute("data-sheets-dropdown-rule-id");
      const dropdownRuleIdNum = dropdownRuleIdRaw
        ? Number(dropdownRuleIdRaw)
        : NaN;
      const dropdownRuleId = Number.isFinite(dropdownRuleIdNum)
        ? dropdownRuleIdNum
        : undefined;

      row.push({
        value,
        bold: bold || undefined,
        italic: italic || undefined,
        underline: underline || undefined,
        strikethrough: strikethrough || undefined,
        textColor,
        fillColor,
        hAlign,
        fontSize,
        formula,
        controlType,
        dropdownRuleId,
      });
    }
    rows.push(row);
  }

  if (rows.length === 0) return null;
  return { grid: rows, sourceAnchor };
}

/** Result of parsing a paste event. `sourceAnchor` is set only when
 *  the html came from another datasette-sheets tab — the same tab that
 *  produced the copy carried a `data-sheets-source-anchor` attribute
 *  on the <table>. Used to compute the (dRow, dCol) delta for
 *  relative-ref shifting. */
export interface ParsedClipboard {
  grid: ClipboardCell[][];
  sourceAnchor?: string;
}

/**
 * Parse plain text (tab-separated values) into a 2D array.
 * No styling info available from plain text.
 *
 * Notes on shape preservation:
 * - Blank lines in the middle of the input are intentional (the
 *   user copied a blank row); they survive as a single-empty-cell
 *   row so the destination grid stays aligned with the source.
 * - TSV cell values are NOT trimmed — whitespace is content (e.g.
 *   `" 1234 Main St "` from an address column).
 * - Markdown-table detection requires a real separator row on
 *   line 2 (`|---|---|`), not just a `|` character somewhere on
 *   line 1; otherwise pipe-bearing plain text (regexes, code) gets
 *   eaten as a malformed table.
 */
function parsePlainText(text: string): ClipboardCell[][] {
  // Strip ONLY a single trailing newline. Don't filter blank lines —
  // they represent blank rows and should produce blank-cell rows.
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = trimmed.split("\n");

  // If a tab appears anywhere, treat the whole paste as TSV (matches
  // GSheets / Excel plain output). Empty lines become a single empty
  // cell so the row count stays aligned with the source.
  if (lines.some((l) => l.includes("\t"))) {
    return lines.map((line) =>
      line === ""
        ? [{ value: "" }]
        : line.split("\t").map((c) => ({ value: c })),
    );
  }

  // Markdown table: only when line 2 is an actual separator row
  // (`|---|---|` or with alignment colons). Otherwise we treat `|`
  // as ordinary text (regexes, code snippets, etc.).
  if (
    lines.length >= 2 &&
    /^\s*\|/.test(lines[0]) &&
    /^\s*\|[\s\-:|]+\|\s*$/.test(lines[1])
  ) {
    return lines
      .filter((_, i) => i !== 1)
      .map((line) => {
        const inner = line.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "");
        return inner.split(/\s*\|\s*/).map((c) => ({ value: c }));
      });
  }

  // Single-cell paste: keep the user's spacing — no `.trim()`.
  return [[{ value: text }]];
}

/**
 * Extract a 2D grid of cells from a paste event's clipboard data.
 * Prefers HTML table parsing (has styling + intra-app formula attrs),
 * falls back to plain text. `sourceAnchor` is non-empty only when the
 * html came from another datasette-sheets tab.
 */
export function parseClipboardData(
  clipboardData: DataTransfer,
): ParsedClipboard {
  // Try HTML first — richer structure + styling from spreadsheets/tables
  const html = clipboardData.getData("text/html");
  if (html) {
    const parsed = parseHtmlTable(html);
    if (parsed) return parsed;
  }

  // Fall back to plain text
  const text = clipboardData.getData("text/plain");
  if (text) {
    return { grid: parsePlainText(text) };
  }

  return { grid: [] };
}

/**
 * Split an inline ``style`` attribute into a `Map<property, value>`.
 * Property names are lowercased and values trimmed. One pass over
 * the string instead of one regex per consumer.
 *
 * Not a general-purpose CSS parser — good enough for the shapes
 * ``buildCopyPayload`` emits and for what Google Sheets / Excel spit
 * out on their clipboard HTML. Pathological input (escaped
 * semicolons in URL values, nested parentheses with `;` inside) is
 * out of scope.
 */
function parseInlineStyle(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of style.split(";")) {
    const ix = decl.indexOf(":");
    if (ix === -1) continue;
    const k = decl.slice(0, ix).trim().toLowerCase();
    const v = decl.slice(ix + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

/**
 * Treat a ``font-weight`` value as bold when it's the keyword
 * ``bold`` / ``bolder`` or any numeric weight ≥ 600 (GSheets
 * actually emits ``700`` for bold, but ``600`` semibold should also
 * register as bold for our binary flag).
 */
function isBoldFontWeight(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v === "bold" || v === "bolder") return true;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 600;
}

/**
 * Heuristic shape check for ``background:`` shorthand values that we
 * can safely store as a fill colour: hex (``#abc`` / ``#aabbcc``),
 * ``rgb(...)`` / ``rgba(...)`` / ``hsl(...)`` / ``hsla(...)``, or a
 * single bareword (named colours like ``red``, ``transparent``).
 *
 * Rejects URL-bearing shorthands (``background: url(x.png) center``)
 * and any value with internal whitespace, which signals a multi-part
 * shorthand we shouldn't echo back into the cell as a colour.
 */
function isColorLikeValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/\burl\s*\(/i.test(v)) return false;
  if (v.startsWith("#")) return /^#[0-9a-f]{3,8}$/i.test(v);
  if (/^(?:rgba?|hsla?)\s*\(/i.test(v)) {
    // Reject any whitespace before the opening paren — that would
    // be a second token, not a colour function.
    return /^[a-z]+\s*\([^)]*\)$/i.test(v);
  }
  // Single bareword (named colour). Anything with whitespace = multi-part shorthand.
  return /^[a-z][a-z0-9-]*$/i.test(v);
}

/**
 * Parse a CSS font-size value back into a numeric point size. Accepts
 * ``12pt``, ``14px``, ``1.2em`` — px is converted at the standard 4:3
 * ratio, em falls back to a best-effort 10pt baseline. Anything
 * unparseable returns ``undefined`` so the caller leaves the format
 * alone.
 */
function parsePointSize(raw: string): number | undefined {
  const m = /^\s*([\d.]+)\s*(pt|px|em|rem)?\s*$/i.exec(raw);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? "pt").toLowerCase();
  if (unit === "pt") return Math.round(n);
  if (unit === "px") return Math.round(n * 0.75);
  if (unit === "em" || unit === "rem") return Math.round(n * 10);
  return undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build clipboard-ready payloads for a 2D grid of cells, matching the
 * shape Google Sheets emits on copy:
 *
 *   - `text/html`  → a <table> prefixed with <google-sheets-html-origin>
 *     so other spreadsheet apps pick it up as tabular data.
 *   - `text/plain` → tab-separated values, newline-separated rows.
 *
 * We don't attempt to emit the proprietary Google `application/x-vnd.*`
 * payloads — those are only useful to Google's own apps and require a
 * private schema. The html+plain pair is what Excel, Numbers, Obsidian,
 * our own paste handler, etc. all consume.
 *
 * For intra-app formula round-trip we add two custom data-attributes:
 * the table carries `data-sheets-source-anchor="A1"` (top-left of the
 * copied range), and any cell whose source had a formula carries
 * `data-sheets-formula="=A2*B1"`. External apps ignore unknown
 * attributes; our own paste parser reads them to enable relative-ref
 * shifting on paste.
 */
export function buildCopyPayload(
  grid: CopyCell[][],
  sourceAnchor?: string,
): {
  html: string;
  text: string;
} {
  const rowsHtml = grid
    .map((row) => {
      const tds = row
        .map((cell) => {
          // Explicit h-align wins over the numeric auto-rule. Mirrors
          // what the in-app renderer does.
          const align = cell.hAlign
            ? `text-align:${cell.hAlign};`
            : cell.numeric
              ? "text-align:right;"
              : "";
          const weight = cell.bold ? "font-weight:bold;" : "";
          const fontStyle = cell.italic ? "font-style:italic;" : "";
          // Underline + strike stack in one declaration — apply both
          // in a single text-decoration if both flags are on.
          const decorations: string[] = [];
          if (cell.underline) decorations.push("underline");
          if (cell.strikethrough) decorations.push("line-through");
          const deco = decorations.length
            ? `text-decoration:${decorations.join(" ")};`
            : "";
          const colorDecl = cell.textColor ? `color:${cell.textColor};` : "";
          const fillDecl = cell.fillColor
            ? `background-color:${cell.fillColor};`
            : "";
          const sizeDecl = cell.fontSize ? `font-size:${cell.fontSize}pt;` : "";
          const formulaAttr = cell.formula
            ? ` data-sheets-formula="${escapeHtml(cell.formula)}"`
            : "";
          const controlAttr = cell.controlType
            ? ` data-sheets-control-type="${escapeHtml(cell.controlType)}"`
            : "";
          const dropdownAttr = cell.dropdownRuleId
            ? ` data-sheets-dropdown-rule-id="${escapeHtml(String(cell.dropdownRuleId))}"`
            : "";
          return (
            `<td style="overflow:hidden;padding:2px 3px 2px 3px;` +
            `vertical-align:bottom;${align}${weight}${fontStyle}${deco}` +
            `${colorDecl}${fillDecl}${sizeDecl}"${formulaAttr}${controlAttr}${dropdownAttr}>` +
            escapeHtml(cell.value) +
            `</td>`
          );
        })
        .join("");
      return `<tr style="height:21px;">${tds}</tr>`;
    })
    .join("");

  const anchorAttr = sourceAnchor
    ? ` data-sheets-source-anchor="${escapeHtml(sourceAnchor)}"`
    : "";
  const html =
    "<google-sheets-html-origin>" +
    '<style type="text/css"><!--td {border: 1px solid #cccccc;}' +
    "br {mso-data-placement:same-cell;}--></style>" +
    '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" ' +
    'cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;' +
    "font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;" +
    'border:none"' +
    anchorAttr +
    "><tbody>" +
    rowsHtml +
    "</tbody></table>";

  // Plain text: TSV, no trailing newline (matches Google Sheets' output).
  const text = grid.map((row) => row.map((c) => c.value).join("\t")).join("\n");

  return { html, text };
}
