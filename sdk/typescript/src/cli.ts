/**
 * Command-line interface: a thin wrapper over the library functions.
 *
 * This is the only module that uses Node-only APIs (`node:fs`); the
 * library proper runs in browsers.  `bin/worldview.js` is the executable
 * shim that calls {@link main}.
 *
 * Every command accepts `--json` (before the command name, as in the
 * Python CLI; also accepted afterwards) for machine-readable output whose
 * data is identical to the Python CLI's.  Exit codes: 0 success, 1 the
 * file is not a valid worldview (or, for `validate`, cannot be read), 2
 * usage error or unknown id.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { WHITESPACE } from "./canon.js";
import { diff } from "./diff.js";
import { LoadError, UnknownIdError, WorldviewError } from "./errors.js";
import { toDot, toMermaid } from "./export.js";
import { computeIdentities } from "./identity.js";
import { duplicates, emptyJustifications, isOughtGaps, lintAll, unused } from "./lint.js";
import { merge } from "./merge.js";
import { getArgument, worldviewFromDict } from "./model.js";
import type { Worldview, WorldviewDocument } from "./model.js";
import { present } from "./present.js";
import { pyFloatRepr } from "./pyfloat.js";
import { foundations, plan, restsOn, sccs, supports, wellFounded } from "./queries.js";
import type { ClosureNode, ClosureReport, DownArgument, PlanReport, UpArgument } from "./queries.js";
import { schema } from "./schema.js";
import { stats } from "./stats.js";
import { validateDict } from "./validate.js";
import { VERSION } from "./version.js";

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

/** Where the CLI writes.  Defaults to the process streams; tests substitute buffers. */
export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIO: CliIO = {
  stdout: (t) => {
    process.stdout.write(t);
  },
  stderr: (t) => {
    process.stderr.write(t);
  },
};

class CliExit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const USAGE = `usage: worldview [--json] [--version] [--help] <command> ...

Validate, inspect, and diff worldview-core files.

commands:
  validate <file> [--jsonschema]    Check a file against the schema and referential integrity.
  ids <file>                        Emit prop_id, just_id, and arg_hash for every statement and argument.
  rests-on <file> <id> [--depth N]  What a statement rests on: upstream closure, per incoming argument.
  supports <file> <id> [--depth N]  What a statement supports: downstream closure, per outgoing argument.
  foundations <file>                Statements with no incoming argument.
  sccs <file>                       Cyclic strongly connected components (size > 1 or self-loop).
  plan <file> <id> [--given IDS]    What must be established to reach a statement, given what the audience accepts.
  lint well-founded <file>          Statements not grounded in any foundation.
  lint duplicates <file>            Statements that are the same proposition under different ids.
  lint unused <file>                Statements that appear in no argument.
  lint empty-justifications <file>  Arguments with a blank justification.
  lint is-ought <file>              Arguments that conclude an ought from is premises alone (Hume's gap).
  lint all <file>                   Run every lint.
  present <file> <id> [--given IDS] [--depth N] [-o FILE]
                                    Render the full case for a statement as Markdown.
  stats <file>                      Descriptive statistics of the hypergraph.
  diff <a> <b>                      Match statements and arguments across two files by identity.
  merge <base> <ours> <theirs> [-o FILE] [--force]
                                    Three-way merge: combine two lines of edits from a common base. Exit 1 on conflicts.
  export <file> [--format dot|mermaid] [--no-ids] [--wrap N] [--direction D] [-o FILE]
                                    Export the hypergraph as Graphviz DOT or Mermaid.
  schema                            Print the JSON Schema for the format.

options:
  --json      emit JSON instead of text (place before the command)
  --version   print the version and exit
  --help, -h  show this help and exit

exit codes: 0 success, 1 invalid file, 2 usage error or unknown id
`;

