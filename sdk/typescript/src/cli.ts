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

import { readFileSync } from "node:fs";

import { diff } from "./diff.js";
import { LoadError, UnknownIdError, WorldviewError } from "./errors.js";
import { computeIdentities } from "./identity.js";
import { worldviewFromDict } from "./model.js";
import type { Worldview, WorldviewDocument } from "./model.js";
import { foundations, restsOn, sccs, supports, wellFounded } from "./queries.js";
import type { ClosureNode, ClosureReport, DownArgument, UpArgument } from "./queries.js";
import { schema } from "./schema.js";
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
  lint well-founded <file>          Statements not grounded in any foundation.
  diff <a> <b>                      Match statements and arguments across two files by identity.
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

function emit(io: CliIO, data: unknown, asJson: boolean, text: () => void): void {
  if (asJson) {
    io.stdout(JSON.stringify(data, null, 2) + "\n");
  } else {
    text();
  }
}

// -------------------------------------------------------- arg parsing

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

/** Minimal argparse: `--flag`, `--opt value`, `--opt=value`.  Unknown options are usage errors. */
function parseArgs(args: string[], spec: { positional: string[]; bools?: string[]; values?: string[] }, io: CliIO): Parsed {
  const bools = new Set(spec.bools ?? []);
  const values = new Set(spec.values ?? []);
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (bools.has(name) && eq === -1) {
        flags.set(name, true);
      } else if (values.has(name)) {
        let value: string | undefined;
        if (eq !== -1) {
          value = arg.slice(eq + 1);
        } else {
          i++;
          value = args[i];
        }
        if (value === undefined) usage(io, `option --${name} requires a value`);
        flags.set(name, value);
      } else {
        usage(io, `unrecognized option ${arg}`);
      }
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < spec.positional.length) {
    usage(io, `missing argument: ${spec.positional[positional.length] as string}`);
  }
  if (positional.length > spec.positional.length) {
    usage(io, `unrecognized argument: ${positional[spec.positional.length] as string}`);
  }
  return { positional, flags };
}

function usage(io: CliIO, message: string): never {
  io.stderr(`${USAGE}\nworldview: error: ${message}\n`);
  throw new CliExit(EXIT_USAGE);
}

function parseDepth(io: CliIO, raw: string | true | undefined): number | null {
  if (raw === undefined) return null;
  if (raw === true || !/^[+-]?[0-9]+$/.test(raw)) {
    usage(io, `argument --depth: invalid int value: ${JSON.stringify(raw)}`);
  }
  return Number.parseInt(raw, 10);
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
  const depth = parseDepth(io, flags.get("depth"));
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

function cmdLintWellFounded(args: string[], asJson: boolean, io: CliIO): number {
  const { positional } = parseArgs(args, { positional: ["file"] }, io);
  const wv = load(positional[0] as string, io);
  const data = wellFounded(wv);
  emit(io, data, asJson, () => {
    if (data.ungrounded.length === 0) {
      io.stdout(`well-founded: all ${data.grounded.length} statements are grounded in ${data.foundations.length} foundation(s)\n`);
    } else {
      io.stdout(`${data.ungrounded.length} statement(s) not grounded in any foundation:\n`);
      const text = new Map(wv.statements.map((s) => [s.id, s.text]));
      for (const sid of data.ungrounded) io.stdout(`  ${sid}: ${text.get(sid) ?? ""}\n`);
    }
  });
  return EXIT_OK;
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
  io.stdout(JSON.stringify(schema, null, 2) + "\n");
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
    // surrogate, which cannot be hashed): report it like an invalid file.
    if (e instanceof WorldviewError || e instanceof RangeError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT_INVALID;
    }
    throw e;
  }
}

function run(argv: string[], io: CliIO): number {
  let asJson = false;
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg === "--json") {
      asJson = true;
    } else if (arg === "--version") {
      io.stdout(`worldview-core ${VERSION}\n`);
      return EXIT_OK;
    } else if (arg === "--help" || arg === "-h") {
      io.stdout(USAGE);
      return EXIT_OK;
    } else {
      rest.push(arg);
    }
  }
  const command = rest.shift();
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
    case "lint": {
      const sub = rest.shift();
      if (sub === "well-founded") return cmdLintWellFounded(rest, asJson, io);
      return usage(io, sub === undefined ? "lint requires a sub-command (well-founded)" : `unknown lint command ${JSON.stringify(sub)}`);
    }
    case "diff":
      return cmdDiff(rest, asJson, io);
    case "schema":
      return cmdSchema(rest, io);
    default:
      return usage(io, `unknown command ${JSON.stringify(command)}`);
  }
}
