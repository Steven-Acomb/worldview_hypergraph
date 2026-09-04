/**
 * Optional lints.  Informational only; none of these is a validity rule.
 *
 * - {@link wellFounded} (in `queries.ts`): statements not grounded in foundations.
 * - {@link duplicates}: several statements that are the same proposition.
 * - {@link unused}: statements no argument mentions.
 * - {@link emptyJustifications}: arguments whose justification is blank.
 * - {@link isOughtGaps}: arguments that conclude an `ought` from `is` premises alone.
 *
 * Line-for-line port of `lint.py`; results are identical to the Python
 * reference implementation.
 */

import { canon } from "./canon.js";
import { Graph } from "./graph.js";
import { Identities, computeIdentities } from "./identity.js";
import { getStatement } from "./model.js";
import type { Mode, Worldview } from "./model.js";
import { wellFounded } from "./queries.js";
import type { WellFoundedReport } from "./queries.js";

/** One group of {@link duplicates}. */
export interface DuplicateGroup {
  prop_id: string;
  /** Canonical text of the proposition. */
  text: string;
  mode: Mode;
  /** Local ids of the statements that share it, file order. */
  ids: string[];
}

/** Groups of statements sharing a proposition id (same canonical text and mode), in order of first occurrence. */
export function duplicates(wv: Worldview, ids?: Identities): DuplicateGroup[] {
  const identities = ids ?? computeIdentities(wv);
  const groups = new Map<string, string[]>();
  for (const s of wv.statements) {
    const prop = identities.propId.get(s.id) as string;
    const members = groups.get(prop);
    if (members === undefined) groups.set(prop, [s.id]);
    else members.push(s.id);
  }
  const out: DuplicateGroup[] = [];
  for (const [prop, members] of groups) {
    if (members.length > 1) {
      const first = getStatement(wv, members[0] as string);
      out.push({ prop_id: prop, text: canon(first.text), mode: first.mode, ids: members });
    }
  }
  return out;
}

/** Statements that appear in no argument, as premise or conclusion.  File order. */
export function unused(wv: Worldview, graph?: Graph): string[] {
  const g = graph ?? Graph.build(wv);
  const out: string[] = [];
  for (const sid of g.statements.keys()) {
    if (g.incomingOf(sid).length === 0 && g.outgoingOf(sid).length === 0) out.push(sid);
  }
  return out;
}

/** Arguments whose justification is empty after canonicalization.  File order. */
export function emptyJustifications(wv: Worldview): string[] {
  return wv.arguments.filter((a) => canon(a.justification) === "").map((a) => a.id);
}

/** One entry of {@link isOughtGaps}. */
export interface IsOughtGap {
  argument: string;
  /** The `ought` conclusions of the argument, file order. */
  ought_conclusions: string[];
  /** Every premise of the argument, file order; none of them is `ought`. */
  premises: string[];
}

/**
 * Arguments that conclude an `ought` from `is` premises alone.
 *
 * Hume's observation: no set of purely descriptive premises entails a
 * normative conclusion without a normative premise somewhere.  This lint
 * lists every argument with at least one `ought` conclusion and no `ought`
 * premise (including zero-premise arguments).  It is a structural flag,
 * not a verdict: the author may hold a bridge principle they have not
 * written down, which is exactly the kind of hidden assumption the format
 * exists to surface.  File order.
 */
export function isOughtGaps(wv: Worldview): IsOughtGap[] {
  const mode = new Map(wv.statements.map((s) => [s.id, s.mode] as const));
  const out: IsOughtGap[] = [];
  for (const a of wv.arguments) {
    const oughts = a.conclusions.filter((c) => mode.get(c) === "ought");
    if (oughts.length > 0 && !a.premises.some((p) => mode.get(p) === "ought")) {
      out.push({ argument: a.id, ought_conclusions: oughts, premises: [...a.premises] });
    }
  }
  return out;
}

/** The result of {@link lintAll}. */
export interface LintReport {
  well_founded: WellFoundedReport;
  duplicates: DuplicateGroup[];
  unused: string[];
  empty_justifications: string[];
  is_ought_gaps: IsOughtGap[];
}

/** Every lint at once. */
export function lintAll(wv: Worldview): LintReport {
  const g = Graph.build(wv);
  return {
    well_founded: wellFounded(wv, g),
    duplicates: duplicates(wv, computeIdentities(wv, g)),
    unused: unused(wv, g),
    empty_justifications: emptyJustifications(wv),
    is_ought_gaps: isOughtGaps(wv),
  };
}
