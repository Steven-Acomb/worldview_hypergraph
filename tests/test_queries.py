"""Milestone 3: structural queries."""

from __future__ import annotations

import pytest

from worldview_core import Graph, UnknownIdError, foundations, load, rests_on, sccs, supports, well_founded

from conftest import A, S, chain_doc, cycle_doc, doc, wv


def test_foundations_chain(chain):
    assert [f["id"] for f in foundations(wv(chain))] == ["a", "b", "d", "f"]


def test_foundations_cycle(cycle):
    assert [f["id"] for f in foundations(wv(cycle))] == ["p"]


def test_zero_premise_argument_conclusion_is_not_a_foundation():
    d = doc([S("a", "A")], [A("given", [], ["a"], "stipulated")])
    assert foundations(wv(d)) == []


def test_sccs_none_in_chain(chain):
    assert sccs(wv(chain)) == []


def test_sccs_cycle(cycle):
    out = sccs(wv(cycle))
    assert out == [
        {
            "members": ["x", "y", "z"],
            "self_loops": [],
            "internal_arguments": ["x-y", "y-z", "z-x"],
            "boundary_arguments": ["p-x", "z-q"],
        }
    ]


def test_sccs_self_loop():
    d = doc([S("a", "A")], [A("loop", ["a"], ["a"], "self")])
    assert sccs(wv(d)) == [
        {"members": ["a"], "self_loops": ["a"], "internal_arguments": ["loop"], "boundary_arguments": []}
    ]


def test_graph_scc_topological_order(cycle):
    g = Graph.build(wv(cycle))
    assert g.sccs() == [["p"], ["x", "y", "z"], ["q"]]


# ----------------------------------------------------------- rests-on


def test_rests_on_reports_per_argument(chain):
    r = rests_on(wv(chain), "e")
    assert r["closure"]["statements"] == ["a", "b", "c", "d", "f"]
    assert r["closure"]["arguments"] == ["ab-c", "cd-e", "f-e"]
    assert r["sccs"] == []
    t = r["tree"]
    assert [a["argument"] for a in t["arguments"]] == ["cd-e", "f-e"]
    via_cd = t["arguments"][0]
    assert [p["statement"] for p in via_cd["premises"]] == ["c", "d"]
    c = via_cd["premises"][0]
    assert c["arguments"][0]["argument"] == "ab-c"
    assert [p["statement"] for p in c["arguments"][0]["premises"]] == ["a", "b"]
    assert c["arguments"][0]["premises"][0]["arguments"] == []  # foundation
    assert via_cd["premises"][1]["arguments"] == []  # d is a foundation


def test_rests_on_foundation(chain):
    r = rests_on(wv(chain), "a")
    assert r["closure"] == {"statements": [], "arguments": []}
    assert r["tree"]["arguments"] == []


def test_rests_on_shared_premise_is_expanded_once():
    d = doc(
        [S("a", "A"), S("b", "B"), S("c", "C"), S("d", "D")],
        [A("a-b", ["a"], ["b"]), A("a-c", ["a"], ["c"]), A("bc-d", ["b", "c"], ["d"])],
    )
    r = rests_on(wv(d), "d")
    prem = r["tree"]["arguments"][0]["premises"]
    a_first = prem[0]["arguments"][0]["premises"][0]
    a_second = prem[1]["arguments"][0]["premises"][0]
    assert a_first["statement"] == "a" and "seen" not in a_first
    assert a_second["statement"] == "a" and a_second["seen"] is True


def test_rests_on_cycle_terminates_and_reports_scc(cycle):
    r = rests_on(wv(cycle), "q")
    assert r["closure"]["statements"] == ["p", "x", "y", "z"]
    assert r["sccs"] == [["x", "y", "z"]]
    z = r["tree"]["arguments"][0]["premises"][0]
    assert z["statement"] == "z" and z["scc"] == ["x", "y", "z"]
    # walk z <- y <- x <- {p, z(seen)}
    y = z["arguments"][0]["premises"][0]
    x = y["arguments"][0]["premises"][0]
    incoming = {a["argument"]: a for a in x["arguments"]}
    assert set(incoming) == {"p-x", "z-x"}
    assert incoming["z-x"]["premises"][0] == {"statement": "z", "text": "Z", "scc": ["x", "y", "z"], "seen": True}


