/**
 * Graph structure over a worldview: adjacency, strongly connected components.
 *
 * The *statement graph* has one edge `p -> c` for every argument that
 * lists `p` among its premises and `c` among its conclusions.  Cycles are
 * ordinary structure here, never an error.
 *
 * All maps iterate in file order (the order statements and arguments
 * appear in the worldview), which every downstream ordering depends on.
 */

import { UnknownIdError } from "./errors.js";
import type { Argument, Statement, Worldview } from "./model.js";

function must<V>(map: Map<string, V>, key: string, kind: "statement" | "argument"): V {
  const v = map.get(key);
  if (v === undefined) {
    throw new UnknownIdError(kind, key);
  }
  return v;
}

export class Graph {
  /** statement id -> statement, in file order */
  readonly statements: Map<string, Statement>;
  /** argument id -> argument, in file order */
  readonly arguments: Map<string, Argument>;
  /** statement id -> ids of arguments concluding it, in file order */
  readonly incoming = new Map<string, string[]>();
  /** statement id -> ids of arguments using it as a premise, in file order */
  readonly outgoing = new Map<string, string[]>();
  /** statement id -> statements it supports */
  readonly succ = new Map<string, Set<string>>();
  /** statement id -> statements supporting it */
  readonly pred = new Map<string, Set<string>>();

  private sccsCache: string[][] | null = null;
  private sccOfCache: Map<string, number> | null = null;

  private constructor(statements: Map<string, Statement>, args: Map<string, Argument>) {
    this.statements = statements;
    this.arguments = args;
  }

  static build(wv: Worldview): Graph {
    const statements = new Map<string, Statement>();
    for (const s of wv.statements) statements.set(s.id, s);
    const args = new Map<string, Argument>();
    for (const a of wv.arguments) args.set(a.id, a);
    const g = new Graph(statements, args);
    for (const sid of statements.keys()) {
      g.incoming.set(sid, []);
      g.outgoing.set(sid, []);
      g.succ.set(sid, new Set());
      g.pred.set(sid, new Set());
    }
    for (const a of wv.arguments) {
      for (const c of a.conclusions) {
        must(g.incoming, c, "statement").push(a.id);
      }
      for (const p of a.premises) {
        must(g.outgoing, p, "statement").push(a.id);
        for (const c of a.conclusions) {
          must(g.succ, p, "statement").add(c);
          must(g.pred, c, "statement").add(p);
        }
      }
    }
    return g;
  }

  // -------------------------------------------------------- basic facts

  /** Ids of the arguments concluding `sid`, in file order. */
  incomingOf(sid: string): string[] {
    return must(this.incoming, sid, "statement");
  }

  /** Ids of the arguments using `sid` as a premise, in file order. */
  outgoingOf(sid: string): string[] {
    return must(this.outgoing, sid, "statement");
  }

  /** Statements `sid` supports (through any argument). */
  succOf(sid: string): Set<string> {
    return must(this.succ, sid, "statement");
  }

  /** Statements supporting `sid` (through any argument). */
  predOf(sid: string): Set<string> {
    return must(this.pred, sid, "statement");
  }

  statement(sid: string): Statement {
    return must(this.statements, sid, "statement");
  }

  argument(aid: string): Argument {
    return must(this.arguments, aid, "argument");
  }

  isFoundation(sid: string): boolean {
    return this.incomingOf(sid).length === 0;
  }

  /** Statements with no incoming argument, in file order. */
  foundations(): string[] {
    const out: string[] = [];
    for (const sid of this.statements.keys()) {
      if (this.isFoundation(sid)) out.push(sid);
    }
    return out;
  }

  hasSelfLoop(sid: string): boolean {
    return this.succOf(sid).has(sid);
  }

  // ---------------------------------------------------------------- SCCs

