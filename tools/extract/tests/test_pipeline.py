"""The whole pipeline driven by the scripted FakeLLM."""

from __future__ import annotations

import re

import pytest

from worldview_core import Worldview, foundations, validate_dict
from worldview_extract import ExtractError, ExtractOptions, FakeLLM, LLMError, extract
from worldview_extract.prompts import (
    ARGUMENTS_SCHEMA,
    MERGE_SCHEMA,
    STATEMENTS_SCHEMA,
    SYSTEM_ARGUMENTS,
    SYSTEM_LINK,
    SYSTEM_MERGE,
    SYSTEM_STATEMENTS,
)


def by_id(doc, kind):
    return {x["id"]: x for x in doc[kind]}


def test_full_pipeline_produces_a_valid_worldview(small_text, fake_llm):
    progress = []
    doc = extract(
        small_text,
        fake_llm,
        ExtractOptions(name="Small", description="A test", source="small.txt", chunk_tokens=120, progress=progress.append),
    )
    assert validate_dict(doc) == []
    Worldview.from_dict(doc)  # loads without complaint

    # segmentation produced several chunks; every chunk was seen by pass A and pass B
    n_chunks = int(re.search(r", (\d+) chunks", progress[0]).group(1))
    assert n_chunks >= 2
    systems = [c["system"] for c in fake_llm.calls]
    assert systems.count(SYSTEM_STATEMENTS) == n_chunks
    assert systems.count(SYSTEM_ARGUMENTS) == n_chunks
    assert systems.count(SYSTEM_MERGE) == 1
    assert SYSTEM_LINK not in systems
    schemas = [c["schema"] for c in fake_llm.calls]
    assert schemas.count(STATEMENTS_SCHEMA) == n_chunks and schemas.count(MERGE_SCHEMA) == 1
    assert schemas.count(ARGUMENTS_SCHEMA) == n_chunks
    # pass A prompts carry the document name and the citation keys
    a_prompts = [c["user"] for c in fake_llm.calls if c["schema"] is STATEMENTS_SCHEMA]
    assert all(p.startswith("Document: Small\n") for p in a_prompts)
    assert "[I.1] Good sense" in a_prompts[0]

    st = by_id(doc, "statements")
    # exact duplicate across chunks collapsed, sources merged, unknown citation key dropped
    assert st["good-sense-equal"]["meta"]["sources"] == ["I.1", "I.2"]
    assert "good-sense-equal-2" not in st
    # near-duplicate merged by the model: the kept statement absorbed the sources
    assert "senses-deceive-2" not in st
    assert st["senses-deceive"]["meta"]["sources"] == ["II.1", "II.2"]
    # cross-mode merge refused, unknown-id merge ignored
    assert "good-mind-not-enough" in st and "people-err" in st
    assert st["clear-perception-true"]["meta"]["role"] == "assumption"
    assert st["clear-perception-true"]["meta"]["note"] == "hidden premise"
    assert st["apply-mind-well"]["mode"] == "ought"

    ar = by_id(doc, "arguments")
    assert ar["cogito"]["premises"] == ["i-think"] and ar["cogito"]["conclusions"] == ["i-exist"]
    assert ar["cogito"]["rule"] == "cogito"
    assert "cogito-2" not in ar and "ghost" not in ar
    assert ar["distrust-from-error"]["premises"] == ["people-err"]  # dangling premise repaired away
    assert ar["distrust-from-error"]["meta"]["repairs"] == ["dropped unknown premise(s) no-such-id"]
    assert "rule" not in ar["distrust-from-deception"]
    assert ar["distrust-from-deception"]["meta"] == {"sources": ["II.1"]}  # untouched arguments carry no repairs

    ex = doc["meta"]["extraction"]
    assert ex["tool"] == "worldview-extract" and ex["version"]
    assert ex["model"] == "fake-model"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", ex["date"])
    assert ex["source"] == "small.txt"
    assert ex["chunking"]["segmentation"] == "tagged"
    assert ex["chunking"]["paragraphs"] == 6 and ex["chunking"]["chunks"] == n_chunks
    assert ex["chunking"]["chunk_tokens"] == 120 and ex["chunking"]["skipped_blocks"] == 3
    assert ex["link_pass"] is False
    assert ex["merged"] == {"senses-deceive-2": "senses-deceive"}
    assert ex["usage"]["calls"] == len(fake_llm.calls) and ex["usage"]["input_tokens"] > 0
    assert any("no-such-id" in line for line in ex["repairs"])
    assert any(line.startswith("argument cogito-2: dropped") for line in ex["repairs"])
    assert any(line.startswith("argument ghost: dropped") for line in ex["repairs"])
    assert doc["name"] == "Small" and doc["description"] == "A test"

    # the result answers structural queries like any worldview
    wv = Worldview.from_dict(doc)
    assert "i-think" in [s["id"] for s in foundations(wv)]


