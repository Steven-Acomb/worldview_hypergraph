/**
 * Behaviour of the later additions (plan, lints, stats, present, export,
 * merge) that the conformance vectors do not pin down, plus the two
 * Python-compatibility helpers they depend on: the textwrap port and
 * Python's float rounding.  Every expected value here was produced by the
 * Python reference implementation (3.13).
 */

import { describe, expect, it } from "vitest";

import {
  isOughtGaps,
  lintAll,
  merge,
  parseWorldview,
  plan,
  present,
  pyFloatRepr,
  pyRound,
  restsOn,
  stats,
  textwrap,
  toDot,
  toMermaid,
  worldviewToDict,
} from "../src/index.js";
import type { WorldviewDocument } from "../src/index.js";

const S = (id: string, text: string, mode: "is" | "ought" = "is", extra: Record<string, unknown> = {}) => ({ id, text, mode, ...extra });
const A = (id: string, premises: string[], conclusions: string[], justification = "because", extra: Record<string, unknown> = {}) => ({
  id,
  premises,
  conclusions,
  justification,
  ...extra,
});
const D = (statements: unknown[], args: unknown[], header: Record<string, unknown> = {}): WorldviewDocument =>
  ({ format: "worldview-core", version: "0.1", ...header, statements, arguments: args }) as WorldviewDocument;

describe("textwrap port of Python's textwrap.wrap", () => {
  // [text, width, textwrap.wrap(text, width=width)] from CPython 3.13.
  const cases: Array<[string, number, string[]]> = [
    ["long-term health.", 5, ["long-", "term", "healt", "h."]],
    ["   ", 10, []],
    ["", 5, []],
    ["a\tb", 10, ["a       b"]],
    ["supercalifragilistic", 8, ["supercal", "ifragili", "stic"]],
    ["well-founded--yes", 6, ["well-f", "ounded", "--yes"]],
    ["x y z", 3, ["x y", "z"]],
    ["　a　", 4, ["　a　"]],
    ["ab--cd ef", 4, ["ab--", "cd", "ef"]],
    ["a\nb\r\nc", 3, ["a b", "c"]],
    ["\u{1f600}\u{1f600}\u{1f600}", 2, ["\u{1f600}\u{1f600}", "\u{1f600}"]],
    ["the well-founded--and long-term--plan", 9, ["the well-", "founded--", "and long-", "term--", "plan"]],
    ["a-b-c-d-e-f", 3, ["a-", "b-", "c-", "d-", "e-f"]],
    ["---- --x-- x--y", 4, ["----", "--x-", "- x", "--y"]],
    ["12-34 ab-12 é-ü", 5, ["12-34", "ab-12", "é-ü"]],
    ["\tx\ty", 9, ["        x", "y"]],
    ["  lead and trail  ", 6, ["  lead", "and", "trail"]],
    ["Il pleut souvent  ici", 8, ["Il pleut", "souvent", "ici"]],
  ];

  it.each(cases)("wrap(%j, %i)", (text, width, want) => {
    expect(textwrap(text, width)).toStrictEqual(want);
  });

  it("rejects a non-positive width like Python's ValueError", () => {
    expect(() => textwrap("x", 0)).toThrow(RangeError);
    expect(() => textwrap("x", -3)).toThrow(RangeError);
  });
});

describe("pyRound reproduces Python's round(x, n)", () => {
  it("rounds exact binary ties to even, unlike Math.round", () => {
    expect(pyRound(0.0625, 3)).toBe(0.062);
    expect(pyRound(0.1875, 3)).toBe(0.188);
    expect(pyRound(5 / 16, 3)).toBe(0.312);
    expect(pyRound(0.4375, 3)).toBe(0.438);
    expect(pyRound(-0.0625, 3)).toBe(-0.062);
    expect(pyRound(0.5, 0)).toBe(0);
    expect(pyRound(1.5, 0)).toBe(2);
    expect(pyRound(2.5, 0)).toBe(2);
    expect(Math.round(0.0625 * 1000) / 1000).not.toBe(0.062); // the naive way is wrong here
  });

  it("uses the exact binary value, so 2.675 rounds down", () => {
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(1 / 3, 3)).toBe(0.333);
    expect(pyRound(2 / 3, 3)).toBe(0.667);
    expect(pyRound(1234.56785, 4)).toBe(1234.5678);
    expect(pyRound(1e-7, 3)).toBe(0);
    expect(pyRound(0, 3)).toBe(0);
    expect(pyRound(2, 3)).toBe(2);
  });

  it("pyFloatRepr prints integral floats with a decimal point", () => {
    expect(pyFloatRepr(2)).toBe("2.0");
    expect(pyFloatRepr(0)).toBe("0.0");
    expect(pyFloatRepr(1.667)).toBe("1.667");
    expect(pyFloatRepr(0.062)).toBe("0.062");
  });

  it("stats.mean is a Python-rounded value", () => {
    // 16 arguments with one premise in total: mean 1/16 = 0.0625 -> 0.062 (ties to even).
    const args = [A("a0", ["a"], ["b"]), ...Array.from({ length: 15 }, (_, i) => A(`z${i}`, [], ["b"]))];
    const wv = parseWorldview(D([S("a", "A"), S("b", "B")], args));
    expect(stats(wv).premises).toStrictEqual({ min: 0, max: 1, mean: 0.062 });
    expect(stats(wv).conclusions).toStrictEqual({ min: 1, max: 1, mean: 1 });
    expect(stats(wv).zero_premise_arguments).toBe(15);
  });
});