  /**
   * Strongly connected components in topological order of the condensation.
   *
   * Components that only support others come first; components that only
   * rest on others come last.  Every statement is in exactly one component;
   * acyclic statements form singleton components.  Members are listed in
   * file order.  The order is exactly that of the Python reference
   * implementation (iterative Tarjan over statements in file order).
   */
  sccs(): string[][] {
    if (this.sccsCache === null) this.computeSccs();
    return this.sccsCache as string[][];
  }

  /** Map statement id -> index into {@link sccs}. */
  sccOf(): Map<string, number> {
    if (this.sccOfCache === null) this.computeSccs();
    return this.sccOfCache as Map<string, number>;
  }

  /** True if the component contains a cycle (size > 1, or a self-loop). */
  isCyclicComponent(comp: readonly string[]): boolean {
    return comp.length > 1 || this.hasSelfLoop(comp[0] as string);
  }

  cyclicSccs(): string[][] {
    return this.sccs().filter((c) => this.isCyclicComponent(c));
  }

  private computeSccs(): void {
    // Iterative Tarjan.  Emits components in reverse topological order
    // (a component is emitted only after everything reachable from it),
    // so we reverse at the end to get sources first.
    const order = new Map<string, number>();
    let i = 0;
    for (const sid of this.statements.keys()) order.set(sid, i++);
    const byOrder = (a: string, b: string): number => (order.get(a) as number) - (order.get(b) as number);
    const sortedSucc = (sid: string): string[] => [...this.succOf(sid)].sort(byOrder);

    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const comps: string[][] = [];
    let counter = 0;

    for (const root of this.statements.keys()) {
      if (index.has(root)) continue;
      const work: Array<[string, string[]]> = [[root, sortedSucc(root)]];
      index.set(root, counter);
      low.set(root, counter);
      counter++;
      stack.push(root);
      onStack.add(root);
      while (work.length > 0) {
        const [v, todo] = work[work.length - 1] as [string, string[]];
        if (todo.length > 0) {
          const w = todo.pop() as string; // pops from the END: last successor in file order first
          if (!index.has(w)) {
            index.set(w, counter);
            low.set(w, counter);
            counter++;
            stack.push(w);
            onStack.add(w);
            work.push([w, sortedSucc(w)]);
          } else if (onStack.has(w)) {
            low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
          }
        } else {
          work.pop();
          if (work.length > 0) {
            const parent = (work[work.length - 1] as [string, string[]])[0];
            low.set(parent, Math.min(low.get(parent) as number, low.get(v) as number));
          }
          if (low.get(v) === index.get(v)) {
            const comp: string[] = [];
            for (;;) {
              const w = stack.pop() as string;
              onStack.delete(w);
              comp.push(w);
              if (w === v) break;
            }
            comp.sort(byOrder);
            comps.push(comp);
          }
        }
      }
    }
    comps.reverse();
    this.sccsCache = comps;
    const sccOf = new Map<string, number>();
    comps.forEach((comp, ci) => {
      for (const sid of comp) sccOf.set(sid, ci);
    });
    this.sccOfCache = sccOf;
  }

  // -------------------------------------------------------- reachability

  /**
   * All statements from which `sid` is reachable (excluding itself unless cyclic).
   *
   * Statements in `stop` are reached but not expanded: the walk does not
   * continue past them.
   */
  upstream(sid: string, stop?: ReadonlySet<string>): Set<string> {
    return this.reach(sid, this.pred, stop);
  }

  /** All statements reachable from `sid` (excluding itself unless cyclic). */
  downstream(sid: string, stop?: ReadonlySet<string>): Set<string> {
    return this.reach(sid, this.succ, stop);
  }

  private reach(start: string, adj: Map<string, Set<string>>, stop?: ReadonlySet<string>): Set<string> {
    const seen = new Set<string>();
    const todo = [...must(adj, start, "statement")];
    while (todo.length > 0) {
      const v = todo.pop() as string;
      if (seen.has(v)) continue;
      seen.add(v);
      if (stop !== undefined && stop.has(v)) continue;
      for (const w of must(adj, v, "statement")) {
        if (!seen.has(w)) todo.push(w);
      }
    }
    return seen;
  }
}
