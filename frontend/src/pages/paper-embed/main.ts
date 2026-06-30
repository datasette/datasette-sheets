/**
 * datasette-paper embed integration.
 *
 * Defines a `<datasette-sheets-preview db="…" workbook-id="N">` web component
 * that renders a compact, read-only preview of a sheets workbook (its sheet
 * tabs + the first sheet's top-left cells), fetching its own data from the
 * sheets API. Then `export default`s a paper embed provider for the
 * `sheets-workbook` kind: paper `import()`s this bundle on demand and registers
 * the provider for us (see the provider descriptor in datasette_sheets/paper.py
 * and docs/EMBED_PROVIDERS.md in datasette-paper).
 *
 * Everything is client-side: resolve/search fetch the sheets API with the
 * viewer's `ds_actor` cookie, so per-viewer leak discipline is ours — a denied
 * workbook yields `denied`/`not_found` with no name or data leaked.
 *
 * Ref shape: sheets workbook pages are database-scoped
 * (`/{db}/-/sheets/workbook/{id}`), which can't sit under a single fixed
 * `ref_prefix`, so we store a normalized ref `/-/sheets/workbook/{db}/{id}`
 * (db folded behind the fixed prefix) and map the real page URL onto it in
 * `matchUrl`. The inline-pill / block-header link (`href`) is the real,
 * navigable workbook URL.
 */
import "./style.css";

// Normalized stored ref:        /-/sheets/workbook/{db}/{id}
const REF_RE = /^\/-\/sheets\/workbook\/([^/]+)\/(\d+)\/?$/;
// Real (navigable) workbook URL: /{db}/-/sheets/workbook/{id}
const PAGE_RE = /^\/([^/]+)\/-\/sheets\/workbook\/(\d+)\/?$/;

const PREVIEW_ROWS = 12;
const PREVIEW_COLS = 8;

// bootstrap-icons/table — inline pill + block-card header icon. Static markup
// only (paper renders it as raw HTML, unsanitized — never interpolate data).
const TABLE_ICON =
  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 2h-4v3h4zm0 4h-4v3h4zm0 4h-4v3h3a1 1 0 0 0 1-1zm-5 3v-3H6v3zm-5 0v-3H1v2a1 1 0 0 0 1 1zm-4-4h4V8H1zm0-4h4V4H1zm5-3v3h4V4zm4 4H6v3h4z"/></svg>';

interface WorkbookRef {
  db: string;
  id: number;
}

function parseRef(ref: string): WorkbookRef | null {
  const m = REF_RE.exec(ref);
  return m ? { db: m[1], id: Number(m[2]) } : null;
}

/** The real, navigable workbook page URL for a normalized ref. */
function pageUrl(r: WorkbookRef): string {
  return `/${r.db}/-/sheets/workbook/${r.id}`;
}

interface WorkbookMeta {
  name: string;
  sheets: Array<{ id: number; name: string; color: string | null }>;
}

