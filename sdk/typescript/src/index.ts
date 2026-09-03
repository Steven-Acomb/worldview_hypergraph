/**
 * worldview-core: a portable JSON format for worldviews.
 *
 * A worldview is a set of natural-language *statements* connected by
 * *arguments*, where an argument is a directed hyperedge from N premise
 * statements to M conclusion statements.  This package is the TypeScript
 * port of the Python reference implementation: parse, validate, compute
 * content-derived identities, run structural queries, and diff two
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
export { Graph } from "./graph.js";
export { Identities, computeIdentities, propId } from "./identity.js";
export type { ArgumentIdentity, IdentitiesDict, StatementIdentity } from "./identity.js";
export {
  FORMAT,
  FORMAT_VERSION,
  argumentIds,
  getArgument,
  getStatement,
  parseWorldview,
  parseWorldviewJson,
  statementIds,
  worldviewFromDict,
  worldviewToDict,
} from "./model.js";
export type { Argument, JsonObject, JsonValue, Mode, Statement, Worldview, WorldviewDocument } from "./model.js";
export { foundations, restsOn, sccs, supports, wellFounded } from "./queries.js";
export type {
  ClosureNode,
  ClosureReport,
  Direction,
  DownArgument,
  FoundationEntry,
  SccEntry,
  UpArgument,
  WellFoundedReport,
} from "./queries.js";
export { schema } from "./schema.js";
export { validateDict } from "./validate.js";
export { VERSION } from "./version.js";
