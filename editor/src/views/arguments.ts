/**
 * Sidebar tab: the argument list with search.  Rows are rebuilt only when
 * the document or the search changes; selection just moves the marker.
 */

import type { Argument } from "worldview-core";
import type { Actions, Ctx, View } from "../context.js";
import { filterArguments, problemsForArgument } from "../logic.js";
import { h, markSelected, replaceChildren } from "../ui.js";

export class ArgumentsView implements View {
  readonly el: HTMLElement;
  private query = "";
  private readonly list = h("div", { class: "list", role: "listbox", "aria-label": "Arguments" });
  private readonly count = h("span", { class: "list-count muted" });
  private ctx: Ctx | null = null;
  private listKey = "";
  private rows = new Map<string, HTMLElement>();
  private selectedId: string | null = null;
  private scrolledTo: string | null = null;

  constructor(private readonly actions: Actions) {
    const search = h("input", {
      type: "search",
      class: "search",
      placeholder: "Search id, rule, justification, statement ids…",
      "aria-label": "Search arguments by id, rule, justification, or statement ids",
      oninput: () => {
        this.query = search.value;
        if (this.ctx) this.update(this.ctx);
      },
    });
    this.el = h(
      "div",
      { class: "tab-panel" },
      h(
        "div",
        { class: "list-tools" },
        h("div", { class: "row-tools" }, search, h("button", { class: "btn primary", title: "Add an argument (concluding the selected statement, if any)", onclick: () => actions.addArgument() }, "+ Argument")),
        h("div", { class: "row-tools" }, h("span", { class: "muted small" }, "premises ⇒ conclusions"), this.count),
      ),
      this.list,
    );
  }

  update(ctx: Ctx): void {
    this.ctx = ctx;
    const { store } = ctx;
    const all = store.doc.arguments;
    const listKey = `${store.version}|${this.query}`;
    const sel = store.selection?.kind === "argument" ? store.selection.id : null;

    if (listKey !== this.listKey) {
      this.listKey = listKey;
      this.selectedId = null;
      this.rows = new Map();
      const shown = filterArguments(all, this.query);
      this.count.textContent = shown.length === all.length ? `${all.length}` : `${shown.length} of ${all.length}`;
      replaceChildren(
        this.list,
        shown.length
          ? shown.map((a) => {
              const row = this.row(ctx, a);
              this.rows.set(a.id, row);
              return row;
            })
          : h("div", { class: "empty" }, all.length ? "No argument matches this search" : "No arguments yet."),
      );
    }
    if (sel !== this.selectedId) {
      if (this.selectedId !== null) markSelected(this.rows.get(this.selectedId), false);
      if (sel !== null) markSelected(this.rows.get(sel), true);
      this.selectedId = sel;
    }
    if (sel !== this.scrolledTo) {
      if (sel !== null) this.rows.get(sel)?.scrollIntoView({ block: "nearest" });
      this.scrolledTo = sel;
    }
  }

  private row(ctx: Ctx, a: Argument): HTMLElement {
    const { store, derived } = ctx;
    const actions = this.actions;
    const problems = derived.problems.length ? problemsForArgument(derived.problems, store.doc, a.id) : [];
    const select = (): void => actions.select({ kind: "argument", id: a.id }, { center: true });
    return h(
      "div",
      {
        class: "row" + (problems.length ? " invalid" : ""),
        role: "option",
        "aria-selected": "false",
        tabindex: 0,
        dataset: { id: a.id },
        title: problems.length ? problems.join("\n") : a.justification,
        onclick: select,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        },
      },
      h(
        "div",
        { class: "row-head" },
        h("span", { class: "mono id" }, a.id),
        a.rule ? h("span", { class: "badge rule" }, a.rule) : null,
        problems.length ? h("span", { class: "badge ungrounded" }, "!") : null,
      ),
      h(
        "div",
        { class: "row-text mono small" },
        a.premises.length ? a.premises.join(", ") : h("em", { class: "muted" }, "(no premises)"),
        " ⇒ ",
        a.conclusions.length ? a.conclusions.join(", ") : h("em", { class: "muted" }, "(no conclusions)"),
      ),
    );
  }
}
