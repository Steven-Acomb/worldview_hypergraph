"""Generate the conformance vectors from the Python reference implementation.

Usage (from the repo root, with the package installed):

    python conformance/generate.py

Writes ``conformance/vectors/*.json``.  Every other implementation of
worldview-core (the TypeScript SDK, for one) must reproduce these files
byte-for-byte in meaning: same hashes, same query results, same diff
buckets.  The Python test suite also replays them, so a change in the
reference implementation that alters any hash is caught immediately.

Vector kinds
------------

``primitives.json``
    ``canon`` and ``H`` input/output pairs.

``cases/<name>.json``
    One worldview (``input``) plus everything the library computes from
    it (``expected``): validity, identities, foundations, sccs,
    well-founded lint, and ``rests_on`` / ``supports`` for every
    statement (full depth and depth 1).

``invalid/<name>.json``
    Documents that must be rejected.  Only ``valid: false`` is asserted;
    the problem messages are implementation-specific.

``diffs/<name>.json``
    Pairs of case names and the expected diff between them.

``extras/<name>.json``
    Later additions kept separate so that older ports keep passing the
    core vectors: ``plan`` with several ``given`` sets, the extra lints,
    and the DOT and Mermaid exports.
"""

from __future__ import annotations

import json
import random
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from worldview_core import (  # noqa: E402
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
    rests_on,
    sccs,
    stats,
    supports,
    to_dot,
    to_mermaid,
    validate_dict,
    well_founded,
)

OUT = Path(__file__).resolve().parent / "vectors"


# --------------------------------------------------------------- builders


def S(id_, text, mode="is", **extra):
    return {"id": id_, "text": text, "mode": mode, **extra}


def A(id_, premises, conclusions, justification="because", **extra):
    return {"id": id_, "premises": list(premises), "conclusions": list(conclusions), "justification": justification, **extra}


def doc(statements, arguments, **header):
    return {"format": "worldview-core", "version": "0.1", **header, "statements": statements, "arguments": arguments}


def chain():
    return doc(
        [S("a", "A"), S("b", "B"), S("c", "C"), S("d", "D"), S("e", "E", "ought"), S("f", "F")],
        [
            A("ab-c", ["a", "b"], ["c"], "a and b give c"),
            A("cd-e", ["c", "d"], ["e"], "c and d give e"),
            A("f-e", ["f"], ["e"], "f alone gives e"),
        ],
        name="chain",
    )


def chain_edited_leaf():
    d = chain()
    d["statements"][0]["text"] = "A (edited)"
    return d


def chain_renamed():
    d = chain()
    ren = {"a": "alpha", "c": "gamma", "e": "epsilon"}
    for s in d["statements"]:
        s["id"] = ren.get(s["id"], s["id"])
    for a in d["arguments"]:
        a["id"] = "arg-" + a["id"]
        a["premises"] = [ren.get(p, p) for p in a["premises"]]
        a["conclusions"] = [ren.get(c, c) for c in a["conclusions"]]
    d["statements"].reverse()
    d["arguments"].reverse()
    return d


def chain_plus():
    d = chain()
    d["statements"].append(S("g", "G"))
    d["arguments"].append(A("g-e", ["g"], ["e"], "g gives e"))
    d["statements"] = [s for s in d["statements"] if s["id"] != "f"]
    d["arguments"] = [a for a in d["arguments"] if a["id"] != "f-e"]
    return d


def cycle():
    return doc(
        [S("p", "P"), S("x", "X"), S("y", "Y"), S("z", "Z"), S("q", "Q")],
        [
            A("p-x", ["p"], ["x"], "p gives x"),
            A("x-y", ["x"], ["y"], "x gives y"),
            A("y-z", ["y"], ["z"], "y gives z"),
            A("z-x", ["z"], ["x"], "z gives x"),
            A("z-q", ["z"], ["q"], "z gives q"),
        ],
        name="cycle",
    )


def cycle_edited_member():
    d = cycle()
    d["statements"][2]["text"] = "Y (edited)"
    return d


def cycle_edited_downstream():
    d = cycle()
    d["statements"][4]["text"] = "Q (edited)"
    return d


def self_loop():
    return doc(
        [S("a", "A"), S("b", "B")],
        [A("loop", ["a"], ["a"], "a supports itself"), A("a-b", ["a"], ["b"], "a gives b")],
    )


def zero_premise():
    return doc([S("a", "A"), S("b", "B")], [A("given", [], ["a"], "stipulated"), A("a-b", ["a"], ["b"], "j")])


def joint_conclusions():
    return doc(
        [S("a", "A"), S("b", "B"), S("c", "C"), S("d", "D")],
        [A("x", ["a"], ["b", "c"], "j"), A("y", ["b", "c"], ["d"], "k")],
    )


