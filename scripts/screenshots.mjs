// Programmatic doc screenshots of datasette-sheets → docs/screenshots/*.png.
//
// SELF-CONTAINED (modelled on datasette-paper's `shots`): this boots its own
// throwaway datasette on a fixed port with a fresh internal + data DB, lets the
// shot-plugin seed a deterministic "Q3 Revenue Plan" workbook (values, SUM
// formulas, currency/bold formatting, and alice/bob/carol acl grants), drives
// Playwright, then tears the server down. One command, reproducible — so the
// committed PNGs only change when the UI actually changes (clean git diffs).
//
// Output is committed; the README embeds these, so re-run + commit when the
// grid / list / share dialog look changes:  `just shots`  (or `just shots
// editor collaboration` for a subset).
//
// Determinism notes:
//   * The workbook is owned by `alice`, shared to `bob` (Editor) + `carol`
//     (Viewer) — so the share dialog shows a populated people list and the
//     manager-only Share button renders.
//   * The collaboration shot opens the same workbook in three browser contexts
//     (alice/bob/carol). bob + carol click cells; their cursors + name labels +
//     avatars then show up live in alice's window over SSE.
//   * `freezeVolatile()` rewrites moving text (relative timestamps, the save
//     indicator) and a stability stylesheet hides the caret / disables
//     transitions / hides the dev debug widget, so a re-run with no UI change
//     produces no binary diff.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";

const PORT = Number(process.env.SHOTS_PORT || 8487);
const BASE = `http://localhost:${PORT}`;
const DB_NAME = "data";
const SHEETS = `${BASE}/${DB_NAME}/-/sheets`;
// Fixed signing secret — lets us mint signed actor cookies so the seeded
// workbook is owned/shared as expected. NOT a real secret.
const SECRET = "screenshots-secret-not-for-prod";
const INTERNAL_DB = "/tmp/datasette-sheets-shots-internal.db";
// The directory name makes the Datasette database name "data" (matches DB_NAME).
const DATA_DIR = "/tmp/datasette-sheets-shots-data";
const DATA_DB = `${DATA_DIR}/${DB_NAME}.db`;

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = resolve(HERE, "shot-plugins");
const OUT = resolve(HERE, "../docs/screenshots");

