/**
 * worldview-core: a portable JSON format for worldviews.
 *
 * A worldview is a set of natural-language *statements* connected by
 * *arguments*, where an argument is a directed hyperedge from N premise
 * statements to M conclusion statements.  This package is the TypeScript
 * port of the Python reference implementation: parse, validate, compute
 * content-derived identities, run structural queries, plan and present
 * arguments, lint, compute statistics, export pictures, and diff or merge
 * worldviews.  Every hash and every query result is identical to the
 * Python implementation; the conformance suite under `conformance/` in
 * the repository proves it.
 *
 * Typical use:
 *
 *     import { parseWorldview, restsOn, computeIdentities } from "worldview-core";
 *
 *     const wv = parseWorldview(JSON.parse(text), "my-worldview.json");
 *     console.log(restsOn(wv, "some-statement-id"));
 *     const ids = computeIdentities(wv);
 */

export { H, WHITESPACE, canon, containsWhitespace } from "./canon.js";
export type { HashPart } from "./canon.js";
export { Sha256, sha256, sha256Hex, toHex } from "./sha256.js";
export { diff } from "./diff.js";
export type { ArgumentSummary, DiffReport, StatementSummary } from "./diff.js";
export { LoadError, UnknownIdError, ValidationError, WorldviewError } from "./errors.js";
export { toDot, toMermaid } from "./export.js";
export type { DotOptions, MermaidOptions } from "./export.js";
export { Graph } from "./graph.js";
export { duplicates, emptyJustifications, isOughtGaps, lintAll, unused } from "./lint.js";
export type { DuplicateGroup, IsOughtGap, LintReport } from "./lint.js";
export { merge } from "./merge.js";
export type { HeaderField, MergeConflict, MergeReport, MergeTally } from "./merge.js";
export { Identities, computeIdentities, propId } from "./identity.js";
export type { ArgumentIdentity, IdentitiesDict, StatementIdentity } from "./identity.js";
export {
  FORMAT,
  FORMAT_VERSION,
  argumentIds,
  argumentToDict,
  getArgument,
  getStatement,
  parseWorldview,
  parseWorldviewJson,
  statementIds,
  statementToDict,
  worldviewFromDict,
  worldviewToDict,
} from "./model.js";
export type { Argument, JsonObject, JsonValue, Mode, Statement, Worldview, WorldviewDocument } from "./model.js";
export { present } from "./present.js";
export type { PresentOptions } from "./present.js";
export { pyFloatRepr, pyRound } from "./pyfloat.js";
export { foundations, plan, restsOn, sccs, supports, wellFounded } from "./queries.js";
export type {
  ClosureNode,
  ClosureReport,
  Direction,
  DownArgument,
  FoundationEntry,
  MustEstablishEntry,
  MustGrantEntry,
  PlanReport,
  SccEntry,
  UpArgument,
  WellFoundedReport,
} from "./queries.js";
export { schema } from "./schema.js";
export { stats } from "./stats.js";
export type { Distribution, StatsReport } from "./stats.js";
export { wrap as textwrap } from "./textwrap.js";
export { validateDict } from "./validate.js";
export { VERSION } from "./version.js";