def two_cycles():
    # Two separate cycles, one feeding the other, plus a self-loop inside the second.
    return doc(
        [S("a", "A"), S("b", "B"), S("c", "C"), S("d", "D"), S("e", "E"), S("root", "Root")],
        [
            A("r-a", ["root"], ["a"]),
            A("a-b", ["a"], ["b"]),
            A("b-a", ["b"], ["a"]),
            A("b-c", ["b"], ["c"]),
            A("c-d", ["c"], ["d"]),
            A("d-c", ["d"], ["c"]),
            A("d-d", ["d"], ["d"], "d on its own"),
            A("cd-e", ["c", "d"], ["e"]),
        ],
    )


def pure_cycle():
    return doc(
        [S("x", "X"), S("y", "Y"), S("q", "Q")],
        [A("x-y", ["x"], ["y"]), A("y-x", ["y"], ["x"]), A("y-q", ["y"], ["q"])],
    )


def unicode_and_whitespace():
    return doc(
        [
            S("nfc", "café au lait"),  # precomposed e-acute
            S("nfd", "café au lait"),  # decomposed: same proposition as nfc
            S("ws", "  Il   pleut\tsouvent\n ici  "),
            S("ws2", "Il pleut souvent ici"),
            S("case", "Il Pleut Souvent Ici"),  # different: no case folding
            S("ought", "Il pleut souvent ici", "ought"),  # different: mode
            S("emoji", "Snow ☃ is cold \U0001F976"),
            S("c", "Conclusion"),
        ],
        [
            A("j1", ["nfc", "ws"], ["c"], "  spaced\n\n justification  "),
            A("j2", ["nfd", "ws2"], ["c"], "spaced justification"),  # identical argument to j1
        ],
        meta={"note": "meta is ignored"},
        ext={"bayes": {"ignored": True}},
    )


def duplicate_props():
    return doc([S("x1", "X"), S("x2", "X"), S("y", "Y")], [A("a", ["x1"], ["y"]), A("b", ["x2"], ["y"])])


def duplicate_props_single():
    return doc([S("x", "X"), S("y", "Y")], [A("a", ["x"], ["y"])])


def empty():
    return doc([], [])


def with_meta_ext():
    d = chain()
    d["meta"] = {"author": "someone"}
    d["ext"] = {"defeasible": {"semantics": "grounded"}}
    d["statements"][0]["meta"] = {"role": "axiom"}
    d["statements"][0]["ext"] = {"bayes": {"prior": 0.3}}
    d["arguments"][0]["rule"] = "modus ponens"
    d["arguments"][0]["meta"] = {"n": 1}
    d["arguments"][0]["ext"] = {"defeasible": {"kind": "inductive"}}
    return d


def random_graph(seed: int, n_statements: int, n_arguments: int):
    rng = random.Random(seed)
    words = ["rain", "roads", "wet", "slippery", "drive", "slowly", "late", "coffee", "cold", "night", "stars", "visible"]
    stmts = []
    for i in range(n_statements):
        text = " ".join(rng.choice(words) for _ in range(rng.randint(2, 6))).capitalize() + rng.choice([".", "", "!"])
        stmts.append(S(f"s{i}", text, rng.choice(["is", "is", "ought"])))
    ids = [s["id"] for s in stmts]
    args = []
    for i in range(n_arguments):
        k = rng.choice([0, 1, 1, 2, 2, 3])
        prem = rng.sample(ids, k)
        m = rng.choice([1, 1, 1, 2])
        conc = rng.sample(ids, m)
        args.append(A(f"a{i}", prem, conc, f"justification {rng.randint(0, 5)}"))
    return doc(stmts, args, name=f"random-{seed}")


CASES = {
    "empty": empty,
    "chain": chain,
    "chain-edited-leaf": chain_edited_leaf,
    "chain-renamed": chain_renamed,
    "chain-plus": chain_plus,
    "cycle": cycle,
    "cycle-edited-member": cycle_edited_member,
    "cycle-edited-downstream": cycle_edited_downstream,
    "self-loop": self_loop,
    "zero-premise": zero_premise,
    "joint-conclusions": joint_conclusions,
    "two-cycles": two_cycles,
    "pure-cycle": pure_cycle,
    "unicode-and-whitespace": unicode_and_whitespace,
    "duplicate-props": duplicate_props,
    "duplicate-props-single": duplicate_props_single,
    "with-meta-ext": with_meta_ext,
    "random-1": lambda: random_graph(1, 12, 10),
    "random-2": lambda: random_graph(2, 25, 30),
    "random-3": lambda: random_graph(3, 40, 60),
}

