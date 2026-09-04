/**
 * Present an argument as a Markdown document with its full structure explicit.
 *
 * Show someone a conclusion together with everything it rests on, per
 * argument, including the justification prose, so the whole case can be
 * read top to bottom.  Port of `present.py`; the Markdown is identical to
 * the Python reference implementation's.
 */

import { WHITESPACE, canon } from "./canon.js";
import { Graph } from "./graph.js";
import type { Worldview } from "./model.js";
import { plan, restsOn } from "./queries.js";
import type { ClosureNode, UpArgument } from "./queries.js";

/** Options of {@link present}. */
export interface PresentOptions {
  /** Statements the audience already accepts; the tree is pruned there (see {@link plan}).  Empty means none. */
  given?: readonly string[];
  /** Limit expansion to this many argument hops (ignored when `given` is non-empty). */
  depth?: number | null;
  /** A pre-built graph to reuse. */
  graph?: Graph;
}

const PY_SPACE = new Set<string>(Array.from(WHITESPACE));

/** Python's `str.rstrip()`. */
function pyRstrip(s: string): string {
  const cps = Array.from(s);
  let end = cps.length;
  while (end > 0 && PY_SPACE.has(cps[end - 1] as string)) end--;
  return cps.slice(0, end).join("");
}

const code = (x: string): string => `\`${x}\``;

/**
 * Markdown rendering of the case for `sid`.
 *
 * With `given`, the tree is pruned at statements the audience already
 * accepts (see {@link plan}).  `depth` limits expansion as in
 * {@link restsOn}.
 *
 * Throws {@link UnknownIdError} for an unknown statement id.
 */
export function present(wv: Worldview, sid: string, options: PresentOptions = {}): string {
  const g = options.graph ?? Graph.build(wv);
  const given = options.given ?? [];
  const usePlan = given.length > 0;
  const report = usePlan ? plan(wv, sid, given, g) : restsOn(wv, sid, options.depth ?? null, g);
  const target = g.statement(sid);

  const out: string[] = [];
  out.push(`# ${canon(target.text)}`);
  out.push("");
  const tags = [code(sid), target.mode];
  const scc = report.tree.scc;
  if (scc !== undefined && scc.length > 0) tags.push("in cycle: " + scc.map(code).join(", "));
  out.push(tags.join(" · "));
  out.push("");
  if (usePlan && "given" in report) {
    const shown = report.given;
    out.push("Taken as given: " + (shown.length > 0 ? shown.map(code).join(", ") : "nothing in this statement's closure") + ".");
    out.push("");
  }

  out.push("## The case");
  out.push("");
  render(out, g, report.tree, 0);
  out.push("");

  if ("must_grant" in report) {
    const grant = report.must_grant;
    out.push("## What the audience must grant");
    out.push("");
    if (grant.length === 0) out.push("Nothing: every foundation reached is already given.");
    for (const s of grant) out.push(`- ${code(s.id)}: ${canon(s.text)}`);
    out.push("");
  } else {
    let founds = report.closure.statements.filter((s) => g.isFoundation(s));
    if (g.isFoundation(sid)) founds = [sid, ...founds];
    out.push("## Foundations reached");
    out.push("");
    if (founds.length === 0) out.push("None: every statement in the closure has an argument for it (the closure is cyclic).");
    for (const s of founds) out.push(`- ${code(s)}: ${canon(g.statement(s).text)}`);
    out.push("");
  }

  if (report.sccs.length > 0) {
    out.push("## Cycles involved");
    out.push("");
    for (const comp of report.sccs) out.push("- " + comp.map(code).join(", "));
    out.push("");
  }
  return pyRstrip(out.join("\n")) + "\n";
}

function render(out: string[], g: Graph, node: ClosureNode, indent: number): void {
  const pad = "  ".repeat(indent);
  const s = g.statement(node.statement);
  const flags: string[] = [];
  if (node.given) flags.push("given");
  if (node.seen) flags.push("see above");
  if (node.truncated) flags.push("not expanded further");
  if (node.arguments !== undefined && node.arguments.length === 0) flags.push("foundation");
  const suffix = flags.length > 0 ? ` — *${flags.join("; ")}*` : "";
  out.push(`${pad}- **${canon(s.text)}** (${code(s.id)}, ${s.mode})${suffix}`);
  for (const entry of (node.arguments ?? []) as UpArgument[]) {
    const a = g.argument(entry.argument);
    const rule = a.rule ? ` [${a.rule}]` : "";
    const co = entry.co_conclusions ?? [];
    const jointly = co.length > 0 ? ` (jointly concludes ${co.map(code).join(", ")})` : "";
    const just = canon(a.justification) || "(no justification given)";
    out.push(`${pad}  - via ${code(a.id)}${rule}${jointly}: ${just}`);
    if (entry.premises.length === 0) out.push(`${pad}    - *no premises*`);
    for (const p of entry.premises) render(out, g, p, indent + 2);
  }
}