// ------------------------------------------------------------------ io

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new LoadError(`cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new LoadError(`${path}: not valid JSON: ${(e as Error).message}`);
  }
}

function load(path: string, io: CliIO): Worldview {
  let data: unknown;
  try {
    data = readJson(path);
  } catch (e) {
    io.stderr(`error: ${(e as Error).message}\n`);
    throw new CliExit(EXIT_INVALID);
  }
  const problems = validateDict(data);
  if (problems.length > 0) {
    io.stderr(`error: ${path} is not a valid worldview-core file\n`);
    for (const prob of problems) io.stderr(`  - ${prob}\n`);
    throw new CliExit(EXIT_INVALID);
  }
  return worldviewFromDict(data as WorldviewDocument, path);
}

function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

function emit(io: CliIO, data: unknown, asJson: boolean, text: () => void): void {
  if (asJson) {
    io.stdout(toJson(data));
  } else {
    text();
  }
}

/** Write a text file exactly as the Python CLI does: UTF-8, `\n` newlines. */
function writeText(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
}

// -------------------------------------------------------- arg parsing

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
  /** Repeatable options (`--given a --given b`), in order. */
  lists: Map<string, string[]>;
}

interface Spec {
  positional: string[];
  /** `--flag` */
  bools?: string[];
  /** `--opt value` or `--opt=value`; the last occurrence wins */
  values?: string[];
  /** `--opt value`, repeatable; every occurrence is kept */
  lists?: string[];
  /** short aliases: `{ o: "output" }` accepts `-o value` and `-ovalue` */
  shorts?: Record<string, string>;
}

/**
 * argparse's `allow_abbrev`: a long option may be given by any prefix that
 * matches exactly one of the known names (`--giv` for `--given`).  An exact
 * name always wins; an ambiguous prefix or no match is a usage error.
 */
function resolveLong(name: string, arg: string, known: Iterable<string>, io: CliIO): string {
  const names = [...known];
  if (name !== "" && names.includes(name)) return name;
  const matches = name === "" ? [] : names.filter((n) => n.startsWith(name));
  if (matches.length === 1) return matches[0] as string;
  if (matches.length > 1) usage(io, `ambiguous option: --${name} could match ${matches.map((m) => `--${m}`).join(", ")}`);
  return usage(io, `unrecognized option ${arg}`);
}

/**
 * Minimal argparse: `--flag`, `--opt value`, `--opt=value`, `-o value`, unique
 * prefixes of long options, and `--` after which everything is positional
 * (the only way to name a statement whose id starts with `-`).  Unknown
 * options are usage errors; `--help` prints the usage.
 */
function parseArgs(args: string[], spec: Spec, io: CliIO): Parsed {
  const bools = new Set(spec.bools ?? []);
  const values = new Set(spec.values ?? []);
  const lists = new Set(spec.lists ?? []);
  const shorts = spec.shorts ?? {};
  const known = ["help", ...bools, ...values, ...lists];
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const listValues = new Map<string, string[]>();
  const takeValue = (name: string, inline: string | undefined, i: number): [string, number] => {
    if (inline !== undefined) return [inline, i];
    const next = args[i + 1];
    if (next === undefined) usage(io, `argument --${name}: expected one argument`);
    return [next, i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    let name: string;
    let inline: string | undefined;
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      name = resolveLong(eq === -1 ? arg.slice(2) : arg.slice(2, eq), arg, known, io);
      inline = eq === -1 ? undefined : arg.slice(eq + 1);
      if (name === "help") {
        io.stdout(USAGE);
        throw new CliExit(EXIT_OK);
      }
    } else if (arg.length >= 2 && arg.startsWith("-") && Object.hasOwn(shorts, arg[1] as string)) {
      name = shorts[arg[1] as string] as string;
      inline = arg.length > 2 ? arg.slice(2) : undefined;
    } else {
      positional.push(arg);
      continue;
    }
    if (bools.has(name) && inline === undefined) {
      flags.set(name, true);
    } else if (values.has(name)) {
      const [value, next] = takeValue(name, inline, i);
      i = next;
      flags.set(name, value);
    } else if (lists.has(name)) {
      const [value, next] = takeValue(name, inline, i);
      i = next;
      const list = listValues.get(name);
      if (list === undefined) listValues.set(name, [value]);
      else list.push(value);
    } else {
      usage(io, `unrecognized option ${arg}`);
    }
  }
  if (positional.length < spec.positional.length) {
    usage(io, `missing argument: ${spec.positional[positional.length] as string}`);
  }
  if (positional.length > spec.positional.length) {
    usage(io, `unrecognized argument: ${positional[spec.positional.length] as string}`);
  }
  return { positional, flags, lists: listValues };
}

function usage(io: CliIO, message: string): never {
  io.stderr(`${USAGE}\nworldview: error: ${message}\n`);
  throw new CliExit(EXIT_USAGE);
}

const PY_SPACE = new Set<string>(Array.from(WHITESPACE));
const DECIMAL_DIGIT = /\p{Nd}/u;

/** The value 0-9 of a decimal digit of any script: Unicode encodes every digit set as a contiguous run 0..9. */
function digitValue(cp: number): number {
  let start = cp;
  while (start > 0 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/**
 * Python's `int(text)`, which is what argparse's `type=int` applies: the
 * text may be surrounded by whitespace (any `str.isspace()` code point),
 * start with a sign, use the decimal digits of any script, and separate
 * digit groups with single underscores.  `null` where Python raises
 * `ValueError`.
 */
export function pyInt(text: string): number | null {
  const cps = Array.from(text);
  let i = 0;
  let end = cps.length;
  while (i < end && PY_SPACE.has(cps[i] as string)) i++;
  while (end > i && PY_SPACE.has(cps[end - 1] as string)) end--;
  let negative = false;
  if (i < end && (cps[i] === "+" || cps[i] === "-")) {
    negative = cps[i] === "-";
    i++;
  }
  let value = 0n;
  let afterDigit = false;
  for (; i < end; i++) {
    const ch = cps[i] as string;
    if (ch === "_") {
      if (!afterDigit) return null; // leading or doubled underscore
      afterDigit = false;
      continue;
    }
    if (!DECIMAL_DIGIT.test(ch)) return null;
    value = value * 10n + BigInt(digitValue(ch.codePointAt(0) as number));
    afterDigit = true;
  }
  if (!afterDigit) return null; // no digits, or a trailing underscore
  return Number(negative ? -value : value);
}

function parseInt(io: CliIO, name: string, raw: string | true | undefined): number | null {
  if (raw === undefined) return null;
  const value = raw === true ? null : pyInt(raw);
  if (value === null) {
    usage(io, `argument --${name}: invalid int value: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** `--given a,b --given c` -> ["a", "b", "c"], empty pieces dropped, like the Python CLI. */
function splitIds(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    for (const x of v.split(",")) if (x !== "") out.push(x);
  }
  return out;
}

