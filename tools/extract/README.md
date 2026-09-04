# worldview-extract

LLM-assisted extraction: turn a plain-text document into a
[worldview-core](../../README.md) file using the Claude API.

The tool reads a document in chunks, asks the model for the propositions the
author asserts or relies on (statements), consolidates them, asks for the
inferences that connect them (arguments), and writes a worldview-core file that
passes `worldview validate`. Every statement and argument cites the paragraphs
it came from so a reviewer can check it against the source.

```
$ worldview-extract examples/sources/descartes-discourse-on-method.txt \
      -o examples/descartes.json --name "Discourse on the Method" --link --verbose
```

It is a consumer of the core format, not part of it: the core has no dependency
on this package, and nothing here changes what a worldview file means.

## Install

The package depends on `worldview-core` (the repo root) and the official
`anthropic` SDK. Install the root package first, then this one:

```
python -m venv .venv
.venv/Scripts/pip install -e .                       # Windows; macOS/Linux: .venv/bin/pip
.venv/Scripts/pip install -e "tools/extract[dev]"    # [dev] adds pytest
worldview-extract --help
```

Requires Python 3.11 or newer and `anthropic>=1.0` (the tool uses structured
outputs, `output_config.format`, which older SDKs do not expose).

## Run

```
worldview-extract INPUT.txt -o OUT.json [options]

  --name NAME            document name for the header and prompts (default: input file stem)
  --description TEXT     free-text description for the header
  --model ID             Claude model id (default: claude-opus-5)
  --chunk-tokens N       approximate token budget per chunk (default: 3000)
  --link                 run the whole-document cross-chunk linking pass (pass C)
  --dry-run              print the chunks and the prompts; call no API
  --record FILE.jsonl    write every model response to FILE
  --replay FILE.jsonl    serve responses from FILE instead of calling the API
  -v, --verbose          progress and repair log on stderr
```

Credentials are resolved the way the SDK resolves them: `ANTHROPIC_API_KEY`,
or `ANTHROPIC_AUTH_TOKEN`, or a profile written by `ant auth login`. If none is
found the tool stops with a clear message before doing anything, unless
`--dry-run` or `--replay` is given, which never contact the API.

Exit code 0 is success; 1 means the extraction failed (API error, refusal, a
result that could not be made valid, or an output file that could not be
written after the run, in which case the document is printed to stdout so the
run is not lost); 2 is a usage error caught before any model call (unreadable
input, no output path, an output directory that does not exist, an unreadable
replay file, an unwritable record file, no credentials).

A good first step on a new document is a dry run:

```
$ worldview-extract essay.txt --dry-run
segmentation: untagged, 41 paragraphs
chunks: 6 (budget ~3000 tokens each)
  chunk 1: 7 paragraphs, ~2871 tokens, keys p1..p7, heading "Introduction"
  ...
```

It shows how the text was segmented, every chunk with its citation keys and the
headings it spans, which paragraphs are larger than the budget, an estimate of
the prompt tokens, the system prompts of every pass, and the pass A user prompt
for the first chunk (`--verbose` prints all of them).

## Input format

Two styles are recognised automatically.

**Tagged.** Every paragraph starts with a citation key in square brackets, as in
[`examples/sources/descartes-discourse-on-method.txt`](../../examples/sources/descartes-discourse-on-method.txt):

```
# PART IV

[IV.1] I am in doubt as to the propriety of making my first meditations ...

[IV.2] ...
```

Keys are taken from the tags (`IV.1`). Lines starting with `# ` are headings and
are passed to the model as context. Blocks with neither a tag nor a heading
(front matter, a licence) are skipped, and the dry run reports how many.

**Untagged.** Plain prose. Paragraphs are separated by blank lines and get keys
`p1`, `p2`, ... in order; `# ` headings are context and are not numbered.

Paragraph boundaries are blank lines, so hard-wrapped text is joined back into
one paragraph. Two exceptions keep other layouts working: a line that begins
with a heading marker or a `[KEY]` tag always starts a new paragraph even
without a blank line before it, and a document with no blank line anywhere is
read one paragraph per line.

Chunks are packed from consecutive paragraphs up to `--chunk-tokens`
(estimated at about 3.5 characters per token). A paragraph is never split; one
larger than the budget becomes a chunk on its own, and the dry run and the
progress log say so. Once a chunk is at least half full, a change of heading
starts a new chunk so sections stay together.

