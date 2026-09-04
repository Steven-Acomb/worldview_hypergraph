# worldview-core

[![CI](https://github.com/Steven-Acomb/worldview_hypergraph/actions/workflows/ci.yml/badge.svg)](https://github.com/Steven-Acomb/worldview_hypergraph/actions/workflows/ci.yml)

A portable JSON format for representing a **worldview**: a set of natural-language
**statements** connected by **arguments**, where an argument is a directed hyperedge
that takes N premise statements and produces M conclusion statements.

The format is the product. Everything else in this repository is a consumer of it: a
Python reference implementation, a hash-identical TypeScript port, a browser editor,
and an LLM-assisted extraction tool.

```
$ worldview rests-on examples/walking-to-work.json need-raincoat
need-raincoat: I should own a good raincoat.
  <- raincoat
      walk-commute: I should walk to work.
        <- walk-for-health [practical syllogism]
            exercise-good: Regular physical activity improves long-term health.  [foundation]
            walk-is-exercise: Walking for thirty minutes a day counts as regular physical activity.  [foundation]
            health-matters: I should act to protect my long-term health.  [foundation]
            commute-30: My commute takes about thirty minutes on foot.
              <- commute-from-reports
                  habit-reports: My reports about how I spend my time have matched outside observation.  [cycle: self-knowledge, habit-reports]
                    <- knowledge-vouches-reports
                        self-knowledge: My assessments of my own habits are accurate.  [cycle: self-knowledge, habit-reports]
                          <- reports-confirm-knowledge
                              habit-reports: ...  [cycle: self-knowledge, habit-reports; see above]
        <- walk-for-money
            car-costs: Driving to work costs more than walking.  [foundation]
            save-money: I should prefer the cheaper option when the options are otherwise equal.  [foundation]
      rain-often: It rains often where I live.  [foundation]
      rain-unpleasant: Walking in the rain without a raincoat is unpleasant.  [foundation]
```

Two independent arguments for walking to work, a coherentist pair reported as a cycle
rather than rejected, and the whole thing bottoming out in statements nothing argues
for. That is the entire model.

## Sixty-second tour

Neither package is published yet, so install from the repository:

```
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # Windows;  .venv/bin/pip on macOS / Linux

worldview validate examples/walking-to-work.json
worldview stats examples/descartes-discourse-on-method.json
worldview rests-on examples/walking-to-work.json need-raincoat
worldview present examples/walking-to-work.json need-raincoat > case.md
worldview diff examples/walking-to-work.json examples/walking-to-work-fork.json
```

[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) walks the same ground at more
length, including the editor, the libraries, and the extraction tool.

## What is in this repository

| path | what it is | tests |
|---|---|---|
| [`src/worldview_core/`](src/worldview_core/) | Python reference implementation and the `worldview` CLI. No runtime dependencies. | 267 |
| [`sdk/typescript/`](sdk/typescript/) | TypeScript and JavaScript port for Node and browsers, same hashes and the same CLI. No runtime dependencies. | 516 |
| [`editor/`](editor/) | Browser editor built on the TypeScript SDK. Entirely client-side: no server, no accounts. | 56 + e2e |
| [`tools/extract/`](tools/extract/) | `worldview-extract`: builds a worldview file from a text using the Claude API. | 107 |
| [`conformance/`](conformance/) | Shared JSON vectors (22 cases, 27 invalid documents, 12 diffs, 8 merges, 22 extras, plus hashing primitives) that every implementation replays. | — |
| [`examples/`](examples/) | Five worked worldviews and the public-domain source text one of them was built from. | — |
| [`docs/`](docs/) | The format, identity, and query specifications, plus a getting-started guide. | — |

The Python implementation is normative: when the two disagree, Python is right and the
conformance vectors are regenerated from it.

## Which entry point is for you

- **Reading or writing a file by hand.** [`docs/FORMAT.md`](docs/FORMAT.md) is the
  normative description of every field and rule.
- **Editing visually.** `editor/` runs locally with `npm run dev`; see
  [`editor/README.md`](editor/README.md). It is deployed to GitHub Pages once Pages is
  enabled for the repository (see [`HUMAN_TODO.md`](HUMAN_TODO.md)).
- **Calling a library.** Python or TypeScript, same operations and same results; see
  [`sdk/README.md`](sdk/README.md) for the side-by-side API table.
- **Building a worldview from someone's writing.** `worldview-extract`; see
  [`tools/extract/README.md`](tools/extract/README.md). Needs an Anthropic API key.
- **Porting to another language.** [`docs/IDENTITY.md`](docs/IDENTITY.md) specifies the
  hashing byte for byte, and the conformance vectors prove a port correct.

## What the format can and cannot say

The core is deliberately small. A file records that its author claims certain
statements follow from certain others, and nothing else.

- **It records structure only.** Every argument is read as "these premises, taken
  together, entail these conclusions." There are no credences, weights, probabilities,
  or strengths anywhere in the core.
- **It does not judge validity.** The validator checks that a file is well-formed and
  self-consistent. It never checks whether an argument is any good.
- **Statements are identified by their literal text.** "All men are mortal" and "All
  humans are mortal" are two different statements. This is intentional: they may
  genuinely differ in what the author means.
- **Cycles are allowed, silently.** A worldview may justify A by B and B by A. The
  format takes no position on whether justification must bottom out in foundations
  (the Münchhausen trilemma); foundationalist, coherentist, and infinitist worldviews
  are all representable. No validation rule rejects cycles and no warning is emitted.
  Every query treats cycles as structure and reports them as strongly connected
  components.
- **One file is one worldview**, self-contained. There are no imports or cross-file
  references.
- **Nothing is deductive, inductive, or defeasible.** The core has no argument kinds
  and no attack relations. Sister projects add those through the extension slot.

## The file format

A worldview file is a JSON object:

```json
{
  "format": "worldview-core",
  "version": "0.1",
  "name": "Walking to work",
  "description": "A small worldview about one everyday decision.",
  "meta": { "author": "example" },
  "statements": [
    { "id": "exercise-good",  "text": "Regular physical activity improves long-term health.", "mode": "is" },
    { "id": "health-matters", "text": "I should act to protect my long-term health.",         "mode": "ought" },
    { "id": "walk-commute",   "text": "I should walk to work.",                               "mode": "ought" }
  ],
  "arguments": [
    {
      "id": "walk-for-health",
      "premises": ["exercise-good", "health-matters"],
      "conclusions": ["walk-commute"],
      "justification": "If protecting my health is something I should do, and walking is a form of the activity that protects it, then walking is something I should do.",
      "rule": "practical syllogism"
    }
  ]
}
```

The normative definition is [`worldview-core.schema.json`](src/worldview_core/worldview-core.schema.json)
(JSON Schema 2020-12); `worldview schema` prints it, and
[`docs/FORMAT.md`](docs/FORMAT.md) explains every rule the schema cannot express.

### Header

| field | required | meaning |
|---|---|---|
| `format` | yes | Always the literal string `"worldview-core"`. |
| `version` | yes | Format version as `"major.minor"`, currently `"0.1"`. |
| `name`, `description` | no | Free text. Nothing at the file level is evaluative. |
| `meta` | no | Free-form object for human notes. |
| `ext` | no | Namespaced extension slot, see below. |
| `statements` | yes | Array of statements. Order is not meaningful. |
| `arguments` | yes | Array of arguments. Order is not meaningful. |

### Statement

There is exactly one node type.

| field | required | meaning |
|---|---|---|
| `id` | yes | A local identifier: any non-empty string with no whitespace, unique among statements in this file. It is only ever used to reference the statement from within the same file. Pick something readable. |
| `text` | yes | The proposition, in natural language. |
| `mode` | yes | `"is"` for a descriptive statement, `"ought"` for a normative one. Exactly these two values. |
| `meta` | no | Free-form object. If you want to call a statement an "axiom", "hypothesis", or "observation", say so here. The format defines no role vocabulary. |
| `ext` | no | Namespaced extension slot. |

"Axiom" is not a schema concept. Whether a statement is foundational is a *computed*
property: it has no incoming argument. The `foundations` query reports these.

### Argument

| field | required | meaning |
|---|---|---|
| `id` | yes | A local identifier, unique among arguments in this file. |
| `premises` | yes | Statement ids, N ≥ 0. Set semantics: order does not matter, no duplicates. The premises are consumed **jointly**: the argument asserts that all of them together support the conclusions. |
| `conclusions` | yes | Statement ids, M ≥ 1. Set semantics. Asserted **jointly**: the argument yields all M. |
| `justification` | yes | Prose explaining why the conclusions follow from the premises. |
| `rule` | no | Name of the inference pattern, e.g. `"modus ponens"`. Free text; no vocabulary is enforced. |
| `meta` | no | Free-form object. |
| `ext` | no | Namespaced extension slot. |

Alternatives ("D follows from {A, B} *or* from {C}") are written as two separate
arguments into D. An argument never encodes disjunction internally.

An argument with zero premises is legal though unusual. A premise may also appear in
the conclusions of the same argument; that is a self-loop, treated like any other
cycle.

### `meta` versus `ext`

Both are ignored by hashing and by every query. Two files that differ only in `meta`
or `ext` are the same worldview to the core.

- `meta` is for **unstructured human notes**. Anything goes inside.
- `ext` is for **machine-readable extensions**. Its keys are namespaces and each value
  must be an object: `"ext": { "defeasible": { ... }, "bayes": { ... } }`. The core
  validates only that shape and never looks inside.

No other fields are permitted on the header, a statement, or an argument. Extensions
go under `ext`, not alongside it.

## Identity: how two files are compared

Local ids are only meaningful inside one file. To recognise the same statement across
files, forks, and edits, both implementations compute two content-derived identities.
Neither is ever stored in the file; both are computed on demand.

- **Proposition id** identifies *what is being said*: a hash of the canonical text and
  the mode. Two statements with the same canonical text and mode are the same
  proposition, whatever their ids, files, or justifications.
- **Justified-statement id** identifies *what is being said and why*: a hash of the
  proposition id together with the hashes of every incoming argument, which in turn
  cover their premises' justified ids. It encodes the statement's whole upstream
  graph, so editing anything upstream changes it and editing anything downstream does
  not. Like a git commit hash.

The consequences are all intended: the same justification prose over different
premises is a different argument; the same statement text under a different
justification is the same proposition but a different justified statement; renaming
local ids, reordering arrays, and editing `meta`, `ext`, or `rule` change nothing.
Cycles would make the recursion loop, so strongly connected components are hashed as
units, which means changing any member of a mutually-justifying cluster changes the
identity of every member.

Canonicalization is literal by design: Unicode NFC, trim, collapse internal whitespace
runs to one space, and nothing else. No case folding, no punctuation stripping, no
stemming. Hashing is SHA-256 over a length-prefixed encoding, so different splits of
the same characters can never collide.

[`docs/IDENTITY.md`](docs/IDENTITY.md) gives the exact byte-level specification with
worked values; `conformance/vectors/` is its executable form.

## Command line

Both implementations ship the same CLI with the same commands and the same `--json`
output: `worldview` from the Python package, `node sdk/typescript/bin/worldview.js`
from the SDK. `--json` goes before the command name. Exit code 0 is success, 1 means
the file is not a valid worldview, 2 is a usage error or an unknown id.

| command | meaning |
|---|---|
| `validate <file>` | Schema check plus referential integrity: ids unique, every referenced id exists. Add `--jsonschema` to also run the `jsonschema` package if installed. Never warns about cycles. |
| `rests-on <file> <id> [--depth N]` | Upstream closure of a statement, reported **per incoming argument** so you can see each justification and what it depends on. Cycles are reported as components. |
| `supports <file> <id> [--depth N]` | Downstream closure: what this statement contributes to, per outgoing argument, with the co-premises of each. |
| `foundations <file>` | Statements with no incoming argument. |
| `sccs <file>` | Cyclic strongly connected components (size > 1 or self-loop), with the arguments inside and on the boundary of each. |
| `plan <file> <id> [--given a,b,...]` | Argument planning: given what an audience already accepts, which foundations they must still grant and which statements must be established, with the arguments available for each. |
| `present <file> <id> [--given ...]` | The full case for a statement as a Markdown document: every argument with its justification, down to the foundations. |
| `stats <file>` | Counts, cycle sizes, longest chain of arguments, most supporting and most supported statements. |
| `ids <file>` | `prop_id` and `just_id` for every statement, `arg_hash` for every argument. |
| `diff <a> <b>` | Match statements across two files by identity. Four buckets: **identical** (`just_id` matches), **rejustified** (`prop_id` matches, `just_id` does not), **added**, **removed**. Arguments are matched by `arg_hash`. |
| `merge <base> <ours> <theirs> [-o out]` | Three-way merge of two forks of one worldview, by local id and content. Exit 1 on conflicts. |
| `export <file> --format dot\|mermaid` | The hypergraph as Graphviz DOT or a Mermaid flowchart, for pictures. |
| `lint well-founded` | Optional, informational: statements not grounded in any foundation. |
| `lint duplicates`, `unused`, `empty-justifications`, `is-ought`, `all` | More optional lints: the same proposition under several ids; statements in no argument; arguments with a blank justification; arguments deriving an `ought` from `is` premises alone. |
| `schema` | Print the JSON Schema. |

In `rests-on` and `supports` output, each statement is expanded once. A later
encounter of the same statement is a leaf marked "see above" (`"seen": true` in
JSON). That keeps the output linear in the size of the closure and makes cycles
finite. `--depth` limits how many argument hops are expanded; cut-off nodes are
marked "depth limit" (`"truncated": true`). The flat closure in the JSON output is
always complete regardless of depth.

`lint well-founded` calls a statement *grounded* if it is a foundation, or if some
argument concluding it has all of its premises grounded. This is the least fixed
point, so a statement whose only support runs through a cycle is ungrounded, and a
statement that needs two premises is ungrounded if either one is. A zero-premise
argument grounds its conclusions.

Every result shape is documented once, in [`docs/QUERIES.md`](docs/QUERIES.md).

## Library

The CLI is a thin wrapper. Every operation is a function that takes a worldview and
returns plain data.

```python
from worldview_core import load, validate_dict, compute_identities
from worldview_core import rests_on, supports, foundations, sccs, well_founded
from worldview_core import plan, present, stats, diff, merge, lint_all, to_dot, to_mermaid

wv = load("examples/walking-to-work.json")         # raises LoadError / ValidationError
problems = validate_dict(raw_dict)                 # [] if valid, else list of strings

ids = compute_identities(wv)
ids.prop_id["walk-commute"]                        # 64-hex proposition id
ids.just_id["walk-commute"]                        # 64-hex justified-statement id
ids.scc_of("habit-reports")                        # ['self-knowledge', 'habit-reports'] or None

rests_on(wv, "need-raincoat", depth=2)             # same dict the CLI prints as JSON
plan(wv, "need-raincoat", given=["walk-commute"])  # what an audience must still grant
present(wv, "need-raincoat")                       # Markdown: the whole case, foundations up
diff(wv, load("examples/walking-to-work-fork.json"))
merge(base, ours, theirs)                          # three-way merge of two forks
to_mermaid(wv)                                     # picture source
```

The same operations in TypeScript, in camelCase, for Node and browsers:

```ts
import { parseWorldviewJson, restsOn, computeIdentities, plan, diff } from "worldview-core";

const wv = parseWorldviewJson(text);
restsOn(wv, "need-raincoat").closure;
computeIdentities(wv).justId.get("need-raincoat");
```

`Worldview`, `Statement`, and `Argument` mirror the JSON exactly and round-trip a
loaded file unchanged. `Graph.build(wv)` exposes adjacency, strongly connected
components in topological order, and reachability, if you want to write your own
queries. Neither library has runtime dependencies, and both are meant to be vendored.

## Decisions on open items

These were left open in the design handoff and are decided here.

- **Canonicalization** uses NFC, trim, and whitespace collapse, nothing else.
  "Whitespace" is a fixed list of 29 code points spelled out in `canon.py` so every
  implementation agrees; U+FEFF is not whitespace.
- **`version`** is a simple `"major.minor"` string, not semver. There is no patch
  component because a format either changed meaning or it did not.
- **Self-loops within one argument** (a premise that is also a conclusion of the same
  argument) are allowed. They form a cyclic component of size one.
- **Large `rests-on` output** is handled with `--depth` and the once-per-statement
  expansion. There is no pagination; the JSON closure is always complete.
- **Local ids** are any non-empty string without whitespace. The schema does not
  impose a slug alphabet.
- **Unknown fields are rejected** at every level, so that extension data cannot be
  mistaken for core data. Extensions go under `ext`.
- **Arguments "touching" a cyclic component**, for the purpose of hashing it, are the
  arguments with at least one conclusion inside it. Arguments that only use a member
  as a premise are downstream and do not affect the component's identity.
- **Duplicate propositions in one file** (two statements with the same text and mode)
  are permitted; `diff` matches them as a multiset.
- **Text outputs are part of the conformance contract.** `present`, `export`, and the
  CLI's `--json` are compared character for character between implementations.

## Extensions and sister projects

The core reserves `ext` so other projects can add data without changing what a file
means. Each reads core files unchanged, adds its data under its own namespace, and
ships its own evaluator. None of them modifies core semantics.

Two consumers live in this repository and add no semantics of their own: the
[editor](editor/), which gets everything it computes from the SDK, and the
[extraction tool](tools/extract/), which only writes core files.

Two are planned as separate packages:

- **Defeasible extension** (`ext.defeasible`). Argument kinds (deductive, inductive,
  abductive, defeasible) and attack relations (rebut, undercut), evaluated with an
  acceptability semantics rather than reachability.
- **Bayesian extension** (`ext.bayes`). Priors on statements, factors on arguments. The
  core hypergraph is already a factor graph.

The full design rationale is in [`docs/handoff.md`](docs/handoff.md).

## Status

Everything above works and is covered by tests. Nothing is published to PyPI or npm
yet, and the editor is not yet deployed, because each needs a one-time account setup
recorded in [`HUMAN_TODO.md`](HUMAN_TODO.md). [`ROADMAP.md`](ROADMAP.md) tracks what
is built and what is next; [`CHANGELOG.md`](CHANGELOG.md) records changes.

## Development

```
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # Windows;  .venv/bin/pip on macOS / Linux
python -m pytest
```

Requires Python 3.11 or newer. The TypeScript SDK needs Node 18 or newer and the
editor's build needs Node 20.19 or newer; CI runs Node 22.
[`CONTRIBUTING.md`](CONTRIBUTING.md) has the per-component commands and explains how
the conformance vectors are regenerated.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
