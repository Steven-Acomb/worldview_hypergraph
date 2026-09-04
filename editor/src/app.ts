/**
 * The application shell: owns the store, UI state, and overlays; builds
 * the layout; implements `Actions`; wires keyboard shortcuts, drag and
 * drop, autosave, and startup.
 */

import type { WorldviewDocument } from "worldview-core";
import { validateDict } from "worldview-core";
import type { Actions, Ctx, ExampleEntry, ReadResult, Tab, Theme, UiState } from "./context.js";
import { MAX_DEPTH } from "./context.js";
import { derive } from "./derived.js";
import type { Derived } from "./derived.js";
import { GraphView } from "./graph/view.js";
import { argumentKey, statementKey } from "./graph/layout.js";
import { debounce, suggestFileName } from "./logic.js";
import { forgetRecent, loadPrefs, loadRecents, loadWorkingDoc, rememberRecent, savePrefs, saveWorkingDoc } from "./persist.js";
import type { RecentEntry } from "./persist.js";
import { Store, emptyDocument } from "./store.js";
import type { Selection } from "./store.js";
import { copyText, download, h, isTextEntry, plural } from "./ui.js";
import { Overlays } from "./views/overlays.js";
import { RightPanel } from "./views/right-panel.js";
import { Sidebar } from "./views/sidebar.js";
import { StatusBar } from "./views/statusbar.js";
import { Toolbar } from "./views/toolbar.js";

/** Above this many graph nodes a freshly loaded document starts in focus mode. */
const LARGE_DOCUMENT_NODES = 600;
const NARROW_PX = 1000;
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
/** Single-file builds (vite.single.config.ts) ship the examples inline instead of fetching them. */
const INLINE_EXAMPLES = import.meta.env.VITE_INLINE_EXAMPLES === "1";

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+N", "New document (some browsers reserve this key; use the toolbar then)"],
  ["Ctrl+O", "Open a file (or drop a .json file anywhere on the page)"],
  ["Ctrl+S", "Save: download the document as JSON"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Shift+Z, Ctrl+Y", "Redo"],
  ["Delete", "Delete the selected statement or argument (after confirming)"],
  ["Escape", "Close menus and dialogs, leave a text field, clear the selection"],
  ["F", "Fit the graph in view"],
  ["?", "This help"],
  ["Mouse", "Drag the background to pan, wheel to zoom, click a node to select it, double-click to centre it"],
];

export class App {
  readonly store = new Store();
  readonly ui: UiState;
  private readonly overlays = new Overlays();
  private readonly toolbar: Toolbar;
  private readonly sidebar: Sidebar;
  private readonly graph: GraphView;
  private readonly right: RightPanel;
  private readonly status: StatusBar;
  private readonly fileInput: HTMLInputElement;
  private readonly main: HTMLElement;
  private derivedCache: { version: number; derived: Derived } | null = null;
  private examplesPromise: Promise<ExampleEntry[]> | null = null;
  private storageWarned = false;
  private readonly autosave = debounce(() => {
    const ok = saveWorkingDoc(this.store.doc, this.store.sourceName, this.store.dirty);
    if (!ok && !this.storageWarned) {
      this.storageWarned = true;
      this.overlays.toast("Could not autosave: this browser's storage is unavailable or full. Use Save to keep your work.", "error");
    }
  }, 300);
  readonly actions: Actions;

  constructor(private readonly root: HTMLElement) {
    const prefs = loadPrefs();
    this.ui = {
      tab: isTab(prefs.sidebarTab) ? prefs.sidebarTab : "statements",
      theme: prefs.theme ?? "system",
      rankdir: prefs.rankdir === "TB" ? "TB" : "LR",
      showIds: prefs.showIds ?? true,
      lintOverlay: prefs.lintOverlay ?? false,
      focusMode: "off",
      focusDepth: 2,
      focusId: null,
      inspectorDepth: 3,
      rightOpen: false,
    };
    this.actions = this.makeActions();
    this.toolbar = new Toolbar(this.actions);
    this.sidebar = new Sidebar(this.store, this.actions);
    this.graph = new GraphView(this.actions);
    this.right = new RightPanel(this.store, this.actions);
    this.status = new StatusBar(this.actions);
    this.fileInput = h("input", {
      type: "file",
      accept: ".json,application/json",
      hidden: true,
      onchange: () => {
        const f = this.fileInput.files?.[0];
        if (f) void this.actions.openFile(f);
        this.fileInput.value = "";
      },
    });
    this.main = h("div", { class: "main" }, this.sidebar.el, this.graph.el, this.right.el);
    root.replaceChildren(h("div", { class: "app" }, this.toolbar.el, this.main, this.status.el), this.fileInput, this.overlays.el);
  }

