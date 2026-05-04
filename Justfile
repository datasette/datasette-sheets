DEV_PORT := "5171"

# Pinned liblotus release. Both artifacts (PyPI wheel + wasm tarball)
# come from the same upstream tag — keep this in sync with the
# `liblotus==…` pin in `pyproject.toml`.
#
# PyPI uses PEP 440 form (`0.0.1a2`); GitHub release tags use
# `0.0.1-alpha.N`. The `_PY` / `_GH` split below maps between them.
LIBLOTUS_VERSION_PY := "0.0.1a2"
LIBLOTUS_VERSION_GH := "0.0.1-alpha.2"
LIBLOTUS_WASM_DIR := "frontend/vendor/lotus-wasm"

# Sync the liblotus PyPI wheel into this repo's uv environment. The
# importable module is `lotus`; the PyPI package is `liblotus` and is
# pinned in pyproject.toml.
engine-wheel:
    uv sync

# Download the matching wasm-bindgen pkg from the GitHub release and
# extract it into `frontend/vendor/lotus-wasm/`. Vite imports the pkg
# directly from there (see `frontend/src/lib/engine.ts`). The release
# tarball is built with `--target bundler --features datetime,url` —
# don't swap to `--target web` (vite-plugin-wasm needs bundler).
engine-wasm:
    #!/usr/bin/env bash
    set -euo pipefail
    rm -rf "{{LIBLOTUS_WASM_DIR}}"
    mkdir -p "{{LIBLOTUS_WASM_DIR}}"
    url="https://github.com/asg017/liblotus/releases/download/{{LIBLOTUS_VERSION_GH}}/liblotus-wasm-{{LIBLOTUS_VERSION_GH}}.tar.gz"
    echo "Fetching $url"
    curl -fsSL "$url" | tar -xz -C "{{LIBLOTUS_WASM_DIR}}"

# Both engine artifacts at the pinned LIBLOTUS_VERSION_*. Run after
# bumping the pin (and the matching one in pyproject.toml).
engine:
    just engine-wheel
    just engine-wasm

frontend *flags:
    npm run build --prefix frontend {{flags}}

# Reap stale .js / .css / .wasm files under datasette_sheets/static/gen/
# that the current manifest.json doesn't reference. Vite deliberately
# keeps `emptyOutDir: false` so the manifest survives rebuilds, which
# means stale bundles pile up — 88 files / 8 MB after a couple
# months of iteration. This is the cleanup.
clean-gen:
    uv run scripts/clean-stale-gen.py

frontend-dev *flags:
    npm run dev --prefix frontend -- --port {{DEV_PORT}} {{flags}}

format-frontend *flags:
    npm run format --prefix frontend {{flags}}

format-frontend-check *flags:
    npm run format:check --prefix frontend {{flags}}

format-backend *flags:
    uv run ruff format {{flags}}

format-backend-check *flags:
    uv run ruff format --check {{flags}}

format:
    just format-backend
    just format-frontend

format-check:
    just format-backend-check
    just format-frontend-check

check-frontend:
    npm run check --prefix frontend

# Svelte-only type check. Faster than `check-frontend` and skips the
# tsc pass on vite.config.ts / vitest.config.ts — useful while
# iterating on app code. Prefer `check-frontend` before committing.
check-frontend-app:
    cd frontend && npx svelte-check --tsconfig ./tsconfig.app.json

check-backend:
    uvx ty check

check:
    just check-backend
    just check-frontend

lint-frontend *flags:
    npm run lint --prefix frontend {{flags}}

lint-frontend-fix *flags:
    npm run lint:fix --prefix frontend {{flags}}

types-routes:
  uv run python -c 'from datasette_sheets.router import router; import datasette_sheets.routes; import json; print(json.dumps(router.openapi_document_json()))' \
    | npx --prefix frontend openapi-typescript > frontend/api.d.ts

types:
  just types-routes

