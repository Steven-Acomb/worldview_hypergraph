"""plan, extra lints, and export."""

from __future__ import annotations

import json

import pytest

from worldview_core import (
    UnknownIdError,
    duplicates,
    empty_justifications,
    lint_all,
    load,
    plan,
    rests_on,
    to_dot,
    to_mermaid,
    unused,
)
from worldview_core.cli import main

from conftest import A, S, chain_doc, cycle_doc, doc, write, wv

# --------------------------------------------------------------------- plan


def test_plan_nothing_given(chain):
    p = plan(wv(chain), "e")
    assert [s["id"] for s in p["must_grant"]] == ["a", "b", "d", "f"]
    assert [(s["id"], s["via"]) for s in p["must_establish"]] == [("c", ["ab-c"]), ("e", ["cd-e", "f-e"])]
    assert p["given"] == []
    assert p["arguments"] == ["ab-c", "cd-e", "f-e"]
    # with nothing given the tree is exactly the rests-on tree
    assert p["tree"] == rests_on(wv(chain), "e")["tree"]


def test_plan_stops_at_given(chain):
    p = plan(wv(chain), "e", given=["c"])
    assert p["given"] == ["c"]
    assert [s["id"] for s in p["must_grant"]] == ["d", "f"]
    assert [s["id"] for s in p["must_establish"]] == [("e")]
    assert p["arguments"] == ["cd-e", "f-e"]  # ab-c is behind the given statement
    c = p["tree"]["arguments"][0]["premises"][0]
    assert c == {"statement": "c", "text": "C", "given": True}


def test_plan_target_given(chain):
    p = plan(wv(chain), "e", given=["e", "a"])
    assert p["must_establish"] == [] and p["must_grant"] == []
    assert p["tree"] == {"statement": "e", "text": "E", "given": True}


def test_plan_foundation_target(chain):
    p = plan(wv(chain), "a")
    assert [s["id"] for s in p["must_grant"]] == ["a"]
    assert p["must_establish"] == []


def test_plan_given_not_in_closure_is_not_listed(chain):
    p = plan(wv(chain), "c", given=["f"])
    assert p["given"] == []
    assert [s["id"] for s in p["must_grant"]] == ["a", "b"]


def test_plan_cycle(cycle):
    p = plan(wv(cycle), "q", given=["x"])
    # x is given, so the walk stops there: y and z still need establishing, p is never reached
    assert p["given"] == ["x"]
    assert [s["id"] for s in p["must_establish"]] == ["y", "z", "q"]
    assert p["must_grant"] == []
    assert p["sccs"] == [["x", "y", "z"]]


def test_plan_zero_premise_argument():
    d = doc([S("a", "A"), S("b", "B")], [A("given", [], ["a"], "stipulated"), A("a-b", ["a"], ["b"])])
    p = plan(wv(d), "b")
    assert p["must_grant"] == []
    assert [(s["id"], s["via"]) for s in p["must_establish"]] == [("a", ["given"]), ("b", ["a-b"])]


def test_plan_unknown_ids(chain):
    with pytest.raises(UnknownIdError):
        plan(wv(chain), "nope")
    with pytest.raises(UnknownIdError):
        plan(wv(chain), "e", given=["nope"])


def test_plan_example(example_path):
    w = load(example_path)
    p = plan(w, "need-raincoat", given=["walk-commute"])
    assert [s["id"] for s in p["must_grant"]] == ["rain-often", "rain-unpleasant"]
    assert [s["id"] for s in p["must_establish"]] == ["need-raincoat"]
    assert p["sccs"] == []


# -------------------------------------------------------------------- lints


def test_duplicates():
    d = doc([S("x1", "X"), S("x2", " X "), S("y", "Y"), S("x3", "X", "ought")], [])
    out = duplicates(wv(d))
    assert out == [{"prop_id": out[0]["prop_id"], "text": "X", "mode": "is", "ids": ["x1", "x2"]}]


def test_unused(chain):
    d = chain_doc()
    d["statements"].append(S("lonely", "Nobody mentions me"))
    assert unused(wv(d)) == ["lonely"]
    assert unused(wv(chain)) == []


def test_empty_justifications():
    d = doc([S("a", "A"), S("b", "B")], [A("x", ["a"], ["b"], "  \n "), A("y", ["a"], ["b"], "real")])
    assert empty_justifications(wv(d)) == ["x"]


