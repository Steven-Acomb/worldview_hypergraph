// Shared locations for the test suite.  Tests run from the built package
// directory; the conformance vectors and examples live in the repository.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(SDK_ROOT, "..", "..");
export const VECTORS = path.join(REPO_ROOT, "conformance", "vectors");
export const EXAMPLES = path.join(REPO_ROOT, "examples");
export const PYTHON_SCHEMA = path.join(REPO_ROOT, "src", "worldview_core", "worldview-core.schema.json");
export const BIN = path.join(SDK_ROOT, "bin", "worldview.js");

export function readText(p: string): string {
  return readFileSync(p, "utf8");
}

export function readJson(p: string): unknown {
  return JSON.parse(readText(p));
}