// ------------------------------------------------------------ commands

function cmdValidate(args: string[], asJson: boolean, io: CliIO): number {
  const { positional, flags } = parseArgs(args, { positional: ["file"], bools: ["jsonschema"] }, io);
  const file = positional[0] as string;
  let data: unknown;
  try {
    data = readJson(file);
  } catch (e) {
    const message = (e as Error).message;
    emit(io, { file, valid: false, problems: [message] }, asJson, () => io.stderr(`error: ${message}\n`));
    return EXIT_INVALID;
  }
  const problems = validateDict(data);
  if (flags.has("jsonschema")) {
    io.stderr("warning: --jsonschema is accepted for parity with the Python CLI but has no effect here; the built-in validator mirrors the schema exactly\n");
  }
  const result = { file, valid: problems.length === 0, problems };
  emit(io, result, asJson, () => {
    if (result.valid) {
      const doc = data as WorldviewDocument;
      io.stdout(`${file}: valid (${doc.statements.length} statements, ${doc.arguments.length} arguments)\n`);
    } else {
      io.stdout(`${file}: INVALID\n`);
      for (const prob of problems) io.stdout(`  - ${prob}\n`);
    }
  });
  return result.valid ? EXIT_OK : EXIT_INVALID;
}

/** Length in code points, as Python's `len()` counts it, so columns line up identically for astral-plane ids. */
function width(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function padEnd(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - width(s)));
}

