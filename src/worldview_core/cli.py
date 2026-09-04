"""Command-line interface: a thin wrapper over the library functions.

Every command accepts ``--json`` for machine-readable output.  Exit
codes: 0 success, 1 the file is not a valid worldview (or, for
``validate``, cannot be read), 2 usage error or unknown id.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import __version__
from .diff import diff
from .errors import LoadError, UnknownIdError, ValidationError
from .export import to_dot, to_mermaid
from .identity import compute_identities
from .lint import duplicates, empty_justifications, is_ought_gaps, lint_all, unused
from .merge import merge
from .model import Worldview, load, read_json
from .present import present
from .queries import foundations, plan, rests_on, sccs, supports, well_founded
from .stats import stats
from .validate import schema, validate_dict

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 2


def _emit(data: Any, as_json: bool, text_fn) -> None:
    if as_json:
        json.dump(data, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        text_fn(data)


def _load(path: str) -> Worldview:
    try:
        return load(path)
    except LoadError as e:
        sys.stderr.write(f"error: {e}\n")
        sys.exit(EXIT_INVALID)
    except ValidationError as e:
        sys.stderr.write(f"error: {path} is not a valid worldview-core file\n")
        for prob in e.problems:
            sys.stderr.write(f"  - {prob}\n")
        sys.exit(EXIT_INVALID)


# --------------------------------------------------------------- commands


def cmd_validate(args) -> int:
    try:
        data = read_json(args.file)
    except LoadError as e:
        _emit({"file": args.file, "valid": False, "problems": [str(e)]}, args.json, lambda d: sys.stderr.write(f"error: {e}\n"))
        return EXIT_INVALID
    problems = validate_dict(data)
    if args.jsonschema:
        try:
            from .validate import validate_with_jsonschema

            problems = problems + [f"[jsonschema] {p}" for p in validate_with_jsonschema(data)]
        except ImportError:
            sys.stderr.write("warning: --jsonschema requested but the jsonschema package is not installed\n")
    result = {"file": args.file, "valid": not problems, "problems": problems}

    def text(d):
        if d["valid"]:
            n_s = len(data["statements"])
            n_a = len(data["arguments"])
            print(f"{args.file}: valid ({n_s} statements, {n_a} arguments)")
        else:
            print(f"{args.file}: INVALID")
            for prob in d["problems"]:
                print(f"  - {prob}")

    _emit(result, args.json, text)
    return EXIT_OK if not problems else EXIT_INVALID


def cmd_ids(args) -> int:
    wv = _load(args.file)
    ids = compute_identities(wv)
    data = ids.to_dict()

    def text(d):
        w = max((len(s["id"]) for s in d["statements"]), default=0)
        print("statements  (id  prop_id  just_id)")
        for s in d["statements"]:
            scc = f"  scc={','.join(s['scc'])}" if "scc" in s else ""
            print(f"  {s['id']:<{w}}  {s['prop_id'][:16]}  {s['just_id'][:16]}{scc}")
        w = max((len(a["id"]) for a in d["arguments"]), default=0)
        print("arguments  (id  arg_hash)")
        for a in d["arguments"]:
            print(f"  {a['id']:<{w}}  {a['arg_hash'][:16]}")
        print("(hashes truncated to 16 hex chars; use --json for full values)")

    _emit(data, args.json, text)
    return EXIT_OK


def _cmd_closure(args, fn, up: bool) -> int:
    wv = _load(args.file)
    try:
        data = fn(wv, args.id, depth=args.depth)
    except UnknownIdError as e:
        sys.stderr.write(f"error: {e}\n")
        return EXIT_USAGE

    def text(d):
        arrow = "<-" if up else "->"
        kids = "premises" if up else "conclusions"
        co = "co_conclusions" if up else "co_premises"

        def render(node, indent):
            pad = "  " * indent
            flags = []
            if "scc" in node:
                flags.append("cycle: " + ", ".join(node["scc"]))
            if node.get("seen"):
                flags.append("see above")
            if node.get("truncated"):
                flags.append("depth limit")
            if "arguments" in node and not node["arguments"]:
                flags.append("foundation" if up else "terminal")
            suffix = f"  [{'; '.join(flags)}]" if flags else ""
            print(f"{pad}{node['statement']}: {node['text']}{suffix}")
            for a in node.get("arguments", []):
                extra = f" [{a['rule']}]" if a.get("rule") else ""
                if a[co]:
                    extra += f" (jointly with {', '.join(a[co])})"
                print(f"{pad}  {arrow} {a['argument']}{extra}")
                if not a[kids]:
                    print(f"{pad}      (no {kids})")
                for k in a[kids]:
                    render(k, indent + 3)

        render(d["tree"], 0)
        c = d["closure"]
        print()
        print(f"closure: {len(c['statements'])} statements, {len(c['arguments'])} arguments")
        if d["sccs"]:
            for comp in d["sccs"]:
                print("cycle: " + ", ".join(comp))

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_rests_on(args) -> int:
    return _cmd_closure(args, rests_on, up=True)


def cmd_supports(args) -> int:
    return _cmd_closure(args, supports, up=False)


def _split_ids(values: list[str] | None) -> list[str]:
    out: list[str] = []
    for v in values or []:
        out.extend(x for x in v.split(",") if x)
    return out


def cmd_plan(args) -> int:
    wv = _load(args.file)
    given = _split_ids(args.given)
    try:
        data = plan(wv, args.id, given)
    except UnknownIdError as e:
        sys.stderr.write(f"error: {e}\n")
        return EXIT_USAGE

    def text(d):
        print(f"to reach {d['statement']}: {d['text']}")
        if d["given"]:
            print(f"given ({len(d['given'])}): {', '.join(d['given'])}")
        if not d["must_establish"] and not d["must_grant"]:
            print("nothing to establish: the target is already given")
        if d["must_grant"]:
            print(f"the audience must grant ({len(d['must_grant'])} foundations):")
            for s in d["must_grant"]:
                print(f"  {s['id']}: {s['text']}")
        if d["must_establish"]:
            print(f"must be established ({len(d['must_establish'])}):")
            for s in d["must_establish"]:
                print(f"  {s['id']}: {s['text']}  [via {', '.join(s['via'])}]")
        if d["sccs"]:
            for comp in d["sccs"]:
                print("cycle: " + ", ".join(comp))

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_foundations(args) -> int:
    wv = _load(args.file)
    data = foundations(wv)

    def text(d):
        if not d:
            print("(no foundations: every statement has an incoming argument)")
        for s in d:
            print(f"{s['id']} [{s['mode']}]: {s['text']}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_sccs(args) -> int:
    wv = _load(args.file)
    data = sccs(wv)

    def text(d):
        if not d:
            print("(no cycles)")
        for i, c in enumerate(d, 1):
            print(f"cycle {i}: {', '.join(c['members'])}")
            if c["self_loops"]:
                print(f"  self-loops: {', '.join(c['self_loops'])}")
            if c["internal_arguments"]:
                print(f"  internal arguments: {', '.join(c['internal_arguments'])}")
            if c["boundary_arguments"]:
                print(f"  boundary arguments: {', '.join(c['boundary_arguments'])}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_lint_well_founded(args) -> int:
    wv = _load(args.file)
    data = well_founded(wv)

    def text(d):
        if not d["ungrounded"]:
            print(f"well-founded: all {len(d['grounded'])} statements are grounded in {len(d['foundations'])} foundation(s)")
        else:
            print(f"{len(d['ungrounded'])} statement(s) not grounded in any foundation:")
            for sid in d["ungrounded"]:
                print(f"  {sid}: {wv.statement(sid).text}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_lint_duplicates(args) -> int:
    wv = _load(args.file)
    data = duplicates(wv)

    def text(d):
        if not d:
            print("no duplicate propositions")
        for g in d:
            print(f"{', '.join(g['ids'])} [{g['mode']}]: {g['text']}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_lint_unused(args) -> int:
    wv = _load(args.file)
    data = unused(wv)

    def text(d):
        if not d:
            print("every statement takes part in some argument")
        for sid in d:
            print(f"{sid}: {wv.statement(sid).text}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_lint_empty_justifications(args) -> int:
    wv = _load(args.file)
    data = empty_justifications(wv)

    def text(d):
        if not d:
            print("every argument has a justification")
        for aid in d:
            a = wv.argument(aid)
            print(f"{aid}: {', '.join(a.premises) or '(none)'} => {', '.join(a.conclusions)}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_lint_is_ought(args) -> int:
    wv = _load(args.file)
    data = is_ought_gaps(wv)

    def text(d):
        if not d:
            print("every ought conclusion has an ought premise behind it")
        for g in d:
            print(f"{g['argument']}: {', '.join(g['premises']) or '(no premises)'} => {', '.join(g['ought_conclusions'])}  [ought from is alone]")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_lint_all(args) -> int:
    wv = _load(args.file)
    data = lint_all(wv)

    def text(d):
        wf = d["well_founded"]
        print(f"well-founded: {len(wf['ungrounded'])} ungrounded" + (f" ({', '.join(wf['ungrounded'])})" if wf["ungrounded"] else ""))
        print(f"duplicates: {len(d['duplicates'])} group(s)" + (" (" + "; ".join(", ".join(g["ids"]) for g in d["duplicates"]) + ")" if d["duplicates"] else ""))
        print(f"unused statements: {len(d['unused'])}" + (f" ({', '.join(d['unused'])})" if d["unused"] else ""))
        print(f"empty justifications: {len(d['empty_justifications'])}" + (f" ({', '.join(d['empty_justifications'])})" if d["empty_justifications"] else ""))
        print(f"is-ought gaps: {len(d['is_ought_gaps'])}" + (f" ({', '.join(g['argument'] for g in d['is_ought_gaps'])})" if d["is_ought_gaps"] else ""))

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_export(args) -> int:
    wv = _load(args.file)
    if args.format == "dot":
        out = to_dot(wv, ids=not args.no_ids, wrap=args.wrap, rankdir=args.direction)
    else:
        out = to_mermaid(wv, ids=not args.no_ids, wrap=args.wrap, direction=args.direction)
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as f:
            f.write(out)
    else:
        sys.stdout.write(out)
    return EXIT_OK


def cmd_present(args) -> int:
    wv = _load(args.file)
    try:
        md = present(wv, args.id, given=_split_ids(args.given), depth=args.depth)
    except UnknownIdError as e:
        sys.stderr.write(f"error: {e}\n")
        return EXIT_USAGE
    if args.json:
        json.dump({"statement": args.id, "markdown": md}, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    elif args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as f:
            f.write(md)
    else:
        sys.stdout.write(md)
    return EXIT_OK


def cmd_stats(args) -> int:
    wv = _load(args.file)
    data = stats(wv)

    def text(d):
        print(f"statements: {d['statements']} ({d['modes']['is']} is, {d['modes']['ought']} ought)")
        print(f"arguments: {d['arguments']} (premises {d['premises']['min']}-{d['premises']['max']}, mean {d['premises']['mean']}; "
              f"conclusions {d['conclusions']['min']}-{d['conclusions']['max']}; {d['zero_premise_arguments']} with no premises)")
        print(f"foundations: {d['foundations']}   terminals: {d['terminals']}   unused: {d['unused']}   ungrounded: {d['ungrounded']}")
        print(f"cycles: {d['cycles']} (largest {d['largest_cycle']}, {d['statements_in_cycles']} statements in cycles)")
        print(f"longest chain of arguments: {d['longest_chain']}")
        if d["most_supporting"]:
            print("most supporting: " + ", ".join(f"{x['id']} ({x['downstream']})" for x in d["most_supporting"]))
        if d["most_supported"]:
            print("most supported: " + ", ".join(f"{x['id']} ({x['upstream']})" for x in d["most_supported"]))

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_merge(args) -> int:
    base, ours, theirs = _load(args.base), _load(args.ours), _load(args.theirs)
    data = merge(base, ours, theirs)
    conflicts = data["conflicts"]

    def text(d):
        s, a = d["summary"]["statements"], d["summary"]["arguments"]
        print(f"statements: {s['kept']} kept, {s['changed']} changed, {s['added_ours']}+{s['added_theirs']}+{s['added_both']} added (ours+theirs+both), {s['removed']} removed")
        print(f"arguments: {a['kept']} kept, {a['changed']} changed, {a['added_ours']}+{a['added_theirs']}+{a['added_both']} added, {a['removed']} removed")
        if conflicts:
            print(f"{len(conflicts)} conflict(s):")
            for c in conflicts:
                if c["kind"] == "dangling":
                    print(f"  dangling {c['id']}: references missing {', '.join(c['missing'])} ({c['resolution']})")
                else:
                    print(f"  {c['kind']} {c['id']}: changed on both sides ({c['resolution']})")
        else:
            print("no conflicts")

    _emit(data, args.json, text)
    if args.output and (not conflicts or args.force):
        with open(args.output, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data["merged"], f, indent=2, ensure_ascii=False)
            f.write("\n")
        if not args.json:
            print(f"wrote {args.output}")
    elif args.output:
        sys.stderr.write(f"not writing {args.output}: conflicts (use --force to write the ours-wins result)\n")
    return EXIT_INVALID if conflicts else EXIT_OK


def cmd_diff(args) -> int:
    a, b = _load(args.a), _load(args.b)
    data = diff(a, b)

    def text(d):
        s, g = d["statements"], d["arguments"]
        print(f"statements: {len(s['identical'])} identical, {len(s['rejustified'])} rejustified, "
              f"{len(s['added'])} added, {len(s['removed'])} removed")
        for x in s["rejustified"]:
            same = "" if x["a"] == x["b"] else f" (was {x['a']})"
            print(f"  ~ {x['b']}{same}: {x['text']}")
        for x in s["added"]:
            print(f"  + {x['id']}: {x['text']}")
        for x in s["removed"]:
            print(f"  - {x['id']}: {x['text']}")
        print(f"arguments: {len(g['identical'])} identical, {len(g['added'])} added, {len(g['removed'])} removed")
        for x in g["added"]:
            print(f"  + {x['id']}: {', '.join(x['premises']) or '(none)'} => {', '.join(x['conclusions'])}")
        for x in g["removed"]:
            print(f"  - {x['id']}: {', '.join(x['premises']) or '(none)'} => {', '.join(x['conclusions'])}")

    _emit(data, args.json, text)
    return EXIT_OK


def cmd_schema(args) -> int:
    json.dump(schema(), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return EXIT_OK


# ------------------------------------------------------------------ parser


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="worldview",
        description="Validate, inspect, and diff worldview-core files.",
    )
    p.add_argument("--version", action="version", version=f"worldview-core {__version__}")
    p.add_argument("--json", action="store_true", help="emit JSON instead of text")
    sub = p.add_subparsers(dest="command", required=True)

    def add(name, fn, help_, **kw):
        sp = sub.add_parser(name, help=help_, description=help_, **kw)
        sp.set_defaults(fn=fn)
        return sp

    sp = add("validate", cmd_validate, "Check a file against the schema and referential integrity.")
    sp.add_argument("file")
    sp.add_argument("--jsonschema", action="store_true", help="also run the jsonschema package, if installed")

    sp = add("ids", cmd_ids, "Emit prop_id, just_id, and arg_hash for every statement and argument.")
    sp.add_argument("file")

    sp = add("rests-on", cmd_rests_on, "What a statement rests on: upstream closure, per incoming argument.")
    sp.add_argument("file")
    sp.add_argument("id", help="statement id")
    sp.add_argument("--depth", type=int, default=None, help="max argument hops to expand")

    sp = add("supports", cmd_supports, "What a statement supports: downstream closure, per outgoing argument.")
    sp.add_argument("file")
    sp.add_argument("id", help="statement id")
    sp.add_argument("--depth", type=int, default=None, help="max argument hops to expand")

    sp = add("foundations", cmd_foundations, "Statements with no incoming argument.")
    sp.add_argument("file")

    sp = add("sccs", cmd_sccs, "Cyclic strongly connected components (size > 1 or self-loop).")
    sp.add_argument("file")

    sp = add("plan", cmd_plan, "What must be established to reach a statement, given what the audience accepts.")
    sp.add_argument("file")
    sp.add_argument("id", help="target statement id")
    sp.add_argument("--given", action="append", metavar="IDS", help="statement ids the audience already accepts (comma-separated; repeatable)")

    lint = add("lint", None, "Optional, informational checks.")
    lint_sub = lint.add_subparsers(dest="lint_command", required=True)
    for name, fn, help_ in (
        ("well-founded", cmd_lint_well_founded, "Statements not grounded in any foundation."),
        ("duplicates", cmd_lint_duplicates, "Statements that are the same proposition under different ids."),
        ("unused", cmd_lint_unused, "Statements that appear in no argument."),
        ("empty-justifications", cmd_lint_empty_justifications, "Arguments with a blank justification."),
        ("is-ought", cmd_lint_is_ought, "Arguments that conclude an ought from is premises alone (Hume's gap)."),
        ("all", cmd_lint_all, "Run every lint."),
    ):
        sp = lint_sub.add_parser(name, help=help_, description=help_)
        sp.set_defaults(fn=fn)
        sp.add_argument("file")

    sp = add("present", cmd_present, "Render the full case for a statement as Markdown.")
    sp.add_argument("file")
    sp.add_argument("id", help="statement id")
    sp.add_argument("--given", action="append", metavar="IDS", help="statement ids the audience already accepts (comma-separated; repeatable)")
    sp.add_argument("--depth", type=int, default=None, help="max argument hops to expand (ignored with --given)")
    sp.add_argument("-o", "--output", help="write Markdown to this file")

    sp = add("stats", cmd_stats, "Descriptive statistics of the hypergraph.")
    sp.add_argument("file")

    sp = add("diff", cmd_diff, "Match statements and arguments across two files by identity.")
    sp.add_argument("a")
    sp.add_argument("b")

    sp = add("merge", cmd_merge, "Three-way merge: combine two lines of edits from a common base. Exit 1 on conflicts.")
    sp.add_argument("base")
    sp.add_argument("ours")
    sp.add_argument("theirs")
    sp.add_argument("-o", "--output", help="write the merged worldview here (only if conflict-free, or with --force)")
    sp.add_argument("--force", action="store_true", help="write the output even with conflicts (ours wins)")

    sp = add("export", cmd_export, "Export the hypergraph as Graphviz DOT or Mermaid.")
    sp.add_argument("file")
    sp.add_argument("--format", choices=["dot", "mermaid"], default="dot")
    sp.add_argument("-o", "--output", help="write to this file instead of stdout")
    sp.add_argument("--no-ids", action="store_true", help="omit local ids from labels")
    sp.add_argument("--wrap", type=int, default=36, help="wrap statement text at this many characters")
    sp.add_argument("--direction", default="LR", help="layout direction: LR, TB, RL, BT")

    add("schema", cmd_schema, "Print the JSON Schema for the format.")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
