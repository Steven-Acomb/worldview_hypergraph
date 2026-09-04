"""Assembly and repair of the final document."""

from __future__ import annotations

import pytest

from worldview_core import validate_dict
from worldview_extract.assemble import ArgumentRec, ExtractError, StatementRec, build_document, repair


def S(id_, mode="is", **kw):
    return StatementRec(id=id_, text=f"Text of {id_}.", mode=mode, **kw)


def A(id_, premises, conclusions, **kw):
    return ArgumentRec(id=id_, premises=premises, conclusions=conclusions, justification=f"Because {id_}.", **kw)


def test_build_document_shape():
    doc = build_document(
        [S("a", sources=["p1"], note="hm"), S("b", "ought", role="assumption")],
        [A("ab", ["a"], ["b"], rule="mp", sources=["p1"]), A("link", [], ["b"], origin="link")],
        name="N",
        description="D",
        extraction={"tool": "worldview-extract"},
    )
    assert validate_dict(doc) == []
    assert doc["format"] == "worldview-core" and doc["version"] == "0.1"
    assert doc["name"] == "N" and doc["description"] == "D"
    assert doc["meta"] == {"extraction": {"tool": "worldview-extract"}}
    assert doc["statements"][0] == {
        "id": "a",
        "text": "Text of a.",
        "mode": "is",
        "meta": {"sources": ["p1"], "role": "stated", "note": "hm"},
    }
    assert doc["statements"][1]["meta"] == {"sources": [], "role": "assumption"}
    assert doc["arguments"][0] == {
        "id": "ab",
        "premises": ["a"],
        "conclusions": ["b"],
        "justification": "Because ab.",
        "rule": "mp",
        "meta": {"sources": ["p1"]},
    }
    assert "rule" not in doc["arguments"][1] and doc["arguments"][1]["meta"] == {"sources": [], "link": True}


def test_build_document_omits_empty_header_fields():
    doc = build_document([S("a")], [])
    assert set(doc) == {"format", "version", "statements", "arguments"}


def test_repair_leaves_a_clean_document_alone():
    doc = build_document([S("a"), S("b")], [A("ab", ["a"], ["b"])])
    fixed, log = repair(doc)
    assert fixed == doc and log == []


def test_repair_fixes_references_and_duplicates():
    doc = build_document(
        [S("a"), S("b"), S("c")],
        [
            A("dangling-premise", ["a", "ghost"], ["b"]),
            A("dangling-conclusion", ["b"], ["c", "ghost"]),
            A("no-conclusion", ["a"], ["ghost"]),
            A("dupes-inside", ["a", "a"], ["c", "c"]),
            A("same-shape", ["a"], ["c"]),
            A("dupes-inside", ["b", "a"], ["c"]),
            A("self-loop", ["c"], ["c"]),
        ],
    )
    assert validate_dict(doc)  # it starts out invalid
    fixed, log = repair(doc)
    assert validate_dict(fixed) == []
    assert [a["id"] for a in fixed["arguments"]] == [
        "dangling-premise",
        "dangling-conclusion",
        "dupes-inside",
        "dupes-inside-2",
        "self-loop",
    ]
    assert fixed["arguments"][0]["premises"] == ["a"]
    assert fixed["arguments"][1]["conclusions"] == ["c"]
    assert fixed["arguments"][2]["premises"] == ["a"] and fixed["arguments"][2]["conclusions"] == ["c"]
    assert fixed["arguments"][3]["premises"] == ["b", "a"]
    assert "argument dangling-premise: dropped unknown premise(s) ghost" in log
    assert "argument dangling-conclusion: dropped unknown conclusion(s) ghost" in log
    assert "argument no-conclusion: dropped unknown conclusion(s) ghost" in log
    assert "argument no-conclusion: dropped (no valid conclusion left)" in log
    assert "argument dupes-inside: collapsed duplicate ids" in log
    assert log.count("argument dupes-inside: collapsed duplicate ids") == 1  # once per argument, not per list
    assert "argument same-shape: dropped (same premises and conclusions as an earlier argument)" in log
    assert "argument dupes-inside: renamed to dupes-inside-2 (duplicate id)" in log
    assert not any("self-loop" in line for line in log)  # a self-loop is legal
    # every surviving argument that was changed says so in its own meta; untouched ones do not
    assert fixed["arguments"][0]["meta"] == {"sources": [], "repairs": ["dropped unknown premise(s) ghost"]}
    assert fixed["arguments"][2]["meta"]["repairs"] == ["collapsed duplicate ids"]
    assert fixed["arguments"][3]["meta"]["repairs"] == ["renamed from dupes-inside (duplicate id)"]
    assert fixed["arguments"][4]["meta"] == {"sources": []}


def test_repair_resolves_merged_and_normalised_references():
    doc = build_document(
        [S("a"), S("b")],
        [
            A("x", ["old-a", "B", "b."], ["Old A"]),
            A("y", ["older-a", "zzz", ""], ["b"]),
        ],
    )
    fixed, log = repair(doc, merged={"old-a": "a", "older-a": "old-a"})
    assert validate_dict(fixed) == []
    x, y = fixed["arguments"]
    assert x["premises"] == ["a", "b"] and x["conclusions"] == ["a"]
    assert x["meta"]["repairs"] == [
        "premise old-a merged into a",
        "premise B normalised to b",
        "premise b. normalised to b",
        "collapsed duplicate ids",
        "conclusion Old A normalised and merged into a",
    ]
    assert y["premises"] == ["a"] and y["conclusions"] == ["b"]  # the chain older-a -> old-a -> a is followed
    assert y["meta"]["repairs"] == ["premise older-a merged into a", "dropped unknown premise(s) zzz, "]
    assert log == [f"argument x: {n}" for n in x["meta"]["repairs"]] + [f"argument y: {n}" for n in y["meta"]["repairs"]]


def test_repair_never_invents_a_reference():
    doc = build_document([S("alpha")], [A("x", ["alphas", "alpha-2", "beta"], ["alpha"])])
    fixed, log = repair(doc, merged={"beta": "gamma"})  # a merge target that does not exist either
    assert fixed["arguments"][0]["premises"] == []
    assert log == ["argument x: dropped unknown premise(s) alphas, alpha-2, beta"]


def test_repair_reports_problems_it_cannot_fix():
    doc = build_document([S("a"), S("a")], [])  # duplicate statement id
    with pytest.raises(ExtractError, match="duplicate statement id"):
        repair(doc)
