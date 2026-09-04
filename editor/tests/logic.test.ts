import { describe, expect, it, vi } from "vitest";
import type { Statement } from "worldview-core";
import { derive } from "../src/derived";
import {
  DEFAULT_STATEMENT_FILTERS,
  debounce,
  filterArguments,
  filterStatements,
  formatJsonField,
  idProblem,
  matches,
  parseJsonField,
  problemsForArgument,
  problemsForStatement,
  searchStatements,
  shortHash,
  suggestFileName,
} from "../src/logic";

const statements: Statement[] = [
  { id: "exercise-good", text: "Regular physical activity improves long-term health.", mode: "is" },
  { id: "health-matters", text: "I should act to protect my long-term health.", mode: "ought" },
  { id: "walk-commute", text: "I should walk to work.", mode: "ought" },
  { id: "loop-a", text: "A because B", mode: "is" },
  { id: "loop-b", text: "B because A", mode: "is" },
];

function doc() {
  return {
    format: "worldview-core" as const,
    version: "0.1",
    name: "Filter test",
    statements: statements.map((s) => ({ ...s })),
    arguments: [
      { id: "walk-for-health", premises: ["exercise-good", "health-matters"], conclusions: ["walk-commute"], justification: "practical", rule: "practical syllogism" },
      { id: "a-b", premises: ["loop-a"], conclusions: ["loop-b"], justification: "x" },
      { id: "b-a", premises: ["loop-b"], conclusions: ["loop-a"], justification: "y" },
    ],
  };
}

describe("search and filters", () => {
  it("matches case-insensitively on any field and treats an empty query as a match", () => {
    expect(matches("", "anything")).toBe(true);
    expect(matches("  ", "anything")).toBe(true);
    expect(matches("HEALTH", "health-matters", undefined)).toBe(true);
    expect(matches("nope", "health-matters", "text")).toBe(false);
  });

  it("filters statements by query, mode, and computed facts", () => {
    const d = derive(doc());
    const all = filterStatements(statements, DEFAULT_STATEMENT_FILTERS, d);
    expect(all.length).toBe(5);
    expect(filterStatements(statements, { ...DEFAULT_STATEMENT_FILTERS, query: "health" }, d).map((s) => s.id)).toEqual(["exercise-good", "health-matters"]);
    expect(filterStatements(statements, { ...DEFAULT_STATEMENT_FILTERS, mode: "ought" }, d).map((s) => s.id)).toEqual(["health-matters", "walk-commute"]);
    expect(filterStatements(statements, { ...DEFAULT_STATEMENT_FILTERS, foundationsOnly: true }, d).map((s) => s.id)).toEqual(["exercise-good", "health-matters"]);
    expect(filterStatements(statements, { ...DEFAULT_STATEMENT_FILTERS, cyclicOnly: true }, d).map((s) => s.id)).toEqual(["loop-a", "loop-b"]);
    expect(filterStatements(statements, { ...DEFAULT_STATEMENT_FILTERS, ungroundedOnly: true }, d).map((s) => s.id)).toEqual(["loop-a", "loop-b"]);
    expect(filterStatements(statements, { ...DEFAULT_STATEMENT_FILTERS, cyclicOnly: true, mode: "ought" }, d)).toEqual([]);
  });

  it("filters arguments on id, rule, justification, and referenced ids", () => {
    const args = doc().arguments;
    expect(filterArguments(args, "").length).toBe(3);
    expect(filterArguments(args, "syllogism").map((a) => a.id)).toEqual(["walk-for-health"]);
    expect(filterArguments(args, "loop-b").map((a) => a.id)).toEqual(["a-b", "b-a"]);
    expect(filterArguments(args, "practical").map((a) => a.id)).toEqual(["walk-for-health"]);
    expect(filterArguments(args, "zzz")).toEqual([]);
  });

  it("ranks picker results: exact id, id prefix, id substring, then text", () => {
    expect(searchStatements(statements, "loop-a").map((s) => s.id)[0]).toBe("loop-a");
    expect(searchStatements(statements, "loop").map((s) => s.id)).toEqual(["loop-a", "loop-b"]);
    expect(searchStatements(statements, "commute").map((s) => s.id)).toEqual(["walk-commute"]);
    // "health" is a substring of the id health-matters (rank 2) and of the text of exercise-good (rank 3)
    expect(searchStatements(statements, "health").map((s) => s.id)).toEqual(["health-matters", "exercise-good"]);
    expect(searchStatements(statements, "", ["loop-a", "loop-b"]).map((s) => s.id)).toEqual(["exercise-good", "health-matters", "walk-commute"]);
    expect(searchStatements(statements, "", [], 2).length).toBe(2);
    expect(searchStatements(statements, "nothing-here")).toEqual([]);
  });
});

