import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import wasm from "vite-plugin-wasm";
import { playwright } from "@vitest/browser-playwright";

// Vitest runs in a real browser (Playwright/chromium) so the Rust WASM
// engine, Svelte components and DOM events all behave identically to
// production. Use this for fast component/store unit tests; reserve
// e2e/ for full-stack flows that need Datasette + SSE.
export default defineConfig({
  plugins: [svelte(), wasm()],
  test: {
    include: ["src/**/*.test.ts"],
    // [TESTS-10] Shared store reset — individual specs can layer
    // additional beforeEach calls; this guarantees the baseline.
    setupFiles: ["./src/test-setup.ts"],
    // [TESTS-10] Default 5s is fine for most specs, but
    // ``Grid.virtualization.test.ts`` does multi-rAF settles and can
    // approach the limit on a busy CI box. Pin an explicit budget.
    testTimeout: 10_000,
    // [TESTS-10] ``vitest run --coverage`` provider + targets. No
    // threshold yet — establish a baseline first, then ratchet in a
    // follow-up.
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**"],
    },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      // Reuse the cell's `data-cell-id` as the test-id locator so
      // `page.getByTestId("A1")` matches `<div data-cell-id="A1">`.
      locators: { testIdAttribute: "data-cell-id" },
    },
  },
});
