/**
 * Structural queries.  None of these evaluates truth or validity.
 *
 * Every function takes a {@link Worldview} and returns plain data (objects,
 * arrays, strings) suitable for JSON output, with exactly the key names
 * and orderings of the Python reference implementation (`queries.py`).
 * Cycles are reported as structure, never thrown.
 */

import { UnknownIdError } from "./errors.js";
import { Graph } from "./graph.js";
import type { Mode, Worldview } from "./model.js";

function graphOf(wv: Worldview, graph?: Graph): Graph {
  return graph ?? Graph.build(wv);
}

function requireStatement(g: Graph, sid: string): void {
  if (!g.statements.has(sid)) {
    throw new UnknownIdError("statement", sid);
  }
}

// ----------------------------------------------------------- foundations

/** One entry of {@link foundations}. */
export interface FoundationEntry {
  id: string;
  text: string;
  mode: Mode;
}

/** Statements with no incoming argument: the computed notion of "axiom".  File order. */
export function foundations(wv: Worldview, graph?: Graph): FoundationEntry[] {
  const g = graphOf(wv, graph);
  return g.foundations().map((sid) => {
    const s = g.statement(sid);
    return { id: sid, text: s.text, mode: s.mode };
  });
}

// ------------------------------------------------------------------ sccs

/** One entry of {@link sccs}. */
export interface SccEntry {
  /** Member statements, file order. */
  members: string[];
  /** Members with an argument from themselves to themselves. */
  self_loops: string[];
  /** Arguments whose premises and conclusions are all members. */
  internal_arguments: string[];
  /** Arguments that touch the component but are not wholly inside it. */
  boundary_arguments: string[];
}

/**
 * Cyclic strongly connected components: size > 1, or a self-loop.
 *
 * Each entry lists the member statements, the arguments that run entirely
 * inside the component (premises and conclusions all members) and the
 * arguments that run partly inside it.
 */
export function sccs(wv: Worldview, graph?: Graph): SccEntry[] {
  const g = graphOf(wv, graph);
  const out: SccEntry[] = [];
  for (const comp of g.cyclicSccs()) {
    const members = new Set(comp);
    const internal: string[] = [];
    const boundary: string[] = [];
    for (const [aid, a] of g.arguments) {
      const touches = a.premises.some((p) => members.has(p)) || a.conclusions.some((c) => members.has(c));
      if (!touches) continue;
      if (a.premises.every((p) => members.has(p)) && a.conclusions.every((c) => members.has(c))) {
        internal.push(aid);
      } else {
        boundary.push(aid);
      }
    }
    out.push({
      members: [...comp],
      self_loops: comp.filter((s) => g.hasSelfLoop(s)),
      internal_arguments: internal,
      boundary_arguments: boundary,
    });
  }
  return out;
}

// -------------------------------------------------------------- rests-on

/** Direction of a closure report. */
export type Direction = "up" | "down";

/** An argument entry in a {@link restsOn} tree. */
export interface UpArgument {
  argument: string;
  rule?: string;
  /** The other conclusions of this argument (besides the node it hangs under). */
  co_conclusions: string[];
  premises: ClosureNode[];
}

/** An argument entry in a {@link supports} tree. */
export interface DownArgument {
  argument: string;
  rule?: string;
  /** The other premises of this argument (besides the node it hangs under). */
  co_premises: string[];
  conclusions: ClosureNode[];
}

/** One statement node in a closure tree. */
export interface ClosureNode {
  statement: string;
  text: string;
  /** Members of the cyclic component this statement belongs to, if any. */
  scc?: string[];
  /** (plan only) The audience already accepts this statement; it is never expanded. */
  given?: true;
  /** This statement was already expanded earlier in the tree. */
  seen?: true;
  /** Expansion was cut off by the depth limit. */
  truncated?: true;
  /** Present when the node was expanded: one entry per incoming (up) or outgoing (down) argument. */
  arguments?: Array<UpArgument | DownArgument>;
}

/** The result of {@link restsOn} or {@link supports}. */
export interface ClosureReport {
  statement: string;
  text: string;
  direction: Direction;
  /** Every statement and argument in the closure, file order, regardless of depth. */
  closure: { statements: string[]; arguments: string[] };
  /** Every cyclic component that the target or its closure belongs to, topological order. */
  sccs: string[][];
  tree: ClosureNode;
}

