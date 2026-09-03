"""CLI: thin wrapper, JSON mode, exit codes."""

from __future__ import annotations

import json

import pytest

from worldview_core.cli import main

from conftest import A, S, chain_doc, cycle_doc, doc, write


def run(capsys, *argv):
    try:
        code = main(list(argv))
    except SystemExit as e:  # _load exits on invalid input
        code = e.code
    out, err = capsys.readouterr()
    return code, out, err


def test_validate_ok(capsys, example_path):
    code, out, _ = run(capsys, "validate", str(example_path))
    assert code == 0 and "valid" in out


def test_validate_json(capsys, example_path):
    code, out, _ = run(capsys, "--json", "validate", str(example_path))
    assert code == 0 and json.loads(out)["valid"] is True


def test_validate_with_jsonschema_flag(capsys, example_path):
    code, out, _ = run(capsys, "--json", "validate", "--jsonschema", str(example_path))
    assert code == 0 and json.loads(out)["problems"] == []


def test_validate_invalid_exit_1(capsys, tmp_path):
    d = chain_doc()
    d["arguments"][0]["premises"] = ["nope"]
    p = write(tmp_path, "bad.json", d)
    code, out, _ = run(capsys, "validate", str(p))
    assert code == 1 and "INVALID" in out and "nope" in out
    code, out, _ = run(capsys, "--json", "validate", str(p))
    assert code == 1 and json.loads(out)["valid"] is False


def test_validate_missing_file(capsys, tmp_path):
    code, _, err = run(capsys, "validate", str(tmp_path / "missing.json"))
    assert code == 1 and "error" in err


def test_cyclic_file_validates_without_warning(capsys, tmp_path):
    p = write(tmp_path, "circular.json", cycle_doc())
    code, out, err = run(capsys, "validate", str(p))
    assert code == 0 and err == ""
    assert out.strip() == f"{p}: valid (5 statements, 5 arguments)"


def test_query_on_invalid_file_exits_1(capsys, tmp_path):
    p = write(tmp_path, "bad.json", {"format": "nope"})
    code, _, err = run(capsys, "foundations", str(p))
    assert code == 1 and "not a valid" in err


def test_ids(capsys, tmp_path):
    p = write(tmp_path, "c.json", cycle_doc())
    code, out, _ = run(capsys, "--json", "ids", str(p))
    data = json.loads(out)
    assert code == 0
    assert {s["id"] for s in data["statements"]} == {"p", "x", "y", "z", "q"}
    assert all(len(s["just_id"]) == 64 for s in data["statements"])
    code, out, _ = run(capsys, "ids", str(p))
    assert code == 0 and "scc=x,y,z" in out


def test_rests_on_text_and_json(capsys, example_path):
    code, out, _ = run(capsys, "rests-on", str(example_path), "need-raincoat")
    assert code == 0
    assert "<- raincoat" in out
    assert "foundation" in out
    assert "cycle: self-knowledge, habit-reports" in out
    assert "see above" in out
    code, out, _ = run(capsys, "--json", "rests-on", str(example_path), "need-raincoat", "--depth", "1")
    data = json.loads(out)
    assert data["tree"]["arguments"][0]["premises"][0]["truncated"] is True


def test_rests_on_unknown_id_exit_2(capsys, example_path):
    code, _, err = run(capsys, "rests-on", str(example_path), "nope")
    assert code == 2 and "nope" in err


def test_supports(capsys, example_path):
    code, out, _ = run(capsys, "supports", str(example_path), "health-matters")
    assert code == 0 and "-> walk-for-health" in out and "jointly with" in out


def test_foundations(capsys, example_path):
    code, out, _ = run(capsys, "foundations", str(example_path))
    assert code == 0 and "health-matters [ought]" in out
    code, out, _ = run(capsys, "--json", "foundations", str(example_path))
    assert len(json.loads(out)) == 7


def test_sccs(capsys, example_path, tmp_path):
    code, out, _ = run(capsys, "sccs", str(example_path))
    assert code == 0 and "cycle 1: self-knowledge, habit-reports" in out
    p = write(tmp_path, "chain.json", chain_doc())
    code, out, _ = run(capsys, "sccs", str(p))
    assert code == 0 and "no cycles" in out


def test_lint_well_founded(capsys, example_path, tmp_path):
    code, out, _ = run(capsys, "lint", "well-founded", str(example_path))
    assert code == 0 and "not grounded" in out and "self-knowledge" in out
    p = write(tmp_path, "chain.json", chain_doc())
    code, out, _ = run(capsys, "lint", "well-founded", str(p))
    assert code == 0 and "well-founded" in out


def test_diff(capsys, example_path, fork_path):
    code, out, _ = run(capsys, "diff", str(example_path), str(fork_path))
    assert code == 0
    assert "+ bike-faster" in out and "- rain-often" in out and "~ need-raincoat" in out
    code, out, _ = run(capsys, "--json", "diff", str(example_path), str(fork_path))
    assert json.loads(out)["summary"]["statements"] == {"identical": 9, "rejustified": 2, "added": 2, "removed": 1}


def test_schema(capsys):
    code, out, _ = run(capsys, "schema")
    assert code == 0 and json.loads(out)["title"] == "worldview-core"


def test_version(capsys):
    with pytest.raises(SystemExit) as e:
        main(["--version"])
    assert e.value.code == 0
    assert "worldview-core" in capsys.readouterr().out
