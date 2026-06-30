"""datasette-paper integration: a ``paper_embed_provider`` so a sheets workbook
can be referenced/embedded inside a paper document.

Paper resolves and renders embeds **entirely client-side** (see
``frontend/src/pages/paper-embed/main.ts``): the bundle claims
``/-/sheets/workbook/{db}/{id}`` refs, fetches its own data from the sheets API
with the viewer's cookie, and owns leak discipline. The backend's only job is to
*describe* this provider — its stable ``kind``, the ref namespace it owns, the
``/``-menu source, and where its JS/CSS bundle lives — so paper can lazy-load
that bundle on demand. There is no server-side resolve/render/search.

Note on the ref shape: sheets workbook pages are *database-scoped*
(``/{db}/-/sheets/workbook/{id}``), so the canonical URL path can't sit under a
single fixed ``ref_prefix``. We therefore store a normalized ref
``/-/sheets/workbook/{db}/{id}`` (db folded behind the fixed prefix) so paper's
``startsWith(ref_prefix)`` lazy-load on render works; the bundle's ``matchUrl``
maps a pasted real workbook URL back onto that normalized ref.

The hook is a no-op unless datasette-paper is installed (it owns the
``paper_embed_provider`` spec); when absent, nothing calls this.
"""

from __future__ import annotations

from datasette import hookimpl
from datasette_vite import vite_css_urls, vite_js_urls

# Vite entry that defines the web component + default-exports the paper provider.
_PAPER_EMBED_ENTRY = "src/pages/paper-embed/main.ts"


class SheetsEmbedProvider:
    """Describes the sheets workbook embed for datasette-paper's editor.

    ``kind`` must equal the bundle's default-exported provider ``kind``. The
    actual resolve/render/search all live in that bundle.
    """

    kind = "sheets-workbook"
    label = "Spreadsheet"
    # Stored refs are the normalized ``/-/sheets/workbook/{db}/{id}`` — all under
    # this namespace. Lets paper inject our bundle for a doc's embeds before
    # running our matchRef.
    ref_prefixes = ["/-/sheets/workbook/"]
    # Mirrors the bundle's picker() source so the `/` menu can list it before
    # the bundle loads; picking it injects the bundle, then runs its search().
    sources = [
        {
            "id": "sheets",
            "label": "Spreadsheet",
            "icon": "table",
            "mode": "block",
        },
    ]

    def frontend_assets(self, datasette):
        # Paper's embed loader does `import(url)` over a list of *string* URLs
        # (see embedProviders.ts); vite_js_urls returns `{"url", "module"}`
        # dicts (shaped for a script-tag consumer), so unwrap to the bare URL.
        # vite_css_urls already returns plain href strings.
        js = vite_js_urls(
            datasette=datasette,
            entrypoint=_PAPER_EMBED_ENTRY,
            plugin_package="datasette_sheets",
        )
        return {
            "js": [u["url"] if isinstance(u, dict) else u for u in js],
            "css": vite_css_urls(
                datasette=datasette,
                entrypoint=_PAPER_EMBED_ENTRY,
                plugin_package="datasette_sheets",
            ),
        }


@hookimpl
def paper_embed_provider(datasette):
    return SheetsEmbedProvider()
