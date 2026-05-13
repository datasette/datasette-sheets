import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import wasm from "vite-plugin-wasm";
import path from "path";

export default defineConfig({
  plugins: [svelte(), wasm()],
  // Dev: base = "/" so the Vite dev server can be reached via the
  // port-only shorthand:
  //   -s plugins.datasette-vite.dev_ports.datasette_sheets 5171
  // Build: base is irrelevant because `experimental.renderBuiltUrl`
  // emits every bundled asset URL absolutely.
  base: "/",
  experimental: {
    // Datasette mounts datasette_sheets/static/ at
    // /-/static-plugins/datasette_sheets/. Our assetsDir = "static/gen"
    // makes manifest paths begin with "static/" so datasette-vite's
    // `relative_to("static")` works — but vite would also bake that
    // same prefix into bundled-asset URLs (wasm fetch, dynamic imports,
    // CSS @font-face). Strip it here so runtime URLs match what
    // Datasette actually serves.
    renderBuiltUrl(filename) {
      const stripped = filename.replace(/^static\//, "");
      return `/-/static-plugins/datasette_sheets/${stripped}`;
    },
  },
  build: {
    target: "esnext",
    // outDir = plugin package root so `manifest.json` lands at
    // `datasette_sheets/manifest.json` (where `datasette_vite._load_manifest`
    // looks for it), with assets nested under `static/gen/`.
    outDir: path.resolve(__dirname, "../datasette_sheets"),
    assetsDir: "static/gen",
    emptyOutDir: false,
    manifest: "manifest.json",
    rollupOptions: {
      input: {
        sheets: path.resolve(__dirname, "src/pages/sheets/index.ts"),
      },
    },
  },
  server: {
    port: 5171,
    strictPort: true,
    cors: true,
    // origin ensures all dev asset URLs (including WASM fetch) go to the
    // Vite server, not the page's origin (Datasette)
    origin: "http://localhost:5171",
    hmr: {
      host: "localhost",
      protocol: "ws",
    },
    fs: {
      // Allow serving the WASM package from outside the frontend/ root
      allow: [path.resolve(__dirname, "..")],
    },
  },
});
