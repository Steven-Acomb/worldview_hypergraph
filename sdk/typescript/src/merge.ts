/**
 * Three-way merge of worldviews, for the fork-and-experiment workflow.
 *
 * Given a common ancestor `base` and two descendants `ours` and `theirs`,
 * produce a merged worldview and a list of conflicts.  Entries are matched
 * by **local id** (the way a human tracks a statement across edits of one
 * lineage), and compared by **content**:
 *
 * - statement content = canonical text, mode, meta, ext;
 * - argument content = premise set, conclusion set, canonical
 *   justification, rule, meta, ext.
 *
 * Per id the usual rule applies: if both sides agree, take it; if only one
 * side changed (edited, added, or deleted) relative to base, take that
 * side; if both changed differently, it is a conflict and `ours` wins in
 * the merged output while the conflict is reported.  An argument left
 * referring to a statement that the other side deleted is a dangling
 * conflict and is dropped from the output.
 *
 * Use {@link diff} (identity-based) to *understand* how two worldviews
 * differ; use this to *combine* two lines of edits.
 *
 * Port of `merge.py`.  Content comparison reproduces Python's equality on
 * the JSON values of `meta` and `ext` (objects compared as sorted key
 * lists, `true == 1`, `1 == 1.0`), so the result is identical to the
 * reference implementation's.
 */

import { canon } from "./canon.js";
import { argumentToDict, statementToDict, worldviewToDict } from "./model.js";
import type { Argument, JsonObject, JsonValue, Statement, Worldview, WorldviewDocument } from "./model.js";

/** Counts per kind in {@link MergeReport.summary}. */
export interface MergeTally {
  kept: number;
  added_ours: number;
  added_theirs: number;
  added_both: number;
  removed: number;
  changed: number;
}

/** The header fields merged one by one. */
export type HeaderField = "name" | "description" | "meta" | "ext";

/** One conflict of {@link merge}. */
export type MergeConflict =
  | {
      kind: "statement";
      id: string;
      base: Statement | null;
      ours: Statement | null;
      theirs: Statement | null;
      resolution: "kept ours" | "kept theirs";
    }
  | {
      kind: "argument";
      id: string;
      base: Argument | null;
      ours: Argument | null;
      theirs: Argument | null;
      resolution: "kept ours" | "kept theirs";
    }
  | { kind: "dangling"; id: string; missing: string[]; argument: Argument; resolution: "dropped argument" }
  | {
      kind: "header";
      id: HeaderField;
      base: JsonValue | null;
      ours: JsonValue | null;
      theirs: JsonValue | null;
      resolution: "kept ours";
    };

/** The result of {@link merge}. */
export interface MergeReport {
  /** The merged worldview in file form: base order, then additions from ours, then from theirs. */
  merged: WorldviewDocument;
  conflicts: MergeConflict[];
  summary: { statements: MergeTally; arguments: MergeTally };
}

// -------------------------------------------------- Python-equal content keys

/** `merge.py`'s `_freeze`: a JSON value as nested tuples, dicts as sorted (key, value) pairs. */
type Frozen = null | string | number | boolean | Frozen[];

/** Python `str` ordering: by code point. */
function cpCompare(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const d = (x.value.codePointAt(0) as number) - (y.value.codePointAt(0) as number);
    if (d !== 0) return d;
  }
}

function freeze(x: JsonValue | undefined): Frozen {
  if (x === undefined || x === null) return null;
  if (Array.isArray(x)) return x.map(freeze);
  if (typeof x === "object") {
    return Object.keys(x)
      .sort(cpCompare)
      .map((k): Frozen => [k, freeze(x[k] as JsonValue)]);
  }
  return x;
}

/** Python `==` on frozen values: tuples elementwise, `True == 1 == 1.0`, everything else by type and value. */
function frozenEq(a: Frozen, b: Frozen): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => frozenEq(v, b[i] as Frozen));
  }
  if (a === null || b === null) return a === b;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return Number(a) === Number(b);
}

function stmtKey(s: Statement): Frozen {
  return [canon(s.text), s.mode, freeze(s.meta), freeze(s.ext)];
}

function idSet(ids: readonly string[]): Frozen {
  return [...new Set(ids)].sort();
}

function argKey(a: Argument): Frozen {
  return [idSet(a.premises), idSet(a.conclusions), canon(a.justification), a.rule ?? null, freeze(a.meta), freeze(a.ext)];
}

