"""Milestone 1: schema + validator."""

from __future__ import annotations

import copy
import json

import pytest

from worldview_core import ValidationError, load, validate_dict, validate_with_jsonschema
from worldview_core.validate import schema

from conftest import A, S, chain_doc, cycle_doc, doc, write

# ----------------------------------------------------------------- valid


def test_minimal_valid():
    assert validate_dict(doc([], [])) == []


def test_chain_valid():
    assert validate_dict(chain_doc()) == []


def test_cyclic_file_is_valid():
    assert validate_dict(cycle_doc()) == []


def test_self_loop_within_one_argument_is_valid():
    d = doc([S("a", "A")], [A("loop", ["a"], ["a"], "a supports itself")])
    assert validate_dict(d) == []


def test_zero_premise_argument_is_valid():
    d = doc([S("a", "A")], [A("given", [], ["a"], "stipulated")])
    assert validate_dict(d) == []


def test_meta_and_ext_allowed_everywhere():
    d = doc(
        [S("a", "A", meta={"role": "axiom"}, ext={"bayes": {"prior": 0.5}})],
        [A("x", [], ["a"], meta={"n": 1}, ext={"defeasible": {"kind": "inductive"}})],
        meta={"author": "me"},
        ext={"defeasible": {"semantics": "grounded"}},
        name="n",
        description="d",
    )
    assert validate_dict(d) == []


def test_examples_valid(example_path, fork_path):
    for p in (example_path, fork_path):
        wv = load(p)
        assert wv.source == str(p)
        assert len(wv.statements) > 5


# --------------------------------------------------------------- invalid


def _bad(mutate, base=None):
    d = copy.deepcopy(base or chain_doc())
    mutate(d)
    return d


INVALID_CASES = {
    "not-an-object": lambda: [],
    "wrong-format": lambda: _bad(lambda d: d.update(format="other")),
    "missing-format": lambda: _bad(lambda d: d.pop("format")),
    "bad-version": lambda: _bad(lambda d: d.update(version="v1")),
    "unknown-top-field": lambda: _bad(lambda d: d.update(credence=0.5)),
    "meta-not-object": lambda: _bad(lambda d: d.update(meta="notes")),
    "ext-not-object": lambda: _bad(lambda d: d.update(ext=[])),
    "ext-namespace-not-object": lambda: _bad(lambda d: d.update(ext={"bayes": 1})),
    "statements-not-array": lambda: _bad(lambda d: d.update(statements={})),
    "statement-missing-text": lambda: _bad(lambda d: d["statements"][0].pop("text")),
    "statement-empty-text": lambda: _bad(lambda d: d["statements"][0].update(text="")),
    "statement-bad-mode": lambda: _bad(lambda d: d["statements"][0].update(mode="maybe")),
    "statement-missing-mode": lambda: _bad(lambda d: d["statements"][0].pop("mode")),
    "statement-unknown-field": lambda: _bad(lambda d: d["statements"][0].update(weight=1)),
    "statement-id-whitespace": lambda: _bad(lambda d: d["statements"][0].update(id="a b")),
    "statement-id-empty": lambda: _bad(lambda d: d["statements"][0].update(id="")),
    "argument-missing-justification": lambda: _bad(lambda d: d["arguments"][0].pop("justification")),
    "argument-no-conclusions": lambda: _bad(lambda d: d["arguments"][0].update(conclusions=[])),
    "argument-missing-premises": lambda: _bad(lambda d: d["arguments"][0].pop("premises")),
    "argument-duplicate-premise": lambda: _bad(lambda d: d["arguments"][0].update(premises=["a", "a"])),
    "argument-premise-not-string": lambda: _bad(lambda d: d["arguments"][0].update(premises=[1])),
    "argument-rule-not-string": lambda: _bad(lambda d: d["arguments"][0].update(rule=3)),
    "argument-unknown-field": lambda: _bad(lambda d: d["arguments"][0].update(strength=0.9)),
}

REFERENTIAL_CASES = {
    "duplicate-statement-id": lambda: _bad(lambda d: d["statements"].append(S("a", "again"))),
    "duplicate-argument-id": lambda: _bad(lambda d: d["arguments"].append(A("ab-c", ["a"], ["c"]))),
    "unknown-premise": lambda: _bad(lambda d: d["arguments"][0].update(premises=["a", "nope"])),
    "unknown-conclusion": lambda: _bad(lambda d: d["arguments"][0].update(conclusions=["nope"])),
}


@pytest.mark.parametrize("name", list(INVALID_CASES) + list(REFERENTIAL_CASES))
def test_invalid_is_rejected(name):
    d = (INVALID_CASES.get(name) or REFERENTIAL_CASES[name])()
    problems = validate_dict(d)
    assert problems, name
    with pytest.raises(ValidationError) as ei:
        validate_dict(d, strict=True)
    assert ei.value.problems == problems


def test_problem_messages_name_the_location():
    problems = validate_dict(REFERENTIAL_CASES["unknown-premise"]())
    assert problems == ["arguments[0] (ab-c): premises references unknown statement 'nope'"]


# ------------------------------------------------ agreement with the schema


def test_schema_is_well_formed():
    s = schema()
    assert s["$schema"].endswith("2020-12/schema")
    assert s["properties"]["format"]["const"] == "worldview-core"


@pytest.mark.parametrize("name", list(INVALID_CASES))
def test_builtin_validator_agrees_with_jsonschema_on_invalid(name):
    d = INVALID_CASES[name]()
    assert validate_with_jsonschema(d), f"schema accepted {name} but validator rejects it"


@pytest.mark.parametrize("make", [lambda: doc([], []), chain_doc, cycle_doc])
def test_builtin_validator_agrees_with_jsonschema_on_valid(make):
    assert validate_with_jsonschema(make()) == []


def test_examples_pass_jsonschema(example_path, fork_path):
    for p in (example_path, fork_path):
        assert validate_with_jsonschema(json.loads(p.read_text(encoding="utf-8"))) == []


# ------------------------------------------------------------------ load


def test_load_bad_json(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    from worldview_core import LoadError

    with pytest.raises(LoadError):
        load(p)


def test_load_missing_file(tmp_path):
    from worldview_core import LoadError

    with pytest.raises(LoadError):
        load(tmp_path / "nope.json")


def test_load_invalid_raises(tmp_path):
    p = write(tmp_path, "x.json", INVALID_CASES["wrong-format"]())
    with pytest.raises(ValidationError):
        load(p)


def test_roundtrip_to_dict(example_path):
    original = json.loads(example_path.read_text(encoding="utf-8"))
    assert load(example_path).to_dict() == original
