/**
 * The command-line interface, exercised through the real bin shim against
 * the built dist/ (npm test builds first).  --json output must be the same
 * data the library returns; exit codes must match the Python CLI.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeIdentities,
  diff,
  foundations,
  parseWorldviewJson,
  restsOn,
  sccs,
  schema,
  supports,
  wellFounded,
} from "../src/index.js";
import { BIN, REPO_ROOT, readText } from "./paths.js";

const EXAMPLE = "examples/walking-to-work.json";
const FORK = "examples/walking-to-work-fork.json";
const NOT_A_WORLDVIEW = "conformance/vectors/invalid/wrong-format.json"; // a vector wrapper, not a worldview file

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(...args: string[]): Run {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function json(r: Run): unknown {
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

function example(rel: string) {
  return parseWorldviewJson(readText(path.join(REPO_ROOT, rel)), rel);
}

describe("worldview CLI", () => {
  it("--json ids emits the same data as computeIdentities().toDict()", () => {
    const r = run("--json", "ids", EXAMPLE);
    expect(json(r)).toStrictEqual(computeIdentities(example(EXAMPLE)).toDict());
    expect(r.stdout.endsWith("\n")).toBe(true);
  });

  it("--json is also accepted after the command", () => {
    expect(json(run("ids", EXAMPLE, "--json"))).toStrictEqual(computeIdentities(example(EXAMPLE)).toDict());
  });

  it("ids text output lists every statement and argument", () => {
    const r = run("ids", EXAMPLE);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("statements");
    expect(r.stdout).toContain("need-raincoat");
    expect(r.stdout).toContain("scc=self-knowledge,habit-reports");
  });

  it("ids text output pads ids by code points, like the Python CLI", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const file = path.join(dir, "astral.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "worldview-core",
        version: "0.1",
        statements: [
          { id: "\u{1d504}", text: "one astral code point", mode: "is" }, // two UTF-16 units
          { id: "ab", text: "two ascii", mode: "is" },
        ],
        arguments: [{ id: "\u{1f600}\u{1f600}\u{1f600}", premises: ["\u{1d504}"], conclusions: ["ab"], justification: "j" }],
      }),
      "utf8",
    );
    const r = run("ids", file);
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n");
    const astral = lines.find((l) => l.startsWith("  \u{1d504}")) as string;
    const ascii = lines.find((l) => l.startsWith("  ab")) as string;
    // Both id columns are width 2 (in code points), so the hash column starts at the same visual offset.
    expect(astral).toMatch(/^  \u{1d504}   [0-9a-f]{16}  [0-9a-f]{16}$/u);
    expect(ascii).toMatch(/^  ab  [0-9a-f]{16}  [0-9a-f]{16}$/u);
    const arg = lines.find((l) => l.startsWith("  \u{1f600}")) as string;
    expect(arg).toMatch(/^  \u{1f600}\u{1f600}\u{1f600}  [0-9a-f]{16}$/u);
  });

  it("a file whose text cannot be hashed exits 1 with an error, not a stack trace", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const file = path.join(dir, "surrogate.json");
    writeFileSync(file, '{"format":"worldview-core","version":"0.1","statements":[{"id":"a","text":"x\\ud800","mode":"is"}],"arguments":[]}', "utf8");
    expect(run("validate", file).code).toBe(0);
    const r = run("ids", file);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: .*lone surrogate/);
    expect(r.stderr).not.toContain("    at ");
  });

  it("validate: valid file exits 0 in text and JSON modes", () => {
    const text = run("validate", EXAMPLE);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("valid (12 statements, 6 arguments)");
    expect(json(run("--json", "validate", EXAMPLE))).toStrictEqual({ file: EXAMPLE, valid: true, problems: [] });
  });

  it("validate: invalid file exits 1 and reports problems", () => {
    const text = run("validate", NOT_A_WORLDVIEW);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("INVALID");
    const r = run("--json", "validate", NOT_A_WORLDVIEW);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout) as { file: string; valid: boolean; problems: string[] };
    expect(data.file).toBe(NOT_A_WORLDVIEW);
    expect(data.valid).toBe(false);
    expect(data.problems.length).toBeGreaterThan(0);
  });

  it("validate: unreadable file exits 1", () => {
    const r = run("--json", "validate", "does-not-exist.json");
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout) as { valid: boolean; problems: string[] };
    expect(data.valid).toBe(false);
    expect(data.problems.length).toBe(1);
    expect(run("validate", "does-not-exist.json").code).toBe(1);
  });

  it("other commands exit 1 on an invalid or missing file", () => {
    expect(run("ids", NOT_A_WORLDVIEW).code).toBe(1);
    expect(run("ids", "does-not-exist.json").code).toBe(1);
    expect(run("foundations", NOT_A_WORLDVIEW).stderr).toContain("not a valid worldview-core file");
  });

  it("rests-on / supports match the library, including --depth", () => {
    const wv = example(EXAMPLE);
    expect(json(run("--json", "rests-on", EXAMPLE, "need-raincoat"))).toStrictEqual(restsOn(wv, "need-raincoat"));
    expect(json(run("--json", "rests-on", EXAMPLE, "need-raincoat", "--depth", "1"))).toStrictEqual(
      restsOn(wv, "need-raincoat", 1),
    );
    expect(json(run("--json", "rests-on", EXAMPLE, "need-raincoat", "--depth=2"))).toStrictEqual(
      restsOn(wv, "need-raincoat", 2),
    );
    expect(json(run("--json", "supports", EXAMPLE, "walk-commute"))).toStrictEqual(supports(wv, "walk-commute"));
    const text = run("rests-on", EXAMPLE, "need-raincoat");
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("need-raincoat: I should own a good raincoat.");
    expect(text.stdout).toContain("[foundation]");
    expect(text.stdout).toContain("see above");
    expect(text.stdout).toContain("closure:");
  });

  it("unknown statement id exits 2", () => {
    const r = run("rests-on", EXAMPLE, "nope");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no statement with id");
    expect(run("--json", "supports", EXAMPLE, "nope").code).toBe(2);
  });

  it("foundations, sccs, lint well-founded match the library", () => {
    const wv = example(EXAMPLE);
    expect(json(run("--json", "foundations", EXAMPLE))).toStrictEqual(foundations(wv));
    expect(json(run("--json", "sccs", EXAMPLE))).toStrictEqual(sccs(wv));
    expect(json(run("--json", "lint", "well-founded", EXAMPLE))).toStrictEqual(wellFounded(wv));
    expect(run("foundations", EXAMPLE).stdout).toContain("exercise-good [is]:");
    expect(run("sccs", EXAMPLE).stdout).toContain("cycle 1: self-knowledge, habit-reports");
    expect(run("lint", "well-founded", EXAMPLE).stdout).toContain("not grounded in any foundation");
  });

  it("diff matches the library and records the paths as sources", () => {
    const expected = diff(example(EXAMPLE), example(FORK));
    expect(json(run("--json", "diff", EXAMPLE, FORK))).toStrictEqual(expected);
    const text = run("diff", EXAMPLE, FORK);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^statements: \d+ identical/);
  });

  it("schema prints the JSON Schema", () => {
    expect(json(run("schema"))).toStrictEqual(schema);
  });

  it("usage errors exit 2", () => {
    expect(run().code).toBe(2);
    expect(run("frobnicate").code).toBe(2);
    expect(run("ids").code).toBe(2);
    expect(run("ids", EXAMPLE, "extra").code).toBe(2);
    expect(run("rests-on", EXAMPLE, "need-raincoat", "--depth", "x").code).toBe(2);
    expect(run("ids", EXAMPLE, "--bogus").code).toBe(2);
    expect(run("lint").code).toBe(2);
    expect(run("lint", "nonsense", EXAMPLE).code).toBe(2);
  });

  it("--version and --help exit 0", () => {
    const v = run("--version");
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("worldview-core 0.1.0");
    const h = run("--help");
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("usage: worldview");
  });
});
