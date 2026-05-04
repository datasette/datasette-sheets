import type { CellFormat, CellValue, CustomCellValue } from "./types";

export function formatValue(value: CellValue, format: CellFormat): string {
  if (value === null || value === undefined) {
    return "";
  }

  // [sheet.cell.custom] Engine-typed Custom variants (jdate / jtime /
  // jdatetime / jzoned / jspan and host-registered handlers) render
  // via per-tag display rules before any number-format dispatch — a
  // currency mask on a date would be nonsense and we want the type
  // signal to survive.
  if (typeof value === "object" && "type_tag" in value && "data" in value) {
    return formatCustom(value);
  }

  // [sheet.cell.boolean] Booleans render as TRUE/FALSE before the
  // number-format dispatch — applying a currency / percentage mask to
  // a boolean would say "$1.00" and lose the type signal.
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  // Date/time/datetime accept a string that looks like a date; if the
  // string doesn't parse cleanly we fall back to rendering it verbatim
  // so the user sees what they typed rather than an "Invalid Date".
  if (
    format.type === "date" ||
    format.type === "time" ||
    format.type === "datetime"
  ) {
    return formatTemporal(value, format.type);
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "number") {
    return String(value);
  }

  switch (format.type) {
    case "currency":
      return formatCurrency(value, format.decimals, format.currencySymbol);
    case "percentage":
      return formatPercentage(value, format.decimals);
    case "number":
      return formatNumber(value, format.decimals);
    // [sheet.format.scientific]
    case "scientific":
      return formatScientific(value, format.decimals);
    case "general":
    default:
      return formatGeneral(value);
  }
}

function formatCurrency(
  value: number,
  decimals: number,
  symbol: string,
): string {
  const isNegative = value < 0;
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (isNegative) {
    return `(${symbol}${formatted})`;
  }
  return `${symbol}${formatted}`;
}

function formatPercentage(value: number, decimals: number): string {
  const percentage = value * 100;
  return `${percentage.toFixed(decimals)}%`;
}

function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatScientific(value: number, decimals: number): string {
  // ``toExponential`` already gives the scientific form; default to
  // 2 significant digits if the format was created without touching
  // decimals, matching Google Sheets.
  const d = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
  return value.toExponential(d);
}

/** Render a value (string or number) as a date/time/datetime. For
 *  strings, tries ISO / common formats via ``Date.parse``; Excel-
 *  serial support is out of scope for v1. For numbers treated as
 *  Excel serials we could implement later — today, numbers fall
 *  through to `String(value)` so the user sees something reasonable
 *  rather than a garbage date. */
function formatTemporal(
  value: CellValue,
  kind: "date" | "time" | "datetime",
): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  const parsed = Date.parse(str);
  if (Number.isNaN(parsed)) return str;
  const d = new Date(parsed);
  // ``en-US`` keeps output predictable regardless of the browser
  // locale. Users who need locale-aware formatting can land a custom
  // format picker later (see §7 stretch in TODO-styling.md).
  switch (kind) {
    // [sheet.format.date]
    case "date":
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    // [sheet.format.time]
    case "time":
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
    // [sheet.format.datetime]
    case "datetime":
      return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  }
}

/** Display rules for the lotus-datetime Custom variants and a passthrough
 *  for any other handler (host-registered or future) we don't yet know
 *  how to prettify. ``data`` is the handler's canonical serialised form
 *  (ISO 8601 for the j* family). [sheet.cell.custom] */
function formatCustom(value: CustomCellValue): string {
  switch (value.type_tag) {
    case "jdate":
      return formatJDate(value.data);
    case "jtime":
      return formatJTime(value.data);
    case "jdatetime":
    case "jzoned":
      return formatJDateTime(value.data);
    case "jspan":
      return formatJSpan(value.data);
    default:
      return value.data;
  }
}

// jdate is a calendar date, no timezone. Date.parse("2026-04-01") would
// parse it as midnight UTC and toLocaleDateString would then shift it
// to the browser's local TZ — in any zone west of UTC, the rendered
// date is one off. Construct the Date from explicit local components.
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatJDate(iso: string): string {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatJTime(iso: string): string {
  // Bare time strings like "12:34:56" don't parse in every browser;
  // anchor to the epoch date so Date.parse has something to chew on.
  const parsed = Date.parse(`1970-01-01T${iso}`);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatJDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// jiff serialises Span as ISO-8601 duration: optional sign, P prefix,
// optional Y/M/W/D components, T separator, optional H/M/S components.
const ISO_DURATION_RE =
  /^(-?)P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

function formatJSpan(iso: string): string {
  const m = ISO_DURATION_RE.exec(iso);
  if (!m) return iso;
  const [, sign, years, months, weeks, days, hours, mins, secs] = m;
  const parts: string[] = [];
  if (years) parts.push(`${years}y`);
  if (months) parts.push(`${months}mo`);
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs) parts.push(`${secs}s`);
  if (parts.length === 0) return iso;
  const body = parts.join(" ");
  // Use the typographic minus (U+2212) so a negative span doesn't read
  // as a hyphenated unit suffix.
  return sign === "-" ? `−${body}` : body;
}

function formatGeneral(value: number): string {
  // Smart formatting for general numbers
  if (Number.isInteger(value)) {
    return value.toString();
  }

  // Limit decimal places for display, but keep precision
  const str = value.toString();
  if (str.length > 12) {
    return value.toPrecision(10);
  }
  return str;
}

export function createDefaultFormat(): CellFormat {
  return {
    type: "general",
    decimals: 2,
    currencySymbol: "$",
  };
}

/**
 * True when the format carries anything beyond the defaults returned by
 * `createDefaultFormat`. Used by the save gate: cells with only default
 * format don't need a `format_json` blob on the wire.
 */
export function hasNonDefaultFormat(format: CellFormat): boolean {
  if (format.type !== "general") return true;
  if (format.bold) return true;
  if (format.italic) return true;
  if (format.underline) return true;
  if (format.strikethrough) return true;
  if (format.textColor) return true;
  if (format.fillColor) return true;
  if (format.hAlign) return true;
  if (format.vAlign) return true;
  if (format.wrap) return true;
  if (format.fontSize) return true;
  if (format.borders) {
    const b = format.borders;
    if (b.top || b.right || b.bottom || b.left) return true;
  }
  if (format.controlType) return true;
  if (format.dropdownRuleId) return true;
  return false;
}
