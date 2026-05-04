/**
 * Pure / store-touching helpers for the cell context menu. Lifted out
 * of Grid.svelte during the cell-grid-04 extraction so the new
 * ``CellContextMenu.svelte`` component stays focused on layout +
 * dispatch.
 *
 * - ``buildApiUrl`` is pure — same inputs, same output, no DOM /
 *   store reads — and returns ``null`` when the workbook hasn't
 *   loaded its sheet id yet (the caller should bail).
 * - ``copyToClipboard`` returns a result object so callers decide
 *   between an alert and a future inline toast. Existing callers
 *   keep using ``alert()`` but the helper no longer hard-codes that
 *   choice.
 * - ``defineNamedRangeFromRange`` is the one-line wrapper around
 *   ``openNamedRangesPanel`` so the component doesn't have to spell
 *   out the ``initialDefinition: "=A1:B5"`` shape.
 */
import { openNamedRangesPanel } from "./stores/namedRanges";

export interface BuildApiUrlArgs {
  database: string;
  workbookId: string;
  sheetId: string;
  range: string;
}

/**
 * Build the data-API URL for a single-cell or range selection.
 *
 * Single-cell selections (``A1``) use the path-style
 * ``/data/{cellId}`` route; ranges (``A1:B5``) use
 * ``/data?range=A1:B5``. Mirrors FormulaBar's copyApiUrl so users
 * see the same URL whether they reach for the formula-bar dropdown
 * or right-click the selection.
 *
 * Returns ``null`` when ``sheetId`` is empty — callers shouldn't
 * silently surface a malformed URL.
 */
export function buildApiUrl(args: BuildApiUrlArgs): string | null {
  const { database, workbookId, sheetId, range } = args;
  if (!sheetId) return null;
  const base = `${window.location.origin}/${database}/-/sheets/api/workbooks/${workbookId}/sheets/${sheetId}/data`;
  return range.includes(":") ? `${base}?range=${range}` : `${base}/${range}`;
}

export type CopyResult = { ok: true } | { ok: false; error: Error };

/**
 * Wrap ``navigator.clipboard.writeText`` in a result-typed shim.
 * Returning a result lets the caller decide between alert /
 * inline-toast / silent — currently every callsite manually
 * ``try/catch + alert``s, but new callers shouldn't have to inherit
 * that choice.
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Open the Named Ranges panel pre-populated with the right-clicked
 * range as the initial definition.
 */
// [sheet.named-range.define-from-context]
export function defineNamedRangeFromRange(range: string): void {
  openNamedRangesPanel({ initialDefinition: `=${range}` });
}
