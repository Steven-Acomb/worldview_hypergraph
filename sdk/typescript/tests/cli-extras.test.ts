/**
 * The CLI commands added after the initial port (plan, the extra lints,
 * stats, present, export, merge), exercised through the real bin shim
 * against the built dist/.  --json output must be the same data the
 * library returns and the text of present / export must be the library's
 * text; exit codes must match the Python CLI.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pyInt } from "../src/cli.js";
import {
  duplicates,
  emptyJustifications,
  isOughtGaps,
  lintAll,
  merge,
  parseWorldviewJson,
  plan,
  present,
  restsOn,
  stats,
  toDot,
  toMermaid,
  unused,
} from "../src/index.js";
import { BIN, REPO_ROOT, VECTORS, readJson, readText } from "./paths.js";

const EXAMPLE = "examples/walking-to-work.json";
const FORK = "examples/walking-to-work-fork.json";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(...args: string[]): Run {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function json(r: Run, code = 0): unknown {
  expect(r.code, r.stderr).toBe(code);
  return JSON.parse(r.stdout);
}

function example(rel: string) {
  return parseWorldviewJson(readText(path.join(REPO_ROOT, rel)), rel);
}

/** Write the input of a conformance case to a temp file and return its path. */
function caseFile(dir: string, name: string): string {
  const v = readJson(path.join(VECTORS, "cases", `${name}.json`)) as { input: unknown };
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(v.input, null, 2) + "\n", "utf8");
  return file;
}

