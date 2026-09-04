/**
 * Left sidebar: a tab strip and one panel per tab.  Only the active
 * panel is updated.
 */

import type { Actions, Ctx, Tab, View } from "../context.js";
import type { Store } from "../store.js";
import { h } from "../ui.js";
import { ArgumentsView } from "./arguments.js";
import { DiffView } from "./diff.js";
import { OverviewView } from "./overview.js";
import { StatementsView } from "./statements.js";

const TABS: Array<[Tab, string, string]> = [
  ["statements", "Statements", "Statements: search, filter, add"],
  ["arguments", "Arguments", "Arguments: search, add"],
  ["overview", "Overview", "Header, foundations, cycles, lint, ids"],
  ["diff", "Diff", "Compare another document with this one"],
];

export class Sidebar implements View {
  readonly el: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panels: Record<Tab, View>;
  private readonly body = h("div", { class: "sidebar-body" });
  private active: Tab | null = null;

  constructor(store: Store, actions: Actions) {
    this.panels = {
      statements: new StatementsView(actions),
      arguments: new ArgumentsView(actions),
      overview: new OverviewView(store, actions),
      diff: new DiffView(actions),
    };
    const strip = h("div", { class: "tabs", role: "tablist" });
    for (const [key, label, title] of TABS) {
      const b = h("button", { class: "tab", role: "tab", title, onclick: () => actions.setTab(key) }, label);
      this.tabs.set(key, b);
      strip.append(b);
    }
    this.el = h("aside", { class: "sidebar" }, strip, this.body);
  }

  update(ctx: Ctx): void {
    const tab = ctx.ui.tab;
    for (const [key, b] of this.tabs) {
      b.classList.toggle("active", key === tab);
      b.setAttribute("aria-selected", String(key === tab));
    }
    const panel = this.panels[tab];
    if (this.active !== tab) {
      this.body.replaceChildren(panel.el);
      this.active = tab;
    }
    panel.update(ctx);
  }
}