describe("json fields", () => {
  it("parses blank as undefined and objects as objects", () => {
    expect(parseJsonField("")).toEqual({ ok: true, value: undefined });
    expect(parseJsonField("  \n ")).toEqual({ ok: true, value: undefined });
    expect(parseJsonField('{"role": "axiom"}')).toEqual({ ok: true, value: { role: "axiom" } });
  });

  it("rejects invalid JSON, non-objects, and non-object ext namespaces", () => {
    expect(parseJsonField("{oops").ok).toBe(false);
    expect(parseJsonField("[1,2]").ok).toBe(false);
    expect(parseJsonField("42").ok).toBe(false);
    expect(parseJsonField("null").ok).toBe(false);
    expect(parseJsonField('{"bayes": 1}', "ext").ok).toBe(false);
    expect(parseJsonField('{"bayes": [1]}', "ext").ok).toBe(false);
    expect(parseJsonField('{"bayes": {"prior": 0.5}}', "ext")).toEqual({ ok: true, value: { bayes: { prior: 0.5 } } });
    expect(parseJsonField('{"anything": 1}', "meta").ok).toBe(true);
  });

  it("formats values back for the textarea", () => {
    expect(formatJsonField(undefined)).toBe("");
    expect(formatJsonField({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("ids and names", () => {
  it("reports why an id cannot be used", () => {
    const taken = ["a", "b"];
    expect(idProblem("", "a", taken)).toMatch(/empty/);
    expect(idProblem("has space", "a", taken)).toMatch(/whitespace/);
    expect(idProblem("has nbsp", "a", taken)).toMatch(/whitespace/);
    expect(idProblem("b", "a", taken)).toMatch(/already used/);
    expect(idProblem("a", "a", taken)).toBeNull(); // unchanged
    expect(idProblem("c", "a", taken)).toBeNull();
    expect(idProblem("c", null, taken)).toBeNull();
  });

  it("suggests file names", () => {
    expect(suggestFileName(doc(), "walking.json")).toBe("walking.json");
    expect(suggestFileName(doc(), "example: something")).toBe("filter-test.json");
    expect(suggestFileName(doc(), null)).toBe("filter-test.json");
    expect(suggestFileName({ ...doc(), name: undefined }, null)).toBe("worldview.json");
    expect(suggestFileName({ ...doc(), name: "  !!  " }, null)).toBe("worldview.json");
  });

  it("shortens hashes", () => {
    expect(shortHash("abcdef0123456789")).toBe("abcdef01");
    expect(shortHash("abc")).toBe("abc");
  });
});

describe("problem routing", () => {
  it("picks the problems that concern one statement or argument", () => {
    const d = doc();
    d.arguments[0].premises.push("nope");
    d.statements[1].text = "";
    const problems = derive(d).problems;
    expect(problems.length).toBe(1); // structural problems stop the referential pass
    expect(problemsForStatement(problems, d, "health-matters")).toEqual([problems[0]]);
    expect(problemsForStatement(problems, d, "walk-commute")).toEqual([]);
    // the referential check only runs once the structure is sound
    d.statements[1].text = "back";
    const p2 = derive(d).problems;
    expect(problemsForArgument(p2, d, "walk-for-health")).toEqual([p2[0]]);
    expect(problemsForArgument(p2, d, "a-b")).toEqual([]);
    expect(problemsForArgument(p2, d, "missing")).toEqual([]);
  });
});

describe("debounce", () => {
  it("collapses calls and can flush", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d.call(1);
    d.call(2);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(2);
    d.call(3);
    d.flush();
    expect(fn).toHaveBeenLastCalledWith(3);
    expect(d.pending()).toBe(false);
    d.flush(); // nothing pending: no extra call
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