describe("worldview CLI: plan, lints, stats", () => {
  it("plan --json equals plan(), with --given comma-separated and repeatable", () => {
    const wv = example(EXAMPLE);
    expect(json(run("--json", "plan", EXAMPLE, "need-raincoat"))).toStrictEqual(plan(wv, "need-raincoat"));
    expect(json(run("--json", "plan", EXAMPLE, "need-raincoat", "--given", "walk-commute,rain-often"))).toStrictEqual(
      plan(wv, "need-raincoat", ["walk-commute", "rain-often"]),
    );
    expect(json(run("--json", "plan", EXAMPLE, "need-raincoat", "--given", "walk-commute", "--given=rain-often,"))).toStrictEqual(
      plan(wv, "need-raincoat", ["walk-commute", "rain-often"]),
    );
    const text = run("plan", EXAMPLE, "need-raincoat", "--given", "walk-commute");
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("to reach need-raincoat: I should own a good raincoat.");
    expect(text.stdout).toContain("given (1): walk-commute");
    expect(text.stdout).toContain("the audience must grant (2 foundations):");
    expect(text.stdout).toContain("must be established (1):");
    expect(run("plan", EXAMPLE, "need-raincoat", "--given", "need-raincoat").stdout).toContain("nothing to establish: the target is already given");
  });

  it("plan exits 2 on an unknown target or given id", () => {
    expect(run("plan", EXAMPLE, "nope").code).toBe(2);
    const r = run("--json", "plan", EXAMPLE, "need-raincoat", "--given", "nope");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("no statement with id");
  });

  it("lint duplicates / unused / empty-justifications / all match the library", () => {
    const wv = example(EXAMPLE);
    expect(json(run("--json", "lint", "duplicates", EXAMPLE))).toStrictEqual(duplicates(wv));
    expect(json(run("--json", "lint", "unused", EXAMPLE))).toStrictEqual(unused(wv));
    expect(json(run("--json", "lint", "empty-justifications", EXAMPLE))).toStrictEqual(emptyJustifications(wv));
    expect(json(run("--json", "lint", "is-ought", EXAMPLE))).toStrictEqual(isOughtGaps(wv));
    expect(json(run("--json", "lint", "all", EXAMPLE))).toStrictEqual(lintAll(wv));
    expect(run("lint", "duplicates", EXAMPLE).stdout).toBe("no duplicate propositions\n");
    expect(run("lint", "unused", EXAMPLE).stdout).toBe("every statement takes part in some argument\n");
    expect(run("lint", "empty-justifications", EXAMPLE).stdout).toBe("every argument has a justification\n");
    expect(run("lint", "is-ought", EXAMPLE).stdout).toBe("every ought conclusion has an ought premise behind it\n");
    expect(run("lint", "all", EXAMPLE).stdout).toBe(
      "well-founded: 3 ungrounded (commute-30, self-knowledge, habit-reports)\nduplicates: 0 group(s)\nunused statements: 0\nempty justifications: 0\nis-ought gaps: 0\n",
    );
  });

  it("lints report findings in text mode", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const dup = caseFile(dir, "duplicate-props");
    expect(run("lint", "duplicates", dup).stdout).toBe("x1, x2 [is]: X\n");
    expect(run("lint", "all", dup).stdout).toContain("duplicates: 1 group(s) (x1, x2)");
    const file = path.join(dir, "lint.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "worldview-core",
        version: "0.1",
        statements: [
          { id: "a", text: "A", mode: "is" },
          { id: "b", text: "B", mode: "is" },
          { id: "alone", text: "Alone", mode: "ought" },
          { id: "n", text: "N", mode: "ought" },
          { id: "m", text: "M", mode: "ought" },
          { id: "c", text: "C", mode: "is" },
        ],
        arguments: [
          { id: "a-b", premises: ["a"], conclusions: ["b"], justification: " \n " },
          { id: "b-n", premises: ["b"], conclusions: ["n", "c"], justification: "an ought (and an is) from an is" },
          { id: "stip", premises: [], conclusions: ["m"], justification: "an ought from nothing" },
          { id: "bridged", premises: ["b", "n"], conclusions: ["m"], justification: "an ought with an ought premise" },
        ],
      }),
      "utf8",
    );
    expect(run("lint", "unused", file).stdout).toBe("alone: Alone\n");
    expect(run("lint", "empty-justifications", file).stdout).toBe("a-b: a => b\n");
    expect(run("lint", "is-ought", file).stdout).toBe("b-n: b => n  [ought from is alone]\nstip: (no premises) => m  [ought from is alone]\n");
    expect(json(run("--json", "lint", "is-ought", file))).toStrictEqual([
      { argument: "b-n", ought_conclusions: ["n"], premises: ["b"] },
      { argument: "stip", ought_conclusions: ["m"], premises: [] },
    ]);
    expect(run("lint", "all", file).stdout).toBe(
      "well-founded: 0 ungrounded\nduplicates: 0 group(s)\nunused statements: 1 (alone)\nempty justifications: 1 (a-b)\nis-ought gaps: 2 (b-n, stip)\n",
    );
  });

  it("stats --json equals stats() and prints the mean as a Python float", () => {
    const wv = example(EXAMPLE);
    const r = run("--json", "stats", EXAMPLE);
    expect(json(r)).toStrictEqual(stats(wv));
    expect(r.stdout).toContain('"mean": 2.0\n'); // Python prints floats with a decimal point
    expect(r.stdout).toContain('"mean": 1.0\n');
    const fork = run("--json", "stats", FORK);
    expect(fork.stdout).toContain('"mean": 1.833\n');
    const text = run("stats", EXAMPLE);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      "statements: 12 (8 is, 4 ought)\n" +
        "arguments: 6 (premises 1-4, mean 2.0; conclusions 1-1; 0 with no premises)\n" +
        "foundations: 7   terminals: 1   unused: 0   ungrounded: 3\n" +
        "cycles: 1 (largest 2, 2 statements in cycles)\n" +
        "longest chain of arguments: 3\n" +
        "most supporting: self-knowledge (5), habit-reports (5), exercise-good (2), walk-is-exercise (2), health-matters (2)\n" +
        "most supported: need-raincoat (11), walk-commute (8), commute-30 (2), self-knowledge (2), habit-reports (2)\n",
    );
  });
});

