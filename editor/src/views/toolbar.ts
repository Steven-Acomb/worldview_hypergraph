/**
 * Top toolbar: file actions, examples and recent menus, undo/redo,
 * display toggles, theme, help.
 */

import type { Actions, Ctx, Theme, View } from "../context.js";
import { ellipsis, h, plural } from "../ui.js";

const THEME_ORDER: Theme[] = ["system", "light", "dark"];
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

export class Toolbar implements View {
  readonly el: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly rankBtn: HTMLButtonElement;
  private readonly idsBtn: HTMLButtonElement;
  private readonly lintBtn: HTMLButtonElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly rightBtn: HTMLButtonElement;
  private readonly title = h("span", { class: "toolbar-title" });

  constructor(private readonly actions: Actions) {
    const a = actions;
    const btn = (label: string, title: string, onclick: () => void, extra = "", ariaLabel?: string): HTMLButtonElement =>
      h("button", { class: "btn " + extra, title, onclick, "aria-label": ariaLabel }, label);

    this.undoBtn = btn("↶ Undo", "Undo (Ctrl+Z)", () => a.undo());
    this.redoBtn = btn("↷ Redo", "Redo (Ctrl+Shift+Z, Ctrl+Y)", () => a.redo());
    this.rankBtn = btn("LR", "Layout direction: left-to-right / top-to-bottom", () => a.toggleRankdir(), "toggle");
    this.idsBtn = btn("ids", "Show ids on graph nodes", () => a.toggleShowIds(), "toggle");
    this.lintBtn = btn("lint", "Lint overlay: mark statements not grounded in any foundation", () => a.toggleLint(), "toggle");
    this.themeBtn = btn(THEME_ICON.system, "Theme: system / light / dark", () => {
      const cur = this.themeBtn.dataset.theme as Theme;
      a.setTheme(THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length] as Theme);
    }, "", "Theme: system");
    this.rightBtn = btn("Panel", "Show or hide the editor panel", () => a.toggleRight(), "narrow-only toggle");

    const examplesBtn = btn("Examples ▾", "Load a bundled example", () => this.examplesMenu(examplesBtn));
    const recentBtn = btn("Recent ▾", "Documents opened in this browser", () => this.recentMenu(recentBtn));
    examplesBtn.setAttribute("aria-haspopup", "menu");
    recentBtn.setAttribute("aria-haspopup", "menu");

    this.el = h(
      "header",
      { class: "toolbar" },
      h("span", { class: "brand", title: "worldview-core editor" }, "worldview"),
      h("div", { class: "group" }, btn("New", "New document (Ctrl+N)", () => void a.newDocument()), btn("Open…", "Open a .json file (Ctrl+O), or drop one anywhere", () => a.openPicker()), btn("Save", "Download the document as JSON (Ctrl+S)", () => a.save())),
      h("div", { class: "group" }, examplesBtn, recentBtn),
      h("div", { class: "group" }, this.undoBtn, this.redoBtn),
      this.title,
      h("div", { class: "group" }, this.rankBtn, this.idsBtn, this.lintBtn),
      h("div", { class: "group" }, this.themeBtn, btn("?", "Keyboard shortcuts and help", () => a.showHelp(), "", "Help"), this.rightBtn),
    );
  }

  update(ctx: Ctx): void {
    const { store, ui } = ctx;
    this.undoBtn.disabled = !store.canUndo;
    this.redoBtn.disabled = !store.canRedo;
    this.rankBtn.textContent = ui.rankdir === "LR" ? "LR" : "TB";
    this.idsBtn.classList.toggle("on", ui.showIds);
    this.idsBtn.setAttribute("aria-pressed", String(ui.showIds));
    this.lintBtn.classList.toggle("on", ui.lintOverlay);
    this.lintBtn.setAttribute("aria-pressed", String(ui.lintOverlay));
    this.themeBtn.textContent = THEME_ICON[ui.theme];
    this.themeBtn.dataset.theme = ui.theme;
    this.themeBtn.title = `Theme: ${ui.theme} (click to change)`;
    this.themeBtn.setAttribute("aria-label", `Theme: ${ui.theme}`);
    this.rightBtn.classList.toggle("on", ui.rightOpen);
    this.title.textContent = ellipsis(store.doc.name ?? "Untitled worldview", 60);
    this.title.title = store.doc.name ?? "";
  }

  private examplesMenu(anchor: HTMLElement): void {
    const a = this.actions;
    a.menu(anchor, (close) => {
      const body = h("div", { class: "menu-loading" }, "Loading…");
      a.listExamples()
        .then((list) => {
          body.className = "";
          body.replaceChildren(
            ...(list.length
              ? list.map((e) =>
                  h(
                    "button",
                    {
                      class: "menu-item",
                      role: "menuitem",
                      title: e.description,
                      onclick: () => {
                        close();
                        void a.loadExample(e.file);
                      },
                    },
                    h("span", { class: "menu-item-name" }, e.name),
                    h("span", { class: "muted" }, `${plural(e.statements, "statement")}, ${plural(e.arguments, "argument")}`),
                  ),
                )
              : [h("div", { class: "menu-empty" }, "No examples were bundled with this build")]),
          );
        })
        .catch((err: unknown) => {
          body.className = "menu-empty";
          body.textContent = `Could not load the examples list: ${(err as Error).message}`;
        });
      return body;
    });
  }

  private recentMenu(anchor: HTMLElement): void {
    const a = this.actions;
    a.menu(anchor, (close) => {
      const render = (): HTMLElement[] => {
        const list = a.recents();
        if (!list.length) return [h("div", { class: "menu-empty" }, "Nothing opened yet in this browser")];
        return list.map((r) =>
          h(
            "div",
            { class: "menu-row" },
            h(
              "button",
              {
                class: "menu-item",
                role: "menuitem",
                onclick: () => {
                  close();
                  void a.loadRecent(r.key);
                },
              },
              h("span", { class: "menu-item-name" }, ellipsis(r.name, 48)),
              h("span", { class: "muted" }, `${r.sourceName ?? "unsaved"} · ${plural(r.statements, "statement")} · ${new Date(r.savedAt).toLocaleString()}`),
            ),
            h(
              "button",
              {
                class: "btn icon",
                title: "Remove from the recent list",
                "aria-label": `Remove ${r.name} from the recent list`,
                onclick: (e: MouseEvent) => {
                  e.stopPropagation();
                  a.forgetRecent(r.key);
                  wrap.replaceChildren(...render());
                },
              },
              "×",
            ),
          ),
        );
      };
      const wrap = h("div", null, ...render());
      return wrap;
    });
  }
}
