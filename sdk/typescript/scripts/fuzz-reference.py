"""Reference oracle for scripts/fuzz.mjs: run the Python implementation on a batch of jobs.

Reads a JSON array of jobs from stdin and writes a JSON array of results to
stdout, one per job, in order.  Each job is an object with any of:

    {"canon": ["text", ...]}                 -> {"canon": [...], "prop_is": [...]}
    {"H": [[part, ...], ...]}                -> {"H": [...]}
    {"wrap": [[text, width], ...]}           -> {"wrap": [[line, ...], ...]}  (textwrap.wrap)
    {"validate": [doc, ...]}                 -> {"validate": [bool, ...]}
    {"doc": doc, "depths": [null, 0, 1, ...], "probe": [sid, ...] | null,
     "other": doc | null, "plans": [[sid, [given, ...]], ...],
     "presents": [[sid, given, depth], ...], "exports": [[ids, wrap, direction], ...],
     "variants": [doc, ...], "merges": [[i, j], ...]}
                                             -> everything the library computes
                                                (see ``analyse`` below)

Statement-keyed results are emitted as ``[[sid, value], ...]`` pairs rather
than objects so that ids such as ``__proto__`` cannot collide with anything
on the JavaScript side.  Nothing here is part of the SDK; it exists only so
that ``npm run fuzz`` can compare the two implementations on random input.
"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))

from worldview_core import (  # noqa: E402
    Graph,
    H,
    Worldview,
    canon,
    compute_identities,
    diff,
    foundations,
    lint_all,
    merge,
    plan,
    present,
    prop_id,
    rests_on,
    sccs,
    stats,
    supports,
    to_dot,
    to_mermaid,
    validate_dict,
    well_founded,
)


def analyse(job: dict) -> dict:
    doc = job["doc"]
    problems = validate_dict(doc)
    out: dict = {"valid": not problems, "problems": len(problems)}
    if problems:
        return out
    wv = Worldview.from_dict(doc, source=job.get("source"))
    g = Graph.build(wv)
    ids = compute_identities(wv, g)
    all_ids = wv.statement_ids()
    probe = job.get("probe") or all_ids
    out["ids"] = ids.to_dict()
    out["all_sccs"] = g.sccs()
    out["foundations"] = foundations(wv, g)
    out["sccs"] = sccs(wv, g)
    out["well_founded"] = well_founded(wv, g)
    out["rests_on"] = []
    out["supports"] = []
    for depth in job.get("depths", [None]):
        targets = all_ids if depth is None else probe
        out["rests_on"].append([depth, [[sid, rests_on(wv, sid, depth=depth, graph=g)] for sid in targets]])
        out["supports"].append([depth, [[sid, supports(wv, sid, depth=depth, graph=g)] for sid in targets]])
    out["diff_self"] = diff(wv, wv, ids, ids)
    other = job.get("other")
    if other is not None:
        other_problems = validate_dict(other)
        out["other_valid"] = not other_problems
        if not other_problems:
            wo = Worldview.from_dict(other, source=job.get("other_source"))
            out["diff_ab"] = diff(wv, wo, ids)
            out["diff_ba"] = diff(wo, wv, None, ids)
    # Later additions: plan, lints, stats, present, export, merge.
    out["plan"] = [[sid, [[given, plan(wv, sid, given, graph=g)] for given in givens]] for sid, givens in job.get("plans", [])]
    out["lint_all"] = lint_all(wv)
    out["stats"] = stats(wv, g)
    out["present"] = [
        [sid, given, depth, present(wv, sid, given=given, depth=depth, graph=g)] for sid, given, depth in job.get("presents", [])
    ]
    out["export"] = []
    for ids_, wrap, direction in job.get("exports", []):
        try:
            dot = to_dot(wv, ids=ids_, wrap=wrap, rankdir=direction)
        except ValueError:
            dot = None
        try:
            mermaid = to_mermaid(wv, ids=ids_, wrap=wrap, direction=direction)
        except ValueError:
            mermaid = None
        out["export"].append([ids_, wrap, direction, dot, mermaid])
    variants = job.get("variants") or []
    out["variants_valid"] = [not validate_dict(v) for v in variants]
    out["merge"] = []
    for i, j in job.get("merges", []):
        if out["variants_valid"][i] and out["variants_valid"][j]:
            vi = Worldview.from_dict(variants[i], source=f"v{i}")
            vj = Worldview.from_dict(variants[j], source=f"v{j}")
            out["merge"].append([i, j, merge(wv, vi, vj)])
        else:
            out["merge"].append([i, j, None])
    return out


def run(job: dict) -> dict:
    result: dict = {}
    if "canon" in job:
        result["canon"] = [canon(t) for t in job["canon"]]
        result["prop_is"] = [prop_id(t, "is") for t in job["canon"]]
    if "H" in job:
        result["H"] = [H(*parts) for parts in job["H"]]
    if "wrap" in job:
        result["wrap"] = [textwrap.wrap(text, width=width) for text, width in job["wrap"]]
    if "validate" in job:
        result["validate"] = [not validate_dict(d) for d in job["validate"]]
    if "doc" in job:
        result.update(analyse(job))
    return result


def main() -> None:
    sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    jobs = json.load(sys.stdin)
    results = [run(job) for job in jobs]
    json.dump(results, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