function cmdIds(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const wv = load(positional[0] as string, io);
  const data = computeIdentities(wv).toDict();
  emit(io, data, asJson, () => {
    let w = data.statements.reduce((m, s) => Math.max(m, width(s.id)), 0);
    io.stdout("statements  (id  prop_id  just_id)\n");
    for (const s of data.statements) {
      const scc = s.scc ? `  scc=${s.scc.join(",")}` : "";
      io.stdout(`  ${padEnd(s.id, w)}  ${s.prop_id.slice(0, 16)}  ${s.just_id.slice(0, 16)}${scc}\n`);
    }
    w = data.arguments.reduce((m, a) => Math.max(m, width(a.id)), 0);
    io.stdout("arguments  (id  arg_hash)\n");
    for (const a of data.arguments) {
      io.stdout(`  ${padEnd(a.id, w)}  ${a.arg_hash.slice(0, 16)}\n`);
    }
    io.stdout("(hashes truncated to 16 hex chars; use --json for full values)\n");
  });
  return EXIT_OK;
}

function cmdClosure(args: string[], asJson: boolean, io: CliIO, up: boolean): number {
  const { positional, flags } = parseArgs(args, { positional: ["file", "id"], values: ["depth"] }, io);
  const depth = parseInt(io, "depth", flags.get("depth"));
  const wv = load(positional[0] as string, io);
  const id = positional[1] as string;
  let data: ClosureReport;
  try {
    data = up ? restsOn(wv, id, depth) : supports(wv, id, depth);
  } catch (e) {
    if (e instanceof UnknownIdError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT_USAGE;
    }
    throw e;
  }
  emit(io, data, asJson, () => {
    const arrow = up ? "<-" : "->";
    const render = (node: ClosureNode, indent: number): void => {
      const pad = "  ".repeat(indent);
      const flagsOut: string[] = [];
      if (node.scc) flagsOut.push("cycle: " + node.scc.join(", "));
      if (node.seen) flagsOut.push("see above");
      if (node.truncated) flagsOut.push("depth limit");
      if (node.arguments && node.arguments.length === 0) flagsOut.push(up ? "foundation" : "terminal");
      const suffix = flagsOut.length > 0 ? `  [${flagsOut.join("; ")}]` : "";
      io.stdout(`${pad}${node.statement}: ${node.text}${suffix}\n`);
      for (const a of node.arguments ?? []) {
        const co = up ? (a as UpArgument).co_conclusions : (a as DownArgument).co_premises;
        const kids = up ? (a as UpArgument).premises : (a as DownArgument).conclusions;
        let extra = a.rule ? ` [${a.rule}]` : "";
        if (co.length > 0) extra += ` (jointly with ${co.join(", ")})`;
        io.stdout(`${pad}  ${arrow} ${a.argument}${extra}\n`);
        if (kids.length === 0) io.stdout(`${pad}      (no ${up ? "premises" : "conclusions"})\n`);
        for (const k of kids) render(k, indent + 3);
      }
    };
    render(data.tree, 0);
    io.stdout("\n");
    io.stdout(`closure: ${data.closure.statements.length} statements, ${data.closure.arguments.length} arguments\n`);
    for (const comp of data.sccs) io.stdout(`cycle: ${comp.join(", ")}\n`);
  });
  return EXIT_OK;
}

function cmdPlan(args: string[], asJson: boolean, io: CliIO): number {
  const { positional, lists } = parseArgs(args, { positional: ["file", "id"], lists: ["given"] }, io);
  const wv = load(positional[0] as string, io);
  const given = splitIds(lists.get("given"));
  let data: PlanReport;
  try {
    data = plan(wv, positional[1] as string, given);
  } catch (e) {
    if (e instanceof UnknownIdError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT_USAGE;
    }
    throw e;
  }
  emit(io, data, asJson, () => {
    io.stdout(`to reach ${data.statement}: ${data.text}\n`);
    if (data.given.length > 0) io.stdout(`given (${data.given.length}): ${data.given.join(", ")}\n`);
    if (data.must_establish.length === 0 && data.must_grant.length === 0) {
      io.stdout("nothing to establish: the target is already given\n");
    }
    if (data.must_grant.length > 0) {
      io.stdout(`the audience must grant (${data.must_grant.length} foundations):\n`);
      for (const s of data.must_grant) io.stdout(`  ${s.id}: ${s.text}\n`);
    }
    if (data.must_establish.length > 0) {
      io.stdout(`must be established (${data.must_establish.length}):\n`);
      for (const s of data.must_establish) io.stdout(`  ${s.id}: ${s.text}  [via ${s.via.join(", ")}]\n`);
    }
    for (const comp of data.sccs) io.stdout(`cycle: ${comp.join(", ")}\n`);
  });
  return EXIT_OK;
}

