/**
 * The inspector for a selected statement: identities, cycle membership,
 * rests-on and supports trees (mirroring the SDK's ClosureReport), and
 * the foundations reached (the SDK's `plan` with nothing given).
 * Everything is computed by the SDK.
 */

import type { ClosureNode, ClosureReport, DownArgument, UpArgument } from "worldview-core";
import { plan, restsOn, supports } from "worldview-core";
import type { Actions, Ctx } from "../context.js";
import { MAX_DEPTH, depthLabel } from "../context.js";
import { ellipsis, h, plural, replaceChildren } from "../ui.js";

export class Inspector {
  readonly el = h("div", { class: "inspector" });
  private key = "";
  private lastId: string | null = null;
  /** user toggles of tree nodes for the current statement, keyed by direction + path; survives re-renders */
  private readonly toggles = new Map<string, boolean>();

  constructor(private readonly actions: Actions) {}

  update(ctx: Ctx, id: string): void {
    const { store, derived, ui } = ctx;
    const key = `${store.version}|${id}|${ui.inspectorDepth}`;
    if (key === this.key) return;
    this.key = key;
    if (id !== this.lastId) {
      // open/closed state belongs to one statement's trees, not to a tree position
      this.toggles.clear();
      this.lastId = id;
    }
    const a = this.actions;

    if (!derived.wv || !derived.graph || !derived.graph.statements.has(id) || !derived.ids) {
      replaceChildren(this.el, h("h3", null, "Inspector"), h("p", { class: "muted" }, "Not available while this statement is invalid (empty text, bad id, or a document problem)."));
      return;
    }
    const ids = derived.ids;
    const prop = ids.propId.get(id)!;
    const just = ids.justId.get(id)!;
    const scc = derived.cyclic.get(id);
    const depth = ui.inspectorDepth === Infinity ? null : ui.inspectorDepth;
    const up = restsOn(derived.wv, id, depth, derived.graph);
    const down = supports(derived.wv, id, depth, derived.graph);
    // With nothing given, `must_grant` is exactly the set of foundations the statement rests on
    // (including itself when it is a foundation).
    const mustGrant = plan(derived.wv, id, [], derived.graph).must_grant;
    const isFoundation = derived.foundationSet.has(id);
    const reached = mustGrant.filter((e) => e.id !== id);

    const hashRow = (label: string, value: string, hint: string): HTMLElement =>
      h(
        "div",
        { class: "hash-row", title: hint },
        h("span", { class: "hash-label" }, label),
        h("code", { class: "hash", title: value }, value.slice(0, 16) + "…"),
        h("button", { class: "btn small", title: `Copy ${label}`, "aria-label": `Copy ${label}`, onclick: () => a.copy(value, label) }, "copy"),
      );

    const depthSel = h(
      "select",
      {
        class: "select small",
        title: "How many argument hops to expand in the trees",
        "aria-label": "Tree depth",
        onchange: () => a.setInspectorDepth(depthSel.value === "all" ? Infinity : Number(depthSel.value)),
      },
      ...Array.from({ length: MAX_DEPTH }, (_, i) => h("option", { value: String(i + 1) }, String(i + 1))),
      h("option", { value: "all" }, "all"),
    );
    depthSel.value = ui.inspectorDepth === Infinity ? "all" : String(ui.inspectorDepth);

    replaceChildren(
      this.el,
      h("h3", null, "Inspector"),
      h(
        "div",
        { class: "inspector-ids" },
        hashRow("prop_id", prop, "Proposition id: what is being said (text and mode)"),
        hashRow("just_id", just, "Justified-statement id: what is being said and why (the whole upstream graph)"),
      ),
      h(
        "div",
        { class: "inspector-flags" },
        isFoundation ? h("span", { class: "badge foundation" }, "foundation") : null,
        scc ? h("span", { class: "badge cycle", title: scc.join(", ") }, `↻ cycle of ${scc.length}`) : null,
        derived.ungrounded.has(id) ? h("span", { class: "badge ungrounded" }, "ungrounded") : null,
        h("span", { class: "muted small" }, `${plural(derived.graph.incomingOf(id).length, "incoming argument")}, ${plural(derived.graph.outgoingOf(id).length, "outgoing")}`),
      ),
      scc ? h("div", { class: "small" }, "In a cycle with: ", h("div", { class: "chips" }, ...scc.filter((m) => m !== id).map((m) => this.stmtLink(ctx, m)))) : null,
      h("div", { class: "row-tools" }, h("span", { class: "muted small" }, "Tree depth"), depthSel, h("span", { class: "muted small" }, depthLabel(ui.inspectorDepth) === "all" ? "(whole closure)" : `(${plural(ui.inspectorDepth, "hop")})`)),
      this.section(ctx, "Rests on", up, "up", `Upstream: ${plural(up.closure.statements.length, "statement")}, ${plural(up.closure.arguments.length, "argument")}`),
      this.section(ctx, "Supports", down, "down", `Downstream: ${plural(down.closure.statements.length, "statement")}, ${plural(down.closure.arguments.length, "argument")}`),
      h(
        "section",
        { class: "inspector-section" },
        h("h4", null, `Foundations reached (${mustGrant.length})`),
        isFoundation ? h("p", { class: "muted small" }, "This statement is itself a foundation.") : null,
        reached.length
          ? h("div", { class: "chips" }, ...reached.map((e) => this.stmtLink(ctx, e.id, e.text)))
          : isFoundation
            ? null
            : h("p", { class: "muted small" }, "None: nothing upstream is a foundation" + (up.sccs.length ? " (the support runs through a cycle)" : "") + "."),
      ),
    );
  }

