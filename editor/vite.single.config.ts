/// <reference types="vitest/config" />
// Single-file build: one self-contained HTML file with the examples inlined,
// for hosting anywhere a static page can live (no server, no relative
// assets).  `npm run build:single` writes dist-single/index.html and then
// scripts/make-artifact.mjs derives dist-single/artifact.html from it.
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_INLINE_EXAMPLES": JSON.stringify("1"),
  },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: "dist-single",
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