/**
 * Upstream closure of a statement, reported per incoming argument.
 *
 * The `tree` expands each statement once; a later encounter of the same
 * statement is a leaf marked `"seen": true`.  That keeps the output linear
 * in the size of the closure and makes cycles finite: a statement that
 * rests on itself shows up as a `seen` leaf under its own subtree.
 * `depth` limits how many argument hops are expanded; a node cut off by
 * the limit is marked `"truncated": true`.
 *
 * `closure` is the flat set of every statement and argument upstream
 * (regardless of `depth`), and `sccs` lists every cyclic component that
 * the target or its closure belongs to.
 *
 * Throws {@link UnknownIdError} if `sid` is not a statement.
 */
export function restsOn(wv: Worldview, sid: string, depth?: number | null, graph?: Graph): ClosureReport {
  const g = graphOf(wv, graph);
  requireStatement(g, sid);
  return closureReport(g, sid, depth ?? null, "up");
}

/**
 * Downstream closure of a statement, reported per outgoing argument.
 *
 * Mirror image of {@link restsOn}.  For each argument that uses the
 * statement as a premise, the report lists its co-premises and expands its
 * conclusions.
 */
export function supports(wv: Worldview, sid: string, depth?: number | null, graph?: Graph): ClosureReport {
  const g = graphOf(wv, graph);
  requireStatement(g, sid);
  return closureReport(g, sid, depth ?? null, "down");
}

const NO_STOP: ReadonlySet<string> = new Set();

function closureReport(
  g: Graph,
  sid: string,
  depth: number | null,
  direction: Direction,
  stop: ReadonlySet<string> = NO_STOP,
): ClosureReport {
  const up = direction === "up";
  const reach = up ? g.upstream(sid, stop) : g.downstream(sid, stop);
  const reachPlus = new Set(reach);
  reachPlus.add(sid);
  const argIds = new Set<string>();
  for (const s of reachPlus) {
    if (stop.has(s) && s !== sid) continue; // a stop statement is a leaf: its own arguments are not walked
    for (const aid of up ? g.incomingOf(s) : g.outgoingOf(s)) argIds.add(aid);
  }

  const sccOf = g.sccOf();
  const comps = g.sccs();
  const involvedSet = new Set<number>();
  for (const s of reachPlus) involvedSet.add(sccOf.get(s) as number);
  const involved = [...involvedSet].sort((a, b) => a - b);
  const cyclic: string[][] = [];
  for (const i of involved) {
    const comp = comps[i] as string[];
    if (g.isCyclicComponent(comp)) cyclic.push([...comp]);
  }

  // Global per call: each statement is expanded at most once in the tree.
  const expanded = new Set<string>();

  const node = (s: string, d: number): ClosureNode => {
    const n: ClosureNode = { statement: s, text: g.statement(s).text };
    const comp = comps[sccOf.get(s) as number] as string[];
    if (g.isCyclicComponent(comp)) {
      n.scc = [...comp];
    }
    if (stop.has(s) && s !== sid) {
      n.given = true;
      return n;
    }
    if (expanded.has(s)) {
      n.seen = true;
      return n;
    }
    expanded.add(s);
    const edges = up ? g.incomingOf(s) : g.outgoingOf(s);
    if (depth !== null && d >= depth) {
      if (edges.length > 0) {
        n.truncated = true;
      }
      return n;
    }
    const args: Array<UpArgument | DownArgument> = [];
    for (const aid of edges) {
      const a = g.argument(aid);
      // Keys in the Python order (argument, rule?, co_*, children) so the
      // JSON text matches the reference CLI byte for byte, not just deeply.
      const head: { argument: string; rule?: string } = { argument: aid };
      if (a.rule !== undefined) head.rule = a.rule;
      if (up) {
        args.push({
          ...head,
          co_conclusions: a.conclusions.filter((c) => c !== s),
          premises: a.premises.map((p) => node(p, d + 1)),
        });
      } else {
        args.push({
          ...head,
          co_premises: a.premises.filter((p) => p !== s),
          conclusions: a.conclusions.map((c) => node(c, d + 1)),
        });
      }
    }
    n.arguments = args;
    return n;
  };

  const closureStatements: string[] = [];
  for (const s of g.statements.keys()) {
    if (reach.has(s)) closureStatements.push(s);
  }
  const closureArguments: string[] = [];
  for (const a of g.arguments.keys()) {
    if (argIds.has(a)) closureArguments.push(a);
  }

  return {
    statement: sid,
    text: g.statement(sid).text,
    direction,
    closure: { statements: closureStatements, arguments: closureArguments },
    sccs: cyclic,
    tree: node(sid, 0),
  };
}

