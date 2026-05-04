import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import wasm from "vite-plugin-wasm";
import path from "path";

export default defineConfig({
  plugins: [svelte(), wasm()],
  // Datasette serves datasette_sheets/static/ at /-/static-plugins/datasette_sheets/
  // base ensures WASM fetch URLs in the JS bundle resolve correctly
  base: "/-/static-plugins/datasette_sheets/",
  build: {
    target: "esnext",
    outDir: path.resolve(__dirname, "../datasette_sheets/static"),
    assetsDir: "gen",
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
