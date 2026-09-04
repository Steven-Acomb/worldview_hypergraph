"""Segmentation: tagged and untagged input, chunking."""

from __future__ import annotations

import pytest

from conftest import DESCARTES
from worldview_extract.segment import (
    Paragraph,
    estimate_tokens,
    make_chunks,
    oversize_paragraphs,
    segment,
    split_blocks,
)


def test_split_blocks_joins_lines_and_drops_empties():
    blocks = split_blocks("﻿a\nb\n\n\n  c  \r\n\r\nd")
    assert blocks == ["a b", "c", "d"]


def test_hard_wrapped_paragraphs_stay_whole():
    blocks = split_blocks("[A.1] one\ntwo [not a tag]\nthree\n\n[A.2] four\n#not a heading\nfive")
    assert blocks == ["[A.1] one two [not a tag] three", "[A.2] four #not a heading five"]


def test_tag_and_heading_lines_start_new_blocks_without_blank_lines():
    seg = segment("# Head\n[A.1] Text.\n[A.2] More\nwrapped.\n\n[A.3] Last.\n# Tail\n[A.4] End.")
    assert seg.mode == "tagged"
    assert [(p.key, p.heading, p.text) for p in seg.paragraphs] == [
        ("A.1", "Head", "Text."),
        ("A.2", "Head", "More wrapped."),
        ("A.3", "Head", "Last."),
        ("A.4", "Tail", "End."),
    ]


def test_no_blank_lines_means_one_paragraph_per_line():
    seg = segment("[A.1] First claim.\n[A.2] Second claim.\n[A.3] Third claim.\n")
    assert seg.mode == "tagged"
    assert [(p.key, p.text) for p in seg.paragraphs] == [("A.1", "First claim."), ("A.2", "Second claim."), ("A.3", "Third claim.")]
    seg = segment("# Title\nFirst para.\nSecond para.\nThird para.\n")
    assert seg.mode == "untagged"
    assert [(p.key, p.text, p.heading) for p in seg.paragraphs] == [
        ("p1", "First para.", "Title"),
        ("p2", "Second para.", "Title"),
        ("p3", "Third para.", "Title"),
    ]


def test_tagged_document(small_text):
    seg = segment(small_text)
    assert seg.mode == "tagged"
    assert [p.key for p in seg.paragraphs] == ["I.1", "I.2", "I.3", "II.1", "II.2", "II.3"]
    assert seg.skipped == 3  # start banner, end banner, licence-like block
    assert seg.paragraphs[0].heading == "Section One"
    assert seg.paragraphs[3].heading == "Section Two"
    assert seg.paragraphs[0].text.startswith("Good sense is the most equally distributed")
    assert seg.paragraphs[0].index == 0 and seg.paragraphs[5].index == 5
    assert seg.keys == {"I.1", "I.2", "I.3", "II.1", "II.2", "II.3"}


def test_untagged_document(untagged_text):
    seg = segment(untagged_text)
    assert seg.mode == "untagged"
    assert [p.key for p in seg.paragraphs] == ["p1", "p2", "p3", "p4"]
    assert seg.skipped == 0
    # two lines without a blank line between them are one paragraph
    assert seg.paragraphs[0].text == (
        "Regular physical activity improves long-term health. "
        "Walking for thirty minutes a day counts as regular physical activity."
    )
    assert seg.paragraphs[0].heading == "A note on walking"
    assert seg.paragraphs[2].heading == "Money"


def test_a_single_tag_does_not_make_a_document_tagged():
    seg = segment("[x] one tagged paragraph\n\nplain\n\nplain again\n\nmore plain")
    assert seg.mode == "untagged"
    assert [p.key for p in seg.paragraphs] == ["p1", "p2", "p3", "p4"]


def test_duplicate_tags_are_disambiguated():
    seg = segment("[A.1] first\n\n[A.1] second\n\n[A.2] third")
    assert [p.key for p in seg.paragraphs] == ["A.1", "A.1.2", "A.2"]


