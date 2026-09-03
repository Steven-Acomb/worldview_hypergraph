/**
 * Diff two worldviews by computed identity.
 *
 * Statements are matched in two passes: first on `just_id` (same
 * proposition, same complete justification history), then on `prop_id`
 * among the leftovers (same proposition, different justification).  What
 * remains is added or removed.  Arguments are matched on `arg_hash`.
 *
 * If one file lists the same proposition twice (two statements with the
 * same canonical text and mode), matching is by multiset: a pair is
 * consumed once per occurrence, in file order.
 */

import { Identities, computeIdentities } from "./identity.js";
import { argumentIds, getArgument, getStatement, statementIds } from "./model.js";
import type { Mode, Worldview } from "./model.js";

/** A statement present in only one side. */
export interface StatementSummary {
  id: string;
  text: string;
  mode: Mode;
}

/** An argument present in only one side. */
export interface ArgumentSummary {
  id: string;
  premises: string[];
  conclusions: string[];
}

export interface DiffReport {
  /** `source` of the first worldview, or null. */
  a: string | null;
  /** `source` of the second worldview, or null. */
  b: string | null;
  statements: {
    /** Same just_id: same proposition with the same complete justification history. */
    identical: Array<{ a: string; b: string; just_id: string }>;
    /** Same prop_id, different just_id. */
    rejustified: Array<{ a: string; b: string; prop_id: string; text: string }>;
    added: StatementSummary[];
    removed: StatementSummary[];
  };
  arguments: {
    identical: Array<{ a: string; b: string; arg_hash: string }>;
    added: ArgumentSummary[];
    removed: ArgumentSummary[];
  };
  summary: {
    statements: { identical: number; rejustified: number; added: number; removed: number };
    arguments: { identical: number; added: number; removed: number };
  };
}

function group(ids: string[], key: Map<string, string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const i of ids) {
    const k = key.get(i) as string;
    const list = groups.get(k);
    if (list === undefined) {
      groups.set(k, [i]);
    } else {
      list.push(i);
    }
  }
  return groups;
}

type Pair = [a: string, b: string, key: string];

/** Pair ids across A and B whose keys agree.  Returns [pairs, aLeft, bLeft]. */
function match(
  aIds: string[],
  bIds: string[],
  aKey: Map<string, string>,
  bKey: Map<string, string>,
): [Pair[], string[], string[]] {
  const ga = group(aIds, aKey);
  const gb = group(bIds, bKey);
  const pairs: Pair[] = [];
  const aLeft: string[] = [];
  const bLeft: string[] = [];
  for (const [k, alist] of ga) {
    const blist = gb.get(k) ?? [];
    const n = Math.min(alist.length, blist.length);
    for (let i = 0; i < n; i++) {
      pairs.push([alist[i] as string, blist[i] as string, k]);
    }
    aLeft.push(...alist.slice(blist.length));
  }
  for (const [k, blist] of gb) {
    bLeft.push(...blist.slice((ga.get(k) ?? []).length));
  }
  // keep file order
  const aIndex = new Map(aIds.map((id, i) => [id, i] as const));
  const bIndex = new Map(bIds.map((id, i) => [id, i] as const));
  aLeft.sort((x, y) => (aIndex.get(x) as number) - (aIndex.get(y) as number));
  bLeft.sort((x, y) => (bIndex.get(x) as number) - (bIndex.get(y) as number));
  return [pairs, aLeft, bLeft];
}

/**
 * Match statements and arguments across two worldviews by identity.
 *
 * Optionally pass already-computed {@link Identities} for either side.
 */
export function diff(a: Worldview, b: Worldview, ida?: Identities, idb?: Identities): DiffReport {
  const ia = ida ?? computeIdentities(a);
  const ib = idb ?? computeIdentities(b);
  const sa = statementIds(a);
  const sb = statementIds(b);

  const [identical, saLeft1, sbLeft1] = match(sa, sb, ia.justId, ib.justId);
  const [rejustified, saLeft, sbLeft] = match(saLeft1, sbLeft1, ia.propId, ib.propId);
  const [argSame, aaLeft, abLeft] = match(argumentIds(a), argumentIds(b), ia.argHash, ib.argHash);

  const stmt = (wv: Worldview, sid: string): StatementSummary => {
    const s = getStatement(wv, sid);
    return { id: sid, text: s.text, mode: s.mode };
  };
  const arg = (wv: Worldview, aid: string): ArgumentSummary => {
    const x = getArgument(wv, aid);
    return { id: aid, premises: [...x.premises], conclusions: [...x.conclusions] };
  };

  const statements = {
    identical: identical.map(([x, y, k]) => ({ a: x, b: y, just_id: k })),
    rejustified: rejustified.map(([x, y, k]) => ({ a: x, b: y, prop_id: k, text: getStatement(b, y).text })),
    added: sbLeft.map((y) => stmt(b, y)),
    removed: saLeft.map((x) => stmt(a, x)),
  };
  const args = {
    identical: argSame.map(([x, y, k]) => ({ a: x, b: y, arg_hash: k })),
    added: abLeft.map((y) => arg(b, y)),
    removed: aaLeft.map((x) => arg(a, x)),
  };
  return {
    a: a.source ?? null,
    b: b.source ?? null,
    statements,
    arguments: args,
    summary: {
      statements: {
        identical: statements.identical.length,
        rejustified: statements.rejustified.length,
        added: statements.added.length,
        removed: statements.removed.length,
      },
      arguments: {
        identical: args.identical.length,
        added: args.added.length,
        removed: args.removed.length,
      },
    },
  };
}
