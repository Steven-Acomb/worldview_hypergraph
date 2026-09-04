"""Regenerate ``small-replay.jsonl`` from the scripted responder.

Run it whenever the prompts change (otherwise the replay test warns about
request-hash mismatches):

    python tools/extract/tests/fixtures/regenerate.py

The recording is what ``worldview-extract tests/fixtures/small.txt
--record`` would have produced against a model that answers exactly like
``tests/scripted.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # tests/, for `scripted`

import scripted  # noqa: E402

from worldview_extract import ExtractOptions, FakeLLM, RecordingLLM, extract  # noqa: E402

SOURCE = HERE / "small.txt"
TARGET = HERE / "small-replay.jsonl"


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    # must match what the CLI does for `worldview-extract small.txt -o ...` with default flags
    options = ExtractOptions(name=SOURCE.stem, source=SOURCE.name)
    with RecordingLLM(FakeLLM(responder=scripted.respond), TARGET) as llm:
        doc = extract(text, llm, options)
    print(f"wrote {TARGET}: {llm.usage.calls} responses; {len(doc['statements'])} statements, {len(doc['arguments'])} arguments")


if __name__ == "__main__":
    main()