def test_lint_all(cycle):
    out = lint_all(wv(cycle))
    assert set(out) == {"well_founded", "duplicates", "unused", "empty_justifications", "is_ought_gaps"}
    assert out["well_founded"]["ungrounded"] == []


# ------------------------------------------------------------------- export


def test_dot(example_path):
    w = load(example_path)
    dot = to_dot(w)
    assert dot.startswith("digraph worldview {")
    assert dot.count("shape=box") == 12
    assert dot.count("shape=diamond") == 6
    assert "peripheries=2" in dot  # an ought statement
    assert "->" in dot and dot.rstrip().endswith("}")
    # edges: one per premise and one per conclusion
    n_edges = sum(len(a.premises) + len(a.conclusions) for a in w.arguments)
    assert dot.count("->") == n_edges


def test_dot_escapes_quotes():
    d = doc([S("q", 'He said "hi" \\ bye')], [])
    dot = to_dot(wv(d))
    assert '\\"hi\\"' in dot and "\\\\" in dot


def test_mermaid(example_path):
    w = load(example_path)
    m = to_mermaid(w)
    assert m.startswith("flowchart LR")
    assert m.count("-->") == sum(len(a.premises) + len(a.conclusions) for a in w.arguments)
    assert "class " in m and "ought" in m
    assert '{{"walk-for-health<br/>practical syllogism"}}' in m


def test_mermaid_no_ids_and_quotes():
    d = doc([S("q", 'Say "hi"')], [A("a", [], ["q"], "j")])
    m = to_mermaid(wv(d), ids=False)
    assert "#quot;hi#quot;" in m
    assert '{{" "}}' in m  # empty argument label


# ---------------------------------------------------------------------- CLI


def run(capsys, *argv):
    try:
        code = main(list(argv))
    except SystemExit as e:
        code = e.code
    out, err = capsys.readouterr()
    return code, out, err


def test_cli_plan(capsys, example_path):
    code, out, _ = run(capsys, "plan", str(example_path), "need-raincoat", "--given", "walk-commute,rain-often")
    assert code == 0 and "must grant" in out and "rain-unpleasant" in out and "rain-often" not in out.split("must grant")[1].split("must be")[0]
    code, out, _ = run(capsys, "--json", "plan", str(example_path), "need-raincoat", "--given", "walk-commute", "--given", "rain-often")
    data = json.loads(out)
    assert data["given"] == ["walk-commute", "rain-often"]
    code, _, err = run(capsys, "plan", str(example_path), "need-raincoat", "--given", "nope")
    assert code == 2 and "nope" in err


def test_cli_lints(capsys, tmp_path):
    d = chain_doc()
    d["statements"].append(S("dup", "A"))
    d["statements"].append(S("lonely", "L"))
    d["arguments"][0]["justification"] = ""
    p = write(tmp_path, "l.json", d)
    code, out, _ = run(capsys, "lint", "duplicates", str(p))
    assert code == 0 and "a, dup" in out
    code, out, _ = run(capsys, "lint", "unused", str(p))
    assert code == 0 and "lonely" in out and "dup" in out
    code, out, _ = run(capsys, "lint", "empty-justifications", str(p))
    assert code == 0 and "ab-c" in out
    code, out, _ = run(capsys, "--json", "lint", "all", str(p))
    data = json.loads(out)
    assert data["unused"] == ["dup", "lonely"] and data["empty_justifications"] == ["ab-c"]
    code, out, _ = run(capsys, "lint", "all", str(p))
    assert code == 0 and "duplicates: 1 group(s)" in out


def test_cli_export(capsys, example_path, tmp_path):
    code, out, _ = run(capsys, "export", str(example_path))
    assert code == 0 and out.startswith("digraph")
    code, out, _ = run(capsys, "export", str(example_path), "--format", "mermaid", "--no-ids", "--direction", "TB")
    assert code == 0 and out.startswith("flowchart TB") and "walk-for-health" not in out
    target = tmp_path / "g.dot"
    code, out, _ = run(capsys, "export", str(example_path), "-o", str(target))
    assert code == 0 and out == "" and target.read_text(encoding="utf-8").startswith("digraph")
