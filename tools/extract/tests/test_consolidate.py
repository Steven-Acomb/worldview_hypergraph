"""Consolidation: exact de-duplication, id assignment, the merge mapping, windowing."""

from __future__ import annotations

from worldview_extract.assemble import StatementRec, slug_from_text, slugify, unique_id
from worldview_extract.llm import FakeLLM
from worldview_extract.pipeline import Candidate, ExtractOptions, consolidate, visible_statements
from worldview_extract.prompts import MERGE_SCHEMA
from worldview_extract.segment import Chunk, Paragraph


def C(text, mode="is", slug="", chunk=0, sources=None, role="stated", note=""):
    return Candidate(text=text, mode=mode, sources=sources or [], role=role, note=note, slug=slug, chunk=chunk)


def run(candidates, merges=None, **opts):
    llm = FakeLLM(responses=[{"merges": merges or []}])
    statements, mapping = consolidate(candidates, llm, ExtractOptions(**opts), say=lambda m: None)
    return statements, mapping, llm


# ----------------------------------------------------------------- slugs


def test_slugify():
    assert slugify("Good Sense, Equal!") == "good-sense-equal"
    assert slugify("  --Déjà vu--  ") == "deja-vu"
    assert slugify("###", "fallback") == "fallback"
    long = slugify("a-" * 40)
    assert len(long) <= 48 and not long.endswith("-")
    assert slug_from_text("I think, therefore I am, said he") == "i-think-therefore-i-am"


def test_unique_id():
    taken: set[str] = set()
    assert unique_id("x", taken) == "x"
    assert unique_id("x", taken) == "x-2"
    assert unique_id("x", taken) == "x-3"
    assert taken == {"x", "x-2", "x-3"}


# --------------------------------------------------------- exact dedupe


def test_exact_duplicates_collapse_on_canonical_text_and_mode():
    statements, mapping, llm = run(
        [
            C("Good sense is equal.", slug="good-sense", chunk=0, sources=["I.1"]),
            C("  Good   sense is equal. ", slug="other-slug", chunk=1, sources=["I.2"], role="implied", note="n"),
            C("Good sense is equal.", mode="ought", slug="good-sense", chunk=1),
        ]
    )
    assert [s.id for s in statements] == ["good-sense", "good-sense-2"]
    first = statements[0]
    assert first.text == "Good sense is equal."  # the first spelling wins
    assert first.sources == ["I.1", "I.2"] and first.chunks == {0, 1}
    assert first.role == "stated" and first.note == "n"
    assert statements[1].mode == "ought"
    assert mapping == {}
    assert llm.usage.calls == 1  # one merge pass


def test_ids_fall_back_to_text_when_slug_is_unusable():
    statements, _, _ = run([C("The senses deceive.", slug="???"), C("Blank slug", slug="")])
    assert [s.id for s in statements] == ["the-senses-deceive", "blank-slug"]
    assert all(" " not in s.id for s in statements)


def test_empty_candidate_list_makes_no_llm_call():
    statements, mapping, llm = run([])
    assert statements == [] and mapping == {} and llm.usage.calls == 0


def test_single_statement_skips_the_merge_pass():
    statements, _, llm = run([C("Only one.", slug="one")])
    assert [s.id for s in statements] == ["one"] and llm.usage.calls == 0


# ------------------------------------------------------------- merges


def test_merge_mapping_resolves_chains_and_ignores_bad_ids():
    statements, mapping, _ = run(
        [
            C("A.", slug="a", chunk=0, sources=["p1"]),
            C("A again.", slug="b", chunk=1, sources=["p2"]),
            C("A once more.", slug="c", chunk=2, sources=["p3"]),
            C("Unrelated.", slug="d"),
            C("Ought thing.", mode="ought", slug="e"),
        ],
        merges=[
            {"keep": "b", "drop": ["c"], "reason": "same"},
            {"keep": "a", "drop": ["b"], "reason": "same"},
            {"keep": "zzz", "drop": ["d"], "reason": "unknown keep"},
            {"keep": "d", "drop": ["zzz", "d"], "reason": "unknown drop / self"},
            {"keep": "d", "drop": ["e"], "reason": "cross-mode"},
            {"keep": "c", "drop": ["a"], "reason": "would be circular"},
        ],
    )
    assert mapping == {"c": "a", "b": "a"}
    assert [s.id for s in statements] == ["a", "d", "e"]
    a = statements[0]
    assert a.sources == ["p1", "p2", "p3"] and a.chunks == {0, 1, 2}


def test_merge_pass_is_batched():
    cands = [C(f"Statement {i}.", slug=f"s{i}") for i in range(5)]
    llm = FakeLLM(responses=[{"merges": []}, {"merges": []}, {"merges": []}])
    statements, _ = consolidate(cands, llm, ExtractOptions(merge_batch=2), say=lambda m: None)
    assert len(statements) == 5 and llm.usage.calls == 3
    assert all(c["schema"] is MERGE_SCHEMA for c in llm.calls)
    assert "s0 [is]: Statement 0." in llm.calls[0]["user"] and "s2" not in llm.calls[0]["user"]


# ---------------------------------------------------------- windowing


def test_visible_statements_windows_to_the_neighbourhood():
    recs = [StatementRec(id=f"s{i}", text="t", mode="is", chunks={i}) for i in range(6)]
    chunk = Chunk(index=3, paragraphs=[Paragraph(key="k", text="t", heading=None, index=0)])
    assert visible_statements(recs, chunk, threshold=10) == recs
    window = visible_statements(recs, chunk, threshold=2)
    assert [s.id for s in window] == ["s2", "s3", "s4"]
    far = Chunk(index=42, paragraphs=[])
    assert visible_statements(recs, far, threshold=2) == recs  # never show an empty list
