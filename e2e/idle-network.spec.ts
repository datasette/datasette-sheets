import { test, expect } from "@playwright/test";
import { gotoSheets, typeInCell, waitForAutoSave } from "./helpers";

// All four tests share the same shape:
//   1. Get the page(s) into a quiescent state via state-based waits
//      (``waitForAutoSave`` polls ``[data-save-status]`` for ``idle``).
//   2. Attach the request listener after that quiescence.
//   3. Observe a short *fixed* window — 500 ms is enough for any
//      stray POST scheduled before the listener attached to land,
//      and short enough that the four tests aren't burning ~15 s of
//      pure wall-clock sleep.
const IDLE_OBSERVATION_MS = 500;

test("no requests when idle after initial load (single tab)", async ({
  page,
}) => {
  await gotoSheets(page);
  // Initial load: wait for the save indicator to settle (it never
  // leaves ``idle`` on a fresh load, but the wait also lets the SSE
  // handshake + presence broadcast finish — both are POSTed once and
  // would otherwise race the listener attach below).
  await waitForAutoSave(page);

  const requests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.includes("/api/")) {
      requests.push(`${req.method()} ${url.pathname}`);
    }
  });

  await page.waitForTimeout(IDLE_OBSERVATION_MS);

  expect(requests, requests.join("\n")).toEqual([]);
});

test("no requests when idle after edit settles (single tab)", async ({
  page,
}) => {
  await gotoSheets(page);
  await typeInCell(page, "A1", "hello");
  // ``waitForAutoSave`` polls ``[data-save-status="idle"]`` — strictly
  // tighter than the previous 3000 ms blind sleep, and surfaces a real
  // failure if the save never finishes.
  await waitForAutoSave(page);

  const requests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.includes("/api/")) {
      requests.push(`${req.method()} ${url.pathname}`);
    }
  });

  await page.waitForTimeout(IDLE_OBSERVATION_MS);

  expect(requests, requests.join("\n")).toEqual([]);
});

test("no requests when idle with two tabs", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await gotoSheets(pageA);
    await waitForAutoSave(pageA);
    await gotoSheets(pageB);
    await waitForAutoSave(pageB);

    // Both pages must show the SSE connection dot before we record —
    // otherwise the still-handshaking page would emit its presence
    // POST during the observation window. (Same locator
    // ``collaboration.spec.ts`` uses to gate cross-edit timing.)
    await expect(pageA.locator(".connection-dot.connected")).toBeVisible();
    await expect(pageB.locator(".connection-dot.connected")).toBeVisible();

    const requests: string[] = [];
    pageA.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.includes("/api/")) {
        requests.push(`A: ${req.method()} ${url.pathname}`);
      }
    });
    pageB.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.includes("/api/")) {
        requests.push(`B: ${req.method()} ${url.pathname}`);
      }
    });

    await pageA.waitForTimeout(IDLE_OBSERVATION_MS);

    expect(requests, requests.join("\n")).toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("no echo loop after remote edit", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await gotoSheets(pageA);
    await waitForAutoSave(pageA);
    await gotoSheets(pageB);
    await waitForAutoSave(pageB);
    await expect(pageA.locator(".connection-dot.connected")).toBeVisible();
    await expect(pageB.locator(".connection-dot.connected")).toBeVisible();

    // User A edits — drain both sides so the SSE round-trip and any
    // follow-up auto-save are settled before we record traffic.
    // (Cross-page propagation itself is covered by
    // ``collaboration.spec.ts``; here we only need quiescence.)
    await typeInCell(pageA, "A1", "test");
    await waitForAutoSave(pageA);
    await waitForAutoSave(pageB);

    // Now record — should be silent.
    const requests: string[] = [];
    pageA.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.includes("/api/")) {
        requests.push(`A: ${req.method()} ${url.pathname}`);
      }
    });
    pageB.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.includes("/api/")) {
        requests.push(`B: ${req.method()} ${url.pathname}`);
      }
    });

    await pageA.waitForTimeout(IDLE_OBSERVATION_MS);

    expect(requests, requests.join("\n")).toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
