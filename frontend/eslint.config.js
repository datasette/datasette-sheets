// Minimal flat-config ESLint for the Svelte + TS frontend. Keep the
// surface small: correctness rules only (no stylistic bikeshedding —
// prettier handles formatting). Relax a handful of defaults that don't
// fit this codebase (intentional `any` around clipboard/DOM shims,
// unused `_prefixed` params, triple-slash import at the top of a .d.ts).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "api.d.ts",
      "../datasette_sheets/static/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.{ts,svelte}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        extraFileExtensions: [".svelte"],
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Casting to `any` to reach into DOM/clipboard shims is common and
      // usually fine. We already have type-checking in svelte-check.
      "@typescript-eslint/no-explicit-any": "off",
      // Rune-mode best practice — we intentionally use Svelte 4-style
      // writables + plain Map/Set, so this would fire on legitimate code.
      "svelte/prefer-svelte-reactivity": "off",
      // {#each} keys are a nice-to-have for stable DOM nodes, but a lot
      // of our lists are column letters / tab indices where re-mounts
      // aren't a concern. Surface as a warning, don't block.
      "svelte/require-each-key": "warn",
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
      },
    },
  },
];