  private stmtLink(ctx: Ctx, id: string, text?: string): HTMLElement {
    const s = ctx.derived.statementById.get(id);
    return h(
      "button",
      { class: "link mono", title: text ?? (s ? s.text : id), onclick: () => this.actions.select({ kind: "statement", id }, { center: true }) },
      id,
    );
  }

  private section(ctx: Ctx, title: string, rep: ClosureReport, dir: "up" | "down", hint: string): HTMLElement {
    const root = rep.tree;
    const args = root.arguments ?? [];
    let body: HTMLElement;
    if (!args.length && !root.truncated) {
      body = h("p", { class: "muted small" }, dir === "up" ? "Nothing above: this is a foundation." : "Nothing below: no argument uses this statement as a premise.");
    } else if (root.truncated) {
      body = h("p", { class: "muted small" }, "Depth limit reached at the root; increase the tree depth.");
    } else {
      body = h("div", { class: "tree" }, ...args.map((arg, i) => this.renderArg(ctx, arg, dir, `${dir}/${i}`, 1)));
    }
    return h("section", { class: "inspector-section" }, h("h4", { title: hint }, title, " ", h("span", { class: "muted small" }, hint)), body);
  }

  private renderArg(ctx: Ctx, arg: UpArgument | DownArgument, dir: "up" | "down", path: string, level: number): HTMLElement {
    const co = dir === "up" ? (arg as UpArgument).co_conclusions : (arg as DownArgument).co_premises;
    const children = dir === "up" ? (arg as UpArgument).premises : (arg as DownArgument).conclusions;
    const a = ctx.derived.argumentById.get(arg.argument);
    return h(
      "div",
      { class: "tree-arg" },
      h(
        "div",
        { class: "tree-arg-head" },
        h("span", { class: "diamond", "aria-hidden": "true" }, "◆"),
        h(
          "button",
          { class: "link mono", title: a?.justification ?? "", onclick: () => this.actions.select({ kind: "argument", id: arg.argument }, { center: true }) },
          arg.argument,
        ),
        arg.rule ? h("span", { class: "badge rule" }, arg.rule) : null,
        co.length ? h("span", { class: "muted small" }, dir === "up" ? " also concludes " : " with ", co.join(", ")) : null,
      ),
      h(
        "div",
        { class: "tree-children" },
        children.length
          ? children.map((n, i) => this.renderNode(ctx, n, dir, `${path}/${i}`, level))
          : h("div", { class: "tree-leaf muted small" }, dir === "up" ? "(no premises: asserted on the strength of its justification)" : "(no conclusions)"),
      ),
    );
  }

  private renderNode(ctx: Ctx, node: ClosureNode, dir: "up" | "down", path: string, level: number): HTMLElement {
    const label = h(
      "span",
      { class: "tree-node-label" },
      this.stmtLink(ctx, node.statement, node.text),
      " ",
      h("span", { class: "tree-text", title: node.text }, ellipsis(node.text, 70)),
      node.scc ? h("span", { class: "badge cycle", title: "In a cycle: " + node.scc.join(", ") }, "↻") : null,
      node.seen ? h("span", { class: "badge seen", title: "Already expanded above" }, "see above") : null,
      node.truncated ? h("span", { class: "badge seen", title: "Cut off by the depth limit" }, "depth limit") : null,
      !node.seen && !node.truncated && node.arguments && !node.arguments.length ? h("span", { class: "badge foundation" }, dir === "up" ? "foundation" : "terminal") : null,
    );
    const args = node.arguments ?? [];
    if (node.seen || node.truncated || !args.length) {
      return h("div", { class: "tree-leaf" }, label);
    }
    const open = this.toggles.get(path) ?? level < 3;
    const details = h(
      "details",
      { class: "tree-node", open, ontoggle: () => this.toggles.set(path, details.open) },
      h("summary", null, label),
      ...args.map((arg, i) => this.renderArg(ctx, arg, dir, `${path}/${i}`, level + 1)),
    );
    return details;
  }
}
