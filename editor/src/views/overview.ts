/**
 * Sidebar tab: header editing, foundations, cycles, lint, and the ids
 * table.  Everything listed here is computed by the SDK.
 *
 * The sections are rebuilt only when the document changes; a selection
 * change just moves the `selected` marker on the links and table rows.
 */

import type { Actions, Ctx, View } from "../context.js";
import { errorLine, jsonField, labelled, textField } from "../fields.js";
import type { Field } from "../fields.js";
import { shortHash } from "../logic.js";
import type { Store } from "../store.js";
import { ellipsis, h, plural, replaceChildren } from "../ui.js";

export class OverviewView implements View {
  readonly el: HTMLElement;
  private readonly fields: Field[];
  private readonly dynamic = h("div", { class: "overview-dynamic" });
  private key = "";
  private selKey = "";
  /** "statement:<id>" / "argument:<id>" -> every element that marks that item as selected */
  private marks = new Map<string, HTMLElement[]>();

  constructor(store: Store, private readonly actions: Actions) {
    const name = h("input", { type: "text", class: "input", placeholder: "Untitled worldview" });
    const description = h("textarea", { class: "textarea", rows: 3, placeholder: "What this worldview is about" });
    const meta = h("textarea", { class: "textarea mono", rows: 3, placeholder: '{ "author": "…" }', spellcheck: false });
    const metaErr = errorLine();
    this.fields = [
      textField({ el: name, get: () => store.doc.name ?? "", set: (v) => store.setHeader({ name: v || undefined }, { coalesce: "header:name" }) }),
      textField({ el: description, get: () => store.doc.description ?? "", set: (v) => store.setHeader({ description: v || undefined }, { coalesce: "header:description" }) }),
      jsonField({ el: meta, errorEl: metaErr, kind: "meta", get: () => store.doc.meta, set: (v) => store.setHeader({ meta: v }) }),
    ];
    this.el = h(
      "div",
      { class: "tab-panel scroll" },
      h("section", { class: "section" }, h("h3", null, "Document"), labelled("Name", name), labelled("Description", description), labelled("meta (JSON object)", meta, metaErr)),
      this.dynamic,
    );
  }

  update(ctx: Ctx): void {
    for (const f of this.fields) f.sync();
    const { store } = ctx;
    const key = String(store.version);
    if (key !== this.key) {
      this.key = key;
      this.selKey = "";
      this.rebuild(ctx);
    }
    const sel = store.selection;
    const selKey = sel ? `${sel.kind}:${sel.id}` : "";
    if (selKey !== this.selKey) {
      for (const el of this.marks.get(this.selKey) ?? []) el.classList.remove("selected");
      for (const el of this.marks.get(selKey) ?? []) el.classList.add("selected");
      this.selKey = selKey;
    }
  }

  private mark(key: string, el: HTMLElement): HTMLElement {
    const list = this.marks.get(key);
    if (list) list.push(el);
    else this.marks.set(key, [el]);
    return el;
  }

