/**
 * Right panel: the form for the selected statement or argument, or an
 * empty state.
 */

import type { Actions, Ctx, View } from "../context.js";
import type { Store } from "../store.js";
import { h } from "../ui.js";
import { ArgumentForm } from "./argument-form.js";
import { StatementForm } from "./statement-form.js";

export class RightPanel implements View {
  readonly el: HTMLElement;
  private readonly statementForm: StatementForm;
  private readonly argumentForm: ArgumentForm;
  private readonly empty: HTMLElement;
  private readonly body = h("div", { class: "panel-body" });
  private shown: HTMLElement | null = null;

  constructor(store: Store, actions: Actions) {
    this.statementForm = new StatementForm(store, actions);
    this.argumentForm = new ArgumentForm(store, actions);
    this.empty = h(
      "div",
      { class: "empty panel-empty" },
      h("p", null, "Nothing selected."),
      h("p", { class: "muted small" }, "Click a statement or argument in the list or on the graph to edit it and inspect what it rests on and what it supports."),
      h("div", { class: "row-tools" }, h("button", { class: "btn", onclick: () => actions.addStatement() }, "+ Statement"), h("button", { class: "btn", onclick: () => actions.addArgument() }, "+ Argument")),
    );
    this.el = h(
      "aside",
      { class: "right" },
      h("div", { class: "panel-close" }, h("button", { class: "btn icon", title: "Close panel", onclick: () => actions.toggleRight() }, "×")),
      this.body,
    );
  }

  update(ctx: Ctx): void {
    const sel = ctx.store.selection;
    let next: HTMLElement;
    if (sel?.kind === "statement" && ctx.store.doc.statements.some((s) => s.id === sel.id)) {
      this.statementForm.update(ctx, sel.id);
      next = this.statementForm.el;
    } else if (sel?.kind === "argument" && ctx.store.doc.arguments.some((a) => a.id === sel.id)) {
      this.argumentForm.update(ctx, sel.id);
      next = this.argumentForm.el;
    } else {
      next = this.empty;
    }
    if (next !== this.shown) {
      this.body.replaceChildren(next);
      this.body.scrollTop = 0;
      this.shown = next;
    }
  }
}
