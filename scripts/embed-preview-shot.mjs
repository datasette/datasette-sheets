// Dev-only: render the datasette-paper embed *block preview* in isolation and
// screenshot it, so we can compare it side-by-side against the real grid
// (docs/screenshots/editor.png) while iterating on its styling.
//
// It boots the same throwaway datasette + seeded "Q3 Revenue Plan" workbook the
// doc-screenshot harness uses, then loads the *built* paper-embed bundle
// (datasette_sheets/static/gen/...) onto a blank same-origin page and drops a
// <datasette-sheets-preview> element pointed at the seeded workbook. The
// component fetches the sheets API with alice's cookie, exactly as it would
// inside a paper document.
//
//   just frontend && node scripts/embed-preview-shot.mjs
//   → /private/tmp/.../scratchpad/embed-preview.png   (path printed at the end)
//
// NOT committed output — purely a local visual-diff aid. Requires `just
// frontend` first so the bundle reflects your edits.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";

const PORT = Number(process.env.SHOTS_PORT || 8489);
const BASE = `http://localhost:${PORT}`;
const DB_NAME = "data";
const SHEETS = `${BASE}/${DB_NAME}/-/sheets`;
const SECRET = "screenshots-secret-not-for-prod";
const INTERNAL_DB = "/tmp/datasette-sheets-embedshot-internal.db";
const DATA_DIR = "/tmp/datasette-sheets-embedshot-data";
const DATA_DB = `${DATA_DIR}/${DB_NAME}.db`;

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = resolve(HERE, "shot-plugins");
const REPO = resolve(HERE, "..");
const OUT =
  process.env.EMBED_SHOT_OUT ||
  resolve(
    "/private/tmp/claude-501/-Users-alex-work-simonw-datasette-sheets",
    "1d854b39-3c5e-428e-b14d-416e2bab379a/scratchpad/embed-preview.png",
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Locate the built paper-embed js + css via the Vite manifest.
function embedAssets() {
  const manifest = JSON.parse(
    readFileSync(resolve(REPO, "datasette_sheets/manifest.json"), "utf-8"),
  );
  const e = manifest["src/pages/paper-embed/main.ts"];
  if (!e) throw new Error("paper-embed entry missing from manifest — run `just frontend`");
  const base = "/-/static-plugins/datasette_sheets/";
  return {
    js: base + e.file.replace(/^static\//, ""),
    css: base + (e.css?.[0] || "").replace(/^static\//, ""),
  };
}

const _signed = new Map();
function signActorCookie(actorId) {
  let v = _signed.get(actorId);
  if (!v) {
    v = execFileSync(
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
    ).trim();
    _signed.set(actorId, v);
  }
  return v;
}

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

function setupDataDb() {
  execFileSync("uv", [
    "run",
    "python",
    "-c",
    `import os, sqlite3
os.makedirs(${JSON.stringify(DATA_DIR)}, exist_ok=True)
p = ${JSON.stringify(DATA_DB)}
if os.path.exists(p): os.remove(p)
sqlite3.connect(p).close()`,
  ]);
}

async function startServer() {
  await rm(INTERNAL_DB, { force: true });
  setupDataDb();
  if (await reachable()) throw new Error(`something already serving on ${BASE}`);
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
      "--plugins-dir",
      PLUGINS_DIR,
      "-s",
      "permissions.datasette-sheets-access",
      "true",
      "-p",
      String(PORT),
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, PYTHONHASHSEED: "0" } },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`datasette exited early:\n${log}`);
    if (await reachable()) return child;
    await sleep(250);
  }
  stopServer(child);
  throw new Error(`datasette never came up:\n${log}`);
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // gone
    }
  }
}

async function main() {
  const server = await startServer();
  process.once("SIGINT", () => (stopServer(server), process.exit(130)));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 760, height: 720 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: "ds_actor", value: signActorCookie("alice"), domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();

    // Discover the seeded workbook id.
    const r = await ctx.request.get(`${SHEETS}/api/workbooks`);
    const { workbooks } = await r.json();
    const wb = workbooks.find((w) => w.name === "Q3 Revenue Plan");
    if (!wb) throw new Error("seeded workbook not found");

    const { js, css } = embedAssets();
    // Navigate to a same-origin page so the component's relative API fetches
    // (/data/-/sheets/api/...) resolve against the datasette server.
    await page.goto(`${BASE}/`);
    await page.evaluate(
      async ({ js, css, wbId }) => {
        document.documentElement.style.background = "#e9eef3";
        document.body.innerHTML = "";
        document.body.style.margin = "0";
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = css;
        document.head.appendChild(link);
        // Approximate a paper block card: white surface, padding, soft border.
        const card = document.createElement("div");
        card.style.cssText =
          "max-width:680px;margin:32px auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:16px;";
        const el = document.createElement("datasette-sheets-preview");
        el.setAttribute("db", "data");
        el.setAttribute("workbook-id", String(wbId));
        card.appendChild(el);
        document.body.appendChild(card);
        await import(js);
      },
      { js, css, wbId: wb.id },
    );

    // Wait for the grid to render real data (the "West" row from the seed).
    await page.locator(".ds-sheets-embed-table").waitFor({ timeout: 15_000 });
    await page.getByText("West").first().waitFor({ timeout: 15_000 });
    await sleep(300);
    await page.screenshot({ path: OUT });
    console.log(`✓ embed preview → ${OUT}`);
  } finally {
    await browser.close();
    stopServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