def test_link_pass_adds_cross_chunk_arguments(small_text, fake_llm):
    doc = extract(small_text, fake_llm, ExtractOptions(name="Small", chunk_tokens=120, link=True))
    assert validate_dict(doc) == []
    systems = [c["system"] for c in fake_llm.calls]
    assert systems[-1] == SYSTEM_LINK
    link_prompt = fake_llm.calls[-1]["user"]
    assert "All statements (id [mode]: text):" in link_prompt
    assert "cogito: i-think => i-exist" in link_prompt
    ar = by_id(doc, "arguments")
    assert ar["link-across-sections"]["meta"] == {"sources": ["I.3", "II.3"], "link": True}
    assert "cogito-again" not in ar  # duplicate shape dropped by repair
    assert doc["meta"]["extraction"]["link_pass"] is True


def test_windowing_limits_the_statements_pass_b_sees(small_text, fake_llm):
    doc = extract(small_text, fake_llm, ExtractOptions(chunk_tokens=120, window_threshold=3))
    assert validate_dict(doc) == []
    b_prompts = [c["user"] for c in fake_llm.calls if c["system"] == SYSTEM_ARGUMENTS]
    # the first chunk (Section One) never sees Section Two's last statements
    assert "i-exist" not in b_prompts[0]
    assert "good-sense-equal" in b_prompts[0]


def test_untagged_input_gets_paragraph_keys(untagged_text):
    def responder(system, user, schema):
        if schema is STATEMENTS_SCHEMA:
            keys = re.findall(r"^\[(p\d+)\] ", user, re.M)
            return {
                "statements": [
                    {"text": f"Claim from {k}.", "mode": "is", "sources": [k], "role": "stated", "note": "", "slug": f"claim {k}"}
                    for k in keys
                ]
            }
        if schema is MERGE_SCHEMA:
            return {"merges": []}
        return {"arguments": []}

    doc = extract(untagged_text, FakeLLM(responder=responder))
    assert validate_dict(doc) == []
    assert [s["id"] for s in doc["statements"]] == ["claim-p1", "claim-p2", "claim-p3", "claim-p4"]
    assert doc["statements"][0]["meta"]["sources"] == ["p1"]
    assert doc["meta"]["extraction"]["chunking"]["segmentation"] == "untagged"
    assert "name" not in doc