describe("plan", () => {
  const wv = parseWorldview(
    D(
      [S("root", "Root"), S("a", "A"), S("b", "B"), S("c", "C"), S("x", "X"), S("lonely", "Lonely")],
      [A("r-a", ["root"], ["a"]), A("a-b", ["a"], ["b"]), A("b-a", ["b"], ["a"]), A("b-c", ["b"], ["c"]), A("x-c", ["x"], ["c"])],
    ),
  );

  it("with nothing given equals rests-on plus the grant/establish split", () => {
    const p = plan(wv, "c");
    const r = restsOn(wv, "c");
    expect(p.tree).toStrictEqual(r.tree);
    expect(p.arguments).toStrictEqual(r.closure.arguments);
    expect(p.sccs).toStrictEqual([["a", "b"]]);
    expect(p.given).toStrictEqual([]);
    expect(p.must_grant).toStrictEqual([
      { id: "root", text: "Root" },
      { id: "x", text: "X" },
    ]);
    expect(p.must_establish.map((e) => e.id)).toStrictEqual(["a", "b", "c"]);
    expect(p.must_establish[2]).toStrictEqual({ id: "c", text: "C", via: ["b-c", "x-c"] });
  });

  it("prunes at given statements, which are leaves and never expanded or marked seen", () => {
    const p = plan(wv, "c", ["b", "lonely"]);
    expect(p.given).toStrictEqual(["b"]); // lonely is outside the closure and not reported
    expect(p.must_grant).toStrictEqual([{ id: "x", text: "X" }]);
    expect(p.must_establish).toStrictEqual([{ id: "c", text: "C", via: ["b-c", "x-c"] }]);
    expect(p.arguments).toStrictEqual(["b-c", "x-c"]);
    expect(p.sccs).toStrictEqual([["a", "b"]]); // b is reached, so its cycle is involved
    const first = p.tree.arguments?.[0];
    expect(first?.argument).toBe("b-c");
    const leaf = (first as { premises: unknown[] }).premises[0];
    expect(leaf).toStrictEqual({ statement: "b", text: "B", scc: ["a", "b"], given: true });
    expect(JSON.parse(JSON.stringify(p))).toStrictEqual(p);
  });

  it("a given target has nothing to do", () => {
    expect(plan(wv, "a", ["a", "root"])).toStrictEqual({
      statement: "a",
      text: "A",
      given: ["a"],
      must_establish: [],
      must_grant: [],
      arguments: [],
      sccs: [],
      tree: { statement: "a", text: "A", given: true },
    });
  });

  it("a foundation target must be granted unless given", () => {
    expect(plan(wv, "root").must_grant).toStrictEqual([{ id: "root", text: "Root" }]);
    expect(plan(wv, "root").must_establish).toStrictEqual([]);
  });

  it("rejects unknown target and given ids", () => {
    expect(() => plan(wv, "nope")).toThrow(/no statement/);
    expect(() => plan(wv, "c", ["nope"])).toThrow(/no statement/);
  });
});