  // -------------------------------------------------------------- startup

  async start(): Promise<void> {
    this.applyTheme();
    this.store.subscribe(() => {
      this.render();
      this.autosave.call();
      this.settleGraph();
    });
    this.bindKeyboard();
    this.bindDragDrop();
    window.addEventListener("beforeunload", () => this.autosave.flush());
    this.root.addEventListener("focusout", () => {
      if (this.graph.stale) this.render();
    });

    const saved = loadWorkingDoc();
    if (saved) {
      this.loadDocument(saved.doc, saved.sourceName, { dirty: saved.dirty, remember: false });
      return;
    }
    try {
      const list = await this.actions.listExamples();
      const starter = [...list].sort((a, b) => a.statements - b.statements)[0];
      if (starter) {
        const doc = await this.actions.fetchExample(starter.file);
        this.loadDocument(doc, starter.file, { remember: true });
        this.overlays.toast(`Loaded the example "${starter.name}" to start with.`);
        return;
      }
    } catch (e) {
      this.overlays.toast(`Could not load a starter example: ${(e as Error).message}`, "error");
    }
    this.loadDocument(emptyDocument(), null, { remember: false });
  }

  // ------------------------------------------------------------ rendering

  private derived(): Derived {
    const v = this.store.version;
    if (!this.derivedCache || this.derivedCache.version !== v) {
      this.derivedCache = { version: v, derived: derive(this.store.doc) };
    }
    return this.derivedCache.derived;
  }

  private ctx(): Ctx {
    return { store: this.store, derived: this.derived(), ui: this.ui, actions: this.actions };
  }

  render(): void {
    const ctx = this.ctx();
    this.root.classList.toggle("right-open", this.ui.rightOpen);
    this.toolbar.update(ctx);
    this.sidebar.update(ctx);
    this.graph.update(ctx);
    this.right.update(ctx);
    this.status.update(ctx);
    document.title = `${this.store.dirty ? "• " : ""}${this.store.doc.name ?? "Untitled"} – Worldview editor`;
  }

  /**
   * A large graph is not re-laid out while the user is typing (see
   * GraphView.shouldDefer).  When the field being typed into goes away
   * without a focusout (a rename rebuilds the form, for example), finish
   * the relayout as soon as the event loop is free.
   */
  private settleGraph(): void {
    if (!this.graph.stale) return;
    setTimeout(() => {
      if (this.graph.stale && !isTextEntry(document.activeElement)) this.render();
    }, 0);
  }

  // ------------------------------------------------------------ documents

  /** Replace the working document and reset view state for it. */
  loadDocument(doc: WorldviewDocument, sourceName: string | null, opts: { dirty?: boolean; remember: boolean }): void {
    if (this.store.dirty && this.store.doc.statements.length) {
      rememberRecent(this.store.doc, this.store.sourceName); // never lose a dirty document
    }
    const nodes = doc.statements.length + doc.arguments.length;
    const large = nodes > LARGE_DOCUMENT_NODES;
    this.ui.focusMode = large ? "both" : "off";
    this.ui.focusDepth = 2;
    this.ui.focusId = large ? (doc.statements[0]?.id ?? null) : null;
    this.ui.rightOpen = false;
    this.graph.requestFit();
    this.store.replace(doc, sourceName, { dirty: opts.dirty ?? false });
    if (opts.remember) rememberRecent(doc, sourceName);
    if (large) {
      this.overlays.toast(`Large document (${plural(nodes, "node")}): showing the neighbourhood of "${this.ui.focusId}". Select statements to move the focus, or set Focus to off above the graph to draw everything.`);
    }
  }

