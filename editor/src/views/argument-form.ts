/**
 * Right panel content for a selected argument: id, premises and
 * conclusions (chips plus a searchable picker), justification, rule,
 * meta/ext, and the validation problems that concern this argument.
 */

import type { Actions, Ctx } from "../context.js";
import { errorLine, jsonField, labelled, textField } from "../fields.js";
import type { Field } from "../fields.js";
import { idProblem, problemsForArgument } from "../logic.js";
import type { Store } from "../store.js";
import { ellipsis, h, replaceChildren } from "../ui.js";
import { createPicker } from "./picker.js";

export class ArgumentForm {
  readonly el = h("div", { class: "panel-form" });
  private currentId: string | null = null;
  private fields: Field[] = [];
  private readonly problems = h("div", { class: "problems" });
  private moveUp: HTMLButtonElement | null = null;
  private moveDown: HTMLButtonElement | null = null;
  private readonly premiseChips = h("div", { class: "chips" });
  private readonly conclusionChips = h("div", { class: "chips" });
  private readonly summary = h("div", { class: "arg-summary muted small" });
  private ctx: Ctx | null = null;

  constructor(private readonly store: Store, private readonly actions: Actions) {}

  update(ctx: Ctx, id: string): void {
    this.ctx = ctx;
    if (id !== this.currentId || !this.store.doc.arguments.some((a) => a.id === id)) {
      this.build(id);
    }
    for (const f of this.fields) f.sync();
    const index = this.store.doc.arguments.findIndex((x) => x.id === id);
    if (this.moveUp) this.moveUp.disabled = index <= 0;
    if (this.moveDown) this.moveDown.disabled = index >= this.store.doc.arguments.length - 1;
    const a = this.store.doc.arguments.find((x) => x.id === id);
    if (!a) return;
    this.renderChips(this.premiseChips, a.premises, "premises");
    this.renderChips(this.conclusionChips, a.conclusions, "conclusions");
    const probs = ctx.derived.problems.length ? problemsForArgument(ctx.derived.problems, this.store.doc, id) : [];
    replaceChildren(this.problems, ...probs.map((p) => h("div", { class: "problem" }, p)));
    this.problems.hidden = !probs.length;
    const hash = ctx.derived.ids?.argHash.get(id);
    replaceChildren(
      this.summary,
      `${a.premises.length} premise${a.premises.length === 1 ? "" : "s"} jointly entail ${a.conclusions.length} conclusion${a.conclusions.length === 1 ? "" : "s"}. `,
      hash ? ["arg_hash ", h("code", { class: "hash", title: hash }, hash.slice(0, 16) + "…"), " ", h("button", { class: "btn small", onclick: () => ctx.actions.copy(hash, "arg_hash") }, "copy")] : h("span", null, "(arg_hash unavailable while the argument is invalid)"),
    );
  }

  private renderChips(container: HTMLElement, ids: string[], field: "premises" | "conclusions"): void {
    const ctx = this.ctx!;
    const known = new Set(this.store.doc.statements.map((s) => s.id));
    replaceChildren(
      container,
      ids.length
        ? ids.map((sid) => {
            const s = ctx.derived.statementById.get(sid) ?? this.store.doc.statements.find((x) => x.id === sid);
            return h(
              "span",
              { class: "chip" + (known.has(sid) ? "" : " invalid"), title: s ? s.text : `Unknown statement ${sid}` },
              h("button", { class: "chip-label mono", title: s ? `${s.text}\n(click to select)` : `Unknown statement ${sid}`, onclick: () => ctx.actions.select({ kind: "statement", id: sid }, { center: true }) }, sid),
              s ? h("span", { class: "chip-text" }, ellipsis(s.text, 40)) : null,
              h(
                "button",
                {
                  class: "chip-remove",
                  title: `Remove from ${field}`,
                  "aria-label": `Remove ${sid} from ${field}`,
                  onclick: () => {
                    const a = this.store.doc.arguments.find((x) => x.id === this.currentId);
                    if (!a) return;
                    this.store.updateArgument(a.id, { [field]: a[field].filter((x) => x !== sid) });
                  },
                },
                "×",
              ),
            );
          })
        : h("span", { class: "muted small" }, field === "premises" ? "No premises (asserted on the strength of the justification alone)" : "No conclusions: an argument needs at least one"),
    );
  }