# Regenerate `datasette_sheets/_queries.py` from queries.sql.
#
# Pipeline: migrations.py is the single source of truth for schema.
# We apply it to an ephemeral sqlite file with `sqlite-utils migrate`,
# then point `solite-dev codegen` at that .db so it can resolve column
# types + nullability from the post-migration state. The JSON IR is
# checked in so PR diffs show what changed at the generator boundary;
# `tools/gen_queries.py` turns the IR into Python helpers that take a
# `sqlite3.Connection` as their first arg (to slot into datasette's
# `execute_write_fn` closures).
codegen-queries:
    #!/usr/bin/env bash
    set -euo pipefail
    # solite-dev --schema keys off file extension; mktemp -u returns
    # an extensionless path so we append .db.
    tmp_db=$(mktemp -u).db
    trap "rm -f $tmp_db" EXIT
    uv run sqlite-utils migrate "$tmp_db" datasette_sheets/migrations.py >/dev/null
    solite-dev codegen \
        --schema "$tmp_db" \
        datasette_sheets/sql/queries.sql \
        > datasette_sheets/sql/_queries.sql.json
    uv run python tools/gen_queries.py datasette_sheets/sql/_queries.sql.json \
        > datasette_sheets/_queries.py
    just format-backend datasette_sheets/_queries.py

# CI gate: regenerate into tmp files and diff against the checked-in
# copies. Fails if `just codegen-queries` hasn't been run after an
# edit to queries.sql / migrations.py / tools/gen_queries.py.
check-queries-fresh:
    #!/usr/bin/env bash
    set -euo pipefail
    # solite-dev --schema keys off file extension; mktemp -u returns
    # an extensionless path so we append .db.
    tmp_db=$(mktemp -u).db
    tmp_ir=$(mktemp)
    tmp_py=$(mktemp)
    trap "rm -f $tmp_db $tmp_ir $tmp_py" EXIT
    uv run sqlite-utils migrate "$tmp_db" datasette_sheets/migrations.py >/dev/null
    solite-dev codegen \
        --schema "$tmp_db" \
        datasette_sheets/sql/queries.sql \
        > "$tmp_ir"
    uv run python tools/gen_queries.py "$tmp_ir" > "$tmp_py"
    uv run ruff format --quiet "$tmp_py"
    diff -u datasette_sheets/sql/_queries.sql.json "$tmp_ir" || {
        echo "::error:: _queries.sql.json is stale — run \`just codegen-queries\`"
        exit 1
    }
    diff -u datasette_sheets/_queries.py "$tmp_py" || {
        echo "::error:: _queries.py is stale — run \`just codegen-queries\`"
        exit 1
    }

types-watch:
  watchexec \
    -e py \
    --clear -- \
      just types

test *flags:
    uv run pytest {{flags}}

# Fast component/store unit tests in a real browser (vitest + chromium).
test-frontend *flags:
    npm run test --prefix frontend -- {{flags}}

test-frontend-watch *flags:
    npm run test:watch --prefix frontend -- {{flags}}

test-e2e *flags:
    npx playwright test {{flags}}

test-e2e-headed *flags:
    npx playwright test --headed {{flags}}

# Pre-commit sanity for frontend work: test + type-check + lint +
# format-check. Skips the Playwright e2e suite (slow, needs backend) —
# run `just test-e2e` separately when your change touches SSE /
# persistence / multi-client paths.
verify-frontend:
    just test-frontend
    just check-frontend
    just lint-frontend
    just format-frontend-check

test-all *flags:
    just test {{flags}}
    just test-frontend
    just test-e2e

dev *flags:
  uv run \
    --with ../datasette-sidebar \
    --with ../datasette-user-profiles \
    --with ../datasette-debug-gotham \
    datasette \
      -s permissions.datasette-sheets-access true \
      -s permissions.datasette-sidebar-access true \
      {{flags}}

dev-with-hmr *flags:
  DATASETTE_SHEETS_VITE_PATH=http://localhost:{{DEV_PORT}}/-/static-plugins/datasette_sheets/ \
  watchexec \
    --stop-signal SIGKILL \
    -e py,html \
    --ignore '*.db' \
    --restart \
    --clear -- \
    just dev {{flags}}
