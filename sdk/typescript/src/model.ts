/**
 * In-memory model of a worldview file.
 *
 * The model mirrors the JSON one-to-one and performs no interpretation:
 * `meta` and `ext` are carried along untouched, and nothing here computes
 * identities or walks the graph (see `identity.ts` and `graph.ts`).
 *
 * `Statement`, `Argument`, and `Worldview` are plain objects, not classes,
 * so they serialize, structured-clone, and diff without ceremony.
 */

import { LoadError, UnknownIdError, ValidationError } from "./errors.js";
import { validateDict } from "./validate.js";

export const FORMAT = "worldview-core";
export const FORMAT_VERSION = "0.1";

/** Any JSON value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Any JSON object. */
export type JsonObject = { [key: string]: JsonValue };

/** `"is"` for a descriptive statement, `"ought"` for a normative one. */
export type Mode = "is" | "ought";

/** One node of the hypergraph.  Identical to its JSON form. */
export interface Statement {
  id: string;
  text: string;
  mode: Mode;
  /** Free-form human notes.  Ignored by hashing and every query. */
  meta?: JsonObject;
  /** Namespaced machine-readable extensions.  Ignored by hashing and every query. */
  ext?: JsonObject;
}

/** One hyperedge: N premises jointly entail M conclusions.  Identical to its JSON form. */
export interface Argument {
  id: string;
  premises: string[];
  conclusions: string[];
  justification: string;
  /** Name of the inference pattern.  Not part of identity. */
  rule?: string;
  meta?: JsonObject;
  ext?: JsonObject;
}

/**
 * A loaded worldview.  Same fields as the file minus the constant
 * `format` discriminator, plus `source` (where it was loaded from, if
 * known; reported by {@link diff}).
 */
export interface Worldview {
  version: string;
  name?: string;
  description?: string;
  meta?: JsonObject;
  ext?: JsonObject;
  statements: Statement[];
  arguments: Argument[];
  source?: string;
}

/** The on-disk JSON shape of a worldview file. */
export interface WorldviewDocument {
  format: typeof FORMAT;
  version: string;
  name?: string;
  description?: string;
  meta?: JsonObject;
  ext?: JsonObject;
  statements: Statement[];
  arguments: Argument[];
}

/**
 * Build a Worldview from already-validated JSON data.
 *
 * This does **not** validate.  Call {@link validateDict} first, or use
 * {@link parseWorldview}, which does.
 */
export function worldviewFromDict(data: WorldviewDocument, source?: string): Worldview {
  const statements = data.statements.map((s): Statement => {
    const out: Statement = { id: s.id, text: s.text, mode: s.mode };
    if (s.meta !== undefined) out.meta = s.meta;
    if (s.ext !== undefined) out.ext = s.ext;
    return out;
  });
  const args = data.arguments.map((a): Argument => {
    const out: Argument = {
      id: a.id,
      premises: [...a.premises],
      conclusions: [...a.conclusions],
      justification: a.justification,
    };
    if (a.rule !== undefined) out.rule = a.rule;
    if (a.meta !== undefined) out.meta = a.meta;
    if (a.ext !== undefined) out.ext = a.ext;
    return out;
  });
  const wv: Worldview = { version: data.version, statements, arguments: args };
  if (data.name !== undefined) wv.name = data.name;
  if (data.description !== undefined) wv.description = data.description;
  if (data.meta !== undefined) wv.meta = data.meta;
  if (data.ext !== undefined) wv.ext = data.ext;
  if (source !== undefined) wv.source = source;
  return wv;
}

/** The JSON form of a statement: a copy with the keys in file order (`id`, `text`, `mode`, `meta`, `ext`). */
export function statementToDict(s: Statement): Statement {
  const out: Statement = { id: s.id, text: s.text, mode: s.mode };
  if (s.meta !== undefined) out.meta = s.meta;
  if (s.ext !== undefined) out.ext = s.ext;
  return out;
}

/** The JSON form of an argument: a copy with the keys in file order. */
export function argumentToDict(a: Argument): Argument {
  const out: Argument = {
    id: a.id,
    premises: [...a.premises],
    conclusions: [...a.conclusions],
    justification: a.justification,
  };
  if (a.rule !== undefined) out.rule = a.rule;
  if (a.meta !== undefined) out.meta = a.meta;
  if (a.ext !== undefined) out.ext = a.ext;
  return out;
}

/**
 * The JSON form of a Worldview.  Round-trips a parsed file exactly, with the
 * keys in the order the Python `Worldview.to_dict()` emits them (`format`,
 * `version`, `name`, `description`, `meta`, `ext`, `statements`,
 * `arguments`), so `JSON.stringify` of the result matches the reference CLI.
 */
export function worldviewToDict(wv: Worldview): WorldviewDocument {
  const head: Partial<WorldviewDocument> = { format: FORMAT, version: wv.version };
  if (wv.name !== undefined) head.name = wv.name;
  if (wv.description !== undefined) head.description = wv.description;
  if (wv.meta !== undefined) head.meta = wv.meta;
  if (wv.ext !== undefined) head.ext = wv.ext;
  return {
    ...head,
    format: FORMAT,
    version: wv.version,
    statements: wv.statements.map(statementToDict),
    arguments: wv.arguments.map(argumentToDict),
  };
}

/**
 * Validate raw JSON data and build a Worldview from it.
 *
 * Throws {@link ValidationError} (with a `.problems` array) if the data is
 * not a valid worldview-core document.
 */
export function parseWorldview(data: unknown, source?: string): Worldview {
  const problems = validateDict(data);
  if (problems.length > 0) {
    throw new ValidationError(problems);
  }
  return worldviewFromDict(data as WorldviewDocument, source);
}

/**
 * Like {@link parseWorldview}, but from JSON text.
 *
 * Throws {@link LoadError} if the text is not valid JSON and
 * {@link ValidationError} if it is not a valid worldview-core document.
 */
export function parseWorldviewJson(text: string, source?: string): Worldview {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new LoadError(`not valid JSON: ${(e as Error).message}`);
  }
  return parseWorldview(data, source);
}

/** The statement with the given local id.  Throws {@link UnknownIdError}. */
export function getStatement(wv: Worldview, id: string): Statement {
  for (const s of wv.statements) {
    if (s.id === id) return s;
  }
  throw new UnknownIdError("statement", id);
}

/** The argument with the given local id.  Throws {@link UnknownIdError}. */
export function getArgument(wv: Worldview, id: string): Argument {
  for (const a of wv.arguments) {
    if (a.id === id) return a;
  }
  throw new UnknownIdError("argument", id);
}

/** Statement ids in file order. */
export function statementIds(wv: Worldview): string[] {
  return wv.statements.map((s) => s.id);
}

/** Argument ids in file order. */
export function argumentIds(wv: Worldview): string[] {
  return wv.arguments.map((a) => a.id);
}