describe("is-ought lint", () => {
  // Mirrors tests/test_is_ought.py in the Python reference.
  it("flags ought conclusions with no ought premise, zero-premise arguments included", () => {
    const wv = parseWorldview(
      D(
        [S("fact", "F"), S("norm", "N", "ought"), S("bridge", "B", "ought"), S("norm2", "N2", "ought"), S("fact2", "F2")],
        [
          A("gap", ["fact"], ["norm"], "from fact alone"),
          A("bridged", ["fact", "bridge"], ["norm2"], "with a bridge principle"),
          A("is-only", ["fact"], ["fact2"], "is to is is fine"),
          A("stipulated", [], ["norm"], "an ought with no premises at all"),
        ],
      ),
    );
    const out = isOughtGaps(wv);
    expect(out).toStrictEqual([
      { argument: "gap", ought_conclusions: ["norm"], premises: ["fact"] },
      { argument: "stipulated", ought_conclusions: ["norm"], premises: [] },
    ]);
    expect(lintAll(wv).is_ought_gaps).toStrictEqual(out);
    expect(Object.keys(lintAll(wv))).toStrictEqual(["well_founded", "duplicates", "unused", "empty_justifications", "is_ought_gaps"]);
  });

  it("lists only the ought conclusions of a mixed argument", () => {
    const wv = parseWorldview(D([S("f", "F"), S("o", "O", "ought"), S("g", "G")], [A("x", ["f"], ["g", "o"], "j")]));
    expect(isOughtGaps(wv)).toStrictEqual([{ argument: "x", ought_conclusions: ["o"], premises: ["f"] }]);
  });
});

describe("present", () => {
  const wv = parseWorldview(D([S("a", "  A  "), S("b", "B", "ought")], [A("a-b", ["a"], ["b"], "  because \n so  ", { rule: "mp" })]));

  it("renders canonical text, tags, the case, and the foundations", () => {
    expect(present(wv, "b")).toBe(
      ["# B", "", "`b` · ought", "", "## The case", "", "- **B** (`b`, ought)", "  - via `a-b` [mp]: because so", "    - **A** (`a`, is) — *foundation*", "", "## Foundations reached", "", "- `a`: A", ""].join("\n"),
    );
  });

  it("an empty given list behaves like no given list, as Python's falsy tuple does", () => {
    expect(present(wv, "b", { given: [] })).toBe(present(wv, "b"));
    expect(present(wv, "b", { given: ["a"] })).toContain("Taken as given: `a`.");
    expect(present(wv, "b", { given: ["a"] })).toContain("Nothing: every foundation reached is already given.");
    expect(present(wv, "b", { given: ["a"], depth: 0 })).toBe(present(wv, "b", { given: ["a"] })); // depth ignored with given
  });

  it("depth 0 marks the target as not expanded further", () => {
    expect(present(wv, "b", { depth: 0 })).toContain("- **B** (`b`, ought) — *not expanded further*");
  });
});

describe("export", () => {
  const wv = parseWorldview(
    D([S("a", 'say "hi" \\ now'), S("b", "B", "ought")], [A("x", ["a"], ["b"], "j"), A("y", [], ["a"], "k", { rule: 'r"' })], { name: 'n"1' }),
  );

  it("escapes quotes and backslashes for DOT and uses positional node names", () => {
    const dot = toDot(wv);
    expect(dot).toContain('label="n\\"1"; labelloc=t;');
    expect(dot).toContain('s0 [shape=box, style=rounded, label="a\\nsay \\"hi\\" \\\\ now"];');
    expect(dot).toContain('s1 [shape=box, style=rounded, label="b\\nB", peripheries=2];');
    expect(dot).toContain('a1 [shape=diamond, fontsize=8, label="y\\nr\\""];');
    expect(dot.endsWith("}\n")).toBe(true);
  });

  it("escapes quotes for Mermaid and labels an empty diamond with a space", () => {
    const m = toMermaid(wv, { ids: false, direction: "TB" });
    expect(m.startsWith("flowchart TB\n")).toBe(true);
    expect(m).toContain('s0["say #quot;hi#quot; \\ now"]');
    expect(m).toContain('a0{{" "}}');
    expect(m).toContain('a1{{"r#quot;"}}');
    expect(m).toContain("class s1 ought;");
  });

  it("wraps with the Python algorithm and a whitespace-only text becomes one empty line", () => {
    const ws = parseWorldview(D([S("w", "   ")], []));
    expect(toDot(ws, { ids: false })).toContain('label=""');
    expect(toMermaid(ws, { ids: false })).toContain('s0[""]');
    expect(() => toDot(ws, { wrap: 0 })).toThrow(RangeError);
    expect(() => toMermaid(ws, { wrap: -1 })).toThrow(RangeError);
    expect(toDot(parseWorldview(D([], [])), { wrap: 0 })).toContain("digraph"); // nothing to wrap, so Python does not raise either
  });
});

