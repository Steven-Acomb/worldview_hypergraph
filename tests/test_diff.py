"""Milestone 4: diff."""

from __future__ import annotations

import copy

from worldview_core import diff, load

from conftest import A, S, chain_doc, doc, wv


def buckets(d):
    s = d["statements"]
    return (
        sorted((x["a"], x["b"]) for x in s["identical"]),
        sorted((x["a"], x["b"]) for x in s["rejustified"]),
        [x["id"] for x in s["added"]],
        [x["id"] for x in s["removed"]],
    )


def test_identical_files():
    d = diff(wv(chain_doc(), "a.json"), wv(chain_doc(), "b.json"))
    assert d["a"] == "a.json" and d["b"] == "b.json"
    ident, rej, added, removed = buckets(d)
    assert len(ident) == 6 and not rej and not added and not removed
    assert d["summary"]["arguments"] == {"identical": 3, "added": 0, "removed": 0}


def test_rename_is_identical():
    b = chain_doc()
    for s in b["statements"]:
        if s["id"] == "c":
            s["id"] = "gamma"
    for a in b["arguments"]:
        a["premises"] = ["gamma" if p == "c" else p for p in a["premises"]]
        a["conclusions"] = ["gamma" if c == "c" else c for c in a["conclusions"]]
    ident, rej, added, removed = buckets(diff(wv(chain_doc()), wv(b)))
    assert ("c", "gamma") in ident and not rej and not added and not removed


def test_edit_leaf_rejustifies_downstream():
    b = chain_doc()
    b["statements"][0]["text"] = "A (edited)"
    d = diff(wv(chain_doc()), wv(b))
    ident, rej, added, removed = buckets(d)
    assert ident == [("b", "b"), ("d", "d"), ("f", "f")]
    assert rej == [("c", "c"), ("e", "e")]
    assert added == ["a"] and removed == ["a"]
    args = d["arguments"]
    assert [x["a"] for x in args["identical"]] == ["f-e"]
    assert [x["id"] for x in args["added"]] == ["ab-c", "cd-e"]
    assert [x["id"] for x in args["removed"]] == ["ab-c", "cd-e"]


def test_add_and_remove():
    b = chain_doc()
    b["statements"].append(S("g", "G"))
    b["arguments"].append(A("g-e", ["g"], ["e"], "g gives e"))
    b["statements"] = [s for s in b["statements"] if s["id"] != "f"]
    b["arguments"] = [a for a in b["arguments"] if a["id"] != "f-e"]
    d = diff(wv(chain_doc()), wv(b))
    ident, rej, added, removed = buckets(d)
    assert rej == [("e", "e")]
    assert added == ["g"] and removed == ["f"]
    assert d["summary"]["arguments"] == {"identical": 2, "added": 1, "removed": 1}


def test_duplicate_propositions_match_as_multiset():
    a = doc([S("x1", "X"), S("x2", "X")], [])
    b = doc([S("x", "X")], [])
    ident, rej, added, removed = buckets(diff(wv(a), wv(b)))
    assert ident == [("x1", "x")] and removed == ["x2"] and not added


def test_example_fork(example_path, fork_path):
    d = diff(load(example_path), load(fork_path))
    ident, rej, added, removed = buckets(d)
    # rain-often was reworded: same slug, new proposition -> shows as removed+added,
    # and need-raincoat (downstream of it and of the dropped money argument) is rejustified.
    assert added == ["rain-often", "bike-faster"]
    assert removed == ["rain-often"]
    assert ("rain-often", "rain-often") not in ident
    assert rej == [("need-raincoat", "need-raincoat"), ("walk-commute", "walk-commute")]
    # raincoat's premise changed so it is a new argument; walk-for-money was dropped; bike-timing is new.
    assert d["summary"]["arguments"] == {"identical": 4, "added": 2, "removed": 2}
    assert [x["id"] for x in d["arguments"]["removed"]] == ["walk-for-money", "raincoat"]
    assert [x["id"] for x in d["arguments"]["added"]] == ["raincoat", "bike-timing"]


def test_diff_is_symmetric_in_counts(example_path, fork_path):
    ab = diff(load(example_path), load(fork_path))["summary"]
    ba = diff(load(fork_path), load(example_path))["summary"]
    for kind in ("statements", "arguments"):
        assert ab[kind]["added"] == ba[kind]["removed"]
        assert ab[kind]["removed"] == ba[kind]["added"]
        assert ab[kind]["identical"] == ba[kind]["identical"]
