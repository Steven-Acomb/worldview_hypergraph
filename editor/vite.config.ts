/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// The editor is deployed to GitHub Pages under a sub-path
// (https://steven-acomb.github.io/worldview_hypergraph/), so the base path
// is taken from VITE_BASE_PATH at build time and defaults to "/".
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