  private rebuild(ctx: Ctx): void {
    const { store, derived } = ctx;
    const a = this.actions;
    this.marks = new Map();
    const stmtLink = (id: string, text?: string): HTMLElement =>
      this.mark(
        `statement:${id}`,
        h(
          "button",
          {
            class: "link mono",
            title: text ?? derived.statementById.get(id)?.text ?? "",
            onclick: () => a.select({ kind: "statement", id }, { center: true }),
          },
          id,
        ),
      );
    const argLink = (id: string): HTMLElement =>
      this.mark(
        `argument:${id}`,
        h(
          "button",
          {
            class: "link mono",
            title: derived.argumentById.get(id)?.justification ?? "",
            onclick: () => a.select({ kind: "argument", id }, { center: true }),
          },
          id,
        ),
      );

    if (!derived.wv) {
      replaceChildren(this.dynamic, h("section", { class: "section" }, h("p", { class: "muted" }, "Graph facts are not available: the document cannot be interpreted even after removing its invalid parts. See the problems in the status bar.")));
      return;
    }

    const foundations = h(
      "section",
      { class: "section" },
      h("h3", null, `Foundations (${derived.foundations.length})`),
      h("p", { class: "muted small" }, "Statements with no incoming argument."),
      derived.foundations.length
        ? h("ul", { class: "plain" }, ...derived.foundations.map((f) => h("li", null, stmtLink(f.id, f.text), " ", h("span", { class: "muted" }, ellipsis(f.text, 60)))))
        : h("p", { class: "muted" }, "None."),
    );

    const cycles = h(
      "section",
      { class: "section" },
      h("h3", null, `Cycles (${derived.sccs.length})`),
      h("p", { class: "muted small" }, "Cyclic strongly connected components: statements that justify one another."),
      derived.sccs.length
        ? derived.sccs.map((c, i) =>
            h(
              "div",
              { class: "cycle-card" },
              h("div", null, h("strong", null, `Cycle ${i + 1}`), " ", h("span", { class: "muted" }, plural(c.members.length, "member"))),
              h("div", { class: "chips" }, ...c.members.map((m) => stmtLink(m))),
              c.self_loops.length ? h("div", { class: "small" }, "Self-loops: ", ...c.self_loops.map((m) => stmtLink(m))) : null,
              h("div", { class: "small" }, "Internal arguments: ", c.internal_arguments.length ? c.internal_arguments.map((x) => [argLink(x), " "]) : h("span", { class: "muted" }, "none")),
              h("div", { class: "small" }, "Boundary arguments: ", c.boundary_arguments.length ? c.boundary_arguments.map((x) => [argLink(x), " "]) : h("span", { class: "muted" }, "none")),
            ),
          )
        : h("p", { class: "muted" }, "None."),
    );

    const ung = derived.wellFounded?.ungrounded ?? [];
    const lint = h(
      "section",
      { class: "section" },
      h("h3", null, "Lint: well-founded"),
      h("p", { class: "muted small" }, "Informational only. A statement is grounded if it is a foundation or some argument concluding it has all premises grounded."),
      ung.length
        ? [h("p", null, `${plural(ung.length, "ungrounded statement")}:`), h("div", { class: "chips" }, ...ung.map((id) => stmtLink(id)))]
        : h("p", null, `All ${plural(store.doc.statements.length, "statement")} grounded.`),
    );

    const ids = derived.ids!.toDict();
    const idsSection = h(
      "section",
      { class: "section" },
      h(
        "div",
        { class: "section-head" },
        h("h3", null, "Ids"),
        h("button", { class: "btn small", title: "Copy prop_id, just_id and arg_hash for everything as JSON", onclick: () => a.copy(JSON.stringify(ids, null, 2) + "\n", "ids JSON") }, "Copy all as JSON"),
      ),
      h("p", { class: "muted small" }, "Content-derived identities, computed on demand and never stored in the file."),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table mono small" },
          h("thead", null, h("tr", null, h("th", null, "statement"), h("th", null, "prop_id"), h("th", null, "just_id"), h("th", null, "scc"))),
          h(
            "tbody",
            null,
            ...ids.statements.map((row) =>
              this.mark(
                `statement:${row.id}`,
                h(
                  "tr",
                  null,
                  h("td", null, stmtLink(row.id)),
                  h("td", { title: row.prop_id }, h("button", { class: "link", title: "Copy prop_id", onclick: () => a.copy(row.prop_id, "prop_id") }, shortHash(row.prop_id) + "…")),
                  h("td", { title: row.just_id }, h("button", { class: "link", title: "Copy just_id", onclick: () => a.copy(row.just_id, "just_id") }, shortHash(row.just_id) + "…")),
                  h("td", null, row.scc ? h("span", { class: "badge cycle", title: row.scc.join(", ") }, `↻ ${row.scc.length}`) : ""),
                ),
              ),
            ),
          ),
        ),
        h(
          "table",
          { class: "table mono small" },
          h("thead", null, h("tr", null, h("th", null, "argument"), h("th", null, "arg_hash"))),
          h(
            "tbody",
            null,
            ...ids.arguments.map((row) =>
              this.mark(
                `argument:${row.id}`,
                h(
                  "tr",
                  null,
                  h("td", null, argLink(row.id)),
                  h("td", { title: row.arg_hash }, h("button", { class: "link", title: "Copy arg_hash", onclick: () => a.copy(row.arg_hash, "arg_hash") }, shortHash(row.arg_hash) + "…")),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    replaceChildren(
      this.dynamic,
      derived.sanitized ? h("p", { class: "notice" }, `The document has ${plural(derived.problems.length, "problem")}; the facts below come from a copy with the invalid parts removed.`) : null,
      foundations,
      cycles,
      lint,
      idsSection,
    );
  }
}
