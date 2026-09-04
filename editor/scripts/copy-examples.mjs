#!/usr/bin/env node
// Copies ../examples/*.json into public/examples/ and writes an index.json
// listing them, so the editor's "Examples" menu is discovered at build time
// rather than hardcoded.  Files that are not valid JSON objects are skipped
// with a warning; a missing examples directory yields an empty index.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "..", "examples");
const target = path.resolve(here, "..", "public", "examples");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const index = [];
if (existsSync(source)) {
  for (const file of readdirSync(source).sort()) {
    if (!file.endsWith(".json")) continue;
    const text = readFileSync(path.join(source, file), "utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn(`copy-examples: skipping ${file}: ${e.message}`);
      continue;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      console.warn(`copy-examples: skipping ${file}: not a JSON object`);
      continue;
    }
    writeFileSync(path.join(target, file), text);
    index.push({
      file,
      name: typeof data.name === "string" ? data.name : file.replace(/\.json$/, ""),
      description: typeof data.description === "string" ? data.description : "",
      statements: Array.isArray(data.statements) ? data.statements.length : 0,
      arguments: Array.isArray(data.arguments) ? data.arguments.length : 0,
    });
  }
}
writeFileSync(path.join(target, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`copy-examples: ${index.length} example(s) -> ${path.relative(process.cwd(), target)}`);
