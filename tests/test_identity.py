"""Milestone 2: canonicalization and identity.  These are the tests from
section 5 of the design handoff, plus hashing primitives."""

from __future__ import annotations

import copy
import random

import pytest

from worldview_core import H, canon, compute_identities, prop_id

from conftest import A, S, chain_doc, cycle_doc, doc, wv


def ids(d):
    return compute_identities(wv(d))


def snapshot(d):
    i = ids(d)
    return dict(i.prop_id), dict(i.just_id), dict(i.arg_hash)


# --------------------------------------------------------------- canon


def test_canon_rules():
    assert canon("  All  men\tare\n mortal ") == "All men are mortal"
    assert canon("café") == canon("café")  # NFC
    assert canon("Hello") != canon("hello")  # no case folding
    assert canon("Hello.") != canon("Hello")  # no punctuation stripping


def test_hash_is_delimiter_safe():
    assert H("ab", "c") != H("a", "bc")
    assert H("a", ["b", "c"]) != H("a", "b", "c")
    assert H(["a"], ["b"]) != H(["a", "b"])
    assert H([]) != H("")
    assert len(H("x")) == 64


def test_prop_id_depends_on_text_and_mode_only():
    assert prop_id("A", "is") == prop_id("  A ", "is")
    assert prop_id("A", "is") != prop_id("A", "ought")
    assert prop_id("A", "is") != prop_id("B", "is")


# ------------------------------------------------------- invariances


@pytest.mark.parametrize("make", [chain_doc, cycle_doc])
def test_reordering_changes_nothing(make):
    base = snapshot(make())
    rng = random.Random(7)
    for _ in range(5):
        d = make()
        rng.shuffle(d["statements"])
        rng.shuffle(d["arguments"])
        for a in d["arguments"]:
            rng.shuffle(a["premises"])
            rng.shuffle(a["conclusions"])
        assert snapshot(d) == base


def test_renaming_local_ids_changes_nothing():
    d = chain_doc()
    base = ids(d)
    rename = {"a": "alpha", "c": "gamma", "e": "epsilon"}
    ren = {}
    for s in d["statements"]:
        s["id"] = rename.get(s["id"], s["id"])
    for a in d["arguments"]:
        a["premises"] = [rename.get(p, p) for p in a["premises"]]
        a["conclusions"] = [rename.get(c, c) for c in a["conclusions"]]
        a["id"] = "arg-" + a["id"]
    new = ids(d)
    for old, cur in rename.items():
        assert base.prop_id[old] == new.prop_id[cur]
        assert base.just_id[old] == new.just_id[cur]
    for aid in base.arg_hash:
        assert base.arg_hash[aid] == new.arg_hash["arg-" + aid]


def test_meta_ext_rule_and_header_are_ignored():
    d = chain_doc()
    base = snapshot(d)
    d["name"] = "renamed"
    d["meta"] = {"x": 1}
    d["ext"] = {"bayes": {"y": 2}}
    d["statements"][0]["meta"] = {"role": "axiom"}
    d["statements"][0]["ext"] = {"bayes": {"prior": 0.1}}
    d["arguments"][0]["rule"] = "modus ponens"
    d["arguments"][0]["meta"] = {"note": "hi"}
    d["arguments"][0]["ext"] = {"defeasible": {"kind": "inductive"}}
    assert snapshot(d) == base


def test_whitespace_in_text_is_ignored():
    d = chain_doc()
    base = snapshot(d)
    d["statements"][0]["text"] = "  A "
    d["arguments"][0]["justification"] = "a  and b\n give c"
    assert snapshot(d) == base


def test_two_independent_files_with_same_content_agree():
    d1 = chain_doc()
    d2 = copy.deepcopy(d1)
    assert snapshot(d1) == snapshot(d2)


# --------------------------------------------------------- ripple


def test_editing_a_leaf_ripples_downstream_only():
    d = chain_doc()
    base = ids(d)
    d["statements"][0]["text"] = "A (edited)"  # statement a
    new = ids(d)
    # a: prop and just both change
    assert new.prop_id["a"] != base.prop_id["a"]
    assert new.just_id["a"] != base.just_id["a"]
    # downstream c and e: prop same, just changed
    for s in ("c", "e"):
        assert new.prop_id[s] == base.prop_id[s]
        assert new.just_id[s] != base.just_id[s]
    # unrelated / upstream-of-nothing: b, d, f unchanged
    for s in ("b", "d", "f"):
        assert new.prop_id[s] == base.prop_id[s]
        assert new.just_id[s] == base.just_id[s]
    # arguments: ab-c and cd-e change, f-e does not
    assert new.arg_hash["ab-c"] != base.arg_hash["ab-c"]
    assert new.arg_hash["cd-e"] != base.arg_hash["cd-e"]
    assert new.arg_hash["f-e"] == base.arg_hash["f-e"]


def test_same_justification_over_different_premises_is_different_argument():
    d1 = doc([S("a", "A"), S("b", "B"), S("c", "C")], [A("x", ["a"], ["c"], "j")])
    d2 = doc([S("a", "A"), S("b", "B"), S("c", "C")], [A("x", ["b"], ["c"], "j")])
    assert ids(d1).arg_hash["x"] != ids(d2).arg_hash["x"]
    assert ids(d1).just_id["c"] != ids(d2).just_id["c"]
    assert ids(d1).prop_id["c"] == ids(d2).prop_id["c"]


