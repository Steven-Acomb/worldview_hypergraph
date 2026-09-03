/**
 * Validation of worldview-core documents.
 *
 * Two layers, mirroring `validate.py` in the reference implementation:
 *
 * 1. **Structural** checks that mirror `worldview-core.schema.json`
 *    exactly (types, required fields, enums, no unknown fields).
 * 2. **Referential** checks the schema cannot express: ids unique within
 *    their kind, every premise and conclusion refers to an existing
 *    statement.
 *
 * Cycles are **never** reported here.  A worldview with circular
 * justification is a valid worldview.
 */

import { containsWhitespace } from "./canon.js";

const VERSION_RE = /^[0-9]+\.[0-9]+$/;
const MODES: readonly string[] = ["is", "ought"];

const TOP_FIELDS = new Set(["format", "version", "name", "description", "meta", "ext", "statements", "arguments"]);
const STATEMENT_FIELDS = new Set(["id", "text", "mode", "meta", "ext"]);
const ARGUMENT_FIELDS = new Set(["id", "premises", "conclusions", "justification", "rule", "meta", "ext"]);

type Dict = Record<string, unknown>;

function isDict(x: unknown): x is Dict {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function has(obj: Dict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Python-`repr`-like rendering for messages. */
function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s;
}

/**
 * A local id: a non-empty string with no whitespace.  This is the
 * schema's `^\S+$` with the same explicit whitespace set that `canon`
 * uses, so every implementation agrees on what "whitespace" means.
 */
function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !containsWhitespace(v);
}

/**
 * Validate raw JSON data.  Returns a list of problems (empty if valid).
 *
 * Referential checks run only when the structure is sound.  Use
 * `parseWorldview` to validate and build a `Worldview` in one step.
 */
export function validateDict(data: unknown): string[] {
  const problems = structural(data);
  if (problems.length > 0) {
    return problems;
  }
  return referential(data as Dict);
}

// ------------------------------------------------------------- structure

function structural(data: unknown): string[] {
  const p: string[] = [];
  if (!isDict(data)) {
    return ["document: must be a JSON object"];
  }

  unknownFields(p, "document", data, TOP_FIELDS);
  for (const req of ["format", "version", "statements", "arguments"]) {
    if (!has(data, req)) {
      p.push(`document: missing required field ${show(req)}`);
    }
  }

  if (has(data, "format") && data["format"] !== "worldview-core") {
    p.push(`document: 'format' must be "worldview-core", got ${show(data["format"])}`);
  }
  if (has(data, "version")) {
    const v = data["version"];
    if (typeof v !== "string" || !VERSION_RE.test(v)) {
      p.push(`document: 'version' must be a string like "0.1", got ${show(v)}`);
    }
  }
  for (const f of ["name", "description"]) {
    if (has(data, f) && typeof data[f] !== "string") {
      p.push(`document: ${show(f)} must be a string`);
    }
  }
  metaExt(p, "document", data);

  if (has(data, "statements")) {
    const statements = data["statements"];
    if (!Array.isArray(statements)) {
      p.push("document: 'statements' must be an array");
    } else {
      statements.forEach((s, i) => statement(p, i, s));
    }
  }
  if (has(data, "arguments")) {
    const args = data["arguments"];
    if (!Array.isArray(args)) {
      p.push("document: 'arguments' must be an array");
    } else {
      args.forEach((a, i) => argument(p, i, a));
    }
  }
  return p;
}

function unknownFields(p: string[], where: string, obj: Dict, allowed: Set<string>): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      p.push(`${where}: unknown field ${show(k)} (extensions belong under 'ext')`);
    }
  }
}

function metaExt(p: string[], where: string, obj: Dict): void {
  if (has(obj, "meta") && !isDict(obj["meta"])) {
    p.push(`${where}: 'meta' must be an object`);
  }
  if (has(obj, "ext")) {
    const ext = obj["ext"];
    if (!isDict(ext)) {
      p.push(`${where}: 'ext' must be an object`);
    } else {
      for (const k of Object.keys(ext)) {
        if (!isDict(ext[k])) {
          p.push(`${where}: ext[${show(k)}] must be an object (each ext key is a namespace)`);
        }
      }
    }
  }
}