  private build(id: string): void {
    const store = this.store;
    const a = this.actions;
    this.currentId = id;
    // `id` is captured throughout: a commit that fires late still lands on this argument.
    const cur = (): { justification: string; rule?: string } => store.doc.arguments.find((x) => x.id === id) ?? { justification: "" };

    const idInput = h("input", { type: "text", class: "input mono", spellcheck: false, autocomplete: "off" });
    const idErr = errorLine();
    idInput.value = id;
    idInput.addEventListener("input", () => {
      const p = idProblem(idInput.value, id, store.doc.arguments.map((x) => x.id));
      idErr.textContent = p ?? "";
      idErr.hidden = !p;
      idInput.classList.toggle("invalid", !!p);
    });
    const commitId = (): void => {
      const next = idInput.value;
      if (next === id) return;
      if (idProblem(next, id, store.doc.arguments.map((x) => x.id))) return;
      store.updateArgument(id, { id: next }); // updates the selection; the form rebuilds
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

    const addTo = (field: "premises" | "conclusions") => (sid: string): void => {
      const arg = store.doc.arguments.find((x) => x.id === id);
      if (!arg || arg[field].includes(sid)) return;
      store.updateArgument(arg.id, { [field]: [...arg[field], sid] });
    };
    const picker = (field: "premises" | "conclusions"): HTMLElement =>
      createPicker({
        placeholder: `Add a ${field === "premises" ? "premise" : "conclusion"}: search by id or text…`,
        statements: () => store.doc.statements,
        exclude: () => store.doc.arguments.find((x) => x.id === id)?.[field] ?? [],
        onPick: addTo(field),
      });

    const justification = h("textarea", { class: "textarea", rows: 4, placeholder: "Why the conclusions follow from the premises" });
    const rule = h("input", { type: "text", class: "input", placeholder: "e.g. modus ponens (free text, not part of identity)" });
    const meta = h("textarea", { class: "textarea mono", rows: 2, placeholder: "{ }", spellcheck: false });
    const metaErr = errorLine();
    const ext = h("textarea", { class: "textarea mono", rows: 2, placeholder: '{ "namespace": { … } }', spellcheck: false });
    const extErr = errorLine();
    this.fields = [
      textField({ el: justification, get: () => cur().justification, set: (v) => store.updateArgument(id, { justification: v }, { coalesce: `argument:${id}:justification` }) }),
      textField({ el: rule, get: () => cur().rule ?? "", set: (v) => store.updateArgument(id, { rule: v || undefined }, { coalesce: `argument:${id}:rule` }) }),
      jsonField({ el: meta, errorEl: metaErr, kind: "meta", get: () => store.doc.arguments.find((x) => x.id === id)?.meta, set: (v) => store.updateArgument(id, { meta: v }) }),
      jsonField({ el: ext, errorEl: extErr, kind: "ext", get: () => store.doc.arguments.find((x) => x.id === id)?.ext, set: (v) => store.updateArgument(id, { ext: v }) }),
    ];

    replaceChildren(
      this.el,
      h(
        "div",
        { class: "panel-head" },
        h("h3", null, "Argument"),
        h("span", { class: "spacer" }),
        (this.moveUp = h("button", { class: "btn small", title: "Move up in the file order", "aria-label": "Move up", onclick: () => store.moveArgument(id, -1) }, "▲")),
        (this.moveDown = h("button", { class: "btn small", title: "Move down in the file order", "aria-label": "Move down", onclick: () => store.moveArgument(id, 1) }, "▼")),
        h("button", { class: "btn small danger", title: "Delete this argument (Delete)", onclick: () => void a.deleteArgument(id) }, "Delete"),
      ),
      this.problems,
      labelled("id", idInput, idErr),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "premises (jointly)"), this.premiseChips, picker("premises")),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "conclusions (jointly, at least one)"), this.conclusionChips, picker("conclusions")),
      labelled("justification", justification),
      labelled("rule", rule),
      labelled("meta (JSON object)", meta, metaErr),
      labelled("ext (JSON object of namespaces)", ext, extErr),
      this.summary,
    );
  }
}
