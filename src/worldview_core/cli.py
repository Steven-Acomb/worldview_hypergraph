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
from .identity import compute_identities
from .model import Worldview, load, read_json
from .queries import foundations, rests_on, sccs, supports, well_founded
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

    lint = add("lint", None, "Optional, informational checks.")
    lint_sub = lint.add_subparsers(dest="lint_command", required=True)
    sp = lint_sub.add_parser("well-founded", help="Statements not grounded in any foundation.")
    sp.set_defaults(fn=cmd_lint_well_founded)
    sp.add_argument("file")

    sp = add("diff", cmd_diff, "Match statements and arguments across two files by identity.")
    sp.add_argument("a")
    sp.add_argument("b")

    add("schema", cmd_schema, "Print the JSON Schema for the format.")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