describe("worldview CLI: present and export", () => {
  it("present writes the library's Markdown, wraps it for --json, and writes -o files", () => {
    const wv = example(EXAMPLE);
    const md = present(wv, "need-raincoat");
    expect(run("present", EXAMPLE, "need-raincoat").stdout).toBe(md);
    expect(json(run("--json", "present", EXAMPLE, "need-raincoat"))).toStrictEqual({ statement: "need-raincoat", markdown: md });
    expect(run("present", EXAMPLE, "need-raincoat", "--depth", "1").stdout).toBe(present(wv, "need-raincoat", { depth: 1 }));
    expect(run("present", EXAMPLE, "need-raincoat", "--given", "walk-commute", "--depth", "1").stdout).toBe(
      present(wv, "need-raincoat", { given: ["walk-commute"] }),
    );
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const out = path.join(dir, "case.md");
    const r = run("present", EXAMPLE, "need-raincoat", "-o", out);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(out, "utf8")).toBe(md);
    expect(run("present", EXAMPLE, "nope").code).toBe(2);
  });

  it("export writes DOT by default, Mermaid on request, honours the options, and writes -o files", () => {
    const wv = example(EXAMPLE);
    expect(run("export", EXAMPLE).stdout).toBe(toDot(wv));
    expect(run("export", EXAMPLE, "--format", "mermaid").stdout).toBe(toMermaid(wv));
    expect(run("export", EXAMPLE, "--format=dot", "--no-ids", "--wrap", "20", "--direction", "TB").stdout).toBe(
      toDot(wv, { ids: false, wrap: 20, rankdir: "TB" }),
    );
    expect(run("export", EXAMPLE, "--format", "mermaid", "--no-ids", "--wrap=20", "--direction=TB").stdout).toBe(
      toMermaid(wv, { ids: false, wrap: 20, direction: "TB" }),
    );
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const out = path.join(dir, "graph.dot");
    expect(run("export", EXAMPLE, "-o", out).code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(toDot(wv));
    expect(run("export", EXAMPLE, `-o${out}`).code).toBe(0);
  });

  it("export rejects a bad --format (exit 2) and a non-positive --wrap (exit 1, like Python's ValueError)", () => {
    expect(run("export", EXAMPLE, "--format", "svg").code).toBe(2);
    expect(run("export", EXAMPLE, "--wrap", "x").code).toBe(2);
    const r = run("export", EXAMPLE, "--wrap", "0");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: /);
  });
});

describe("worldview CLI: merge", () => {
  it("--json equals merge() and exits 0 without conflicts", () => {
    const expected = merge(example(EXAMPLE), example(FORK), example(EXAMPLE));
    expect(expected.conflicts).toStrictEqual([]);
    expect(json(run("--json", "merge", EXAMPLE, FORK, EXAMPLE))).toStrictEqual(expected);
    const text = run("merge", EXAMPLE, FORK, EXAMPLE);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      "statements: 8 kept, 4 changed, 1+0+0 added (ours+theirs+both), 0 removed\narguments: 4 kept, 1 changed, 1+0+0 added, 1 removed\nno conflicts\n",
    );
  });

  it("exits 1 on conflicts, lists them, and writes -o only when clean or forced", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const base = caseFile(dir, "chain");
    const ours = caseFile(dir, "with-meta-ext");
    const theirs = caseFile(dir, "chain-edited-leaf");
    const expected = merge(parseWorldviewJson(readText(base), base), parseWorldviewJson(readText(ours), ours), parseWorldviewJson(readText(theirs), theirs));
    expect(expected.conflicts.length).toBe(1);
    expect(json(run("--json", "merge", base, ours, theirs), 1)).toStrictEqual(expected);
    const text = run("merge", base, ours, theirs);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("1 conflict(s):\n  statement a: changed on both sides (kept ours)\n");

    const out = path.join(dir, "merged.json");
    const refused = run("merge", base, ours, theirs, "-o", out);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("not writing");
    expect(refused.stdout).not.toContain("wrote");
    const forced = run("merge", base, ours, theirs, "-o", out, "--force");
    expect(forced.code).toBe(1);
    expect(forced.stdout).toContain(`wrote ${out}`);
    expect(JSON.parse(readFileSync(out, "utf8"))).toStrictEqual(expected.merged);
    expect(readFileSync(out, "utf8").endsWith("\n")).toBe(true);

    const clean = path.join(dir, "clean.json");
    const ok = run("--json", "merge", base, ours, ours, "--output", clean);
    expect(ok.code).toBe(0);
    expect(ok.stdout).not.toContain("wrote"); // --json output is only the report
    expect(JSON.parse(readFileSync(clean, "utf8"))).toStrictEqual(merge(parseWorldviewJson(readText(base)), parseWorldviewJson(readText(ours)), parseWorldviewJson(readText(ours))).merged);
  });

  it("dangling references are reported in text mode", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const base = caseFile(dir, "chain");
    const ours = caseFile(dir, "chain-renamed");
    const theirs = caseFile(dir, "chain-plus");
    const r = run("merge", base, ours, theirs);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("  dangling arg-f-e: references missing f (dropped argument)\n");
    expect(r.stdout).toContain("  dangling g-e: references missing e (dropped argument)\n");
  });

  it("usage errors exit 2", () => {
    expect(run("merge", EXAMPLE, FORK).code).toBe(2);
    expect(run("merge", EXAMPLE, FORK, EXAMPLE, "extra").code).toBe(2);
    expect(run("merge", EXAMPLE, FORK, EXAMPLE, "-o").code).toBe(2);
    expect(run("export", EXAMPLE, "--bogus").code).toBe(2);
    expect(run("present", EXAMPLE).code).toBe(2);
    expect(run("stats").code).toBe(2);
    expect(run("--help").stdout).toContain("merge <base> <ours> <theirs>");
  });
});

