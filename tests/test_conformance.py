"""Replay the conformance vectors against the Python implementation.

If this fails after a deliberate change to hashing or query output,
regenerate the vectors with ``python conformance/generate.py`` and make
sure every other implementation is updated to match.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from worldview_core import H, Worldview, canon, compute_identities, diff, validate_dict
from worldview_core import foundations, lint_all, merge, plan, present, rests_on, sccs, stats, supports, to_dot, to_mermaid, well_founded

VECTORS = Path(__file__).parent.parent / "conformance" / "vectors"


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _cases(sub: str):
    d = VECTORS / sub
    return sorted(d.glob("*.json")) if d.exists() else []


pytestmark = pytest.mark.skipif(not VECTORS.exists(), reason="conformance vectors not generated")


@pytest.mark.parametrize("path", _cases("cases"), ids=lambda p: p.stem)
def test_case(path):
    v = _load(path)
    data, exp = v["input"], v["expected"]
    assert validate_dict(data) == []
    wv = Worldview.from_dict(data, source=v["name"])
    assert compute_identities(wv).to_dict() == exp["ids"]
    assert foundations(wv) == exp["foundations"]
    assert sccs(wv) == exp["sccs"]
    assert well_founded(wv) == exp["well_founded"]
    for sid, want in exp["rests_on"].items():
        assert rests_on(wv, sid) == want, sid
    for sid, want in exp["supports"].items():
        assert supports(wv, sid) == want, sid
    for sid in wv.statement_ids():
        assert rests_on(wv, sid, depth=1) == exp["rests_on_depth_1"][sid], sid
        assert supports(wv, sid, depth=1) == exp["supports_depth_1"][sid], sid


@pytest.mark.parametrize("path", _cases("invalid"), ids=lambda p: p.stem)
def test_invalid(path):
    v = _load(path)
    assert validate_dict(v["input"]) != []


@pytest.mark.parametrize("path", _cases("diffs"), ids=lambda p: p.stem)
def test_diff(path):
    v = _load(path)
    a = _load(VECTORS / "cases" / f"{v['a']}.json")
    b = _load(VECTORS / "cases" / f"{v['b']}.json")
    wa = Worldview.from_dict(a["input"], source=v["a"])
    wb = Worldview.from_dict(b["input"], source=v["b"])
    assert diff(wa, wb) == v["expected"]


@pytest.mark.parametrize("path", _cases("extras"), ids=lambda p: p.stem)
def test_extras(path):
    v = _load(path)
    case = _load(VECTORS / "cases" / f"{v['name']}.json")
    wv = Worldview.from_dict(case["input"], source=v["name"])
    exp = v["expected"]
    for sid, runs in exp["plan"].items():
        for run in runs:
            assert plan(wv, sid, run["given"]) == run["result"], (sid, run["given"])
    assert lint_all(wv) == exp["lint_all"]
    assert stats(wv) == exp["stats"]
    for sid, runs in exp["present"].items():
        assert present(wv, sid) == runs["plain"], sid
        assert present(wv, sid, depth=1) == runs["depth_1"], sid
        assert present(wv, sid, given=runs["given"]["given"]) == runs["given"]["markdown"], sid
    assert to_dot(wv) == exp["dot"]
    assert to_dot(wv, ids=False, wrap=20, rankdir="TB") == exp["dot_no_ids_tb"]
    assert to_mermaid(wv) == exp["mermaid"]
    assert to_mermaid(wv, ids=False, wrap=20, direction="TB") == exp["mermaid_no_ids_tb"]


@pytest.mark.parametrize("path", _cases("merges"), ids=lambda p: p.stem)
def test_merge(path):
    v = _load(path)
    wvs = []
    for role in ("base", "ours", "theirs"):
        case = _load(VECTORS / "cases" / f"{v[role]}.json")
        wvs.append(Worldview.from_dict(case["input"], source=v[role]))
    assert merge(*wvs) == v["expected"]


def test_primitives():
    prims = _load(VECTORS / "primitives.json")
    for c in prims["canon"]:
        assert canon(c["input"]) == c["output"], repr(c["input"])
    for h in prims["H"]:
        assert H(*h["parts"]) == h["output"], h["parts"]