describe("merge", () => {
  const base = D([S("a", "A"), S("b", "B"), S("c", "C")], [A("a-b", ["a"], ["b"]), A("b-c", ["b"], ["c"])], { name: "n" });

  it("compares meta and ext with Python's equality: key order is irrelevant, true == 1, {} differs from absent", () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.statements[0] = S("a", "A", "is", { meta: { x: true, y: [1, { p: 1 }] } }) as never;
    theirs.statements[0] = S("a", "A", "is", { meta: { y: [1.0, { p: true }], x: 1 } }) as never;
    const r = merge(parseWorldview(base), parseWorldview(ours), parseWorldview(theirs));
    expect(r.conflicts).toStrictEqual([]); // both sides made the "same" change
    expect(r.summary.statements).toStrictEqual({ kept: 2, added_ours: 0, added_theirs: 0, added_both: 0, removed: 0, changed: 1 });
    theirs.statements[0] = S("a", "A", "is", { meta: {} }) as never;
    const r2 = merge(parseWorldview(base), parseWorldview(ours), parseWorldview(theirs));
    expect(r2.conflicts.map((c) => c.kind)).toStrictEqual(["statement"]);
    expect(r2.conflicts[0]?.resolution).toBe("kept ours");
    theirs.statements[0] = S("a", "A", "is", { meta: { x: true, y: [{ p: 1 }, 1] } }) as never; // list order matters
    expect(merge(parseWorldview(base), parseWorldview(ours), parseWorldview(theirs)).conflicts.length).toBe(1);
  });

  it("orders conflicts statement, argument, dangling, header and keeps theirs when ours deleted", () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.statements = ours.statements.filter((s) => s.id !== "c"); // ours deletes c
    ours.arguments = ours.arguments.filter((a) => a.id !== "b-c");
    theirs.statements[2] = S("c", "C (edited)") as never; // theirs edits c: conflict, theirs kept
    theirs.arguments[1] = A("b-c", ["b"], ["c"], "edited") as never; // and its argument
    ours.name = "ours";
    theirs.name = "theirs";
    ours.arguments[0] = A("a-b", ["a"], ["b"], "x") as never;
    theirs.arguments[0] = A("a-b", ["a"], ["b"], "y") as never;
    const r = merge(parseWorldview(base), parseWorldview(ours), parseWorldview(theirs));
    expect(r.conflicts.map((c) => [c.kind, c.id, c.resolution])).toStrictEqual([
      ["statement", "c", "kept theirs"],
      ["argument", "a-b", "kept ours"],
      ["argument", "b-c", "kept theirs"],
      ["header", "name", "kept ours"],
    ]);
    expect(r.merged.name).toBe("ours");
    expect(r.merged.statements.map((s) => s.text)).toStrictEqual(["A", "B", "C (edited)"]);
    expect(r.summary.statements.changed).toBe(1);
    expect(r.summary.arguments.changed).toBe(2);
  });

  it("drops arguments left dangling by the other side's deletion", () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.statements = ours.statements.filter((s) => s.id !== "c");
    ours.arguments = ours.arguments.filter((a) => a.id !== "b-c");
    theirs.statements.push(S("d", "D") as never);
    theirs.arguments.push(A("c-d", ["c"], ["d", "c"], "self and on") as never);
    const r = merge(parseWorldview(base), parseWorldview(ours), parseWorldview(theirs));
    expect(r.conflicts).toStrictEqual([
      { kind: "dangling", id: "c-d", missing: ["c", "c"], argument: A("c-d", ["c"], ["d", "c"], "self and on"), resolution: "dropped argument" },
    ]);
    expect(r.merged.arguments.map((a) => a.id)).toStrictEqual(["a-b"]);
    expect(r.summary.statements).toStrictEqual({ kept: 2, added_ours: 0, added_theirs: 1, added_both: 0, removed: 1, changed: 0 });
  });

  it("emits the merged document with the keys in the Python order", () => {
    const wv = parseWorldview(D([S("a", "A")], [], { name: "n", description: "d", meta: { m: 1 }, ext: { e: {} } }));
    expect(Object.keys(worldviewToDict(wv))).toStrictEqual(["format", "version", "name", "description", "meta", "ext", "statements", "arguments"]);
    const r = merge(wv, wv, wv);
    expect(Object.keys(r.merged)).toStrictEqual(["format", "version", "name", "description", "meta", "ext", "statements", "arguments"]);
    expect(r.merged).toStrictEqual(worldviewToDict(wv));
    expect(Object.keys(r.summary.statements)).toStrictEqual(["kept", "added_ours", "added_theirs", "added_both", "removed", "changed"]);
  });
});