// ------------------------------------------------------------------ plan

/** One entry of {@link PlanReport.must_establish}. */
export interface MustEstablishEntry {
  id: string;
  text: string;
  /** The arguments concluding this statement, file order. */
  via: string[];
}

/** One entry of {@link PlanReport.must_grant}. */
export interface MustGrantEntry {
  id: string;
  text: string;
}

/** The result of {@link plan}. */
export interface PlanReport {
  statement: string;
  text: string;
  /** The given statements actually reached from the target, file order. */
  given: string[];
  /** Reached statements that are neither given nor foundations, with the arguments available for each. */
  must_establish: MustEstablishEntry[];
  /** Reached foundations that are not given: the audience has to accept them as premises. */
  must_grant: MustGrantEntry[];
  /** Every argument in the pruned closure, file order. */
  arguments: string[];
  /** Every cyclic component that the target or its pruned closure belongs to. */
  sccs: string[][];
  /** The rests-on tree pruned at given statements (leaves marked `given: true`). */
  tree: ClosureNode;
}

/**
 * Argument planning: what must be established to reach `sid`?
 *
 * `given` is the set of statements the audience already accepts.  The
 * upstream walk from the target stops at any given statement.  Every other
 * statement reached is either a foundation, which the audience will have
 * to **grant** (nothing in the worldview argues for it), or a supported
 * statement that must be **established** by one of its incoming arguments.
 * The `tree` is the rests-on tree pruned at the given statements (leaves
 * marked `"given": true`).
 *
 * If the target itself is given there is nothing to do.
 *
 * Throws {@link UnknownIdError} if `sid` or any given id is not a statement.
 */
export function plan(wv: Worldview, sid: string, given: readonly string[] = [], graph?: Graph): PlanReport {
  const g = graphOf(wv, graph);
  requireStatement(g, sid);
  for (const x of given) requireStatement(g, x);
  const stop = new Set(given);
  const text = g.statement(sid).text;
  if (stop.has(sid)) {
    return {
      statement: sid,
      text,
      given: [sid],
      must_establish: [],
      must_grant: [],
      arguments: [],
      sccs: [],
      tree: { statement: sid, text, given: true },
    };
  }
  const rep = closureReport(g, sid, null, "up", stop);
  const reached = new Set(rep.closure.statements);
  reached.add(sid);
  const ids = [...g.statements.keys()];
  return {
    statement: sid,
    text,
    given: ids.filter((s) => stop.has(s) && reached.has(s)),
    must_establish: ids
      .filter((s) => reached.has(s) && !stop.has(s) && !g.isFoundation(s))
      .map((s) => ({ id: s, text: g.statement(s).text, via: [...g.incomingOf(s)] })),
    must_grant: ids
      .filter((s) => reached.has(s) && !stop.has(s) && g.isFoundation(s))
      .map((s) => ({ id: s, text: g.statement(s).text })),
    arguments: rep.closure.arguments,
    sccs: rep.sccs,
    tree: rep.tree,
  };
}

// ---------------------------------------------------------- well-founded

/** The result of {@link wellFounded}. */
export interface WellFoundedReport {
  foundations: string[];
  grounded: string[];
  ungrounded: string[];
}

/**
 * Optional lint: which statements are grounded in foundations?
 *
 * A statement is *grounded* if it is a foundation, or if some argument
 * concluding it has all of its premises grounded (an argument with no
 * premises is trivially grounded).  This is the least fixed point, so a
 * statement whose only support runs through a cycle is ungrounded, and a
 * statement that needs two premises is ungrounded if either one is.
 * Informational only; never a validation failure.
 */
export function wellFounded(wv: Worldview, graph?: Graph): WellFoundedReport {
  const g = graphOf(wv, graph);
  const grounded = new Set<string>(g.foundations());
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of g.arguments.values()) {
      if (a.premises.every((p) => grounded.has(p))) {
        for (const c of a.conclusions) {
          if (!grounded.has(c)) {
            grounded.add(c);
            changed = true;
          }
        }
      }
    }
  }
  const ids = [...g.statements.keys()];
  return {
    foundations: g.foundations(),
    grounded: ids.filter((s) => grounded.has(s)),
    ungrounded: ids.filter((s) => !grounded.has(s)),
  };
}