function cmdFoundations(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const data = foundations(load(positional[0] as string, io));
  emit(io, data, asJson, () => {
    if (data.length === 0) io.stdout("(no foundations: every statement has an incoming argument)\n");
    for (const s of data) io.stdout(`${s.id} [${s.mode}]: ${s.text}\n`);
  });
  return EXIT_OK;
}

function cmdSccs(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const data = sccs(load(positional[0] as string, io));
  emit(io, data, asJson, () => {
    if (data.length === 0) io.stdout("(no cycles)\n");
    data.forEach((c, i) => {
      io.stdout(`cycle ${i + 1}: ${c.members.join(", ")}\n`);
      if (c.self_loops.length > 0) io.stdout(`  self-loops: ${c.self_loops.join(", ")}\n`);
      if (c.internal_arguments.length > 0) io.stdout(`  internal arguments: ${c.internal_arguments.join(", ")}\n`);
      if (c.boundary_arguments.length > 0) io.stdout(`  boundary arguments: ${c.boundary_arguments.join(", ")}\n`);
    });
  });
  return EXIT_OK;
}

function statementText(wv: Worldview): (sid: string) => string {
  const text = new Map(wv.statements.map((s) => [s.id, s.text]));
  return (sid) => text.get(sid) ?? "";
}

function cmdLintWellFounded(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const wv = load(positional[0] as string, io);
  const data = wellFounded(wv);
  emit(io, data, asJson, () => {
    if (data.ungrounded.length === 0) {
      io.stdout(`well-founded: all ${data.grounded.length} statements are grounded in ${data.foundations.length} foundation(s)\n`);
    } else {
      io.stdout(`${data.ungrounded.length} statement(s) not grounded in any foundation:\n`);
      const text = statementText(wv);
      for (const sid of data.ungrounded) io.stdout(`  ${sid}: ${text(sid)}\n`);
    }
  });
  return EXIT_OK;
}

function cmdLintDuplicates(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const data = duplicates(load(positional[0] as string, io));
  emit(io, data, asJson, () => {
    if (data.length === 0) io.stdout("no duplicate propositions\n");
    for (const g of data) io.stdout(`${g.ids.join(", ")} [${g.mode}]: ${g.text}\n`);
  });
  return EXIT_OK;
}

function cmdLintUnused(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const wv = load(positional[0] as string, io);
  const data = unused(wv);
  emit(io, data, asJson, () => {
    if (data.length === 0) io.stdout("every statement takes part in some argument\n");
    const text = statementText(wv);
    for (const sid of data) io.stdout(`${sid}: ${text(sid)}\n`);
  });
  return EXIT_OK;
}

function cmdLintEmptyJustifications(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const wv = load(positional[0] as string, io);
  const data = emptyJustifications(wv);
  emit(io, data, asJson, () => {
    if (data.length === 0) io.stdout("every argument has a justification\n");
    for (const aid of data) {
      const a = getArgument(wv, aid);
      io.stdout(`${aid}: ${a.premises.join(", ") || "(none)"} => ${a.conclusions.join(", ")}\n`);
    }
  });
  return EXIT_OK;
}