/** `_three_way`: the chosen value for one id and whether it was a conflict. */
function threeWay<T>(b: T | null, o: T | null, t: T | null, key: (x: T) => Frozen): [T | null, boolean] {
  const kb = b === null ? null : key(b);
  const ko = o === null ? null : key(o);
  const kt = t === null ? null : key(t);
  if (frozenEq(ko, kt)) return [o, false];
  if (frozenEq(ko, kb)) return [t, false];
  if (frozenEq(kt, kb)) return [o, false];
  return [o !== null ? o : t, true];
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of items) m.set(x.id, x);
  return m;
}

function orderedIds(...maps: Array<Map<string, unknown>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of maps) {
    for (const i of m.keys()) {
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  }
  return out;
}

function newTally(): MergeTally {
  return { kept: 0, added_ours: 0, added_theirs: 0, added_both: 0, removed: 0, changed: 0 };
}

// ---------------------------------------------------------------- merge

/** Three-way merge of two lines of edits from a common base.  See the module comment. */
export function merge(base: Worldview, ours: Worldview, theirs: Worldview): MergeReport {
  const conflicts: MergeConflict[] = [];
  const summary = { statements: newTally(), arguments: newTally() };

  function run<T extends { id: string }>(
    tally: MergeTally,
    bItems: readonly T[],
    oItems: readonly T[],
    tItems: readonly T[],
    key: (x: T) => Frozen,
    conflictOf: (id: string, b: T | null, o: T | null, t: T | null) => MergeConflict,
  ): T[] {
    const b = byId(bItems);
    const o = byId(oItems);
    const t = byId(tItems);
    const result: T[] = [];
    for (const i of orderedIds(b, o, t)) {
      const bi = b.get(i) ?? null;
      const oi = o.get(i) ?? null;
      const ti = t.get(i) ?? null;
      const [chosen, conflict] = threeWay(bi, oi, ti, key);
      if (conflict) conflicts.push(conflictOf(i, bi, oi, ti));
      if (chosen === null) {
        if (bi !== null) tally.removed++;
        continue;
      }
      result.push(chosen);
      if (bi === null) {
        if (oi !== null && ti !== null) tally.added_both++;
        else if (oi !== null) tally.added_ours++;
        else tally.added_theirs++;
      } else if (frozenEq(key(chosen), key(bi))) {
        tally.kept++;
      } else {
        tally.changed++;
      }
    }
    return result;
  }

  const statements = run(summary.statements, base.statements, ours.statements, theirs.statements, stmtKey, (id, b, o, t) => ({
    kind: "statement",
    id,
    base: b === null ? null : statementToDict(b),
    ours: o === null ? null : statementToDict(o),
    theirs: t === null ? null : statementToDict(t),
    resolution: o !== null ? "kept ours" : "kept theirs",
  }));
  const args = run(summary.arguments, base.arguments, ours.arguments, theirs.arguments, argKey, (id, b, o, t) => ({
    kind: "argument",
    id,
    base: b === null ? null : argumentToDict(b),
    ours: o === null ? null : argumentToDict(o),
    theirs: t === null ? null : argumentToDict(t),
    resolution: o !== null ? "kept ours" : "kept theirs",
  }));

  // Dangling references: an argument survived but a statement it needs did not.
  const present = new Set(statements.map((s) => s.id));
  const keptArgs: Argument[] = [];
  for (const a of args) {
    const missing = [...a.premises, ...a.conclusions].filter((x) => !present.has(x));
    if (missing.length > 0) {
      conflicts.push({ kind: "dangling", id: a.id, missing, argument: argumentToDict(a), resolution: "dropped argument" });
    } else {
      keptArgs.push(a);
    }
  }

  // Header fields, same rule per field.
  function field<K extends HeaderField>(name: K): Worldview[K] | undefined {
    type V = NonNullable<Worldview[K]>;
    const b = (base[name] ?? null) as V | null;
    const o = (ours[name] ?? null) as V | null;
    const t = (theirs[name] ?? null) as V | null;
    const [chosen, conflict] = threeWay<V>(b, o, t, (x) => freeze(x as JsonValue));
    if (conflict) {
      conflicts.push({ kind: "header", id: name, base: b as JsonValue | null, ours: o as JsonValue | null, theirs: t as JsonValue | null, resolution: "kept ours" });
    }
    return chosen === null ? undefined : chosen;
  }

  const merged: Worldview = { version: ours.version, statements, arguments: keptArgs };
  const name = field("name");
  if (name !== undefined) merged.name = name;
  const description = field("description");
  if (description !== undefined) merged.description = description;
  const meta = field("meta");
  if (meta !== undefined) merged.meta = meta as JsonObject;
  const ext = field("ext");
  if (ext !== undefined) merged.ext = ext as JsonObject;

  return { merged: worldviewToDict(merged), conflicts, summary };
}
