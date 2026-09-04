"""The is-ought lint."""

from __future__ import annotations

import json

from worldview_core import is_ought_gaps, lint_all, load
from worldview_core.cli import main

from conftest import A, S, doc, wv


def test_gap_detected_and_bridged():
    d = doc(
        [S("fact", "F"), S("norm", "N", "ought"), S("bridge", "B", "ought"), S("norm2", "N2", "ought"), S("fact2", "F2")],
        [
            A("gap", ["fact"], ["norm"], "from fact alone"),
            A("bridged", ["fact", "bridge"], ["norm2"], "with a bridge principle"),
            A("is-only", ["fact"], ["fact2"], "is to is is fine"),
            A("stipulated", [], ["norm"], "an ought with no premises at all"),
        ],
    )
    out = is_ought_gaps(wv(d))
    assert out == [
        {"argument": "gap", "ought_conclusions": ["norm"], "premises": ["fact"]},
        {"argument": "stipulated", "ought_conclusions": ["norm"], "premises": []},
    ]
    assert lint_all(wv(d))["is_ought_gaps"] == out


def test_mixed_conclusions_list_only_the_oughts():
    d = doc([S("f", "F"), S("o", "O", "ought"), S("g", "G")], [A("x", ["f"], ["g", "o"], "j")])
    assert is_ought_gaps(wv(d))[0]["ought_conclusions"] == ["o"]


def test_examples(example_path):
    assert is_ought_gaps(load(example_path)) == []
    promises = load(example_path.parent / "keeping-promises.json")
    assert [g["argument"] for g in is_ought_gaps(promises)] == ["everyone-does-it"]


def test_cli(capsys, example_path):
    promises = str(example_path.parent / "keeping-promises.json")
    code = main(["lint", "is-ought", promises])
    out = capsys.readouterr().out
    assert code == 0 and "everyone-does-it" in out and "ought from is alone" in out
    code = main(["--json", "lint", "all", promises])
    data = json.loads(capsys.readouterr().out)
    assert [g["argument"] for g in data["is_ought_gaps"]] == ["everyone-does-it"]
    code = main(["lint", "is-ought", str(example_path)])
    assert "every ought conclusion" in capsys.readouterr().out