  private async readFile(file: File): Promise<ReadResult> {
    let text: string;
    try {
      text = await readFileText(file);
    } catch (e) {
      return { ok: false, error: `Could not read ${file.name}: ${(e as Error).message}` };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `${file.name} is not valid JSON: ${(e as Error).message}` };
    }
    const problems = validateDict(data);
    if (problems.length && !looksLikeDocument(data)) {
      return { ok: false, error: `${file.name} is not a worldview-core document: ${problems[0]}` };
    }
    return { ok: true, doc: data as WorldviewDocument, problems };
  }

  private showProblemsModal(title: string, problems: string[], extra?: HTMLElement[]): void {
    this.overlays.showModal(
      title,
      h(
        "div",
        null,
        h("p", { class: "muted" }, `${plural(problems.length, "problem")}:`),
        h("ol", { class: "problem-list" }, ...problems.slice(0, 200).map((p) => h("li", null, p))),
        problems.length > 200 ? h("p", { class: "muted" }, `… and ${problems.length - 200} more`) : null,
      ),
      { wide: true, actions: extra },
    );
  }

  // -------------------------------------------------------------- actions

  private makeActions(): Actions {
    const app = this;
    const store = this.store;
    const ov = this.overlays;
    const prefs = (patch: Parameters<typeof savePrefs>[0]): void => {
      savePrefs(patch);
    };
    return {
      select(sel: Selection, opts = {}) {
        if (sel?.kind === "statement") app.ui.focusId = sel.id;
        const changed = JSON.stringify(sel) !== JSON.stringify(store.selection);
        if (sel && window.innerWidth < NARROW_PX) app.ui.rightOpen = true;
        if (changed) store.select(sel);
        else app.render();
        if (opts.center && sel) app.graph.centerOn(sel.kind === "statement" ? statementKey(sel.id) : argumentKey(sel.id));
      },
      setTab(tab: Tab) {
        app.ui.tab = tab;
        prefs({ sidebarTab: tab });
        app.render();
      },
      setFocus(patch) {
        Object.assign(app.ui, patch);
        if (app.ui.focusMode !== "off" && !app.ui.focusId) {
          const sel = store.selection;
          app.ui.focusId = sel?.kind === "statement" ? sel.id : (store.doc.statements[0]?.id ?? null);
        }
        app.render();
      },
      setInspectorDepth(depth: number) {
        app.ui.inspectorDepth = depth === Infinity ? Infinity : Math.max(1, Math.min(MAX_DEPTH, depth));
        app.render();
      },
      fitGraph() {
        app.graph.fit();
      },

      async newDocument() {
        if (store.dirty && store.doc.statements.length) {
          const ok = await ov.confirm("Start a new, empty document? The current one stays in the Recent list.", "New document");
          if (!ok) return;
        }
        app.loadDocument(emptyDocument(), null, { remember: false });
      },
      openPicker() {
        app.fileInput.click();
      },
      readFile: (file: File) => app.readFile(file),
      async openFile(file: File) {
        const r = await app.readFile(file);
        if (!r.ok) {
          ov.toast(r.error, "error");
          return;
        }
        if (r.problems.length) {
          const onlyReferential = r.problems.every((p) => /duplicate (statement|argument) id|references unknown statement/.test(p));
          const buttons = [h("button", { class: "btn", onclick: () => ov.closeModal() }, "Close")];
          if (onlyReferential) {
            buttons.push(
              h(
                "button",
                {
                  class: "btn primary",
                  title: "The problems are dangling references or duplicate ids, which the editor can display and you can fix",
                  onclick: () => {
                    ov.closeModal();
                    app.loadDocument(r.doc, file.name, { remember: true });
                    ov.toast(`Opened ${file.name} with ${plural(r.problems.length, "problem")} to fix.`);
                  },
                },
                "Open anyway",
              ),
            );
          }
          app.showProblemsModal(`${file.name} is not a valid worldview (the working document was not replaced)`, r.problems, buttons);
          return;
        }
        app.loadDocument(r.doc, file.name, { remember: true });
        ov.toast(`Opened ${file.name}: ${plural(r.doc.statements.length, "statement")}, ${plural(r.doc.arguments.length, "argument")}.`);
      },
      save() {
        (document.activeElement as HTMLElement | null)?.blur?.(); // commit pending edits
        const name = suggestFileName(store.doc, store.sourceName);
        download(name, store.serialize());
        store.sourceName = name;
        store.markSaved();
        rememberRecent(store.doc, name);
        app.autosave.flush();
        ov.toast(`Saved ${name}` + (app.derived().problems.length ? ` (with ${plural(app.derived().problems.length, "validation problem")})` : ""));
      },
      undo() {
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (!store.undo()) ov.toast("Nothing to undo");
      },
      redo() {
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (!store.redo()) ov.toast("Nothing to redo");
      },
      listExamples() {
        if (!app.examplesPromise) {
          const source: Promise<ExampleEntry[]> = INLINE_EXAMPLES
            ? import("./generated/examples.js").then((m) => m.index as ExampleEntry[])
            : fetch(`${BASE}examples/index.json`, { cache: "no-cache" }).then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json() as Promise<ExampleEntry[]>;
              });
          app.examplesPromise = source
            .then((list) => (Array.isArray(list) ? list.filter((e) => e && typeof e.file === "string") : []))
            .catch((e: unknown) => {
              app.examplesPromise = null;
              throw e;
            });
        }
        return app.examplesPromise;
      },
      async fetchExample(file: string) {
        let data: unknown;
        if (INLINE_EXAMPLES) {
          const m = await import("./generated/examples.js");
          data = m.files[file];
          if (data === undefined) throw new Error("not bundled");
        } else {
          const r = await fetch(`${BASE}examples/${encodeURIComponent(file)}`, { cache: "no-cache" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          data = await r.json();
        }
        const problems = validateDict(data);
        if (problems.length) throw new Error(`${file} is not a valid worldview: ${problems[0]}`);
        return data as WorldviewDocument;
      },
      async loadExample(file: string) {
        try {
          const doc = await this.fetchExample(file);
          app.loadDocument(doc, file, { remember: true });
          ov.toast(`Loaded example ${file}.`);
        } catch (e) {
          ov.toast(`Could not load ${file}: ${(e as Error).message}`, "error");
        }
      },
      recents(): RecentEntry[] {
        return loadRecents();
      },
      async loadRecent(key: string) {
        const r = loadRecents().find((x) => x.key === key);
        if (!r) {
          ov.toast("That recent document is no longer available", "error");
          return;
        }
        app.loadDocument(r.doc, r.sourceName, { remember: true });
        ov.toast(`Loaded "${r.name}" from the recent list.`);
      },
      forgetRecent(key: string) {
        forgetRecent(key);
      },

      addStatement() {
        const id = store.addStatement({ text: "" });
        app.ui.tab = "statements";
        this.select({ kind: "statement", id }, { center: true });
        setTimeout(() => app.right.el.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 0);
      },
      addArgument() {
        const sel = store.selection;
        const conclusions = sel?.kind === "statement" ? [sel.id] : [];
        const id = store.addArgument({ conclusions, justification: "" });
        app.ui.tab = "arguments";
        this.select({ kind: "argument", id }, { center: true });
        setTimeout(() => app.right.el.querySelector<HTMLInputElement>(".picker-input")?.focus(), 0);
      },
      async deleteStatement(id: string) {
        const uses = store.doc.arguments.filter((a) => a.premises.includes(id) || a.conclusions.includes(id));
        const orphaned = uses.filter((a) => a.conclusions.length === 1 && a.conclusions[0] === id);
        const detail = uses.length ? ` It is used by ${plural(uses.length, "argument")}; references are removed${orphaned.length ? ` and ${plural(orphaned.length, "argument")} left without conclusions ${orphaned.length === 1 ? "is" : "are"} deleted too` : ""}.` : "";
        if (await ov.confirm(`Delete statement "${id}"?${detail}`, "Delete")) store.deleteStatement(id);
      },
      async deleteArgument(id: string) {
        if (await ov.confirm(`Delete argument "${id}"?`, "Delete")) store.deleteArgument(id);
      },

      setTheme(theme: Theme) {
        app.ui.theme = theme;
        prefs({ theme });
        app.applyTheme();
        app.render();
      },
      toggleRankdir() {
        app.ui.rankdir = app.ui.rankdir === "LR" ? "TB" : "LR";
        prefs({ rankdir: app.ui.rankdir });
        app.render();
      },
      toggleShowIds() {
        app.ui.showIds = !app.ui.showIds;
        prefs({ showIds: app.ui.showIds });
        app.render();
      },
      toggleLint() {
        app.ui.lintOverlay = !app.ui.lintOverlay;
        prefs({ lintOverlay: app.ui.lintOverlay });
        app.render();
      },
      toggleRight() {
        app.ui.rightOpen = !app.ui.rightOpen;
        app.render();
      },

      showHelp() {
        ov.showModal(
          "Worldview editor",
          h(
            "div",
            null,
            h("p", null, "Edit worldview-core files: statements connected by arguments (N premises jointly entail M conclusions). Everything runs in this browser; nothing is uploaded. The working document is autosaved to this browser's storage."),
            h("h3", null, "Keyboard"),
            h("table", { class: "table shortcuts" }, h("tbody", null, ...SHORTCUTS.map(([k, d]) => h("tr", null, h("td", null, h("kbd", null, k)), h("td", null, d))))),
            h("p", { class: "muted small" }, "Shortcuts do not fire while typing in a text field."),
            h("h3", null, "Graph"),
            h("p", null, "Boxes are statements (double border: ought); diamonds are arguments; edges run premise → argument → conclusion. Selecting a statement tints what it rests on and what it supports. Foundations have a thick border, cycle members a ↻ badge, and with the lint overlay on, ungrounded statements are marked with !. Focus mode draws only the neighbourhood of the focused statement."),
          ),
          { wide: true, actions: [h("button", { class: "btn primary", onclick: () => ov.closeModal() }, "Close")] },
        );
      },
      showProblems() {
        const problems = app.derived().problems;
        if (!problems.length) {
          ov.toast("The document is valid.");
          return;
        }
        app.showProblemsModal("Validation problems", problems, [h("button", { class: "btn primary", onclick: () => ov.closeModal() }, "Close")]);
      },
      confirm: (message: string, okLabel?: string) => ov.confirm(message, okLabel),
      toast: (message: string, kind?: "info" | "error") => ov.toast(message, kind),
      copy(text: string, what = "text") {
        void copyText(text).then((ok) => ov.toast(ok ? `Copied ${what} to the clipboard` : `Could not copy ${what}; the clipboard is not available`, ok ? "info" : "error"));
      },
      menu: (anchor, build) => ov.menu(anchor, build),
    };
  }

  // ------------------------------------------------------------- plumbing

  private applyTheme(): void {
    const t = this.ui.theme;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  private bindKeyboard(): void {
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = isTextEntry(target);
      if (e.key === "Escape") {
        if (this.overlays.closeTop()) {
          e.preventDefault();
          return;
        }
        if (typing) {
          target.blur();
          e.preventDefault();
          return;
        }
        if (this.ui.rightOpen && window.innerWidth < NARROW_PX) {
          this.ui.rightOpen = false;
          this.render();
          return;
        }
        this.actions.select(null);
        return;
      }
      if (typing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && !e.shiftKey && key === "n") {
        e.preventDefault();
        void this.actions.newDocument();
      } else if (ctrl && key === "o") {
        e.preventDefault();
        this.actions.openPicker();
      } else if (ctrl && key === "s") {
        e.preventDefault();
        this.actions.save();
      } else if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.actions.undo();
      } else if ((ctrl && key === "z" && e.shiftKey) || (ctrl && key === "y")) {
        e.preventDefault();
        this.actions.redo();
      } else if (e.key === "?" && !ctrl) {
        e.preventDefault();
        if (this.overlays.isOpen) this.overlays.closeTop();
        else this.actions.showHelp();
      } else if (e.key === "Delete" && !ctrl) {
        const sel = this.store.selection;
        if (!sel || this.overlays.isOpen) return;
        e.preventDefault();
        if (sel.kind === "statement") void this.actions.deleteStatement(sel.id);
        else void this.actions.deleteArgument(sel.id);
      } else if (key === "f" && !ctrl && !e.altKey) {
        if (this.overlays.isOpen) return;
        e.preventDefault();
        this.graph.fit();
      }
    });
  }

  private bindDragDrop(): void {
    let depth = 0;
    document.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      this.root.classList.add("dropping");
    });
    document.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) this.root.classList.remove("dropping");
    });
    document.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    });
    document.addEventListener("drop", (e) => {
      depth = 0;
      this.root.classList.remove("dropping");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      void this.actions.openFile(file);
    });
  }
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file);
  });
}

function isTab(v: unknown): v is Tab {
  return v === "statements" || v === "arguments" || v === "overview" || v === "diff";
}

/** Enough shape to be shown in the editor even if invalid: an object with statement and argument arrays. */
function looksLikeDocument(data: unknown): data is WorldviewDocument {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.statements) && Array.isArray(d.arguments);
}
