"""Shared fixtures and builders for the test suite."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from worldview_core import Worldview, validate_dict

FIXTURES = Path(__file__).parent / "fixtures"
EXAMPLES = Path(__file__).parent.parent / "examples"


def S(id_, text, mode="is", **extra):
    return {"id": id_, "text": text, "mode": mode, **extra}


def A(id_, premises, conclusions, justification="because", **extra):
    return {"id": id_, "premises": list(premises), "conclusions": list(conclusions), "justification": justification, **extra}


def doc(statements, arguments, **header):
    return {"format": "worldview-core", "version": "0.1", **header, "statements": statements, "arguments": arguments}


def wv(data, source=None) -> Worldview:
    """Validate strictly and build a Worldview from a dict."""
    validate_dict(data, strict=True)
    return Worldview.from_dict(copy.deepcopy(data), source=source)


# A chain with a fork:   a, b -> c ;  c, d -> e ;  f -> e   (two arguments into e)
def chain_doc():
    return doc(
        [S("a", "A"), S("b", "B"), S("c", "C"), S("d", "D"), S("e", "E", "ought"), S("f", "F")],
        [
            A("ab-c", ["a", "b"], ["c"], "a and b give c"),
            A("cd-e", ["c", "d"], ["e"], "c and d give e"),
            A("f-e", ["f"], ["e"], "f alone gives e"),
        ],
    )


# A three-cycle x -> y -> z -> x, fed by foundation p (p -> x), feeding q (z -> q).
def cycle_doc():
    return doc(
        [S("p", "P"), S("x", "X"), S("y", "Y"), S("z", "Z"), S("q", "Q")],
        [
            A("p-x", ["p"], ["x"], "p gives x"),
            A("x-y", ["x"], ["y"], "x gives y"),
            A("y-z", ["y"], ["z"], "y gives z"),
            A("z-x", ["z"], ["x"], "z gives x"),
            A("z-q", ["z"], ["q"], "z gives q"),
        ],
    )


@pytest.fixture
def chain():
    return chain_doc()


@pytest.fixture
def cycle():
    return cycle_doc()


@pytest.fixture
def example_path():
    return EXAMPLES / "walking-to-work.json"


@pytest.fixture
def fork_path():
    return EXAMPLES / "walking-to-work-fork.json"


def write(tmp_path: Path, name: str, data) -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return p
