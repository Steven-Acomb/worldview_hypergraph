/**
 * Everything the editor knows *about* the document comes from the SDK
 * and is computed here, once per document version.  The editor itself
 * adds no evaluation logic.
 *
 * While the user is mid-edit the document may be invalid (a dangling
 * reference, an empty text).  To keep the graph and inspector useful we
 * compute derived data from a sanitized copy when the raw document does
 * not validate; `problems` always reports the raw document's problems.
 */

import type { FoundationEntry, SccEntry, WellFoundedReport, Worldview, WorldviewDocument } from "worldview-core";
import { Graph, Identities, computeIdentities, foundations, sccs, validateDict, wellFounded, worldviewFromDict } from "worldview-core";

export interface Derived {
  /** Problems with the raw document; empty when valid. */
  problems: string[];
  /** True when derived data comes from a sanitized copy rather than the raw document. */
  sanitized: boolean;
  /** Null only when even the sanitized copy is unusable. */
  wv: Worldview | null;
  graph: Graph | null;
  ids: Identities | null;
  foundations: FoundationEntry[];
  foundationSet: Set<string>;
  sccs: SccEntry[];
  /** statement id -> members of its cyclic component */
  cyclic: Map<string, string[]>;
  wellFounded: WellFoundedReport | null;
  ungrounded: Set<string>;
  statementById: Map<string, Worldview["statements"][number]>;
  argumentById: Map<string, Worldview["arguments"][number]>;
}

export function derive(doc: WorldviewDocument): Derived {
  const problems = validateDict(doc);
  let usable: WorldviewDocument | null = problems.length ? sanitize(doc) : doc;
  let sanitized = problems.length > 0;
  if (usable && validateDict(usable).length) {
    usable = null;
  }
  const empty: Derived = {
    problems,
    sanitized,
    wv: null,
    graph: null,
    ids: null,
    foundations: [],
    foundationSet: new Set(),
    sccs: [],
    cyclic: new Map(),
    wellFounded: null,
    ungrounded: new Set(),
    statementById: new Map(doc.statements.map((s) => [s.id, s])),
    argumentById: new Map(doc.arguments.map((a) => [a.id, a])),
  };
  if (!usable) return empty;
  const wv = worldviewFromDict(usable);
  const graph = Graph.build(wv);
  const ids = computeIdentities(wv);
  const f = foundations(wv);
  const comps = sccs(wv);
  const cyclic = new Map<string, string[]>();
  for (const c of comps) for (const m of c.members) cyclic.set(m, c.members);
  const wf = wellFounded(wv);
  return {
    ...empty,
    sanitized,
    wv,
    graph,
    ids,
    foundations: f,
    foundationSet: new Set(f.map((x) => x.id)),
    sccs: comps,
    cyclic,
    wellFounded: wf,
    ungrounded: new Set(wf.ungrounded),
    statementById: new Map(wv.statements.map((s) => [s.id, s])),
    argumentById: new Map(wv.arguments.map((a) => [a.id, a])),
  };
}

/**
 * Best-effort repair for derived computations only (never written back):
 * drop statements with unusable ids/text/mode, keep the first of duplicate
 * ids, drop dangling references, drop arguments without conclusions.
 */
export function sanitize(doc: WorldviewDocument): WorldviewDocument | null {
  if (!doc || !Array.isArray(doc.statements) || !Array.isArray(doc.arguments)) return null;
  const seen = new Set<string>();
  const statements = [];
  for (const s of doc.statements) {
    if (!s || typeof s.id !== "string" || !s.id || /\s/.test(s.id) || seen.has(s.id)) continue;
    if (typeof s.text !== "string" || !s.text) continue;
    if (s.mode !== "is" && s.mode !== "ought") continue;
    seen.add(s.id);
    const copy = { ...s };
    if (copy.meta !== undefined && (typeof copy.meta !== "object" || copy.meta === null || Array.isArray(copy.meta))) delete copy.meta;
    if (copy.ext !== undefined && !isExt(copy.ext)) delete copy.ext;
    statements.push(copy);
  }
  const seenA = new Set<string>();
  const args = [];
  for (const a of doc.arguments) {
    if (!a || typeof a.id !== "string" || !a.id || /\s/.test(a.id) || seenA.has(a.id)) continue;
    if (!Array.isArray(a.premises) || !Array.isArray(a.conclusions)) continue;
    const premises = [...new Set(a.premises.filter((p) => typeof p === "string" && seen.has(p)))];
    const conclusions = [...new Set(a.conclusions.filter((c) => typeof c === "string" && seen.has(c)))];
    if (!conclusions.length) continue;
    seenA.add(a.id);
    const copy = { ...a, premises, conclusions, justification: typeof a.justification === "string" ? a.justification : "" };
    if (copy.rule !== undefined && typeof copy.rule !== "string") delete copy.rule;
    if (copy.meta !== undefined && (typeof copy.meta !== "object" || copy.meta === null || Array.isArray(copy.meta))) delete copy.meta;
    if (copy.ext !== undefined && !isExt(copy.ext)) delete copy.ext;
    args.push(copy);
  }
  const out: WorldviewDocument = {
    format: "worldview-core",
    version: typeof doc.version === "string" && /^[0-9]+\.[0-9]+$/.test(doc.version) ? doc.version : "0.1",
    statements,
    arguments: args,
  };
  if (typeof doc.name === "string") out.name = doc.name;
  if (typeof doc.description === "string") out.description = doc.description;
  if (doc.meta && typeof doc.meta === "object" && !Array.isArray(doc.meta)) out.meta = doc.meta;
  if (isExt(doc.ext)) out.ext = doc.ext;
  return out;
}

function isExt(v: unknown): v is Record<string, Record<string, unknown>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => x && typeof x === "object" && !Array.isArray(x));
}