const VIEWPORT = { width: 1280, height: 820 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Signed ds_actor cookie for an actor id. itsdangerous has no maintained Node
// port, so shell out to the same one-liner the e2e helpers use. Cached per id.
const _signed = new Map();
function signActorCookie(actorId) {
  let v = _signed.get(actorId);
  if (!v) {
    const out = execFileSync(
      "uv",
      [
        "run",
        "python",
        "-c",
        "import sys, json; from itsdangerous import URLSafeSerializer; " +
          'print(URLSafeSerializer(sys.argv[1]).dumps(json.loads(sys.argv[2]), salt="actor"))',
        SECRET,
        JSON.stringify({ a: { id: actorId } }),
      ],
      { encoding: "utf-8" },
    );
    v = out.trim();
    _signed.set(actorId, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
async function reachable() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 500);
    const r = await fetch(SHEETS, { redirect: "manual", signal: ac.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch {
    return false;
  }
}

// Create an empty (but valid) sqlite file so datasette opens it mutable and the
// shot-plugin's startup seed can write the workbook into it.
function setupDataDb() {
  const py = `
import os, sqlite3
os.makedirs(${JSON.stringify(DATA_DIR)}, exist_ok=True)
p = ${JSON.stringify(DATA_DB)}
if os.path.exists(p): os.remove(p)
sqlite3.connect(p).close()
`;
  execFileSync("uv", ["run", "python", "-c", py]);
}

async function startServer() {
  await rm(INTERNAL_DB, { force: true });
  setupDataDb();
  // Refuse to start if something is already on the port rather than killing it.
  if (await reachable()) {
    throw new Error(
      `something is already serving on ${BASE}. Stop it (or set SHOTS_PORT) and retry.`,
    );
  }
  // `detached: true` puts datasette in its own process group. datasette is a
  // grandchild of `uv run`, so we kill the whole group in stopServer.
  const child = spawn(
    "uv",
    [
      "run",
      "datasette",
      "--internal",
      INTERNAL_DB,
      DATA_DB,
      "--secret",
      SECRET,
      // Throwaway plugin: friendly actor names + seeds the demo workbook/grants.
      "--plugins-dir",
      PLUGINS_DIR,
      // Coarse instance gate open for everyone; per-workbook acl does the rest.
      "-s",
      "permissions.datasette-sheets-access",
      "true",
      "-p",
      String(PORT),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      // Pin the hash seed so the backend's presence colours
      // (PRESENCE_COLORS[hash(actor_id) % N]) are stable across runs — Python
      // string hashing is per-process randomised otherwise, which would churn
      // the collaboration shot's cursor/avatar colours on every regenerate.
      env: { ...process.env, PYTHONHASHSEED: "0" },
    },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`datasette exited early (code ${child.exitCode}):\n${log}`);
    }
    if (await reachable()) return child;
    await sleep(250);
  }
  stopServer(child);
  throw new Error(`datasette never came up on ${BASE}:\n${log}`);
}

// Kill the server's whole process group (datasette is uv's child). Idempotent.
function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Per-page stabilization.
const STABILITY_CSS = `*, *::before, *::after {
  caret-color: transparent !important;
  transition: none !important;
  animation: none !important;
}
/* Dev-only widgets: the sheets debug toggle + datasette-debug-bar's
   fixed panel (hosts gotham's user-switcher). Both are dev deps, never
   shipped. */
.debug-widget { display: none !important; }
#datasette-debug-bar { display: none !important; }`;

async function freezeVolatile(page) {
  await page.evaluate(() => {
    const set = (sel, text) =>
      document.querySelectorAll(sel).forEach((el) => (el.textContent = text));
    // Workbook list page: "Updated <timestamp>".
    set(".workbook-card .meta", "Updated just now");
    // datasette-debug-bar's fixed panel (dev dep) — remove outright; it
    // appends a position:fixed div to <body> after our stability CSS loads.
    document.getElementById("datasette-debug-bar")?.remove();
  });
}

// Make a per-actor context: stability CSS injected on every navigation + that
// actor's signed cookie.
async function makeContext(browser, actorId) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript((css) => {
    const inject = () => {
      if (document.getElementById("__shots_stability")) return;
      const s = document.createElement("style");
      s.id = "__shots_stability";
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    inject();
    document.addEventListener("DOMContentLoaded", inject);
  }, STABILITY_CSS);
  await ctx.addCookies([
    { name: "ds_actor", value: signActorCookie(actorId), domain: "localhost", path: "/" },
  ]);
  return ctx;
}

// Resolve the seeded workbook's id by name via the JSON list API.
async function findWorkbookId(ctx, name) {
  const r = await ctx.request.get(`${SHEETS}/api/workbooks`);
  if (!r.ok()) throw new Error(`list workbooks failed: ${r.status()}`);
  const { workbooks } = await r.json();
  const wb = workbooks.find((w) => w.name === name);
  if (!wb) throw new Error(`seeded workbook "${name}" not found (have: ${workbooks.map((w) => w.name).join(", ")})`);
  return wb.id;
}

// Open a workbook in a page and wait for the grid + live connection.
async function gotoWorkbook(page, wbId, { waitConnected = true } = {}) {
  await page.goto(`${SHEETS}/workbook/${wbId}`);
  await page.locator(".sheets-root").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".sheets-loading").waitFor({ state: "detached", timeout: 20_000 });
  // First data cell rendered with its seeded value.
  await page
    .locator('[data-cell-id="A1"] .cell-value')
    .filter({ hasText: "Region" })
    .waitFor({ timeout: 15_000 });
  if (waitConnected) {
    await page.locator(".connection-dot.connected").waitFor({ timeout: 15_000 });
  }
}

// ---------------------------------------------------------------------------
// Shots.
function buildShots(browser, wbId) {
  const out = (n) => resolve(OUT, `${n}.png`);

  return {
    // The server-rendered workbook list (inside Datasette's chrome).
    "workbook-list": async () => {
      const ctx = await makeContext(browser, "alice");
      const page = await ctx.newPage();
      await page.goto(SHEETS);
      await page.locator(".workbook-card").first().waitFor({ timeout: 15_000 });
      await freezeVolatile(page);
      await page.screenshot({ path: out("workbook-list") });
      await ctx.close();
    },

    // The main spreadsheet: forecast table, SUM formulas, currency + bold.
    editor: async () => {
      const ctx = await makeContext(browser, "alice");
      const page = await ctx.newPage();
      await gotoWorkbook(page, wbId);
      // Wait for a formula cell to have computed (Total column).
      await page
        .locator('[data-cell-id="D2"] .cell-value')
        .filter({ hasText: "$" })
        .waitFor({ timeout: 15_000 });
      await freezeVolatile(page);
      await page.screenshot({ path: out("editor") });
      await ctx.close();
    },

    // Live collaboration: alice's window with bob + grace present, their
    // cursors + name labels + avatars flowing in over SSE.
    collaboration: async () => {
      const ctxA = await makeContext(browser, "alice");
      const ctxB = await makeContext(browser, "bob");
      const ctxC = await makeContext(browser, "grace");
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const pageC = await ctxC.newPage();
      try {
        await gotoWorkbook(pageA, wbId);
        await gotoWorkbook(pageB, wbId);
        await gotoWorkbook(pageC, wbId);

        // bob + grace park their cursors on distinct cells; presence is
        // debounced + broadcast, so alice's window picks them up.
        await pageB.locator('[data-cell-id="B3"]').click();
        await pageC.locator('[data-cell-id="C5"]').click();

        // alice sees two remote presences: avatars in the strip + at least one
        // labelled remote cursor on the grid.
        await pageA
          .locator(".active-users .user-avatar")
          .nth(1)
          .waitFor({ timeout: 15_000 });
        await pageA.locator(".cell.remote-cursor").first().waitFor({ timeout: 15_000 });
        await pageA.locator(".presence-label").first().waitFor({ timeout: 15_000 });
        // Let the second cursor + label settle before capture.
        await sleep(500);

        await freezeVolatile(pageA);
        await pageA.screenshot({ path: out("collaboration") });
      } finally {
        await ctxA.close();
        await ctxB.close();
        await ctxC.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
async function main() {
  const requested = new Set(process.argv.slice(2));

  await mkdir(OUT, { recursive: true });
  console.log(`booting datasette on ${BASE} …`);
  const server = await startServer();
  const onSignal = () => {
    stopServer(server);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const browser = await chromium.launch();
  try {
    // Discover the seeded workbook id (alice owns it).
    const discoverCtx = await makeContext(browser, "alice");
    const wbId = await findWorkbookId(discoverCtx, "Q3 Revenue Plan");
    await discoverCtx.close();

    const shotsByName = buildShots(browser, wbId);
    const names = Object.keys(shotsByName);
    const unknown = [...requested].filter((n) => !names.includes(n));
    if (unknown.length) {
      throw new Error(`unknown shot(s): ${unknown.join(", ")} (have: ${names.join(", ")})`);
    }
    const todo = requested.size ? names.filter((n) => requested.has(n)) : names;

    for (const name of todo) {
      await shotsByName[name]();
      console.log(`✓ ${name} → ${resolve(OUT, name + ".png")}`);
    }
  } finally {
    await browser.close();
    stopServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
