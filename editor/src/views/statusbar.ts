/**
 * Bottom status bar: validation state, counts, dirty flag, source name.
 */

import type { Actions, Ctx, View } from "../context.js";
import { h, plural, replaceChildren } from "../ui.js";

export class StatusBar implements View {
  readonly el: HTMLElement;
  private readonly valid: HTMLButtonElement;
  private readonly counts = h("span", { class: "status-counts" });
  private readonly source = h("span", { class: "status-source" });

  constructor(actions: Actions) {
    this.valid = h("button", { class: "status-valid", onclick: () => actions.showProblems() });
    this.el = h("footer", { class: "statusbar" }, this.valid, this.counts, h("span", { class: "spacer" }), this.source);
  }

  update(ctx: Ctx): void {
    const { store, derived } = ctx;
    const n = derived.problems.length;
    this.valid.className = "status-valid " + (n ? "problems" : "ok");
    this.valid.textContent = n ? `${plural(n, "problem")}` : "Valid";
    this.valid.title = n ? "Click to list the problems" : "The document is a valid worldview-core file";
    replaceChildren(
      this.counts,
      `${plural(store.doc.statements.length, "statement")} · ${plural(store.doc.arguments.length, "argument")}`,
      derived.wv ? ` · ${plural(derived.foundations.length, "foundation")} · ${plural(derived.sccs.length, "cycle")}` : "",
      derived.sanitized ? h("span", { class: "muted", title: "Graph facts come from a copy with the invalid parts removed" }, " (derived from a sanitized copy)") : null,
    );
    replaceChildren(
      this.source,
      store.dirty ? h("span", { class: "dirty", title: "Unsaved changes (autosaved in this browser)" }, "● ") : null,
      store.sourceName ?? "unsaved document",
      store.canUndo || store.canRedo ? h("span", { class: "muted" }, ` · v${store.version}`) : null,
    );
  }
}