/**
 * argparse conventions the Python CLI has and users carry over: `--` ends
 * option processing, long options may be abbreviated to a unique prefix, and
 * `type=int` options take whatever Python's `int()` takes.  Every expectation
 * here was checked against the Python CLI (exit code and stdout).
 */
describe("worldview CLI: argparse conventions", () => {
  const dashy = {
    format: "worldview-core",
    version: "0.1",
    statements: [
      { id: "-neg", text: "Starts with a dash", mode: "is" },
      { id: "--json", text: "Looks like the json flag", mode: "is" },
      { id: "-o", text: "Looks like the output flag", mode: "ought" },
    ],
    arguments: [{ id: "--", premises: ["-neg", "--json"], conclusions: ["-o"], justification: "j" }],
  };

  it("`--` ends option processing, so ids that start with a dash can be named", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "worldview-cli-"));
    const file = path.join(dir, "dashy.json");
    writeFileSync(file, JSON.stringify(dashy, null, 2) + "\n", "utf8");
    const wv = parseWorldviewJson(readText(file), file);
    expect(json(run("--json", "plan", file, "--given=-neg", "--", "-o"))).toStrictEqual(plan(wv, "-o", ["-neg"]));
    expect(json(run("--json", "rests-on", file, "--depth", "1", "--", "--json"))).toStrictEqual(restsOn(wv, "--json", 1));
    expect(run("present", file, "--", "-o").stdout).toBe(present(wv, "-o"));
    expect(run("--json", "--", "stats", file).code).toBe(0);
    expect(run("plan", file, "--", "-o", "--given", "-neg").code).toBe(2); // nothing after -- is an option
    expect(run("--", "--json", "stats", file).code).toBe(2); // `--json` is then taken as the command name
    expect(run("plan", file, "--", "--").code).toBe(2); // the second -- is an id, and there is no such statement
  });

  it("accepts a unique prefix of a long option, like argparse", () => {
    const wv = example(EXAMPLE);
    expect(json(run("--js", "plan", EXAMPLE, "need-raincoat", "--giv", "walk-commute"))).toStrictEqual(plan(wv, "need-raincoat", ["walk-commute"]));
    expect(run("rests-on", EXAMPLE, "need-raincoat", "--dep", "1").stdout).toBe(run("rests-on", EXAMPLE, "need-raincoat", "--depth", "1").stdout);
    expect(run("export", EXAMPLE, "--no", "--wr=20", "--dir", "TB").stdout).toBe(toDot(wv, { ids: false, wrap: 20, rankdir: "TB" }));
    expect(run("--vers").stdout).toBe(run("--version").stdout);
    const help = run("plan", EXAMPLE, "need-raincoat", "--he");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("usage:");
    expect(run("stats", EXAMPLE, "--js").code).toBe(2); // after the command only the exact --json is recognised
    expect(run("export", EXAMPLE, "--x").code).toBe(2);
  });

  it("parses --depth and --wrap with Python's int() rules", () => {
    const wv = example(EXAMPLE);
    expect(run("export", EXAMPLE, "--wrap", " 2_0 ").stdout).toBe(toDot(wv, { wrap: 20 }));
    expect(run("export", EXAMPLE, "--wrap", "٢٠").stdout).toBe(toDot(wv, { wrap: 20 })); // Arabic-Indic digits
    expect(run("rests-on", EXAMPLE, "need-raincoat", "--depth", "　+1\n").stdout).toBe(
      run("rests-on", EXAMPLE, "need-raincoat", "--depth", "1").stdout,
    );
    for (const bad of ["1__0", "_1", "1_", "1.0", "1e3", "0x10", "+ 1", "", "​1", "²", "-"]) {
      expect(run("export", EXAMPLE, "--wrap", bad).code, JSON.stringify(bad)).toBe(2);
    }
    expect(pyInt("١٢٣")).toBe(123);
    expect(pyInt("\u{1d7d9}\u{1d7da}")).toBe(12);
    expect(pyInt("-0")).toBe(0);
    expect(pyInt(" -1_000_000")).toBe(-1000000);
    expect(pyInt("1 0")).toBeNull();
    expect(pyInt("+")).toBeNull();
  });
});