function cmdLintIsOught(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const data = isOughtGaps(load(positional[0] as string, io));
  emit(io, data, asJson, () => {
    if (data.length === 0) io.stdout("every ought conclusion has an ought premise behind it\n");
    for (const g of data) {
      io.stdout(`${g.argument}: ${g.premises.join(", ") || "(no premises)"} => ${g.ought_conclusions.join(", ")}  [ought from is alone]\n`);
    }
  });
  return EXIT_OK;
}

function cmdLintAll(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const data = lintAll(load(positional[0] as string, io));
  emit(io, data, asJson, () => {
    const wf = data.well_founded;
    const paren = (items: string[]): string => (items.length > 0 ? ` (${items.join(", ")})` : "");
    io.stdout(`well-founded: ${wf.ungrounded.length} ungrounded${paren(wf.ungrounded)}\n`);
    const groups = data.duplicates.map((g) => g.ids.join(", ")).join("; ");
    io.stdout(`duplicates: ${data.duplicates.length} group(s)${data.duplicates.length > 0 ? ` (${groups})` : ""}\n`);
    io.stdout(`unused statements: ${data.unused.length}${paren(data.unused)}\n`);
    io.stdout(`empty justifications: ${data.empty_justifications.length}${paren(data.empty_justifications)}\n`);
    io.stdout(`is-ought gaps: ${data.is_ought_gaps.length}${paren(data.is_ought_gaps.map((g) => g.argument))}\n`);
  });
  return EXIT_OK;
}

function cmdExport(args: string[], io: CliIO): number {
  const { positional, flags } = parseArgs(
    args,
    { positional: ["file"], bools: ["no-ids"], values: ["format", "wrap", "direction", "output"], shorts: { o: "output" } },
    io,
  );
  const format = flags.get("format") ?? "dot";
  if (format !== "dot" && format !== "mermaid") {
    usage(io, `argument --format: invalid choice: ${JSON.stringify(format)} (choose from 'dot', 'mermaid')`);
  }
  const wrap = parseInt(io, "wrap", flags.get("wrap")) ?? 36;
  const direction = flags.get("direction");
  const dir = typeof direction === "string" ? direction : "LR";
  const wv = load(positional[0] as string, io);
  const ids = !flags.has("no-ids");
  const out = format === "dot" ? toDot(wv, { ids, wrap, rankdir: dir }) : toMermaid(wv, { ids, wrap, direction: dir });
  const output = flags.get("output");
  if (typeof output === "string") {
    writeText(output, out);
  } else {
    io.stdout(out);
  }
  return EXIT_OK;
}

function cmdPresent(args: string[], asJson: boolean, io: CliIO): number {
  const { positional, flags, lists } = parseArgs(
    args,
    { positional: ["file", "id"], lists: ["given"], values: ["depth", "output"], shorts: { o: "output" } },
    io,
  );
  const depth = parseInt(io, "depth", flags.get("depth"));
  const wv = load(positional[0] as string, io);
  const id = positional[1] as string;
  let md: string;
  try {
    md = present(wv, id, { given: splitIds(lists.get("given")), depth });
  } catch (e) {
    if (e instanceof UnknownIdError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT_USAGE;
    }
    throw e;
  }
  const output = flags.get("output");
  if (asJson) {
    io.stdout(toJson({ statement: id, markdown: md }));
  } else if (typeof output === "string") {
    writeText(output, md);
  } else {
    io.stdout(md);
  }
  return EXIT_OK;
}

function cmdStats(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const data = stats(load(positional[0] as string, io));
  if (asJson) {
    // `mean` is a float in Python and prints as `2.0`; every other number is an int.
    io.stdout(toJson(data).replace(/^(\s*"mean": -?\d+)(,?)$/gm, "$1.0$2"));
    return EXIT_OK;
  }
  const p = data.premises;
  const c = data.conclusions;
  io.stdout(`statements: ${data.statements} (${data.modes.is} is, ${data.modes.ought} ought)\n`);
  io.stdout(
    `arguments: ${data.arguments} (premises ${p.min}-${p.max}, mean ${pyFloatRepr(p.mean)}; ` +
      `conclusions ${c.min}-${c.max}; ${data.zero_premise_arguments} with no premises)\n`,
  );
  io.stdout(`foundations: ${data.foundations}   terminals: ${data.terminals}   unused: ${data.unused}   ungrounded: ${data.ungrounded}\n`);
  io.stdout(`cycles: ${data.cycles} (largest ${data.largest_cycle}, ${data.statements_in_cycles} statements in cycles)\n`);
  io.stdout(`longest chain of arguments: ${data.longest_chain}\n`);
  if (data.most_supporting.length > 0) {
    io.stdout("most supporting: " + data.most_supporting.map((x) => `${x.id} (${x.downstream})`).join(", ") + "\n");
  }
  if (data.most_supported.length > 0) {
    io.stdout("most supported: " + data.most_supported.map((x) => `${x.id} (${x.upstream})`).join(", ") + "\n");
  }
  return EXIT_OK;
}

