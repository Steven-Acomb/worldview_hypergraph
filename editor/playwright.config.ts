/**
 * End-to-end configuration (npm run e2e).
 *
 * The suite runs against the production build served by `vite preview`.
 * The build uses the GitHub Pages sub-path as its base so that the tests
 * also prove that assets and example fetches resolve when the editor is
 * not at the root of a domain (see the deployment section of README.md).
 */

import { defineConfig, devices } from "@playwright/test";

export const BASE_PATH = "/worldview_hypergraph/";
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `${ORIGIN}${BASE_PATH}`,
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `${ORIGIN}${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_BASE_PATH: BASE_PATH },
  },
});