EXAMPLE_FILES = ["walking-to-work", "walking-to-work-fork"]

DIFFS = [
    ("chain", "chain"),
    ("chain", "chain-edited-leaf"),
    ("chain", "chain-renamed"),
    ("chain", "chain-plus"),
    ("chain", "with-meta-ext"),
    ("cycle", "cycle-edited-member"),
    ("cycle", "cycle-edited-downstream"),
    ("cycle", "pure-cycle"),
    ("duplicate-props", "duplicate-props-single"),
    ("empty", "chain"),
    ("random-2", "random-3"),
    ("walking-to-work", "walking-to-work-fork"),
]


def invalid_cases():
    import copy

    def bad(mutate, base=None):
        d = copy.deepcopy(base or chain())
        mutate(d)
        return d

    return {
        "not-an-object": [],
        "wrong-format": bad(lambda d: d.update(format="other")),
        "missing-format": bad(lambda d: d.pop("format")),
        "bad-version": bad(lambda d: d.update(version="v1")),
        "unknown-top-field": bad(lambda d: d.update(credence=0.5)),
        "meta-not-object": bad(lambda d: d.update(meta="notes")),
        "ext-not-object": bad(lambda d: d.update(ext=[])),
        "ext-namespace-not-object": bad(lambda d: d.update(ext={"bayes": 1})),
        "statements-not-array": bad(lambda d: d.update(statements={})),
        "statement-missing-text": bad(lambda d: d["statements"][0].pop("text")),
        "statement-empty-text": bad(lambda d: d["statements"][0].update(text="")),
        "statement-bad-mode": bad(lambda d: d["statements"][0].update(mode="maybe")),
        "statement-missing-mode": bad(lambda d: d["statements"][0].pop("mode")),
        "statement-unknown-field": bad(lambda d: d["statements"][0].update(weight=1)),
        "statement-id-whitespace": bad(lambda d: d["statements"][0].update(id="a b")),
        "statement-id-empty": bad(lambda d: d["statements"][0].update(id="")),
        "argument-missing-justification": bad(lambda d: d["arguments"][0].pop("justification")),
        "argument-no-conclusions": bad(lambda d: d["arguments"][0].update(conclusions=[])),
        "argument-missing-premises": bad(lambda d: d["arguments"][0].pop("premises")),
        "argument-duplicate-premise": bad(lambda d: d["arguments"][0].update(premises=["a", "a"])),
        "argument-premise-not-string": bad(lambda d: d["arguments"][0].update(premises=[1])),
        "argument-rule-not-string": bad(lambda d: d["arguments"][0].update(rule=3)),
        "argument-unknown-field": bad(lambda d: d["arguments"][0].update(strength=0.9)),
        "duplicate-statement-id": bad(lambda d: d["statements"].append(S("a", "again"))),
        "duplicate-argument-id": bad(lambda d: d["arguments"].append(A("ab-c", ["a"], ["c"]))),
        "unknown-premise": bad(lambda d: d["arguments"][0].update(premises=["a", "nope"])),
        "unknown-conclusion": bad(lambda d: d["arguments"][0].update(conclusions=["nope"])),
    }


PRIMITIVES = {
    "canon": [
        "",
        "   ",
        "plain",
        "  leading and trailing  ",
        "multiple   internal\u0009\u0009spaces\u000aand\u000d\u000anewlines",
        "caf\u00e9",
        "cafe\u0301",
        "Hello, World!",
        "HELLO",
        "\u00a0nbsp\u00a0wrapped\u00a0",
        "\u3000ideographic space\u3000",
        "tab\u0009sep",
        "\ufb01 ligature stays",  # NFC does not decompose compatibility characters
        "Snow \u2603 \U0001f976",
        "\u001c\u001dseparators\u001e\u001f are whitespace",
        "next\u0085line",
        "\ufeffBOM is not whitespace\ufeff",
        "zero\u200bwidth space is not whitespace",
        "\u2028line\u2029paragraph",
        "\u00c5 (decomposed) vs \u00c5 (precomposed) vs \u00c5 (angstrom sign)",
        "\u314f hangul: \uac01 vs \uac01",
    ],
    "H": [
        [],
        [""],
        ["a"],
        ["a", "b"],
        ["ab"],
        ["a", ["b", "c"]],
        ["a", "b", "c"],
        [["a"], ["b"]],
        [["a", "b"]],
        [[]],
        ["prop", "Regular physical activity improves long-term health.", "is"],
        ["é", ["☃"]],
    ],
}


# --------------------------------------------------------------- expected