function cmdMerge(args: string[], asJson: boolean, io: CliIO): number {
  const { positional, flags } = parseArgs(
    args,
    { positional: ["base", "ours", "theirs"], bools: ["force"], values: ["output"], shorts: { o: "output" } },
    io,
  );
  const base = load(positional[0] as string, io);
  const ours = load(positional[1] as string, io);
  const theirs = load(positional[2] as string, io);
  const data = merge(base, ours, theirs);
  const conflicts = data.conflicts;
  emit(io, data, asJson, () => {
    const s = data.summary.statements;
    const a = data.summary.arguments;
    io.stdout(
      `statements: ${s.kept} kept, ${s.changed} changed, ${s.added_ours}+${s.added_theirs}+${s.added_both} added (ours+theirs+both), ${s.removed} removed\n`,
    );
    io.stdout(`arguments: ${a.kept} kept, ${a.changed} changed, ${a.added_ours}+${a.added_theirs}+${a.added_both} added, ${a.removed} removed\n`);
    if (conflicts.length > 0) {
      io.stdout(`${conflicts.length} conflict(s):\n`);
      for (const c of conflicts) {
        if (c.kind === "dangling") {
          io.stdout(`  dangling ${c.id}: references missing ${c.missing.join(", ")} (${c.resolution})\n`);
        } else {
          io.stdout(`  ${c.kind} ${c.id}: changed on both sides (${c.resolution})\n`);
        }
      }
    } else {
      io.stdout("no conflicts\n");
    }
  });
  const output = flags.get("output");
  if (typeof output === "string") {
    if (conflicts.length === 0 || flags.has("force")) {
      writeText(output, toJson(data.merged));
      if (!asJson) io.stdout(`wrote ${output}\n`);
    } else {
      io.stderr(`not writing ${output}: conflicts (use --force to write the ours-wins result)\n`);
    }
  }
  return conflicts.length > 0 ? EXIT_INVALID : EXIT_OK;
}

function cmdDiff(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["a", "b"] }, io);
  const a = load(positional[0] as string, io);
  const b = load(positional[1] as string, io);
  const data = diff(a, b);
  emit(io, data, asJson, () => {
    const s = data.statements;
    const g = data.arguments;
    io.stdout(
      `statements: ${s.identical.length} identical, ${s.rejustified.length} rejustified, ${s.added.length} added, ${s.removed.length} removed\n`,
    );
    for (const x of s.rejustified) {
      const same = x.a === x.b ? "" : ` (was ${x.a})`;
      io.stdout(`  ~ ${x.b}${same}: ${x.text}\n`);
    }
    for (const x of s.added) io.stdout(`  + ${x.id}: ${x.text}\n`);
    for (const x of s.removed) io.stdout(`  - ${x.id}: ${x.text}\n`);
    io.stdout(`arguments: ${g.identical.length} identical, ${g.added.length} added, ${g.removed.length} removed\n`);
    const show = (p: string[], c: string[]): string => `${p.join(", ") || "(none)"} => ${c.join(", ")}`;
    for (const x of g.added) io.stdout(`  + ${x.id}: ${show(x.premises, x.conclusions)}\n`);
    for (const x of g.removed) io.stdout(`  - ${x.id}: ${show(x.premises, x.conclusions)}\n`);
  });
  return EXIT_OK;
}