## Default model and cost

The default is **`claude-opus-5`**. Extraction is intelligence-sensitive in a
way that is hard to check afterwards: paraphrasing a proposition, choosing
`is` versus `ought`, surfacing a hidden premise, and deciding whether two
statements are the same proposition all change what the author is recorded as
saying, and a wrong merge is silent. A document is extracted once and then
reviewed by a person, so quality per document matters more than cost per token.
Opus 5 is the current general-purpose flagship, supports structured outputs, and
its 1M context comfortably holds a whole document for the linking pass. Adaptive
thinking is on by default on Opus 5 and is left on.

Rough cost, at Opus 5 list prices ($5 per million input tokens, $25 per million
output tokens), for a 100,000-word document (about 135k tokens, ~45 chunks):

| pass | input tokens | output tokens |
|---|---|---|
| A: statements, per chunk | ~200k (chunk + system prompt) | ~150-200k, thinking included |
| consolidation | ~50k | ~5-10k |
| B: arguments, per chunk | ~400k (chunk + statement window) | ~150-250k, thinking included |
| C: linking (`--link`) | ~80k | ~10-30k |

That is on the order of **$10-20 per 100,000 words**; the output side, which
includes thinking tokens, dominates and varies with how dense the text is.
`--model claude-sonnet-5` ($2 / $10) runs the same pipeline for roughly a third
of that and is a reasonable choice for a first pass over a long text.
`claude-fable-5-1` costs about twice Opus 5 and brings nothing this task needs.
From the library you can also lower `effort` (`AnthropicLLM(effort="medium")`)
to cut thinking tokens. The actual usage of every run is recorded in the output
file under `meta.extraction.usage`.

## How it works

```
segment ──> pass A (per chunk) ──> consolidate ──> pass B (per chunk) ──> [pass C] ──> assemble + repair + validate
            candidate statements    exact dedupe     arguments over the      cross-chunk
                                    + LLM merge      consolidated list       arguments
```

1. **Segment** the text into paragraphs with stable citation keys and pack
   them into chunks (above).
2. **Pass A**, one call per chunk: candidate statements, each with `text`,
   `mode`, `sources` (citation keys), `role` (`stated`, `implied`, or
   `assumption` for a surfaced hidden premise), a reviewer `note`, and a
   kebab-case `slug` that becomes the local id.
3. **Consolidate.** Candidates with the same canonical text
   (`worldview_core.canon`: NFC, trimmed, whitespace collapsed) and mode are
   merged exactly, their sources unioned. Ids are assigned from the slugs and
   made unique (`good-sense-equal`, `good-sense-equal-2`). Then one model call
   (batched above 600 statements) proposes merges of near-duplicates and
   returns them as *keep / drop* pairs; the pipeline turns those into a mapping
   `dropped id -> kept id`, ignoring unknown ids, cross-mode merges, and
   anything circular. The mapping is written to `meta.extraction.merged`.
4. **Pass B**, one call per chunk: arguments as `premises`, `conclusions`,
   `justification`, `rule`, `sources`, `slug`, using only ids from the
   statement list shown. Up to 150 statements the whole list is shown; above
   that, only statements that came from the chunk or its two neighbours.
5. **Pass C** (`--link`): one whole-document call with every statement and a
   compact list of the arguments so far, asking for the cross-section arguments
   the per-chunk passes could not see. These get `meta.link: true`.
6. **Assemble** the file, then **repair** the references in every argument. A
   reference to an id the consolidation pass merged away is rewritten to the
   surviving id; a reference that differs from an existing id only in case,
   whitespace, or punctuation is rewritten to that id; any other unknown
   reference is dropped. The repair never invents a reference. Then duplicate
   ids inside a premise or conclusion list are collapsed, an argument with no
   conclusion left is dropped, an argument repeating an earlier one's premise
   set and conclusion set is dropped, and a duplicate argument id is renamed.
   Every change is logged (`--verbose`), listed in `meta.extraction.repairs`,
   and, for each surviving argument that was changed, repeated under that
   argument's own `meta.repairs` so a reviewer sees it next to the argument.
   The result is validated with `worldview_core.validate_dict`; a document that
   is still invalid is an error, never written.

Every reply is checked against the pass's schema by the pipeline itself,
whatever provider produced it, so a malformed reply is a clean error rather
than a crash.

### What the output looks like