/** Fetch the workbook's name + sheet list (viewer's cookie). Throws on !ok. */
async function fetchWorkbook(r: WorkbookRef): Promise<WorkbookMeta> {
  const res = await fetch(`/${r.db}/-/sheets/api/workbooks/${r.id}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`workbook ${res.status}`);
  const j = (await res.json()) as {
    workbook?: { name?: string };
    sheets?: Array<{ id: number; name: string; color: string | null }>;
  };
  return {
    name: j.workbook?.name || `Workbook ${r.id}`,
    sheets: j.sheets ?? [],
  };
}

interface SheetGrid {
  columns: string[];
  rows: unknown[][];
}

/** Fetch one sheet's data grid (arrays format), capped to the preview window. */
async function fetchSheetData(
  r: WorkbookRef,
  sheetId: number,
): Promise<SheetGrid> {
  const res = await fetch(
    `/${r.db}/-/sheets/api/workbooks/${r.id}/sheets/${sheetId}/data`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`sheet ${res.status}`);
  const j = (await res.json()) as { columns?: string[]; rows?: unknown[][] };
  const columns = (j.columns ?? []).slice(0, PREVIEW_COLS);
  const rows = (j.rows ?? [])
    .slice(0, PREVIEW_ROWS)
    .map((row) => (Array.isArray(row) ? row.slice(0, PREVIEW_COLS) : []));
  return { columns, rows };
}

/** Stringify a cell value for display (textContent — never innerHTML). */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * `<datasette-sheets-preview db="…" workbook-id="N">` — read-only preview of a
 * workbook: its sheet tabs + the first sheet's top-left cells. All values land
 * in the DOM as text nodes, never innerHTML (the only innerHTML use is the
 * trusted constant icon, which this component doesn't render — paper owns the
 * header).
 */
class DatasetteSheetsPreview extends HTMLElement {
  connectedCallback(): void {
    this.style.display = "block";
    this.style.width = "100%";
    const db = this.getAttribute("db");
    const workbookId = Number(this.getAttribute("workbook-id"));
    if (!db || !Number.isFinite(workbookId)) {
      this.textContent = "Invalid workbook reference";
      return;
    }
    void this.renderPreview({ db, id: workbookId });
  }

  private async renderPreview(r: WorkbookRef): Promise<void> {
    let meta: WorkbookMeta;
    try {
      meta = await fetchWorkbook(r);
    } catch {
      this.textContent = "Could not load this workbook";
      return;
    }
    if (!this.isConnected) return; // unmounted while fetching

    const root = document.createElement("div");
    root.className = "ds-sheets-embed";

    // Sheet tabs (names only — read-only).
    if (meta.sheets.length) {
      const tabs = document.createElement("div");
      tabs.className = "ds-sheets-embed-tabs";
      for (const [i, s] of meta.sheets.entries()) {
        const tab = document.createElement("span");
        tab.className = "ds-sheets-embed-tab";
        if (i === 0) tab.classList.add("is-active");
        if (s.color) tab.style.borderBottomColor = s.color;
        tab.textContent = s.name;
        tabs.appendChild(tab);
      }
      root.appendChild(tabs);
    }

    const gridHost = document.createElement("div");
    gridHost.className = "ds-sheets-embed-grid";
    gridHost.textContent = "Loading…";
    root.appendChild(gridHost);

    this.replaceChildren(root);

    // Data for the first sheet.
    const first = meta.sheets[0];
    if (!first) {
      gridHost.textContent = "This workbook has no sheets.";
      return;
    }
    let grid: SheetGrid;
    try {
      grid = await fetchSheetData(r, first.id);
    } catch {
      gridHost.textContent = "Could not load sheet data";
      return;
    }
    if (!this.isConnected) return;
    this.renderGrid(gridHost, grid);
  }

  private renderGrid(host: HTMLElement, grid: SheetGrid): void {
    if (!grid.columns.length || !grid.rows.length) {
      host.textContent = "This sheet is empty.";
      return;
    }
    const table = document.createElement("table");
    table.className = "ds-sheets-embed-table";

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    // Leading corner cell (row-number gutter).
    hr.appendChild(document.createElement("th"));
    for (const col of grid.columns) {
      const th = document.createElement("th");
      th.textContent = col;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    grid.rows.forEach((row, i) => {
      const tr = document.createElement("tr");
      const rowHead = document.createElement("th");
      rowHead.className = "ds-sheets-embed-rownum";
      rowHead.textContent = String(i + 1);
      tr.appendChild(rowHead);
      for (let c = 0; c < grid.columns.length; c++) {
        const td = document.createElement("td");
        td.textContent = cellText(row[c]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    host.replaceChildren(table);
  }
}

if (!customElements.get("datasette-sheets-preview")) {
  customElements.define("datasette-sheets-preview", DatasetteSheetsPreview);
}

// --- Paper embed provider (paper import()s this bundle + registers it) -------

type ResolveResult =
  | { status: "ok"; kind: string; label: string; href: string; icon?: string }
  | { status: "denied" }
  | { status: "not_found" }
  | null;

interface PaperEmbedContext {
  ref: string;
  mode: string;
}

interface PickerSource {
  id: string;
  label: string;
  icon?: string;
  mode?: string;
}

interface SearchHit {
  ref: string;
  label: string;
  kind?: string;
  detail?: string;
}

const provider = {
  kind: "sheets-workbook",

  /** Claim a stored ref (checked before paper's native .json resolution). */
  matchRef(ref: string): boolean {
    return REF_RE.test(ref);
  },

  /** Claim a pasted same-origin workbook URL → the normalized ref to store. */
  matchUrl(url: URL): string | null {
    const m = PAGE_RE.exec(url.pathname);
    return m ? `/-/sheets/workbook/${m[1]}/${m[2]}` : null;
  },

  /** Inline-pill identity. Fetch with the viewer's cookie; leak discipline:
   *  a denied/missing workbook never yields a label. */
  async resolve(ref: string): Promise<ResolveResult> {
    const r = parseRef(ref);
    if (!r) return { status: "not_found" };
    let res: Response;
    try {
      res = await fetch(`/${r.db}/-/sheets/api/workbooks/${r.id}`, {
        headers: { Accept: "application/json" },
      });
    } catch {
      return { status: "not_found" };
    }
    if (res.status === 403) return { status: "denied" }; // never a label here
    if (!res.ok) return { status: "not_found" };
    const j = (await res.json()) as { workbook?: { name?: string } };
    return {
      status: "ok",
      kind: "sheets-workbook",
      label: j.workbook?.name || `Workbook ${r.id}`,
      href: pageUrl(r),
      icon: TABLE_ICON,
    };
  },

  /** Block card body. Paper owns the header; we fill `host` with the preview. */
  mount(host: HTMLElement, ctx: PaperEmbedContext): () => void {
    const r = parseRef(ctx.ref);
    const el = document.createElement("datasette-sheets-preview");
    if (r) {
      el.setAttribute("db", r.db);
      el.setAttribute("workbook-id", String(r.id));
    }
    host.appendChild(el);
    return () => el.remove();
  },

  /** Browsable `/`-menu source — mirrored by `sources` in paper.py so it shows
   *  before this bundle loads. */
  picker(): PickerSource {
    return { id: "sheets", label: "Spreadsheet", icon: "table", mode: "block" };
  },

  /** Viewer-visible workbooks matching `q`, across databases, for the picker.
   *  No native cross-database workbook search exists, so enumerate `/.json`
   *  (database names) then each db's workbooks API and filter client-side.
   *  The sheets API enforces the viewer's permissions. */
  async search(q: string, limit: number): Promise<SearchHit[]> {
    const ql = (q || "").toLowerCase();
    let dbNames: string[];
    try {
      const top = await fetch("/.json", {
        headers: { Accept: "application/json" },
      });
      if (!top.ok) return [];
      const tj = (await top.json()) as { databases?: Record<string, unknown> };
      // Datasette's internal databases are `_`-prefixed; never offer them.
      dbNames = Object.keys(tj.databases ?? {}).filter(
        (n) => !n.startsWith("_"),
      );
    } catch {
      return [];
    }

    const perDb = await Promise.all(
      dbNames.map(async (db): Promise<SearchHit[]> => {
        try {
          const res = await fetch(`/${db}/-/sheets/api/workbooks`, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) return [];
          const j = (await res.json()) as {
            workbooks?: Array<{ id: number; name: string | null }>;
          };
          return (j.workbooks ?? [])
            .filter((w) => !ql || (w.name || "").toLowerCase().includes(ql))
            .map((w) => ({
              ref: `/-/sheets/workbook/${db}/${w.id}`,
              kind: "sheets-workbook",
              label: w.name || `Workbook ${w.id}`,
              detail: db,
            }));
        } catch {
          return [];
        }
      }),
    );

    const hits = perDb.flat();
    hits.sort((a, b) => {
      const an = a.label.toLowerCase();
      const bn = b.label.toLowerCase();
      const aStarts = ql && an.startsWith(ql) ? 0 : 1;
      const bStarts = ql && bn.startsWith(ql) ? 0 : 1;
      return aStarts - bStarts || an.localeCompare(bn);
    });
    return hits.slice(0, limit);
  },
};

export default provider;