def test_same_statement_over_different_justification_is_same_proposition():
    d1 = doc([S("a", "A"), S("c", "C")], [A("x", ["a"], ["c"], "one")])
    d2 = doc([S("a", "A"), S("c", "C")], [A("x", ["a"], ["c"], "two")])
    assert ids(d1).prop_id["c"] == ids(d2).prop_id["c"]
    assert ids(d1).just_id["c"] != ids(d2).just_id["c"]


def test_adding_an_argument_changes_the_conclusion_only():
    d = chain_doc()
    base = ids(d)
    d["arguments"].append(A("d-e", ["d"], ["e"], "d alone gives e"))
    new = ids(d)
    assert new.just_id["e"] != base.just_id["e"]
    for s in "abcdf":
        assert new.just_id[s] == base.just_id[s]


def test_joint_conclusions_share_the_argument_hash_but_not_just_id():
    d = doc([S("a", "A"), S("b", "B"), S("c", "C")], [A("x", ["a"], ["b", "c"], "j")])
    i = ids(d)
    assert i.just_id["b"] != i.just_id["c"]
    # Reordering conclusions is invariant (covered generically), and removing
    # one conclusion changes the argument and the remaining conclusion.
    d2 = doc([S("a", "A"), S("b", "B")], [A("x", ["a"], ["b"], "j")])
    assert ids(d2).arg_hash["x"] != i.arg_hash["x"]
    assert ids(d2).just_id["b"] != i.just_id["b"]


# ------------------------------------------------------------- cycles


def test_cycle_members_share_scc_and_have_distinct_just_ids():
    i = ids(cycle_doc())
    assert i.scc_of("x") == ["x", "y", "z"]
    assert i.scc_of("p") is None
    assert i.scc_of("q") is None
    assert len({i.just_id["x"], i.just_id["y"], i.just_id["z"]}) == 3


def test_editing_a_cycle_member_changes_every_member_and_downstream():
    d = cycle_doc()
    base = ids(d)
    for s in d["statements"]:
        if s["id"] == "y":
            s["text"] = "Y (edited)"
    new = ids(d)
    for s in ("x", "y", "z", "q"):
        assert new.just_id[s] != base.just_id[s], s
    assert new.just_id["p"] == base.just_id["p"]
    assert new.prop_id["x"] == base.prop_id["x"]
    assert new.prop_id["y"] != base.prop_id["y"]


def test_editing_an_internal_cycle_argument_changes_every_member():
    d = cycle_doc()
    base = ids(d)
    for a in d["arguments"]:
        if a["id"] == "y-z":
            a["justification"] = "y gives z, on reflection"
    new = ids(d)
    for s in ("x", "y", "z", "q"):
        assert new.just_id[s] != base.just_id[s], s
    assert new.just_id["p"] == base.just_id["p"]


def test_editing_downstream_of_cycle_leaves_cycle_alone():
    d = cycle_doc()
    base = ids(d)
    for s in d["statements"]:
        if s["id"] == "q":
            s["text"] = "Q (edited)"
    new = ids(d)
    assert new.just_id["q"] != base.just_id["q"]
    for s in ("p", "x", "y", "z"):
        assert new.just_id[s] == base.just_id[s], s
    for a in ("p-x", "x-y", "y-z", "z-x"):
        assert new.arg_hash[a] == base.arg_hash[a]
    assert new.arg_hash["z-q"] != base.arg_hash["z-q"]


def test_editing_upstream_of_cycle_changes_cycle():
    d = cycle_doc()
    base = ids(d)
    d["statements"][0]["text"] = "P (edited)"
    new = ids(d)
    for s in ("x", "y", "z", "q"):
        assert new.just_id[s] != base.just_id[s], s


def test_self_loop_is_a_cyclic_scc_of_size_one():
    d = doc([S("a", "A"), S("b", "B")], [A("loop", ["a"], ["a"], "self"), A("a-b", ["a"], ["b"], "j")])
    i = ids(d)
    assert i.scc_of("a") == ["a"]
    assert i.scc_of("b") is None
    # The loop's justification participates in a's identity.
    d2 = copy.deepcopy(d)
    d2["arguments"][0]["justification"] = "self, differently"
    j = ids(d2)
    assert j.just_id["a"] != i.just_id["a"]
    assert j.just_id["b"] != i.just_id["b"]


def test_cycle_versus_no_cycle_differ():
    # Same statements; one file closes the loop, the other does not.
    with_cycle = ids(cycle_doc())
    d = cycle_doc()
    d["arguments"] = [a for a in d["arguments"] if a["id"] != "z-x"]
    without = ids(d)
    assert with_cycle.just_id["x"] != without.just_id["x"]
    assert with_cycle.just_id["p"] == without.just_id["p"]


def test_to_dict_shape():
    out = ids(cycle_doc()).to_dict()
    assert [s["id"] for s in out["statements"]] == ["p", "x", "y", "z", "q"]
    assert out["statements"][1]["scc"] == ["x", "y", "z"]
    assert "scc" not in out["statements"][0]
    assert {a["id"] for a in out["arguments"]} == {"p-x", "x-y", "y-z", "z-x", "z-q"}


def test_large_chain_does_not_hit_recursion_limit():
    n = 5000
    d = doc(
        [S(f"s{i}", f"S{i}") for i in range(n)],
        [A(f"a{i}", [f"s{i}"], [f"s{i+1}"], "next") for i in range(n - 1)],
    )
    i = ids(d)
    assert len(i.just_id) == n