function cmdSchema(args: string[], io: CliIO): number {
  parseArgs(args, { positional: [] }, io);
  io.stdout(toJson(schema));
  return EXIT_OK;
}

// ---------------------------------------------------------------- main

/**
 * Run the CLI on `argv` (without the `node` and script entries) and return
 * the exit code.  Never throws for user errors; writes to `io`.
 */
export function main(argv: string[], io: CliIO = processIO): number {
  try {
    return run(argv, io);
  } catch (e) {
    if (e instanceof CliExit) return e.code;
    // A library error on an otherwise valid file (for example text with a lone
    // surrogate, which cannot be hashed, or a non-positive --wrap): report it
    // like an invalid file.
    if (e instanceof WorldviewError || e instanceof RangeError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT_INVALID;
    }
    throw e;
  }
}

const LINT_COMMANDS: Record<string, (args: string[], asJson: boolean, io: CliIO) => number> = {
  "well-founded": cmdLintWellFounded,
  duplicates: cmdLintDuplicates,
  unused: cmdLintUnused,
  "empty-justifications": cmdLintEmptyJustifications,
  "is-ought": cmdLintIsOught,
  all: cmdLintAll,
};

const TOP_OPTIONS = ["json", "version", "help"];

function run(argv: string[], io: CliIO): number {
  let asJson = false;
  let command: string | undefined;
  const rest: string[] = [];
  // Before the command name the top-level options may be abbreviated, as in
  // argparse; after it only the exact spellings are recognised (the Python
  // CLI accepts none there).  `--` ends option processing at this level.
  let literal = false;
  for (const arg of argv) {
    let name: string | null = null;
    if (!literal && arg === "--") {
      literal = true;
      if (command !== undefined) rest.push(arg); // the command's own parser sees it too
      continue;
    }
    if (!literal) {
      if (arg === "-h") {
        name = "help";
      } else if (arg.startsWith("--")) {
        const raw = arg.slice(2);
        if (TOP_OPTIONS.includes(raw)) name = raw;
        else if (command === undefined && raw !== "") {
          const matches = TOP_OPTIONS.filter((n) => n.startsWith(raw));
          if (matches.length === 1) name = matches[0] as string;
        }
      }
    }
    if (name === "json") {
      asJson = true;
    } else if (name === "version") {
      io.stdout(`worldview-core ${VERSION}\n`);
      return EXIT_OK;
    } else if (name === "help") {
      io.stdout(USAGE);
      return EXIT_OK;
    } else if (command === undefined) {
      command = arg;
    } else {
      rest.push(arg);
    }
  }
  switch (command) {
    case undefined:
      return usage(io, "a command is required");
    case "validate":
      return cmdValidate(rest, asJson, io);
    case "ids":
      return cmdIds(rest, asJson, io);
    case "rests-on":
      return cmdClosure(rest, asJson, io, true);
    case "supports":
      return cmdClosure(rest, asJson, io, false);
    case "foundations":
      return cmdFoundations(rest, asJson, io);
    case "sccs":
      return cmdSccs(rest, asJson, io);
    case "plan":
      return cmdPlan(rest, asJson, io);
    case "lint": {
      const sub = rest.shift();
      const fn = sub === undefined ? undefined : LINT_COMMANDS[sub];
      if (fn !== undefined && Object.hasOwn(LINT_COMMANDS, sub as string)) return fn(rest, asJson, io);
      const names = Object.keys(LINT_COMMANDS).join(", ");
      return usage(io, sub === undefined ? `lint requires a sub-command (${names})` : `unknown lint command ${JSON.stringify(sub)}`);
    }
    case "present":
      return cmdPresent(rest, asJson, io);
    case "stats":
      return cmdStats(rest, asJson, io);
    case "diff":
      return cmdDiff(rest, asJson, io);
    case "merge":
      return cmdMerge(rest, asJson, io);
    case "export":
      return cmdExport(rest, io);
    case "schema":
      return cmdSchema(rest, io);
    default:
      return usage(io, `unknown command ${JSON.stringify(command)}`);
  }
}
