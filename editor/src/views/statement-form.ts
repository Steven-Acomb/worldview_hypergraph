/**
 * Right panel content for a selected statement: the edit form and the
 * inspector.  The form is rebuilt when the selection changes; otherwise
 * fields are synced in place so typing is never interrupted.
 */

import type { Mode } from "worldview-core";
import type { Actions, Ctx } from "../context.js";
import { errorLine, jsonField, labelled, textField } from "../fields.js";
import type { Field } from "../fields.js";
import { idProblem, problemsForStatement } from "../logic.js";
import type { Store } from "../store.js";
import { h, replaceChildren } from "../ui.js";
import { Inspector } from "./inspector.js";

export class StatementForm {
  readonly el = h("div", { class: "panel-form" });
  private currentId: string | null = null;
  private fields: Field[] = [];
  private modeInputs: HTMLInputElement[] = [];
  private readonly problems = h("div", { class: "problems" });
  private moveUp: HTMLButtonElement | null = null;
  private moveDown: HTMLButtonElement | null = null;
  private readonly inspector: Inspector;

  constructor(private readonly store: Store, private readonly actions: Actions) {
    this.inspector = new Inspector(actions);
  }

  update(ctx: Ctx, id: string): void {
    if (id !== this.currentId || !this.store.doc.statements.some((s) => s.id === id)) {
      this.build(id);
    }
    for (const f of this.fields) f.sync();
    const index = this.store.doc.statements.findIndex((x) => x.id === id);
    if (this.moveUp) this.moveUp.disabled = index <= 0;
    if (this.moveDown) this.moveDown.disabled = index >= this.store.doc.statements.length - 1;
    const s = this.store.doc.statements.find((x) => x.id === id);
    if (s) {
      for (const r of this.modeInputs) r.checked = r.value === s.mode;
    }
    const probs = ctx.derived.problems.length ? problemsForStatement(ctx.derived.problems, this.store.doc, id) : [];
    replaceChildren(this.problems, ...probs.map((p) => h("div", { class: "problem" }, p)));
    this.problems.hidden = !probs.length;
    this.inspector.update(ctx, id);
  }

  private build(id: string): void {
    const store = this.store;
    const a = this.actions;
    this.currentId = id;
    const get = (): { text: string; mode: Mode; meta?: unknown; ext?: unknown } => store.doc.statements.find((s) => s.id === id) ?? { text: "", mode: "is" };

    const idInput = h("input", { type: "text", class: "input mono", spellcheck: false, autocomplete: "off" });
    const idErr = errorLine();
    idInput.value = id;
    idInput.addEventListener("input", () => {
      const p = idProblem(idInput.value, id, store.doc.statements.map((s) => s.id));
      idErr.textContent = p ?? "";
      idErr.hidden = !p;
      idInput.classList.toggle("invalid", !!p);
    });
    const commitId = (): void => {
      const next = idInput.value;
      if (next === id) return;
      const p = idProblem(next, id, store.doc.statements.map((s) => s.id));
      if (p) return; // message already shown; keep the field as is
      store.renameStatement(id, next); // updates references and the selection; the form rebuilds
    };
    idInput.addEventListener("change", commitId);
    idInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitId();
      } else if (e.key === "Escape") {
        idInput.value = id;
        idInput.dispatchEvent(new Event("input"));
        idInput.blur();
        e.stopPropagation();
      }
    });

    const text = h("textarea", { class: "textarea", rows: 4, placeholder: "The proposition, in natural language" });
    const meta = h("textarea", { class: "textarea mono", rows: 2, placeholder: '{ "role": "axiom" }', spellcheck: false });
    const metaErr = errorLine();
    const ext = h("textarea", { class: "textarea mono", rows: 2, placeholder: '{ "namespace": { … } }', spellcheck: false });
    const extErr = errorLine();

    this.fields = [
      // `id` is captured: a commit that fires late (a debounced edit after the
      // selection moved on) still lands on the statement it was typed into.
      textField({ el: text, get: () => get().text, set: (v) => store.updateStatement(id, { text: v }, { coalesce: `statement:${id}:text` }) }),
      jsonField({ el: meta, errorEl: metaErr, kind: "meta", get: () => store.doc.statements.find((s) => s.id === id)?.meta, set: (v) => store.updateStatement(id, { meta: v }) }),
      jsonField({ el: ext, errorEl: extErr, kind: "ext", get: () => store.doc.statements.find((s) => s.id === id)?.ext, set: (v) => store.updateStatement(id, { ext: v }) }),
    ];

    this.modeInputs = (["is", "ought"] as Mode[]).map((m) =>
      h("input", {
        type: "radio",
        name: "statement-mode",
        value: m,
        onchange: () => store.updateStatement(id, { mode: m }),
      }),
    );
    const modeRow = h(
      "div",
      { class: "radio-row" },
      ...this.modeInputs.map((r, i) => h("label", { class: "radio", title: i === 0 ? "Descriptive: how things are" : "Normative: how things should be" }, r, r.value)),
    );

    replaceChildren(
      this.el,
      h(
        "div",
        { class: "panel-head" },
        h("h3", null, "Statement"),
        h("span", { class: "spacer" }),
        (this.moveUp = h("button", { class: "btn small", title: "Move up in the file order", "aria-label": "Move up", onclick: () => store.moveStatement(id, -1) }, "▲")),
        (this.moveDown = h("button", { class: "btn small", title: "Move down in the file order", "aria-label": "Move down", onclick: () => store.moveStatement(id, 1) }, "▼")),
        h("button", { class: "btn small danger", title: "Delete this statement and every reference to it (Delete)", onclick: () => void a.deleteStatement(id) }, "Delete"),
      ),
      this.problems,
      labelled("id", idInput, idErr),
      labelled("text", text),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "mode"), modeRow),
      labelled("meta (JSON object, human notes)", meta, metaErr),
      labelled("ext (JSON object of namespaces)", ext, extErr),
      this.inspector.el,
    );
  }
}
