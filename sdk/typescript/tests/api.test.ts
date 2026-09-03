/**
 * Behaviour the conformance vectors do not pin down: error types, the
 * model round trip, meta/ext passthrough, the schema constant, and the
 * browser-safety of the library modules.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORMAT,
  FORMAT_VERSION,
  Graph,
  H,
  LoadError,
  UnknownIdError,
  VERSION,
  ValidationError,
  WorldviewError,
  canon,
  computeIdentities,
  diff,
  getArgument,
  getStatement,
  parseWorldview,
  parseWorldviewJson,
  propId,
  restsOn,
  schema,
  supports,
  validateDict,
  worldviewFromDict,
  worldviewToDict,
} from "../src/index.js";
import type { WorldviewDocument } from "../src/index.js";
import { EXAMPLES, PYTHON_SCHEMA, SDK_ROOT, readJson, readText } from "./paths.js";

function chain(): WorldviewDocument {
  return {
    format: "worldview-core",
    version: "0.1",
    statements: [
      { id: "a", text: "A", mode: "is" },
      { id: "b", text: "B", mode: "is" },
      { id: "c", text: "C", mode: "ought" },
    ],
    arguments: [{ id: "ab-c", premises: ["a", "b"], conclusions: ["c"], justification: "a and b give c" }],
  };
}

describe("errors", () => {
  it("parseWorldview throws ValidationError carrying every problem", () => {
    const bad = { ...chain(), format: "other", credence: 0.5 } as unknown;
    const problems = validateDict(bad);
    expect(problems.length).toBe(2);
    let thrown: unknown;
    try {
      parseWorldview(bad);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown).toBeInstanceOf(WorldviewError);
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as ValidationError;
    expect(err.name).toBe("ValidationError");
    expect(err.problems).toStrictEqual(problems);
    expect(err.message).toContain("2 validation problems");
  });

  it("a single problem becomes the message", () => {
    const err = new ValidationError(["document: must be a JSON object"]);
    expect(err.message).toBe("document: must be a JSON object");
  });

  it("parseWorldviewJson throws LoadError on bad JSON", () => {
    expect(() => parseWorldviewJson("{not json")).toThrow(LoadError);
    expect(() => parseWorldviewJson("[]")).toThrow(ValidationError);
  });

  it("queries throw UnknownIdError for unknown statements", () => {
    const wv = parseWorldview(chain());
    let thrown: unknown;
    try {
      restsOn(wv, "nope");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnknownIdError);
    const err = thrown as UnknownIdError;
    expect(err.kind).toBe("statement");
    expect(err.id).toBe("nope");
    expect(err.name).toBe("UnknownIdError");
    expect(() => supports(wv, "nope")).toThrow(UnknownIdError);
    expect(() => getStatement(wv, "nope")).toThrow(UnknownIdError);
    expect(() => getArgument(wv, "nope")).toThrow(UnknownIdError);
  });
});

describe("validation rules", () => {
  it("accepts the minimal document and the constants match the format", () => {
    expect(FORMAT).toBe("worldview-core");
    expect(FORMAT_VERSION).toBe("0.1");
    expect(validateDict({ format: FORMAT, version: FORMAT_VERSION, statements: [], arguments: [] })).toStrictEqual([]);
  });

  it("uses the explicit whitespace set for ids (same as canon)", () => {
    const withId = (id: string): unknown => ({ ...chain(), statements: [{ id, text: "x", mode: "is" }], arguments: [] });
    expect(validateDict(withId("a\u00a0b")).length).toBeGreaterThan(0); // NBSP is whitespace
    expect(validateDict(withId("a\u0085b")).length).toBeGreaterThan(0); // NEL is whitespace
    expect(validateDict(withId("a\u200bb"))).toStrictEqual([]); // zero-width space is not
    expect(validateDict(withId("\ufeffx"))).toStrictEqual([]); // BOM is not
    expect(validateDict(withId("abc\n")).length).toBeGreaterThan(0); // trailing newline is whitespace
  });

  it("checks ext namespaces but never looks inside them", () => {
    const ok = { ...chain(), ext: { bayes: { anything: [1, { deep: true }] } } };
    expect(validateDict(ok)).toStrictEqual([]);
    const bad = { ...chain(), ext: { bayes: 1 } };
    expect(validateDict(bad).length).toBe(1);
  });

  it("never rejects cycles", () => {
    const cyc: WorldviewDocument = {
      format: "worldview-core",
      version: "0.1",
      statements: [{ id: "a", text: "A", mode: "is" }],
      arguments: [{ id: "loop", premises: ["a"], conclusions: ["a"], justification: "a supports itself" }],
    };
    expect(validateDict(cyc)).toStrictEqual([]);
  });
});

describe("model round trip", () => {
  it("carries meta and ext through untouched, including numbers, booleans, null, and nesting", () => {
    const doc: WorldviewDocument = {
      format: "worldview-core",
      version: "0.1",
      name: "n",
      description: "d",
      meta: { author: "x", n: 1.5, flag: true, none: null, list: [1, "two", { three: 3 }] },
      ext: { bayes: { prior: 0.25, nested: { deeper: [false] } } },
      statements: [
        { id: "a", text: "A", mode: "is", meta: { role: "axiom", weight: 2 }, ext: { bayes: { prior: 0.3 } } },
        { id: "b", text: "B", mode: "ought" },
      ],
      arguments: [
        {
          id: "a-b",
          premises: ["a"],
          conclusions: ["b"],
          justification: "j",
          rule: "modus ponens",
          meta: { n: 1 },
          ext: { defeasible: { kind: "inductive" } },
        },
      ],
    };
    const wv = parseWorldview(doc, "doc.json");
    expect(wv.source).toBe("doc.json");
    expect(worldviewToDict(wv)).toStrictEqual(doc);
    // same object identity: the model does not copy or normalise meta/ext
    expect(wv.statements[0]?.meta).toBe(doc.statements[0]?.meta);
    expect(wv.arguments[0]?.ext).toBe(doc.arguments[0]?.ext);
    // and none of it affects identity
    const stripped: WorldviewDocument = {
      format: "worldview-core",
      version: "0.1",
      statements: [
        { id: "a", text: "A", mode: "is" },
        { id: "b", text: "B", mode: "ought" },
      ],
      arguments: [{ id: "a-b", premises: ["a"], conclusions: ["b"], justification: "j" }],
    };
    expect(computeIdentities(wv).toDict()).toStrictEqual(computeIdentities(parseWorldview(stripped)).toDict());
  });

  it("does not alias the premises/conclusions arrays of the input", () => {
    const doc = chain();
    const wv = worldviewFromDict(doc);
    (wv.arguments[0] as { premises: string[] }).premises.push("zzz");
    expect(doc.arguments[0]?.premises).toStrictEqual(["a", "b"]);
  });

  it.each(readdirSync(EXAMPLES).filter((f) => f.endsWith(".json")))("round-trips examples/%s exactly", (file) => {
    const text = readText(path.join(EXAMPLES, file));
    const wv = parseWorldviewJson(text, file);
    expect(worldviewToDict(wv)).toStrictEqual(JSON.parse(text));
  });
});

describe("identity primitives", () => {
  it("propId is H('prop', canon(text), mode)", () => {
    expect(propId("  Hello   world ", "is")).toBe(H("prop", "Hello world", "is"));
    expect(propId("x", "is")).not.toBe(propId("x", "ought"));
    expect(canon("café")).toBe("café");
  });

  it("refuses to hash a lone surrogate instead of silently substituting U+FFFD", () => {
    // TextEncoder would turn both of these into the same bytes; Python refuses to encode either.
    expect(() => H("\ud800")).toThrow(RangeError);
    expect(() => H("a", ["\udfff"])).toThrow(/lone surrogate U\+DFFF/);
    expect(() => propId("x\ud83d", "is")).toThrow(RangeError);
    expect(H("\u{1f600}")).toBe(H("😀")); // a proper pair is fine
    const doc: WorldviewDocument = {
      format: "worldview-core",
      version: "0.1",
      statements: [{ id: "a", text: "bad \udc00 text", mode: "is" }],
      arguments: [],
    };
    expect(validateDict(doc)).toStrictEqual([]); // structurally fine, like the Python validator
    expect(() => computeIdentities(parseWorldview(doc))).toThrow(RangeError);
  });

  it("Identities.sccOf reports cyclic members and returns copies", () => {
    const wv = parseWorldview({
      format: "worldview-core",
      version: "0.1",
      statements: [
        { id: "x", text: "X", mode: "is" },
        { id: "y", text: "Y", mode: "is" },
        { id: "q", text: "Q", mode: "is" },
      ],
      arguments: [
        { id: "x-y", premises: ["x"], conclusions: ["y"], justification: "j" },
        { id: "y-x", premises: ["y"], conclusions: ["x"], justification: "j" },
        { id: "y-q", premises: ["y"], conclusions: ["q"], justification: "j" },
      ],
    });
    const ids = computeIdentities(wv);
    expect(ids.sccOf("x")).toStrictEqual(["x", "y"]);
    expect(ids.sccOf("q")).toBeNull();
    expect(ids.sccOf("nope")).toBeNull();
    const scc = ids.sccOf("x") as string[];
    scc.push("mutated");
    expect(ids.sccOf("x")).toStrictEqual(["x", "y"]);
    expect(ids.sccHash.size).toBe(1);
  });
});

describe("graph", () => {
  it("exposes adjacency, reachability, and component structure", () => {
    const wv = parseWorldview({
      format: "worldview-core",
      version: "0.1",
      statements: [
        { id: "a", text: "A", mode: "is" },
        { id: "b", text: "B", mode: "is" },
        { id: "c", text: "C", mode: "is" },
        { id: "d", text: "D", mode: "is" },
      ],
      arguments: [
        { id: "a-b", premises: ["a"], conclusions: ["b"], justification: "j" },
        { id: "b-c", premises: ["b"], conclusions: ["c"], justification: "j" },
        { id: "c-b", premises: ["c"], conclusions: ["b"], justification: "j" },
        { id: "c-d", premises: ["c"], conclusions: ["d"], justification: "j" },
      ],
    });
    const g = Graph.build(wv);
    expect(g.foundations()).toStrictEqual(["a"]);
    expect(g.incomingOf("b")).toStrictEqual(["a-b", "c-b"]);
    expect(g.outgoingOf("c")).toStrictEqual(["c-b", "c-d"]);
    expect([...g.succOf("c")].sort()).toStrictEqual(["b", "d"]);
    expect([...g.predOf("b")].sort()).toStrictEqual(["a", "c"]);
    expect([...g.upstream("d")].sort()).toStrictEqual(["a", "b", "c"]);
    expect([...g.downstream("a")].sort()).toStrictEqual(["b", "c", "d"]);
    expect([...g.upstream("b")].sort()).toStrictEqual(["a", "b", "c"]); // cyclic: includes itself
    expect(g.sccs()).toStrictEqual([["a"], ["b", "c"], ["d"]]);
    expect(g.cyclicSccs()).toStrictEqual([["b", "c"]]);
    expect(g.sccOf().get("c")).toBe(1);
    expect(g.isCyclicComponent(["d"])).toBe(false);
    expect(g.hasSelfLoop("b")).toBe(false);
    expect(() => g.incomingOf("nope")).toThrow(UnknownIdError);
  });

  it("depth 0 truncates the root only when it has arguments", () => {
    const wv = parseWorldview(chain());
    const root = restsOn(wv, "c", 0);
    expect(root.tree).toStrictEqual({ statement: "c", text: "C", truncated: true });
    expect(root.closure.statements).toStrictEqual(["a", "b"]);
    expect(restsOn(wv, "a", 0).tree).toStrictEqual({ statement: "a", text: "A" });
    expect(restsOn(wv, "a", null).tree).toStrictEqual({ statement: "a", text: "A", arguments: [] });
  });

  it("diff reports null sources when none were given", () => {
    const d = diff(worldviewFromDict(chain()), worldviewFromDict(chain()));
    expect(d.a).toBeNull();
    expect(d.b).toBeNull();
    expect(d.summary.statements.identical).toBe(3);
    expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  });
});

describe("schema", () => {
  it("is identical in content to the schema shipped with the Python package", () => {
    const python = readJson(PYTHON_SCHEMA);
    expect(schema).toStrictEqual(python);
    expect(JSON.stringify(schema)).toBe(JSON.stringify(python));
  });

  it("src/schema.ts is in sync with the generator", () => {
    const generated = readText(path.join(SDK_ROOT, "src", "schema.ts"));
    const pythonText = readText(PYTHON_SCHEMA).replace(/\r\n/g, "\n").trimEnd();
    expect(generated).toContain(pythonText);
  });
});

describe("packaging", () => {
  it("library modules use no Node-only APIs (only cli.ts may)", () => {
    const src = path.join(SDK_ROOT, "src");
    const offenders: string[] = [];
    for (const f of readdirSync(src)) {
      if (!f.endsWith(".ts") || f === "cli.ts") continue;
      const text = readFileSync(path.join(src, f), "utf8");
      if (/from\s+["']node:|require\(|\bprocess\.|\bBuffer\b|__dirname|import\.meta/.test(text)) {
        offenders.push(f);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it("VERSION matches package.json", () => {
    const pkg = readJson(path.join(SDK_ROOT, "package.json")) as { version: string; dependencies?: unknown };
    expect(VERSION).toBe(pkg.version);
    expect(pkg.dependencies).toBeUndefined();
  });
});
