/**
 * Computed identities: proposition ids, justified-statement ids, argument hashes.
 *
 * Nothing here is ever stored in a worldview file.  Both identity layers
 * are derived from content on demand:
 *
 *     prop_id(s)  = H("prop", canon(s.text), s.mode)
 *
 *     arg_hash(a) = H("arg", canon(a.justification),
 *                     sorted(just_id(p) for p in a.premises),
 *                     sorted(prop_id(c) for c in a.conclusions))
 *
 *     just_id(s)  = H("just", prop_id(s),
 *                     sorted(arg_hash(a) for a in incoming(s)))
 *
 * That recursion does not terminate on cycles, so strongly connected
 * components are hashed as units.  For a cyclic component C (size > 1,
 * or a single statement with a self-loop):
 *
 *     arg_hash'(a) = arg_hash(a) but with prop_id(p) in place of just_id(p)
 *                    for premises p inside C
 *
 *     scc_hash(C)  = H("scc", sorted(prop_id(s) for s in C),
 *                      sorted(arg_hash'(a) for a in args concluding into C))
 *
 *     just_id(s in C) = H("justscc", scc_hash(C), prop_id(s))
 *
 * "Args concluding into C" are the arguments with at least one conclusion
 * in C.  Arguments that merely *use* a member of C as a premise are
 * downstream of C and do not affect its identity.
 *
 * `meta`, `ext`, `rule`, and every local `id` are ignored.  The hashes are
 * identical to those of the Python reference implementation.
 */

import { H, canon } from "./canon.js";
import { Graph } from "./graph.js";
import type { Argument, Worldview } from "./model.js";

/** One row of {@link IdentitiesDict.statements}. */
export interface StatementIdentity {
  id: string;
  prop_id: string;
  just_id: string;
  /** Members of the cyclic component this statement belongs to; absent for acyclic statements. */
  scc?: string[];
}

/** One row of {@link IdentitiesDict.arguments}. */
export interface ArgumentIdentity {
  id: string;
  arg_hash: string;
}

/** Plain-data form of {@link Identities}: what `worldview --json ids` prints. */
export interface IdentitiesDict {
  statements: StatementIdentity[];
  arguments: ArgumentIdentity[];
}

/** Sort hex strings in code-point order (never locale-aware). */
function sortedHex(items: Iterable<string>): string[] {
  return [...items].sort();
}

function mustGet(map: Map<string, string>, key: string): string {
  const v = map.get(key);
  if (v === undefined) {
    throw new Error(`internal error: no identity computed for ${JSON.stringify(key)}`);
  }
  return v;
}

export class Identities {
  /** statement id -> proposition id */
  readonly propId: Map<string, string>;
  /** statement id -> justified-statement id */
  readonly justId: Map<string, string>;
  /** argument id -> argument hash */
  readonly argHash: Map<string, string>;
  /** every component, topological order (see {@link Graph.sccs}) */
  readonly sccs: string[][];
  /** component index -> scc hash, cyclic components only */
  readonly sccHash: Map<number, string>;
  readonly graph: Graph;

  constructor(
    propId: Map<string, string>,
    justId: Map<string, string>,
    argHash: Map<string, string>,
    sccs: string[][],
    sccHash: Map<number, string>,
    graph: Graph,
  ) {
    this.propId = propId;
    this.justId = justId;
    this.argHash = argHash;
    this.sccs = sccs;
    this.sccHash = sccHash;
    this.graph = graph;
  }

  /** Members of the cyclic component containing `sid`, or null if acyclic. */
  sccOf(sid: string): string[] | null {
    const i = this.graph.sccOf().get(sid);
    if (i === undefined) {
      return null;
    }
    return this.sccHash.has(i) ? [...(this.sccs[i] as string[])] : null;
  }

  /** Plain-data form, keyed by local id, in file order. */
  toDict(): IdentitiesDict {
    const statements: StatementIdentity[] = [];
    for (const sid of this.graph.statements.keys()) {
      const row: StatementIdentity = {
        id: sid,
        prop_id: mustGet(this.propId, sid),
        just_id: mustGet(this.justId, sid),
      };
      const scc = this.sccOf(sid);
      if (scc !== null) row.scc = scc;
      statements.push(row);
    }
    const args: ArgumentIdentity[] = [];
    for (const aid of this.graph.arguments.keys()) {
      args.push({ id: aid, arg_hash: mustGet(this.argHash, aid) });
    }
    return { statements, arguments: args };
  }
}

/** Proposition id of a statement: what is being said. */
export function propId(text: string, mode: string): string {
  return H("prop", canon(text), mode);
}

function argHashOf(a: Argument, premiseId: (p: string) => string, prop: Map<string, string>): string {
  return H(
    "arg",
    canon(a.justification),
    sortedHex(a.premises.map(premiseId)),
    sortedHex(a.conclusions.map((c) => mustGet(prop, c))),
  );
}

/** Compute every identity for a worldview.  Optionally reuse an already-built {@link Graph}. */
export function computeIdentities(wv: Worldview, graph?: Graph): Identities {
  const g = graph ?? Graph.build(wv);
  const prop = new Map<string, string>();
  for (const [sid, s] of g.statements) prop.set(sid, propId(s.text, s.mode));
  const just = new Map<string, string>();
  const sccHash = new Map<number, string>();
  const justOf = (p: string): string => mustGet(just, p);

  g.sccs().forEach((comp, ci) => {
    if (g.isCyclicComponent(comp)) {
      const members = new Set(comp);
      const touchingSet = new Set<string>();
      for (const sid of comp) {
        for (const aid of g.incomingOf(sid)) touchingSet.add(aid);
      }
      const touching = [...touchingSet].sort();
      const premiseId = (p: string): string => (members.has(p) ? mustGet(prop, p) : justOf(p));
      const sh = H(
        "scc",
        sortedHex(comp.map((s) => mustGet(prop, s))),
        sortedHex(touching.map((aid) => argHashOf(g.argument(aid), premiseId, prop))),
      );
      sccHash.set(ci, sh);
      for (const s of comp) just.set(s, H("justscc", sh, mustGet(prop, s)));
    } else {
      const s = comp[0] as string;
      // Every premise of an incoming argument lies in an earlier component.
      const hashes = sortedHex(g.incomingOf(s).map((aid) => argHashOf(g.argument(aid), justOf, prop)));
      just.set(s, H("just", mustGet(prop, s), hashes));
    }
  });

  const argHash = new Map<string, string>();
  for (const [aid, a] of g.arguments) argHash.set(aid, argHashOf(a, justOf, prop));
  return new Identities(prop, just, argHash, g.sccs(), sccHash, g);
}