```json
{
  "format": "worldview-core",
  "version": "0.1",
  "name": "Discourse on the Method",
  "meta": {
    "extraction": {
      "tool": "worldview-extract",
      "version": "0.1.0",
      "model": "claude-opus-5",
      "date": "2026-09-03T18:20:11Z",
      "source": "descartes-discourse-on-method.txt",
      "chunking": { "segmentation": "tagged", "paragraphs": 64, "skipped_blocks": 50,
                    "chunk_tokens": 3000, "chunks": 15, "window_threshold": 150 },
      "link_pass": true,
      "repairs": ["argument doubt-from-error: dropped unknown premise(s) senses-reliable"],
      "merged": { "senses-deceive-2": "senses-deceive" },
      "usage": { "calls": 32, "input_tokens": 412310, "output_tokens": 98770,
                 "cache_creation_input_tokens": 1450, "cache_read_input_tokens": 41300 }
    }
  },
  "statements": [
    { "id": "senses-deceive", "text": "My senses have sometimes deceived me.", "mode": "is",
      "meta": { "sources": ["IV.1"], "role": "stated" } }
  ],
  "arguments": [
    { "id": "distrust-from-deception", "premises": ["senses-deceive"], "conclusions": ["distrust-senses"],
      "justification": "It is prudent never to trust completely what has deceived me even once.",
      "meta": { "sources": ["IV.1"] } },
    { "id": "doubt-from-error", "premises": ["reason-errs"], "conclusions": ["distrust-senses"],
      "justification": "Since even careful reasoners err, and my senses (which I take to be reliable) have deceived me, ...",
      "meta": { "sources": ["IV.1"], "repairs": ["dropped unknown premise(s) senses-reliable"] } }
  ]
}
```

Everything the tool adds lives in `meta`, which the core ignores for identity
and queries, so an extracted file diffs and hashes like any hand-written one.

## Prompt design

All prompts are in [`prompts.py`](src/worldview_extract/prompts.py). Every
pass shares one preamble, the **format rules**, which restate the core's design
stances in the model's terms: one node type (no axioms, definitions, or
questions as separate kinds; foundations are computed, not declared); `is`
versus `ought` chosen from content; premises consumed jointly and alternatives
as separate arguments (never an "or" inside one); no weights or argument kinds;
cycles allowed and never flagged; the author's own first person; paraphrase
into self-contained modern prose; surface hidden assumptions as statements with
role `assumption`; and record what the author claims, never evaluate it.

Each pass then adds its task and field list. Pass A is told to prefer
completeness (a duplicate costs little, a missed statement cannot be argued
from). Consolidation is told that identity is literal and a wrong merge silently
changes what the author says, so it should merge only when either statement
would serve equally in any argument. Pass B is told to copy ids exactly and
never to invent one or substitute a statement the author did not rely on: if a
needed premise is missing from the list, it records the argument with the
listed premises it does use and names the gap in the justification so a
reviewer can add the statement. Pass C asks for a small number of
well-supported cross-section links rather than many speculative ones.

Mechanically:

- **JSON is forced with structured outputs** (`output_config.format` of type
  `json_schema`), so the reply is schema-valid JSON, not prose to parse. The
  schemas mark every object `additionalProperties: false` with all fields
  required; optional text is an empty string. Replies are checked against the
  schema again client-side.
- **System prompts are constant across a run** (the document name goes in the
  user message) and carry a `cache_control` breakpoint, so the API's prompt
  cache can serve them for every chunk once they exceed the model's minimum
  cacheable length.
- **Requests are streamed** so long replies do not hit HTTP timeouts;
  `max_tokens` is 32000, far above what a chunk's statements or arguments need
  even with thinking tokens counted.
- **Retries with backoff**: rate limits, overload, 5xx, connection errors, and
  malformed replies are retried (four attempts, exponential backoff with
  jitter, waiting at least as long as a `retry-after` header asks) on top of
  the SDK's own retries. Authentication, permission, not-found, bad-request,
  and request-too-large errors, a refusal (`stop_reason: "refusal"`, reported
  with its category), and a reply truncated at `max_tokens` fail immediately
  with a clear message that includes the request id.

## Recording and replaying

`--record responses.jsonl` writes one line per model call: the call index, a
hash of the request (system prompt, user prompt, schema), the model, a short
preview of the user prompt, that call's token usage, and the response. Prompts
themselves are not stored, so the file is a fraction of the size of the run.

