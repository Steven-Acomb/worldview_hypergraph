/**
 * Pure helpers used by the views: list filtering, picker search, JSON
 * field parsing, id validation, file naming.  No DOM, no store; everything
 * here is unit-tested in tests/logic.test.ts.
 */

import type { Argument, JsonObject, Mode, Statement, WorldviewDocument } from "worldview-core";
import { containsWhitespace } from "worldview-core";
import type { Derived } from "./derived.js";

// ------------------------------------------------------------------ search

/** Case-insensitive substring match; an empty query matches everything. */
export function matches(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f !== undefined && f.toLowerCase().includes(q));
}

export interface StatementFilters {
  query: string;
  mode: Mode | "any";
  foundationsOnly: boolean;
  cyclicOnly: boolean;
  ungroundedOnly: boolean;
}

export const DEFAULT_STATEMENT_FILTERS: StatementFilters = {
  query: "",
  mode: "any",
  foundationsOnly: false,
  cyclicOnly: false,
  ungroundedOnly: false,
};

export function filterStatements(
  statements: Statement[],
  filters: StatementFilters,
  facts: Pick<Derived, "foundationSet" | "cyclic" | "ungrounded">,
): Statement[] {
  return statements.filter((s) => {
    if (filters.mode !== "any" && s.mode !== filters.mode) return false;
    if (filters.foundationsOnly && !facts.foundationSet.has(s.id)) return false;
    if (filters.cyclicOnly && !facts.cyclic.has(s.id)) return false;
    if (filters.ungroundedOnly && !facts.ungrounded.has(s.id)) return false;
    return matches(filters.query, s.id, s.text);
  });
}

export function filterArguments(args: Argument[], query: string): Argument[] {
  return args.filter((a) => matches(query, a.id, a.rule, a.justification, ...a.premises, ...a.conclusions));
}

/**
 * Rank statements for the picker: exact id, then id prefix, then id
 * substring, then text substring.  Ties keep file order.  `exclude` hides
 * ids already chosen.
 */
export function searchStatements(statements: Statement[], query: string, exclude: Iterable<string> = [], limit = 20): Statement[] {
  const ex = new Set(exclude);
  const q = query.trim().toLowerCase();
  const scored: Array<[number, number, Statement]> = [];
  statements.forEach((s, i) => {
    if (ex.has(s.id)) return;
    let score: number;
    const id = s.id.toLowerCase();
    if (!q) score = 4;
    else if (id === q) score = 0;
    else if (id.startsWith(q)) score = 1;
    else if (id.includes(q)) score = 2;
    else if (s.text.toLowerCase().includes(q)) score = 3;
    else return;
    scored.push([score, i, s]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((x) => x[2]);
}

// -------------------------------------------------------------- json fields

export type JsonFieldResult = { ok: true; value: JsonObject | undefined } | { ok: false; error: string };

/**
 * Parse the text of a `meta` or `ext` textarea.  Blank text means "no
 * field".  The value must be a JSON object; for `ext` every value must
 * itself be an object (each key is a namespace).
 */
export function parseJsonField(text: string, kind: "meta" | "ext" = "meta"): JsonFieldResult {
  if (!text.trim()) return { ok: true, value: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Must be a JSON object" };
  }
  if (kind === "ext") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return { ok: false, error: `ext[${JSON.stringify(k)}] must be an object (each ext key is a namespace)` };
      }
    }
  }
  return { ok: true, value: parsed as JsonObject };
}

/** Text shown in a JSON textarea for a field value. */
export function formatJsonField(value: JsonObject | undefined): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------- ids

/** Why `candidate` cannot be used as an id, or null when it can. */
export function idProblem(candidate: string, current: string | null, taken: Iterable<string>): string | null {
  if (candidate === "") return "The id must not be empty";
  if (containsWhitespace(candidate)) return "The id must not contain whitespace";
  if (candidate !== current) {
    for (const t of taken) if (t === candidate) return `The id ${JSON.stringify(candidate)} is already used`;
  }
  return null;
}

// -------------------------------------------------------------------- misc

/** A file name for saving: the source name if it was a file, else a slug of the document name. */
export function suggestFileName(doc: WorldviewDocument, sourceName: string | null): string {
  if (sourceName && /\.json$/i.test(sourceName)) return sourceName;
  const base = (doc.name ?? "worldview")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "worldview"}.json`;
}

/** First and last characters of a hash, for tables. */
export function shortHash(h: string, n = 8): string {
  return h.length <= n ? h : h.slice(0, n);
}

/** Problems relevant to one argument, by id or by index in the raw document. */
export function problemsForArgument(problems: string[], doc: WorldviewDocument, id: string): string[] {
  const i = doc.arguments.findIndex((a) => a.id === id);
  const prefix = `arguments[${i}]`;
  return problems.filter((p) => i >= 0 && (p.startsWith(prefix + ":") || p.startsWith(prefix + " ")));
}

/** Problems relevant to one statement. */
export function problemsForStatement(problems: string[], doc: WorldviewDocument, id: string): string[] {
  const i = doc.statements.findIndex((s) => s.id === id);
  const prefix = `statements[${i}]`;
  return problems.filter((p) => i >= 0 && (p.startsWith(prefix + ":") || p.startsWith(prefix + " ")));
}

/** Simple debounce with a flush; used by autosave and the text fields. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): { call: (...args: A) => void; flush: () => void; pending: () => boolean } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  return {
    call(...args: A) {
      last = args;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const a = last as A;
        last = null;
        fn(...a);
      }, ms);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        const a = last as A;
        last = null;
        fn(...a);
      }
    },
    pending: () => timer !== null,
  };
}
