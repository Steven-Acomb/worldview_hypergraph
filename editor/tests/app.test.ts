// @vitest-environment jsdom
/**
 * Smoke test of the whole UI in jsdom: mount the App, load documents,
 * select, edit through the forms, switch tabs, use the keyboard, and
 * make sure every view renders without throwing.  Layout geometry is
 * not checked (jsdom has no layout engine).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldviewDocument } from "worldview-core";
import { App } from "../src/app";
import { derive } from "../src/derived";
import { emptyDocument } from "../src/store";

const examplesDir = path.resolve(__dirname, "..", "..", "examples");
const walking = JSON.parse(readFileSync(path.join(examplesDir, "walking-to-work.json"), "utf8")) as WorldviewDocument;
const fork = JSON.parse(readFileSync(path.join(examplesDir, "walking-to-work-fork.json"), "utf8")) as WorldviewDocument;
const descartes = JSON.parse(readFileSync(path.join(examplesDir, "descartes-discourse-on-method.json"), "utf8")) as WorldviewDocument;

const index = [
  { file: "walking-to-work.json", name: "Walking to work", description: "", statements: walking.statements.length, arguments: walking.arguments.length },
  { file: "descartes-discourse-on-method.json", name: "Descartes", description: "", statements: descartes.statements.length, arguments: descartes.arguments.length },
];

beforeAll(() => {
  // jsdom gaps
  Element.prototype.scrollIntoView = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined; // jsdom cannot navigate to blob: URLs
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.endsWith("index.json") ? index : u.endsWith("walking-to-work.json") ? walking : u.endsWith("descartes-discourse-on-method.json") ? descartes : null;
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
    }),
  );
});

let root: HTMLElement;
let app: App;

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById("app")!;
  app = new App(root);
  await app.start();
});

afterEach(() => {
  vi.useRealTimers();
});

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const $$ = (sel: string): Element[] => [...document.querySelectorAll(sel)];
const key = (k: string, opts: KeyboardEventInit = {}): void => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
};

describe("startup", () => {
  it("loads the smallest example when nothing is saved and renders every region", () => {
    expect(app.store.doc.name).toBe("Walking to work");
    expect(app.store.sourceName).toBe("walking-to-work.json");
    expect($$(".sidebar .row").length).toBe(walking.statements.length);
    expect($$("g.node.statement").length).toBe(walking.statements.length);
    expect($$("g.node.argument").length).toBe(walking.arguments.length);
    expect($$("path.edge").length).toBeGreaterThan(walking.arguments.length);
    expect($(".status-valid").textContent).toBe("Valid");
    expect($(".statusbar").textContent).toContain("12 statements");
    expect($(".panel-empty")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("worldview-editor:recent:v1")!)[0].key).toBe("walking-to-work.json");
  });

  it("restores the autosaved working document on the next start", async () => {
    app.store.addStatement({ text: "Persisted" });
    vi.useFakeTimers();
    app.store.addStatement({ text: "Persisted 2" });
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
    const saved = JSON.parse(localStorage.getItem("worldview-editor:doc:v1")!);
    expect(saved.doc.statements.length).toBe(walking.statements.length + 2);
    expect(saved.dirty).toBe(true);
    document.body.innerHTML = '<div id="app"></div>';
    const again = new App(document.getElementById("app")!);
    await again.start();
    expect(again.store.doc.statements.length).toBe(walking.statements.length + 2);
    expect(again.store.dirty).toBe(true);
    expect(document.querySelector(".statusbar .dirty")).toBeTruthy();
  });
});

describe("selection and forms", () => {
  it("selecting a statement shows its form and inspector and tints the graph", () => {
    ($$(".sidebar .row")[4] as HTMLElement).click(); // walk-commute
    expect(app.store.selection).toEqual({ kind: "statement", id: "walk-commute" });
    const form = $(".right .panel-form");
    expect(form.querySelector<HTMLInputElement>("input.mono")!.value).toBe("walk-commute");
    expect(form.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("I should walk to work.");
    expect(form.querySelector<HTMLInputElement>('input[type=radio][value=ought]')!.checked).toBe(true);
    const inspector = $(".inspector");
    expect(inspector.textContent).toContain("Rests on");
    expect(inspector.textContent).toContain("walk-for-health");
    expect(inspector.textContent).toContain("Foundations reached");
    expect(inspector.querySelectorAll(".hash").length).toBe(2);
    expect($('g.node[data-key="s:walk-commute"]').getAttribute("data-state")).toBe("selected");
    expect($('g.node[data-key="s:exercise-good"]').getAttribute("data-state")).toBe("up");
    expect($('g.node[data-key="s:need-raincoat"]').getAttribute("data-state")).toBe("down");
    expect($('g.node[data-key="a:walk-for-health"]').getAttribute("data-state")).toBe("up");
    // clicking a link in the inspector selects that statement
    const link = [...inspector.querySelectorAll<HTMLButtonElement>("button.link")].find((b) => b.textContent === "exercise-good")!;
    link.click();
    expect(app.store.selection).toEqual({ kind: "statement", id: "exercise-good" });
    expect($(".inspector").textContent).toContain("Nothing above");
  });

  it("edits text with a debounced commit, renames with reference updates, rejects bad ids", () => {
    app.actions.select({ kind: "statement", id: "walk-commute" });
    const text = $(".right textarea") as HTMLTextAreaElement;
    text.focus();
    vi.useFakeTimers();
    text.value = "I should walk to work every day.";
    text.dispatchEvent(new Event("input"));
    expect(app.store.doc.statements[4].text).toBe("I should walk to work.");
    vi.advanceTimersByTime(350);
    expect(app.store.doc.statements[4].text).toBe("I should walk to work every day.");
    vi.useRealTimers();
    expect(app.store.canUndo).toBe(true);
    expect($$(".sidebar .row")[4].textContent).toContain("every day");

    const id = $(".right input.mono") as HTMLInputElement;
    id.value = "walk commute";
    id.dispatchEvent(new Event("input"));
    expect($(".right .field-error").textContent).toMatch(/whitespace/);
    id.dispatchEvent(new Event("change"));
    expect(app.store.doc.statements[4].id).toBe("walk-commute");
    id.value = "commute-30";
    id.dispatchEvent(new Event("input"));
    expect($(".right .field-error").textContent).toMatch(/already used/);
    id.value = "walk";
    id.dispatchEvent(new Event("input"));
    id.dispatchEvent(new Event("change"));
    expect(app.store.doc.statements[4].id).toBe("walk");
    expect(app.store.doc.arguments.find((a) => a.id === "walk-for-health")!.conclusions).toEqual(["walk"]);
    expect(app.store.selection).toEqual({ kind: "statement", id: "walk" });
    expect(($(".right input.mono") as HTMLInputElement).value).toBe("walk");
  });

  it("parses meta on blur and refuses invalid JSON without committing", () => {
    app.actions.select({ kind: "statement", id: "walk-commute" });
    const meta = $$(".right textarea.mono")[0] as HTMLTextAreaElement;
    meta.value = "{ not json";
    meta.dispatchEvent(new Event("blur"));
    expect(app.store.doc.statements[4].meta).toBeUndefined();
    expect($$(".right .field-error").some((e) => !(e as HTMLElement).hidden && e.textContent!.includes("Not valid JSON"))).toBe(true);
    meta.value = '{"role": "conclusion"}';
    meta.dispatchEvent(new Event("blur"));
    expect(app.store.doc.statements[4].meta).toEqual({ role: "conclusion" });
    const ext = $$(".right textarea.mono")[1] as HTMLTextAreaElement;
    ext.value = '{"bayes": 1}';
    ext.dispatchEvent(new Event("blur"));
    expect(app.store.doc.statements[4].ext).toBeUndefined();
    ext.value = '{"bayes": {"prior": 0.4}}';
    ext.dispatchEvent(new Event("blur"));
    expect(app.store.doc.statements[4].ext).toEqual({ bayes: { prior: 0.4 } });
  });

  it("argument form: chips, picker, rule, and live problems", () => {
    const arg = walking.arguments[0];
    expect(arg.id).toBe("walk-for-health");
    app.actions.select({ kind: "argument", id: "walk-for-health" });
    expect($$(".right .chip").length).toBe(arg.premises.length + arg.conclusions.length);
    ($$(".right .chip .chip-remove")[0] as HTMLElement).click();
    expect(app.store.doc.arguments[0].premises).toEqual(arg.premises.slice(1));
    const picker = $$(".right .picker-input")[0] as HTMLInputElement;
    picker.focus();
    picker.value = "exercise-good";
    picker.dispatchEvent(new Event("input"));
    const items = $$(".right .picker-item");
    expect(items.length).toBe(1);
    picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(app.store.doc.arguments[0].premises).toEqual([...arg.premises.slice(1), "exercise-good"]);
    expect($$(".right .chip").length).toBe(arg.premises.length + arg.conclusions.length);
    const rule = $$(".right input.input")[1] as HTMLInputElement;
    rule.value = "";
    rule.dispatchEvent(new Event("change"));
    expect(app.store.doc.arguments[0].rule).toBeUndefined();
    // a dangling reference shows up as a problem on this argument
    app.store.updateArgument("walk-for-health", { conclusions: ["walk-commute", "ghost"] });
    expect($(".status-valid").textContent).toBe("1 problem");
    expect($(".right .problems").textContent).toContain("ghost");
    expect($$(".right .chip.invalid").length).toBe(1);
    app.store.undo();
    expect($(".status-valid").textContent).toBe("Valid");
  });

  it("adds a statement and an argument that concludes it, deletes with confirmation", async () => {
    app.actions.addStatement();
    const sid = app.store.selection!.id;
    expect(app.store.doc.statements.at(-1)!.id).toBe(sid);
    expect(app.ui.tab).toBe("statements");
    app.actions.addArgument();
    const aid = app.store.selection!.id;
    expect(app.store.doc.arguments.at(-1)!).toMatchObject({ id: aid, conclusions: [sid], premises: [] });
    const p = app.actions.deleteArgument(aid);
    expect($(".modal")).toBeTruthy();
    ($(".modal-actions .btn.primary") as HTMLElement).click();
    await p;
    expect(app.store.doc.arguments.some((a) => a.id === aid)).toBe(false);
    app.actions.select({ kind: "statement", id: sid });
    const p2 = app.actions.deleteStatement(sid);
    ($(".modal-actions .btn:not(.primary)") as HTMLElement).click(); // cancel
    await p2;
    expect(app.store.doc.statements.some((s) => s.id === sid)).toBe(true);
  });
});

describe("tabs", () => {
  it("overview shows header fields, foundations, cycles, lint, and ids", () => {
    app.actions.setTab("overview");
    const panel = $(".sidebar .tab-panel");
    expect(panel.querySelector<HTMLInputElement>("input")!.value).toBe("Walking to work");
    expect(panel.textContent).toContain("Foundations (");
    expect(panel.textContent).toContain("Cycles (1)");
    expect(panel.textContent).toContain("self-knowledge");
    expect(panel.textContent).toContain("ungrounded statement");
    expect(panel.querySelectorAll("table tbody tr").length).toBe(walking.statements.length + walking.arguments.length);
    const name = panel.querySelector<HTMLInputElement>("input")!;
    name.value = "Renamed";
    name.dispatchEvent(new Event("change"));
    expect(app.store.doc.name).toBe("Renamed");
    expect($(".toolbar-title").textContent).toBe("Renamed");
    name.value = "";
    name.dispatchEvent(new Event("change"));
    expect(app.store.doc.name).toBeUndefined();
  });

  it("arguments tab lists and selects", () => {
    app.actions.setTab("arguments");
    const rows = $$(".sidebar .row");
    expect(rows.length).toBe(walking.arguments.length);
    (rows[0] as HTMLElement).click();
    expect(app.store.selection).toEqual({ kind: "argument", id: walking.arguments[0].id });
    expect($('g.node[data-key="a:walk-for-health"]').getAttribute("data-state")).toBe("selected");
    expect($('g.node[data-key="s:walk-commute"]').getAttribute("data-state")).toBe("down");
    expect($('g.node[data-key="s:exercise-good"]').getAttribute("data-state")).toBe("up");
  });

  it("diff compares a recent document (A) with the working document (B)", () => {
    // put the fork in the recent list, then diff it against the working doc
    localStorage.setItem(
      "worldview-editor:recent:v1",
      JSON.stringify([{ key: "fork", name: "fork", sourceName: "fork.json", savedAt: new Date().toISOString(), statements: fork.statements.length, arguments: fork.arguments.length, doc: fork }]),
    );
    app.actions.setTab("diff");
    const sel = $$(".sidebar select")[0] as HTMLSelectElement;
    expect([...sel.options].some((o) => o.value === "fork")).toBe(true);
    sel.value = "fork";
    sel.dispatchEvent(new Event("change"));
    const panel = $(".sidebar .tab-panel");
    expect(panel.textContent).toContain("recent: fork");
    expect(panel.textContent).toContain("B working document");
    expect(panel.textContent).toMatch(/Statements: \d+ identical, \d+ rejustified, \d+ added, \d+ removed/);
    const links = [...panel.querySelectorAll<HTMLButtonElement>(".bucket button.link")];
    expect(links.length).toBeGreaterThan(0);
    links[0].click();
    expect(app.store.selection).not.toBeNull();
    expect(app.store.doc.statements.some((s) => s.id === app.store.selection!.id) || app.store.doc.arguments.some((a) => a.id === app.store.selection!.id)).toBe(true);
  });
});

describe("keyboard, overlays, and preferences", () => {
  it("Escape clears the selection, ? opens help, shortcuts do not fire while typing", () => {
    app.actions.select({ kind: "statement", id: "walk-commute" });
    key("Escape");
    expect(app.store.selection).toBeNull();
    key("?");
    expect($(".modal").textContent).toContain("Keyboard");
    key("Escape");
    expect(document.querySelector(".modal")).toBeNull();
    app.actions.select({ kind: "statement", id: "walk-commute" });
    const text = $(".right textarea") as HTMLTextAreaElement;
    text.focus();
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(document.querySelector(".modal")).toBeNull();
    text.blur();
    key("Delete");
    expect($(".modal").textContent).toContain("Delete statement");
    key("Escape");
    expect(app.store.doc.statements.length).toBe(walking.statements.length);
  });

  it("undo/redo via keyboard and the toolbar", () => {
    app.store.addStatement({ text: "x" });
    key("z", { ctrlKey: true });
    expect(app.store.doc.statements.length).toBe(walking.statements.length);
    key("z", { ctrlKey: true, shiftKey: true });
    expect(app.store.doc.statements.length).toBe(walking.statements.length + 1);
    key("y", { ctrlKey: true });
    expect(app.store.doc.statements.length).toBe(walking.statements.length + 1);
    ($$(".toolbar .btn").find((b) => b.textContent!.includes("Undo")) as HTMLElement).click();
    expect(app.store.doc.statements.length).toBe(walking.statements.length);
  });

  it("toggles theme, layout direction, ids, and lint and stores them as preferences", () => {
    app.actions.setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    app.actions.setTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    app.actions.toggleRankdir();
    app.actions.toggleShowIds();
    app.actions.toggleLint();
    const prefs = JSON.parse(localStorage.getItem("worldview-editor:prefs:v1")!);
    expect(prefs).toMatchObject({ theme: "system", rankdir: "TB", showIds: false, lintOverlay: true });
    const ungrounded = derive(walking).ungrounded.size; // the self-knowledge / habit-reports cycle and what rests on it
    expect(ungrounded).toBeGreaterThan(0);
    expect($$("g.node.ungrounded").length).toBe(ungrounded);
    app.actions.toggleLint();
    expect($$("g.node.ungrounded").length).toBe(0);
    expect($('g.node[data-key="s:walk-commute"] text').textContent).not.toContain("walk-commute");
  });

  it("save downloads, marks clean, and remembers the document", () => {
    app.store.addStatement({ text: "x" });
    expect(app.store.dirty).toBe(true);
    key("s", { ctrlKey: true });
    expect(app.store.dirty).toBe(false);
    expect(app.store.sourceName).toBe("walking-to-work.json");
    expect($(".toasts").textContent).toContain("Saved walking-to-work.json");
  });

  it("problems modal lists validation problems from the status bar", () => {
    app.store.updateArgument("walk-for-health", { premises: ["nope"] });
    ($(".status-valid") as HTMLElement).click();
    expect($(".modal").textContent).toContain("unknown statement");
    key("Escape");
  });
});

describe("files and large documents", () => {
  it("rejects an invalid file without replacing the working document, and opens a valid one", async () => {
    const bad = new File([JSON.stringify({ format: "worldview-core", version: "0.1", statements: [{ id: "a", text: "", mode: "is" }], arguments: [] })], "bad.json", { type: "application/json" });
    await app.actions.openFile(bad);
    expect($(".modal").textContent).toContain("bad.json is not a valid worldview");
    expect(app.store.doc.name).toBe("Walking to work");
    expect(document.querySelector(".modal-actions .btn.primary")).toBeNull(); // structural problem: no "open anyway"
    key("Escape");
    const notJson = new File(["{oops"], "x.json");
    await app.actions.openFile(notJson);
    expect($(".toasts").textContent).toContain("not valid JSON");
    const good = new File([JSON.stringify(fork)], "fork.json");
    await app.actions.openFile(good);
    expect(app.store.doc.name).toBe(fork.name);
    expect(app.store.sourceName).toBe("fork.json");
    expect(app.store.canUndo).toBe(false);
  });

  it("offers 'open anyway' for referential problems", async () => {
    const dangling = JSON.parse(JSON.stringify(walking)) as WorldviewDocument;
    dangling.arguments[0].premises.push("ghost");
    await app.actions.openFile(new File([JSON.stringify(dangling)], "dangling.json"));
    const btn = $(".modal-actions .btn.primary") as HTMLButtonElement;
    expect(btn.textContent).toBe("Open anyway");
    btn.click();
    expect(app.store.sourceName).toBe("dangling.json");
    expect($(".status-valid").textContent).toBe("1 problem");
    expect($$("g.node.statement").length).toBe(walking.statements.length); // graph derived from the sanitized copy
  });

  it("starts a large document in focus mode and can show everything", async () => {
    await app.actions.loadExample("descartes-discourse-on-method.json");
    expect(app.store.doc.statements.length).toBe(descartes.statements.length);
    expect(app.ui.focusMode).toBe("both");
    expect(app.ui.focusId).toBe(descartes.statements[0].id);
    expect($(".graph-controls").textContent).toMatch(/statements hidden/);
    expect($$("g.node.statement").length).toBeLessThan(descartes.statements.length);
    expect($(".toasts").textContent).toContain("Large document");
    app.actions.setFocus({ focusMode: "off" });
    expect($$("g.node.statement").length).toBe(descartes.statements.length);
    expect($$("g.node.argument").length).toBe(descartes.arguments.length);
    // selecting from the list works on the full graph and the inspector copes with the whole closure
    app.actions.setInspectorDepth(Infinity);
    app.actions.select({ kind: "statement", id: descartes.statements.at(-1)!.id }, { center: true });
    expect($(".inspector").textContent).toContain("Rests on");
    app.actions.setTab("overview");
    expect($$(".sidebar table tbody tr").length).toBe(descartes.statements.length + descartes.arguments.length);
  });

  it("new document from an empty state", async () => {
    app.loadDocument(emptyDocument("Blank"), null, { remember: false });
    expect($(".graph-empty").textContent).toContain("No statements yet");
    expect($$(".sidebar .row").length).toBe(0);
    expect($(".statusbar").textContent).toContain("unsaved document");
    app.actions.addStatement();
    expect($$("g.node.statement").length).toBe(1);
  });
});

describe("review regressions", () => {
  it("keeps the row elements and only moves the selection marker when selecting", () => {
    const rows = $$(".sidebar .row");
    (rows[0] as HTMLElement).click();
    expect(rows[0].classList.contains("selected")).toBe(true);
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    (rows[1] as HTMLElement).click();
    expect(rows[0].classList.contains("selected")).toBe(false);
    expect(rows[0].getAttribute("aria-selected")).toBe("false");
    expect(rows[1].classList.contains("selected")).toBe(true);
    expect($$(".sidebar .row")[1]).toBe(rows[1]); // same elements, not rebuilt
    // an edit rebuilds the rows and keeps the marker on the selected one
    app.store.updateStatement("exercise-good", { text: "changed" });
    const fresh = $$(".sidebar .row");
    expect(fresh[1]).not.toBe(rows[1]);
    expect(fresh[1].classList.contains("selected")).toBe(true);
  });

  it("renames without rendering an intermediate empty panel and coalesces typing into one undo step", () => {
    app.actions.select({ kind: "statement", id: "walk-commute" });
    const panels: string[] = [];
    app.store.subscribe(() => panels.push($(".right .panel-body").firstElementChild!.className));
    const id = $(".right input.mono") as HTMLInputElement;
    id.value = "walk";
    id.dispatchEvent(new Event("input"));
    id.dispatchEvent(new Event("change"));
    expect(panels).toEqual(["panel-form"]);
    expect(app.store.selection).toEqual({ kind: "statement", id: "walk" });
    const text = $(".right textarea") as HTMLTextAreaElement;
    text.focus();
    vi.useFakeTimers();
    for (const v of ["I", "I s", "I sh"]) {
      text.value = v;
      text.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(350);
    }
    vi.useRealTimers();
    expect(app.store.doc.statements[4].text).toBe("I sh");
    app.store.undo(); // one step for the whole burst
    expect(app.store.doc.statements[4].text).toBe("I should walk to work.");
    expect(app.store.doc.statements[4].id).toBe("walk");
    app.store.undo(); // then the rename
    expect(app.store.doc.statements[4].id).toBe("walk-commute");
  });

  it("diff can be swapped to compare in the other direction", () => {
    localStorage.setItem(
      "worldview-editor:recent:v1",
      JSON.stringify([{ key: "fork", name: "fork", sourceName: "fork.json", savedAt: new Date().toISOString(), statements: fork.statements.length, arguments: fork.arguments.length, doc: fork }]),
    );
    app.actions.setTab("diff");
    const sel = $$(".sidebar select")[0] as HTMLSelectElement;
    sel.dispatchEvent(new Event("focus"));
    sel.value = "fork";
    sel.dispatchEvent(new Event("change"));
    const panel = $(".sidebar .tab-panel");
    expect(panel.textContent).toContain("Statements: 9 identical, 2 rejustified, 1 added, 2 removed.");
    const firstPair = panel.querySelector(".bucket ul li")!;
    expect(firstPair.firstElementChild!.tagName).toBe("SPAN"); // the A side (the fork) is not clickable
    expect(firstPair.querySelector("button.link")).toBeTruthy(); // the B side (working document) is
    ($$(".sidebar .btn").find((b) => b.textContent!.includes("swap")) as HTMLElement).click();
    expect(panel.textContent).toContain("Statements: 9 identical, 2 rejustified, 2 added, 1 removed.");
    expect(panel.textContent).toContain("A working document");
    const swappedPair = panel.querySelector(".bucket ul li")!;
    expect(swappedPair.firstElementChild!.tagName).toBe("BUTTON"); // now the working document is A
  });

  it("shortcuts fire when a checkbox has focus but never while typing", () => {
    app.store.addStatement({ text: "x" });
    const cb = $(".sidebar input[type=checkbox]") as HTMLInputElement;
    cb.focus();
    cb.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(app.store.doc.statements.length).toBe(walking.statements.length);
    const search = $(".sidebar input[type=search]") as HTMLInputElement;
    search.focus();
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(app.store.doc.statements.length).toBe(walking.statements.length); // no redo while typing
  });

  it("the inspector's collapsed nodes do not leak between statements", () => {
    app.actions.select({ kind: "statement", id: "need-raincoat" });
    const details = $(".inspector details") as HTMLDetailsElement;
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    app.actions.select({ kind: "statement", id: "walk-commute" });
    app.actions.select({ kind: "statement", id: "need-raincoat" });
    expect(($(".inspector details") as HTMLDetailsElement).open).toBe(true);
  });

  it("clicking a menu button twice closes the menu", () => {
    const btn = $$(".toolbar .btn").find((b) => b.textContent!.startsWith("Recent")) as HTMLButtonElement;
    btn.click();
    expect(document.querySelector(".menu")).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.click();
    expect(document.querySelector(".menu")).toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});
