import { describe, expect, it } from "vitest";
import { parseWorldviewJson, validateDict } from "worldview-core";
import { Store, emptyDocument, serializeDocument } from "../src/store";
import { derive } from "../src/derived";
import { buildModel, focusSet, layoutModel } from "../src/graph/layout";

function chain() {
  return {
    format: "worldview-core" as const,
    version: "0.1",
    name: "chain",
    statements: [
      { id: "a", text: "A", mode: "is" as const },
      { id: "b", text: "B", mode: "is" as const },
      { id: "c", text: "C", mode: "ought" as const },
    ],
    arguments: [{ id: "ab-c", premises: ["a", "b"], conclusions: ["c"], justification: "a and b give c" }],
  };
}

describe("store edits and history", () => {
  it("adds, updates, deletes statements with undo/redo", () => {
    const st = new Store(chain());
    const id = st.addStatement({ text: "D" });
    expect(id).toBe("s-4");
    expect(st.doc.statements.map((s) => s.id)).toEqual(["a", "b", "c", "s-4"]);
    st.updateStatement("s-4", { text: "D!", mode: "ought", meta: { role: "axiom" } });
    expect(st.doc.statements[3]).toEqual({ id: "s-4", text: "D!", mode: "ought", meta: { role: "axiom" } });
    st.updateStatement("s-4", { meta: undefined });
    expect(st.doc.statements[3].meta).toBeUndefined();
    expect(st.canUndo).toBe(true);
    st.undo();
    expect(st.doc.statements[3].meta).toEqual({ role: "axiom" });
    st.undo();
    st.undo();
    expect(st.doc.statements.length).toBe(3);
    expect(st.canUndo).toBe(false);
    st.redo();
    expect(st.doc.statements.length).toBe(4);
    expect(st.canRedo).toBe(true);
    st.addStatement({ text: "E" }); // clears redo
    expect(st.canRedo).toBe(false);
  });

  it("renames a statement and updates every reference", () => {
    const st = new Store(chain());
    st.select({ kind: "statement", id: "a" });
    st.renameStatement("a", "alpha");
    expect(st.doc.statements[0].id).toBe("alpha");
    expect(st.doc.arguments[0].premises).toEqual(["alpha", "b"]);
    expect(st.selection).toEqual({ kind: "statement", id: "alpha" });
    st.undo();
    expect(st.doc.arguments[0].premises).toEqual(["a", "b"]);
  });

  it("deleting a statement removes references and empty arguments", () => {
    const st = new Store(chain());
    st.deleteStatement("a");
    expect(st.doc.arguments[0].premises).toEqual(["b"]);
    st.deleteStatement("c");
    expect(st.doc.arguments).toEqual([]);
    expect(validateDict(st.doc)).toEqual([]);
  });

  it("argument edits", () => {
    const st = new Store(chain());
    const id = st.addArgument({ premises: ["a"], conclusions: ["b"], justification: "j", rule: "mp" });
    expect(id).toBe("a-2");
    st.updateArgument("a-2", { rule: "", justification: "k", id: "arg" });
    expect(st.doc.arguments[1]).toEqual({ id: "arg", premises: ["a"], conclusions: ["b"], justification: "k" });
    st.moveArgument("arg", -1);
    expect(st.doc.arguments.map((a) => a.id)).toEqual(["arg", "ab-c"]);
    st.deleteArgument("arg");
    expect(st.doc.arguments.length).toBe(1);
  });

  it("header edits and serialization order", () => {
    const st = new Store(chain());
    st.setHeader({ description: "d", meta: { author: "me" } });
    st.setHeader({ name: undefined });
    const text = serializeDocument(st.doc);
    expect(text.startsWith('{\n  "format": "worldview-core",\n  "version": "0.1",\n  "description": "d",\n  "meta"')).toBe(true);
    const wv = parseWorldviewJson(text);
    expect(wv.name).toBeUndefined();
    expect(wv.statements.length).toBe(3);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("replace clears history and selection", () => {
    const st = new Store(chain());
    st.addStatement({ text: "x" });
    st.select({ kind: "statement", id: "a" });
    st.replace(emptyDocument("fresh"), "fresh.json");
    expect(st.canUndo).toBe(false);
    expect(st.selection).toBeNull();
    expect(st.doc.name).toBe("fresh");
    expect(st.dirty).toBe(false);
  });

  it("notifies subscribers once per change and tracks version", () => {
    const st = new Store(chain());
    let n = 0;
    st.subscribe(() => n++);
    const v = st.version;
    st.addStatement();
    st.select({ kind: "statement", id: "a" });
    st.select({ kind: "statement", id: "a" }); // no-op
    expect(n).toBe(2);
    expect(st.version).toBe(v + 1);
  });
});

describe("derived data", () => {
  it("computes graph facts from a valid doc", () => {
    const d = derive(chain());
    expect(d.problems).toEqual([]);
    expect(d.sanitized).toBe(false);
    expect([...d.foundationSet]).toEqual(["a", "b"]);
    expect(d.ids?.propId.get("c")).toHaveLength(64);
    expect(d.ungrounded.size).toBe(0);
  });

  it("falls back to a sanitized copy when the doc is invalid mid-edit", () => {
    const doc = chain();
    doc.arguments[0].premises.push("nope");
    doc.statements.push({ id: "empty", text: "", mode: "is" });
    const d = derive(doc);
    expect(d.problems.length).toBeGreaterThan(0);
    expect(d.sanitized).toBe(true);
    expect(d.graph).not.toBeNull();
    expect(d.graph!.argument("ab-c").premises).toEqual(["a", "b"]);
    expect(d.statementById.has("empty")).toBe(false);
  });

  it("reports cycles", () => {
    const doc = chain();
    doc.arguments.push({ id: "c-a", premises: ["c"], conclusions: ["a"], justification: "loop" });
    const d = derive(doc);
    expect(d.cyclic.get("a")).toEqual(["a", "c"]);
    expect(d.foundationSet.has("a")).toBe(false);
  });
});

describe("graph model and layout", () => {
  it("builds one node per statement and argument and the right edges", () => {
    const m = buildModel(chain());
    expect(m.nodes.map((n) => n.key)).toEqual(["s:a", "s:b", "s:c", "a:ab-c"]);
    expect(m.edges).toEqual([
      { from: "s:a", to: "a:ab-c" },
      { from: "s:b", to: "a:ab-c" },
      { from: "a:ab-c", to: "s:c" },
    ]);
    expect(m.nodes[0].lines).toEqual(["a", "A"]);
    expect(buildModel(chain(), { showIds: false }).nodes[0].lines).toEqual(["A"]);
  });

  it("focus mode limits to the closure within depth", () => {
    const doc = chain();
    doc.statements.push({ id: "d", text: "D", mode: "is" });
    doc.arguments.push({ id: "c-d", premises: ["c"], conclusions: ["d"], justification: "j" });
    const d = derive(doc);
    expect([...focusSet(d.graph!, { id: "d", mode: "up", depth: 1 })].sort()).toEqual(["c", "d"]);
    expect([...focusSet(d.graph!, { id: "d", mode: "up", depth: Infinity })].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...focusSet(d.graph!, { id: "a", mode: "down", depth: 1 })].sort()).toEqual(["a", "c"]);
    const m = buildModel(doc, { focus: { id: "d", mode: "up", depth: 1 }, graph: d.graph });
    expect(m.nodes.map((n) => n.key)).toEqual(["s:c", "s:d", "a:c-d"]);
    expect(m.hiddenStatements).toBe(2);
  });

  it("lays out with dagre and returns positions for every node and edge", () => {
    const m = buildModel(chain());
    const l = layoutModel(m, "LR");
    expect(l.nodes.length).toBe(4);
    expect(l.width).toBeGreaterThan(0);
    for (const n of l.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    for (const e of l.edges) expect(e.points.length).toBeGreaterThan(1);
    // statements a and b precede the argument which precedes c in LR
    const x = Object.fromEntries(l.nodes.map((n) => [n.key, n.x]));
    expect(x["s:a"]).toBeLessThan(x["a:ab-c"]);
    expect(x["a:ab-c"]).toBeLessThan(x["s:c"]);
  });

  it("copes with cycles", () => {
    const doc = chain();
    doc.arguments.push({ id: "c-a", premises: ["c"], conclusions: ["a"], justification: "loop" });
    const l = layoutModel(buildModel(doc), "TB");
    expect(l.nodes.length).toBe(5);
  });
});