def test_references_to_merged_or_miscased_ids_are_resolved(untagged_text):
    def responder(system, user, schema):
        if schema is STATEMENTS_SCHEMA:
            return {
                "statements": [
                    {"text": "Alpha is so.", "mode": "is", "sources": ["p1"], "role": "stated", "note": "", "slug": "alpha"},
                    {"text": "Alpha is the case.", "mode": "is", "sources": ["p2"], "role": "stated", "note": "", "slug": "alpha"},
                    {"text": "Beta is so.", "mode": "is", "sources": ["p3"], "role": "stated", "note": "", "slug": "beta"},
                ]
            }
        if schema is MERGE_SCHEMA:
            return {"merges": [{"keep": "alpha", "drop": ["alpha-2"], "reason": "same"}]}
        return {
            "arguments": [
                {
                    "premises": ["alpha-2", " BETA ", "Beta!"],
                    "conclusions": ["Alpha"],
                    "justification": "j",
                    "rule": "",
                    "sources": ["p3"],
                    "slug": "Arg One",
                }
            ]
        }

    doc = extract(untagged_text, FakeLLM(responder=responder))
    assert validate_dict(doc) == []
    assert [s["id"] for s in doc["statements"]] == ["alpha", "beta"]
    (arg,) = doc["arguments"]
    assert arg["id"] == "arg-one"
    assert arg["premises"] == ["alpha", "beta"] and arg["conclusions"] == ["alpha"]  # a legal self-loop
    assert arg["meta"]["repairs"] == [
        "premise alpha-2 merged into alpha",
        "premise BETA normalised to beta",
        "premise Beta! normalised to beta",
        "collapsed duplicate ids",
        "conclusion Alpha normalised to alpha",
    ]
    assert doc["meta"]["extraction"]["merged"] == {"alpha-2": "alpha"}


def test_unicode_statements_get_ascii_ids(untagged_text):
    def responder(system, user, schema):
        if schema is STATEMENTS_SCHEMA:
            return {
                "statements": [
                    {"text": "Déjà vu est réel.", "mode": "is", "sources": ["p1"], "role": "stated", "note": "", "slug": "déjà-vu-réel"},
                    {"text": "第二段是真的。", "mode": "is", "sources": ["p2"], "role": "stated", "note": "", "slug": "第二段"},
                    {"text": "第三段也是。", "mode": "is", "sources": ["p2"], "role": "stated", "note": "", "slug": ""},
                ]
            }
        if schema is MERGE_SCHEMA:
            return {"merges": []}
        return {"arguments": []}

    doc = extract(untagged_text, FakeLLM(responder=responder))
    assert validate_dict(doc) == []
    assert [s["id"] for s in doc["statements"]] == ["deja-vu-reel", "statement", "statement-2"]
    assert doc["statements"][1]["text"] == "第二段是真的。"


@pytest.mark.parametrize(
    "response",
    [
        {"nope": 1},
        {"statements": "not a list"},
        {"statements": [{"text": "x"}]},
        {"statements": [{"text": "T", "mode": "maybe", "sources": [], "role": "stated", "note": "", "slug": "t"}]},
        {"statements": [{"text": "T", "mode": "is", "sources": "p1", "role": "stated", "note": "", "slug": "t"}]},
        [],
        None,
    ],
)
def test_malformed_provider_replies_are_llm_errors_not_crashes(untagged_text, response):
    class Bad:
        """A provider that does not check its own output, like a hand-written one might."""

        model = "bad"

        def complete(self, system, user, schema):
            return response

    with pytest.raises(LLMError, match="pass A, chunk 1: the reply does not match the expected schema"):
        extract(untagged_text, Bad())


def test_no_paragraphs_is_an_error(fake_llm):
    with pytest.raises(ExtractError, match="no paragraphs"):
        extract("   \n\n  ", fake_llm)


def test_no_statements_is_an_error(untagged_text):
    llm = FakeLLM(responder=lambda s, u, schema: {"statements": []})
    with pytest.raises(ExtractError, match="no statements"):
        extract(untagged_text, llm)


def test_progress_notes_an_oversize_paragraph(fake_llm):
    progress = []
    text = "[I.1] " + "Good sense is equal. " * 60 + "\n\n[I.2] Short.\n"
    extract(text, fake_llm, ExtractOptions(chunk_tokens=50, progress=progress.append))
    assert any(line.startswith("  note: paragraph I.1") and "exceeds the budget" in line for line in progress)