/** Validate obj.id and return a label for later messages. */
function checkId(p: string[], where: string, obj: Dict): string {
  if (!has(obj, "id")) {
    p.push(`${where}: missing required field 'id'`);
    return where;
  }
  const v = obj["id"];
  if (!isId(v)) {
    p.push(`${where}: 'id' must be a non-empty string without whitespace, got ${show(v)}`);
    return where;
  }
  return `${where} (${v})`;
}

function statement(p: string[], i: number, s: unknown): void {
  let where = `statements[${i}]`;
  if (!isDict(s)) {
    p.push(`${where}: must be an object`);
    return;
  }
  unknownFields(p, where, s, STATEMENT_FIELDS);
  where = checkId(p, where, s);
  if (!has(s, "text")) {
    p.push(`${where}: missing required field 'text'`);
  } else if (typeof s["text"] !== "string" || s["text"] === "") {
    p.push(`${where}: 'text' must be a non-empty string`);
  }
  if (!has(s, "mode")) {
    p.push(`${where}: missing required field 'mode'`);
  } else if (typeof s["mode"] !== "string" || !MODES.includes(s["mode"])) {
    p.push(`${where}: 'mode' must be "is" or "ought", got ${show(s["mode"])}`);
  }
  metaExt(p, where, s);
}

function argument(p: string[], i: number, a: unknown): void {
  let where = `arguments[${i}]`;
  if (!isDict(a)) {
    p.push(`${where}: must be an object`);
    return;
  }
  unknownFields(p, where, a, ARGUMENT_FIELDS);
  where = checkId(p, where, a);
  for (const [f, minItems] of [
    ["premises", 0],
    ["conclusions", 1],
  ] as const) {
    if (!has(a, f)) {
      p.push(`${where}: missing required field ${show(f)}`);
      continue;
    }
    const v = a[f];
    if (!Array.isArray(v)) {
      p.push(`${where}: ${show(f)} must be an array of statement ids`);
      continue;
    }
    if (v.length < minItems) {
      p.push(`${where}: ${show(f)} must have at least ${minItems} item(s)`);
    }
    v.forEach((x, j) => {
      if (!isId(x)) {
        p.push(`${where}: ${f}[${j}] must be a statement id (non-empty string without whitespace), got ${show(x)}`);
      }
    });
    const distinct = new Set(v.filter((x): x is string => typeof x === "string"));
    if (distinct.size !== v.length) {
      p.push(`${where}: ${show(f)} contains duplicate ids`);
    }
  }
  if (!has(a, "justification")) {
    p.push(`${where}: missing required field 'justification'`);
  } else if (typeof a["justification"] !== "string") {
    p.push(`${where}: 'justification' must be a string`);
  }
  if (has(a, "rule") && typeof a["rule"] !== "string") {
    p.push(`${where}: 'rule' must be a string`);
  }
  metaExt(p, where, a);
}

// ------------------------------------------------------------ references

function referential(data: Dict): string[] {
  const p: string[] = [];
  const statements = data["statements"] as Array<{ id: string }>;
  const args = data["arguments"] as Array<{ id: string; premises: string[]; conclusions: string[] }>;

  const seen = new Set<string>();
  statements.forEach((s, i) => {
    if (seen.has(s.id)) {
      p.push(`statements[${i}]: duplicate statement id ${show(s.id)}`);
    }
    seen.add(s.id);
  });
  const statementIds = seen;

  const seenArgs = new Set<string>();
  args.forEach((a, i) => {
    if (seenArgs.has(a.id)) {
      p.push(`arguments[${i}]: duplicate argument id ${show(a.id)}`);
    }
    seenArgs.add(a.id);
    for (const f of ["premises", "conclusions"] as const) {
      for (const ref of a[f]) {
        if (!statementIds.has(ref)) {
          p.push(`arguments[${i}] (${a.id}): ${f} references unknown statement ${show(ref)}`);
        }
      }
    }
  });
  return p;
}