def test_unicode_text_and_keys_survive():
    seg = segment("[Ü.1] Café naïve — “quoted” text.\n\n[Ü.2] 第二段。\n\n[Ü.3] third")
    # a non-ASCII key is not a tag, so the document is untagged; the text itself is untouched
    assert seg.mode == "untagged"
    assert seg.paragraphs[1].text == "[Ü.2] 第二段。"
    seg = segment("[u.1] Café naïve.\n\n[u.2] 第二段。")
    assert seg.mode == "tagged" and [p.text for p in seg.paragraphs] == ["Café naïve.", "第二段。"]


def test_chunks_never_split_a_paragraph_and_respect_budget():
    paras = [Paragraph(key=f"p{i}", text="word " * 40, heading=None, index=i) for i in range(10)]
    per = estimate_tokens(paras[0].text)
    chunks = make_chunks(paras, chunk_tokens=per * 3)
    assert [len(c.paragraphs) for c in chunks] == [3, 3, 3, 1]
    assert [c.index for c in chunks] == [0, 1, 2, 3]
    assert all(c.tokens <= per * 3 for c in chunks)
    assert [p.key for c in chunks for p in c.paragraphs] == [p.key for p in paras]


def test_oversize_paragraph_gets_its_own_chunk_and_is_reported():
    big = Paragraph(key="big", text="x" * 4000, heading=None, index=0)
    small = Paragraph(key="small", text="y" * 10, heading=None, index=1)
    chunks = make_chunks([small, big, small], chunk_tokens=100)
    assert [c.keys for c in chunks] == [["small"], ["big"], ["small"]]
    assert [p.key for p in oversize_paragraphs(chunks, 100)] == ["big"]
    assert oversize_paragraphs(chunks, 5000) == []


def test_heading_change_breaks_a_half_full_chunk():
    paras = [
        Paragraph(key="a", text="w " * 100, heading="One", index=0),
        Paragraph(key="b", text="w " * 100, heading="One", index=1),
        Paragraph(key="c", text="w " * 100, heading="Two", index=2),
    ]
    per = estimate_tokens(paras[0].text)
    chunks = make_chunks(paras, chunk_tokens=per * 4)  # room for all three, but a+b is at least half
    assert [c.keys for c in chunks] == [["a", "b"], ["c"]]
    assert chunks[1].heading == "Two"


def test_chunk_headings_lists_every_heading_spanned():
    paras = [
        Paragraph(key="a", text="t", heading="One", index=0),
        Paragraph(key="b", text="t", heading="One", index=1),
        Paragraph(key="c", text="t", heading="Two", index=2),
        Paragraph(key="d", text="t", heading=None, index=3),
    ]
    chunk = make_chunks(paras, 1000)[0]
    assert chunk.headings == ["One", "Two"] and chunk.heading == "One"


def test_chunk_render_shows_headings_when_they_change(small_text):
    seg = segment(small_text)
    chunk = make_chunks(seg.paragraphs, chunk_tokens=100_000)[0]
    rendered = chunk.render()
    assert rendered.startswith("# Section One\n\n[I.1] ")
    assert "\n# Section Two\n\n[II.1] " in rendered
    assert rendered.count("# Section One") == 1


def test_chunk_tokens_must_be_positive():
    with pytest.raises(ValueError):
        make_chunks([], 0)


@pytest.mark.skipif(not DESCARTES.exists(), reason="example source not present")
def test_descartes_source_segments_as_tagged():
    seg = segment(DESCARTES.read_text(encoding="utf-8"))
    assert seg.mode == "tagged"
    keys = [p.key for p in seg.paragraphs]
    assert len(keys) == 64
    assert keys[0] == "NOTE.1" and keys[1] == "I.1" and keys[-1] == "VI.12"
    assert seg.paragraphs[1].heading == "PART I"
    assert not any("Project Gutenberg" in p.text for p in seg.paragraphs)
    assert seg.skipped == 50  # the Gutenberg banners and licence
    chunks = make_chunks(seg.paragraphs, 3000)
    assert 10 <= len(chunks) <= 20
    assert sum(len(c.paragraphs) for c in chunks) == 64
    assert [p.key for p in oversize_paragraphs(chunks, 3000)] == ["V.7"]