`--replay responses.jsonl` serves those responses back in order instead of
calling the API, which reproduces a run without a key (and is how the CLI is
tested). If a request's hash differs from the recording, a warning is printed
and the recorded response is used anyway; that lets you re-run after a harmless
prompt edit, but a replay against a *different document* or chunk size will
either fail (a recorded reply of the wrong shape, or the recording running
out) or produce nonsense, so read the warnings. From the library,
`ReplayLLM(path, strict=True)` makes any mismatch an error. A record without a
`request_hash` (one written by hand) is never checked, and `usage` is optional.

`--record` and `--replay` can be combined to re-record a replay.

## Library

```python
from worldview_extract import AnthropicLLM, ExtractOptions, FakeLLM, RecordingLLM, ReplayLLM, extract

doc = extract(text, AnthropicLLM("claude-opus-5"), ExtractOptions(name="Essay", link=True))
# doc is a dict that passes worldview_core.validate_dict; json.dump it yourself
```

`extract(text, llm, options)` is the whole pipeline. `llm` is anything with
`complete(system: str, user: str, schema: dict) -> dict` returning JSON that
matches the schema (the pipeline checks it and raises `LLMError` if it does
not); `model` and `usage` attributes are read if present. `ExtractOptions`
holds `name`, `description`, `chunk_tokens`, `link`, `source` (the file name
to record), `model` (recorded; defaults to `llm.model`), `window_threshold`,
`merge_batch`, and an optional `progress` callback.
`dry_run_report(text, options, verbose=False)` returns the dry-run text.

Providers: `AnthropicLLM(model, client=None, api_key=None, max_tokens=32000,
max_attempts=4, base_delay=2.0, max_delay=60.0, effort=None, timeout=600.0,
sleep=time.sleep)`; `FakeLLM(responses=[...])` or `FakeLLM(responder=fn)` for
tests; `RecordingLLM(inner, path)` and `ReplayLLM(path, strict=False)` as
above. `LLMError` is raised when a completion cannot be obtained; `ExtractError`
when the result cannot be made valid.

## Limitations

- **The model can hallucinate.** It may attribute a claim the author never
  made, paraphrase a nuance away, pick the wrong mode, or invent an inference
  the text does not contain. Citation keys make this checkable, not impossible.
  Treat the output as a draft.
- **The tool cannot judge validity**, and neither can the format. An argument in
  the output means the model read the author as claiming the premises support
  the conclusion, nothing more.
- **Merging is a judgement call.** The consolidation pass can merge two
  statements that differ in a way that matters, or leave duplicates that
  should have been merged. The mapping is in `meta.extraction.merged`.
- **Hidden premises are surfaced in pass A only.** Pass B works over the fixed
  statement list; a premise it finds missing is named in the justification and
  noted in `meta.repairs` if the model referenced it anyway, so a reviewer can
  add the statement, but the tool does not add it.
- **Chunk boundaries lose context.** An argument whose premise and conclusion
  sit in different chunks is only found by `--link`, and that single pass sees
  a compact list, not the text.
- **Sources are as good as the model's citations.** Keys the model cites that
  do not exist are dropped; a statement can end up with an empty `sources`.
- **A run that fails late is lost**, apart from what `--record` captured; the
  recording cannot be resumed against the API.
- **Cost is real and non-deterministic**: two runs of the same document give
  different files. Record the run you like.

Review the output before trusting it:

```
worldview validate OUT.json                # well-formed and self-consistent
worldview foundations OUT.json             # what the extraction takes as unargued
worldview lint well-founded OUT.json       # what does not rest on any foundation
worldview rests-on OUT.json SOME-ID        # walk one conclusion back to its sources
```

and open the file in the editor to read each statement against the paragraph it
cites.

## Tests

```
.venv/Scripts/python -m pytest tools/extract/tests
```

No test touches the network: the SDK client is mocked for `AnthropicLLM`, the
pipeline runs on a scripted `FakeLLM`, and the CLI is exercised with
`--dry-run` and with `--replay` from two recordings under `tests/fixtures/`.
`small-replay.jsonl` is generated from the scripted responder; if the prompts
change, regenerate it with `python tools/extract/tests/fixtures/regenerate.py`
(the replay test warns about request-hash mismatches until you do).
`two-chunk-replay.jsonl` is written by hand (no hashes) and drives the
end-to-end test of de-duplication across chunks and reference repair.

## License

GPL-3.0-or-later, like the rest of the repository.