def expected_for(data, name):
    wv = Worldview.from_dict(data, source=name)
    ids = compute_identities(wv)
    all_ids = wv.statement_ids()
    # Full trees for every statement on small graphs; a sample on large ones
    # (the full trees of a 40-node random graph run to megabytes).
    probe = all_ids if len(all_ids) <= 15 else all_ids[:4] + all_ids[-3:]
    return {
        "valid": True,
        "ids": ids.to_dict(),
        "foundations": foundations(wv),
        "sccs": sccs(wv),
        "well_founded": well_founded(wv),
        "rests_on": {sid: rests_on(wv, sid) for sid in probe},
        "supports": {sid: supports(wv, sid) for sid in probe},
        "rests_on_depth_1": {sid: rests_on(wv, sid, depth=1) for sid in all_ids},
        "supports_depth_1": {sid: supports(wv, sid, depth=1) for sid in all_ids},
    }


def extras_for(data, name):
    wv = Worldview.from_dict(data, source=name)
    all_ids = wv.statement_ids()
    probe = all_ids if len(all_ids) <= 15 else all_ids[:2] + all_ids[-1:]
    founds = [f["id"] for f in foundations(wv)]
    plans = {}
    for sid in probe:
        closure = rests_on(wv, sid)["closure"]["statements"]
        mids = [s for s in closure if s not in founds]
        given_sets = [[], founds[:2], mids[:1], [sid], closure[:3]]
        plans[sid] = [{"given": g, "result": plan(wv, sid, g)} for g in given_sets]
    presents = {}
    for sid in probe[:3]:
        presents[sid] = {
            "plain": present(wv, sid),
            "depth_1": present(wv, sid, depth=1),
            "given": {"given": founds[:1], "markdown": present(wv, sid, given=founds[:1])},
        }
    return {
        "plan": plans,
        "lint_all": lint_all(wv),
        "stats": stats(wv),
        "present": presents,
        "dot": to_dot(wv),
        "dot_no_ids_tb": to_dot(wv, ids=False, wrap=20, rankdir="TB"),
        "mermaid": to_mermaid(wv),
        "mermaid_no_ids_tb": to_mermaid(wv, ids=False, wrap=20, direction="TB"),
    }


MERGES = [
    ("chain", "chain-edited-leaf", "chain-plus"),
    ("chain", "chain-renamed", "chain-plus"),
    ("chain", "chain-edited-leaf", "chain-edited-leaf"),
    ("chain", "with-meta-ext", "chain-edited-leaf"),
    ("cycle", "cycle-edited-member", "cycle-edited-downstream"),
    ("walking-to-work", "walking-to-work-fork", "walking-to-work"),
    ("walking-to-work", "walking-to-work-fork", "walking-to-work-fork"),
    ("empty", "chain", "cycle"),
]


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)

    inputs = {}
    for name, make in CASES.items():
        inputs[name] = make()
    for name in EXAMPLE_FILES:
        inputs[name] = json.loads((ROOT / "examples" / f"{name}.json").read_text(encoding="utf-8"))

    for name, data in inputs.items():
        problems = validate_dict(data)
        assert not problems, (name, problems)
        dump(OUT / "cases" / f"{name}.json", {"name": name, "input": data, "expected": expected_for(data, name)})
        dump(OUT / "extras" / f"{name}.json", {"name": name, "expected": extras_for(data, name)})

    for name, data in invalid_cases().items():
        assert validate_dict(data), name
        dump(OUT / "invalid" / f"{name}.json", {"name": name, "input": data, "expected": {"valid": False}})

    for a, b in DIFFS:
        wa = Worldview.from_dict(inputs[a], source=a)
        wb = Worldview.from_dict(inputs[b], source=b)
        dump(OUT / "diffs" / f"{a}--{b}.json", {"a": a, "b": b, "expected": diff(wa, wb)})

    for base, ours, theirs in MERGES:
        wb_, wo, wt = (Worldview.from_dict(inputs[n], source=n) for n in (base, ours, theirs))
        dump(OUT / "merges" / f"{base}--{ours}--{theirs}.json",
             {"base": base, "ours": ours, "theirs": theirs, "expected": merge(wb_, wo, wt)})

    prims = {
        "canon": [{"input": t, "output": canon(t)} for t in PRIMITIVES["canon"]],
        "H": [{"parts": parts, "output": H(*parts)} for parts in PRIMITIVES["H"]],
    }
    dump(OUT / "primitives.json", prims)

    n = 2 * len(inputs) + len(invalid_cases()) + len(DIFFS) + len(MERGES)
    print(f"wrote {n} vector files + primitives to {OUT}")


if __name__ == "__main__":
    main()
