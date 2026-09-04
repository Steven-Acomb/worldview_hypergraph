/**
 * Sidebar tab: the statement list with search and filters.
 *
 * The row elements are rebuilt only when the document, the filters, or the
 * lint overlay change.  A selection change just moves the `selected`
 * marker, so clicking around a large document never rebuilds hundreds of
 * rows.
 */

import type { Mode, Statement } from "worldview-core";
import type { Actions, Ctx, View } from "../context.js";
import { DEFAULT_STATEMENT_FILTERS, filterStatements } from "../logic.js";
import type { StatementFilters } from "../logic.js";
import { ellipsis, h, markSelected, replaceChildren } from "../ui.js";

export class StatementsView implements View {
  readonly el: HTMLElement;
  private filters: StatementFilters = { ...DEFAULT_STATEMENT_FILTERS };
  private readonly list = h("div", { class: "list", role: "listbox", "aria-label": "Statements" });
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
      placeholder: "Search id or text…",
      "aria-label": "Search statements by id or text",
      oninput: () => this.setFilters({ query: search.value }),
    });
    const mode = h(
      "select",
      { class: "select", title: "Mode", "aria-label": "Filter by mode", onchange: () => this.setFilters({ mode: mode.value as Mode | "any" }) },
      h("option", { value: "any" }, "any mode"),
      h("option", { value: "is" }, "is"),
      h("option", { value: "ought" }, "ought"),
    );
    const check = (label: string, key: keyof StatementFilters, title: string): HTMLElement => {
      const input = h("input", { type: "checkbox", onchange: () => this.setFilters({ [key]: input.checked }) });
      return h("label", { class: "check", title }, input, label);
    };
    this.el = h(
      "div",
      { class: "tab-panel" },
      h(
        "div",
        { class: "list-tools" },
        h("div", { class: "row-tools" }, search, h("button", { class: "btn primary", title: "Add a statement and select it", onclick: () => actions.addStatement() }, "+ Statement")),
        h(
          "div",
          { class: "row-tools wrap" },
          mode,
          check("foundations", "foundationsOnly", "Only statements with no incoming argument"),
          check("in a cycle", "cyclicOnly", "Only members of a cyclic component"),
          check("ungrounded", "ungroundedOnly", "Only statements not grounded in any foundation"),
          this.count,
        ),
      ),
      this.list,
    );
  }

  private setFilters(patch: Partial<StatementFilters>): void {
    this.filters = { ...this.filters, ...patch };
    if (this.ctx) this.update(this.ctx);
  }

  update(ctx: Ctx): void {
    this.ctx = ctx;
    const { store, derived, ui } = ctx;
    const all = store.doc.statements;
    const f = this.filters;
    const listKey = [store.version, ui.lintOverlay, f.query, f.mode, f.foundationsOnly, f.cyclicOnly, f.ungroundedOnly].join("|");
    const sel = store.selection?.kind === "statement" ? store.selection.id : null;

    if (listKey !== this.listKey) {
      this.listKey = listKey;
      this.selectedId = null;
      this.rows = new Map();
      const shown = filterStatements(all, f, derived);
      this.count.textContent = shown.length === all.length ? `${all.length}` : `${shown.length} of ${all.length}`;
      replaceChildren(
        this.list,
        shown.length
          ? shown.map((s) => {
              const row = this.row(ctx, s);
              this.rows.set(s.id, row);
              return row;
            })
          : h("div", { class: "empty" }, all.length ? "No statement matches these filters" : "No statements yet. Add one, open a file, or pick an example."),
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

  private row(ctx: Ctx, s: Statement): HTMLElement {
    const { derived, ui } = ctx;
    const actions = this.actions;
    const cyc = derived.cyclic.has(s.id);
    const fnd = derived.foundationSet.has(s.id);
    const ung = derived.ungrounded.has(s.id);
    const select = (): void => actions.select({ kind: "statement", id: s.id }, { center: true });
    return h(
      "div",
      {
        class: "row" + (ui.lintOverlay && ung ? " warn" : ""),
        role: "option",
        "aria-selected": "false",
        tabindex: 0,
        dataset: { id: s.id },
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
        h("span", { class: "mono id" }, s.id),
        h("span", { class: `badge mode-${s.mode}` }, s.mode),
        fnd ? h("span", { class: "badge foundation", title: "Foundation: no incoming argument" }, "F") : null,
        cyc ? h("span", { class: "badge cycle", title: "In a cycle: " + derived.cyclic.get(s.id)!.join(", ") }, "↻") : null,
        ung ? h("span", { class: "badge ungrounded", title: "Ungrounded: not reachable from foundations" }, "!") : null,
      ),
      h("div", { class: "row-text" }, s.text ? ellipsis(s.text, 110) : h("em", { class: "muted" }, "(empty text)")),
    );
  }
}

export function cssEscape(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}
