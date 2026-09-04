"""End to end: the CLI on a two-chunk document, replayed from a hand-written recording.

``fixtures/two-chunk-replay.jsonl`` was written by hand (no request hashes,
no usage figures) to play a model that:

* re-extracts the part-one health statement in part two, once with only
  whitespace differences (exact de-duplication) and once reworded under the
  same slug (it becomes ``exercise-good-2`` and the consolidation reply
  merges it), so de-duplication across chunks is exercised both ways;
* cites a key in brackets and a key that does not exist;
* in pass B references the merged-away id, a premise that was never
  extracted (``walk-safe``, a dangling reference that must be repaired), a
  mis-cased id (``Save-Money``), and a conclusion that does not exist
  (``need-raincoat``).

The replies are served in pipeline order: pass A for each chunk, the
consolidation pass, then pass B for each chunk.  ``--chunk-tokens 100``
is what makes the fixture text two chunks (one per heading).
"""

from __future__ import annotations

import json

from conftest import FIXTURES
from worldview_core import Worldview, foundations, rests_on, validate_dict
from worldview_core.cli import main as worldview_main
from worldview_extract import cli

TEXT = FIXTURES / "two-chunk.txt"
REPLAY = FIXTURES / "two-chunk-replay.jsonl"


def run(out_dir, *extra, replay=REPLAY):
    out_dir.mkdir(exist_ok=True)
    out = out_dir / "two-chunk.json"
    rc = cli.main([str(TEXT), "-o", str(out), "--chunk-tokens", "100", "--replay", str(replay), *extra])
    return rc, out


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_two_chunk_replay_produces_the_expected_worldview(tmp_path, capsys):
    rc, out = run(tmp_path, "--verbose")
    err = capsys.readouterr().err
    assert rc == 0, err
    assert "hash mismatch" not in err  # hand-written records carry no hash and are never checked
    assert "pass A: chunk 1/2" in err and "pass B: chunk 2/2" in err
    assert "wrote " in err and "7 statements, 2 arguments, 5 repair(s)" in err

    doc = load(out)
    assert validate_dict(doc) == []
    assert doc["name"] == "two-chunk"

    st = {s["id"]: s for s in doc["statements"]}
    assert list(st) == [
        "exercise-good",
        "walk-is-exercise",
        "health-matters",
        "commute-30",
        "car-costs",
        "save-money",
        "walk-commute",
    ]
    # de-duplicated across chunks: exactly (whitespace) and by the merge pass (reworded, same slug)
    assert "exercise-good-2" not in st
    assert st["exercise-good"]["text"] == "Regular physical activity improves long-term health."
    assert st["exercise-good"]["meta"] == {"sources": ["1.1", "2.1"], "role": "stated", "note": "restated from part one"}
    # citation keys: brackets stripped, unknown key dropped, duplicates collapsed
    assert st["walk-commute"]["meta"]["sources"] == ["2.2"]
    assert st["health-matters"]["mode"] == "ought" and st["commute-30"]["mode"] == "is"

    ar = {a["id"]: a for a in doc["arguments"]}
    assert list(ar) == ["walk-for-health", "walk-for-money"]
    health = ar["walk-for-health"]
    assert health["premises"] == ["exercise-good", "walk-is-exercise", "health-matters", "commute-30"]
    assert health["conclusions"] == ["walk-commute"]
    assert health["rule"] == "practical syllogism"
    assert health["meta"] == {
        "sources": ["1.1", "1.2"],
        "repairs": [
            "premise exercise-good-2 merged into exercise-good",
            "dropped unknown premise(s) walk-safe",
        ],
    }
    money = ar["walk-for-money"]
    assert money["premises"] == ["car-costs", "save-money"] and money["conclusions"] == ["walk-commute"]
    assert "rule" not in money
    assert money["meta"] == {"sources": ["2.2"], "repairs": ["premise Save-Money normalised to save-money"]}

    ex = doc["meta"]["extraction"]
    assert ex["model"] == "hand-written" and ex["source"] == "two-chunk.txt"
    assert ex["chunking"] == {
        "segmentation": "tagged",
        "paragraphs": 4,
        "skipped_blocks": 0,
        "chunk_tokens": 100,
        "chunks": 2,
        "window_threshold": 150,
    }
    assert ex["merged"] == {"exercise-good-2": "exercise-good"}
    assert ex["repairs"] == [
        "argument walk-for-health: premise exercise-good-2 merged into exercise-good",
        "argument walk-for-health: dropped unknown premise(s) walk-safe",
        "argument walk-for-money: premise Save-Money normalised to save-money",
        "argument ghost: dropped unknown conclusion(s) need-raincoat",
        "argument ghost: dropped (no valid conclusion left)",
    ]
    assert ex["usage"]["calls"] == 5 and ex["usage"]["input_tokens"] == 0  # the recording has no usage figures

    # the result is an ordinary worldview for the core library and CLI
    wv = Worldview.from_dict(doc)
    assert [f["id"] for f in foundations(wv)] == [
        "exercise-good",
        "walk-is-exercise",
        "health-matters",
        "commute-30",
        "car-costs",
        "save-money",
    ]
    tree = rests_on(wv, "walk-commute")["tree"]
    assert [a["argument"] for a in tree["arguments"]] == ["walk-for-health", "walk-for-money"]
    assert worldview_main(["validate", str(out)]) == 0


def test_two_chunk_replay_is_reproducible(tmp_path, capsys):
    def strip_date(path):
        doc = load(path)
        doc["meta"]["extraction"].pop("date")
        return doc

    rc, first = run(tmp_path / "1")
    assert rc == 0
    # a second replay of the same recording gives the same document
    rc, second = run(tmp_path / "2")
    assert rc == 0
    assert strip_date(first) == strip_date(second)
    # recording the replay, then replaying the recording, gives it again (now with request hashes that match)
    log = tmp_path / "rec.jsonl"
    rc, third = run(tmp_path / "3", "--record", str(log))
    assert rc == 0
    records = [json.loads(ln) for ln in log.read_text(encoding="utf-8").splitlines()]
    assert len(records) == 5 and all(r["request_hash"] for r in records)
    assert strip_date(third) == strip_date(first)
    capsys.readouterr()
    rc, fourth = run(tmp_path / "4", replay=log)
    assert rc == 0
    assert "hash mismatch" not in capsys.readouterr().err
    assert strip_date(fourth) == strip_date(first)


def test_two_chunk_replay_with_the_wrong_chunking_fails_cleanly(tmp_path, capsys):
    # With the default budget the text is one chunk, so the second recorded reply (pass A for
    # chunk 2) is served to the consolidation pass and does not fit its schema.
    rc = cli.main([str(TEXT), "-o", str(tmp_path / "out.json"), "--replay", str(REPLAY)])
    assert rc == 1
    err = capsys.readouterr().err
    assert "error:" in err and "does not match schema" in err
    assert not (tmp_path / "out.json").exists()