def test_rests_on_member_of_cycle_includes_itself_in_closure(cycle):
    r = rests_on(wv(cycle), "x")
    assert r["closure"]["statements"] == ["p", "x", "y", "z"]
    assert "z-q" not in r["closure"]["arguments"]


def test_rests_on_depth_limit(chain):
    r = rests_on(wv(chain), "e", depth=1)
    c = r["tree"]["arguments"][0]["premises"][0]
    assert c["statement"] == "c" and c["truncated"] is True and "arguments" not in c
    d = r["tree"]["arguments"][0]["premises"][1]
    assert "truncated" not in d  # foundation: nothing to truncate
    # closure is unaffected by depth
    assert r["closure"]["statements"] == ["a", "b", "c", "d", "f"]


def test_rests_on_co_conclusions():
    d = doc([S("a", "A"), S("b", "B"), S("c", "C")], [A("x", ["a"], ["b", "c"])])
    r = rests_on(wv(d), "b")
    assert r["tree"]["arguments"][0]["co_conclusions"] == ["c"]


def test_rests_on_unknown_id(chain):
    with pytest.raises(UnknownIdError):
        rests_on(wv(chain), "nope")


# ----------------------------------------------------------- supports


def test_supports(chain):
    r = supports(wv(chain), "a")
    assert r["closure"]["statements"] == ["c", "e"]
    assert r["closure"]["arguments"] == ["ab-c", "cd-e"]
    t = r["tree"]
    assert t["arguments"][0]["argument"] == "ab-c"
    assert t["arguments"][0]["co_premises"] == ["b"]
    c = t["arguments"][0]["conclusions"][0]
    assert c["statement"] == "c"
    assert c["arguments"][0]["co_premises"] == ["d"]
    assert c["arguments"][0]["conclusions"][0]["arguments"] == []  # e is terminal


def test_supports_cycle(cycle):
    r = supports(wv(cycle), "p")
    assert r["closure"]["statements"] == ["x", "y", "z", "q"]
    assert r["sccs"] == [["x", "y", "z"]]


# ------------------------------------------------------- well-founded


def test_well_founded_chain(chain):
    assert well_founded(wv(chain))["ungrounded"] == []


def test_well_founded_cycle_with_entry_point_is_grounded(cycle):
    assert well_founded(wv(cycle))["ungrounded"] == []


def test_well_founded_pure_cycle_is_ungrounded():
    d = doc([S("x", "X"), S("y", "Y"), S("q", "Q")], [A("x-y", ["x"], ["y"]), A("y-x", ["y"], ["x"]), A("y-q", ["y"], ["q"])])
    out = well_founded(wv(d))
    assert out["foundations"] == []
    assert out["ungrounded"] == ["x", "y", "q"]


def test_well_founded_joint_premises_need_all_grounded():
    # d needs b and c; c is only supported by the cycle -> d ungrounded even though b is fine.
    d = doc(
        [S("b", "B"), S("c", "C"), S("c2", "C2"), S("d", "D")],
        [A("c-c2", ["c"], ["c2"]), A("c2-c", ["c2"], ["c"]), A("bc-d", ["b", "c"], ["d"])],
    )
    assert well_founded(wv(d))["ungrounded"] == ["c", "c2", "d"]


def test_well_founded_zero_premise_argument_grounds():
    d = doc([S("a", "A"), S("b", "B")], [A("given", [], ["a"], "stipulated"), A("a-b", ["a"], ["b"])])
    out = well_founded(wv(d))
    assert out["foundations"] == []
    assert out["ungrounded"] == []


# ------------------------------------------------------------ example


def test_example_queries(example_path):
    w = load(example_path)
    assert {f["id"] for f in foundations(w)} == {
        "exercise-good", "walk-is-exercise", "health-matters", "car-costs", "save-money", "rain-often", "rain-unpleasant",
    }
    assert [c["members"] for c in sccs(w)] == [["self-knowledge", "habit-reports"]]
    r = rests_on(w, "need-raincoat")
    assert r["sccs"] == [["self-knowledge", "habit-reports"]]
    assert well_founded(w)["ungrounded"] == ["commute-30", "self-knowledge", "habit-reports"]
    # walk-commute is still grounded through walk-for-money even though walk-for-health is not.
    assert "walk-commute" in well_founded(w)["grounded"]
