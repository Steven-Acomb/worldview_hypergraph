#!/usr/bin/env node
// Turns dist-single/index.html (a complete single-file page) into
// dist-single/artifact.html: the same page without the outer
// <!doctype>/<html>/<head>/<body> wrapper, for hosts that wrap page content
// in their own document skeleton (Claude artifacts do).  The title, the
// inline styles, the theme pre-paint script, the app mount point, and the
// bundled module script are kept in order.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "dist-single", "index.html");
const dst = path.resolve(here, "..", "dist-single", "artifact.html");

const html = readFileSync(src, "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? "";

const title = head.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? "<title>Worldview editor</title>";
const styles = [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]);
const headScripts = [...head.matchAll(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi)].map((m) => m[0]);

const out = [title, ...styles, ...headScripts, body.trim()].join("\n") + "\n";
writeFileSync(dst, out);
console.log(`make-artifact: ${path.relative(process.cwd(), dst)} (${(out.length / 1024).toFixed(0)} kB)`);
