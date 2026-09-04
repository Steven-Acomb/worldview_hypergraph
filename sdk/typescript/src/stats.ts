/**
 * Descriptive statistics of a worldview.  Structural only, nothing evaluative.
 *
 * Port of `stats.py`; the numbers are identical to the Python reference
 * implementation, including its `round(mean, 3)`.
 */

import { Graph } from "./graph.js";
import { unused } from "./lint.js";
import type { Worldview } from "./model.js";
import { pyRound } from "./pyfloat.js";
import { wellFounded } from "./queries.js";

/** min / max / mean of a list of counts. */
export interface Distribution {
  min: number;
  max: number;
  /** Rounded to three decimals exactly as Python's `round(x, 3)` does. */
  mean: number;
}

/** The result of {@link stats}. */
export interface StatsReport {
  statements: number;
  arguments: number;
  modes: { is: number; ought: number };
  foundations: number;
  /** Statements no argument uses as a premise. */
  terminals: number;
  unused: number;
  ungrounded: number;
  cycles: number;
  largest_cycle: number;
  statements_in_cycles: number;
  premises: Distribution;
  conclusions: Distribution;
  zero_premise_arguments: number;
  /** Largest number of arguments on a path through the condensation (a cycle counts as one step). */
  longest_chain: number;
  /** Up to `top` statements with the largest downstream closure, ties by file order, zero counts omitted. */
  most_supporting: Array<{ id: string; downstream: number }>;
  /** Up to `top` statements with the largest upstream closure. */
  most_supported: Array<{ id: string; upstream: number }>;
}

function dist(values: number[]): Distribution {
  if (values.length === 0) return { min: 0, max: 0, mean: 0 };
  let min = values[0] as number;
  let max = min;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: pyRound(sum / values.length, 3) };
}

export function stats(wv: Worldview, graph?: Graph, top = 5): StatsReport {
  const g = graph ?? Graph.build(wv);
  const comps = g.sccs();
  const cyclic = comps.filter((c) => g.isCyclicComponent(c));
  const sccOf = g.sccOf();

  // Longest chain of arguments across the condensation (cycles count as one step).
  const depth: number[] = new Array<number>(comps.length).fill(0);
  comps.forEach((comp, ci) => {
    const members = new Set(comp);
    let best = 0;
    for (const s of comp) {
      for (const aid of g.incomingOf(s)) {
        for (const p of g.argument(aid).premises) {
          if (!members.has(p)) best = Math.max(best, (depth[sccOf.get(p) as number] as number) + 1);
        }
      }
    }
    depth[ci] = best;
  });

  const ids = [...g.statements.keys()];
  const downstream = new Map<string, number>();
  const upstream = new Map<string, number>();
  for (const s of ids) {
    downstream.set(s, g.downstream(s).size);
    upstream.set(s, g.upstream(s).size);
  }
  const order = new Map<string, number>();
  ids.forEach((s, i) => order.set(s, i));

  const topBy = (counts: Map<string, number>): Array<[string, number]> => {
    const ranked = [...ids].sort((a, b) => {
      const d = (counts.get(b) as number) - (counts.get(a) as number);
      return d !== 0 ? d : (order.get(a) as number) - (order.get(b) as number);
    });
    return ranked
      .slice(0, top)
      .filter((s) => (counts.get(s) as number) > 0)
      .map((s) => [s, counts.get(s) as number]);
  };

  let isCount = 0;
  let oughtCount = 0;
  for (const s of wv.statements) {
    if (s.mode === "is") isCount++;
    else oughtCount++;
  }
  let terminals = 0;
  for (const s of ids) if (g.outgoingOf(s).length === 0) terminals++;

  return {
    statements: wv.statements.length,
    arguments: wv.arguments.length,
    modes: { is: isCount, ought: oughtCount },
    foundations: g.foundations().length,
    terminals,
    unused: unused(wv, g).length,
    ungrounded: wellFounded(wv, g).ungrounded.length,
    cycles: cyclic.length,
    largest_cycle: cyclic.reduce((m, c) => Math.max(m, c.length), 0),
    statements_in_cycles: cyclic.reduce((n, c) => n + c.length, 0),
    premises: dist(wv.arguments.map((a) => a.premises.length)),
    conclusions: dist(wv.arguments.map((a) => a.conclusions.length)),
    zero_premise_arguments: wv.arguments.filter((a) => a.premises.length === 0).length,
    longest_chain: depth.reduce((m, d) => Math.max(m, d), 0),
    most_supporting: topBy(downstream).map(([id, n]) => ({ id, downstream: n })),
    most_supported: topBy(upstream).map(([id, n]) => ({ id, upstream: n })),
  };
}
