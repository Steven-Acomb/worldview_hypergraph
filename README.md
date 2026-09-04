# worldview-core

A portable JSON format for representing a **worldview**: a set of natural-language
**statements** connected by **arguments**, where an argument is a directed hyperedge
that takes N premise statements and produces M conclusion statements.

This repository holds the format's normative JSON Schema and a small, dependency-free
Python reference implementation: a validator, content-derived identity hashing, a
handful of structural queries, a diff, and a CLI that exposes all of it.

The format is the product. Editors, LLM-assisted extraction from someone's writing,
defeasible or Bayesian evaluators, and so on are downstream consumers (see
[Extensions and sister projects](#extensions-and-sister-projects)).

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
(JSON Schema 2020-12). `worldview schema` prints it. Two full examples live in
[`examples/`](examples/).

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
files, forks, and edits, the library computes two content-derived identities. Neither
is ever stored in the file; both are computed on demand.

**Proposition id** identifies *what is being said*:

```
prop_id(s) = H( canon(s.text), s.mode )
```

Two statements with the same canonical text and mode are the same proposition,
regardless of file, slug, or how they are justified.

**Justified-statement id** identifies *what is being said and why*, recursively:

```
arg_hash(a) = H( canon(a.justification),
                 sorted( just_id(p) for p in a.premises ),
                 sorted( prop_id(c) for c in a.conclusions ) )

just_id(s)  = H( prop_id(s), sorted( arg_hash(a) for a in incoming(s) ) )
```

A statement's justified id encodes its whole upstream graph. The consequences are
all intended:

- The same justification prose over different premises is a different argument.
- The same statement text over a different justification is the same proposition but
  a different justified statement.
- Editing one upstream statement changes the justified id of everything downstream,
  and nothing upstream. Like git.
- Renaming local ids, reordering arrays, and editing `meta`, `ext`, or `rule` change
  nothing.

**Cycles** would make that recursion loop, so strongly connected components are hashed
as units. For a cyclic component C (size > 1, or one statement with a self-loop):

```
arg_hash'(a)    = arg_hash(a), but with prop_id(p) instead of just_id(p)
                  for premises p inside C
scc_hash(C)     = H( sorted( prop_id(s) for s in C ),
                     sorted( arg_hash'(a) for a in arguments concluding into C ) )
just_id(s in C) = H( scc_hash(C), prop_id(s) )
```

Changing any member of a mutually-justifying cluster changes the identity of every
member. That is correct: in such a cluster the justifications are shared. Editing a
statement that merely *rests on* the cluster changes only itself and its downstream.

**Canonicalization** (`canon`) is literal by design: Unicode NFC normalization, strip
leading and trailing whitespace, collapse internal whitespace runs to one space. No
case folding, no punctuation stripping, no stemming. "Whitespace" is a fixed list of
code points (Unicode categories Zs, Zl, Zp plus the ASCII and Latin-1 separator
controls), spelled out in `canon.py` so every implementation agrees; U+FEFF is not
whitespace.

**Hashing** is SHA-256 over a length-prefixed encoding of the parts, so different
splits of the same characters can never collide. Every hash is 64 hex characters.

## Command line

```
pip install .            # or: pip install -e ".[dev]" for development
worldview --help
```

Every command takes `--json` (before the command name) for machine-readable output.
Exit code 0 is success, 1 means the file is not a valid worldview, 2 is a usage error
or an unknown id.

| command | meaning |
|---|---|
| `validate <file>` | Schema check plus referential integrity: ids unique, every referenced id exists. Add `--jsonschema` to also run the `jsonschema` package if installed. Never warns about cycles. |
| `rests-on <file> <id> [--depth N]` | Upstream closure of a statement, reported **per incoming argument** so you can see each justification and what it depends on. Cycles are reported as components. |
| `supports <file> <id> [--depth N]` | Downstream closure: what this statement contributes to, per outgoing argument, with the co-premises of each. |
| `foundations <file>` | Statements with no incoming argument. |
| `sccs <file>` | Cyclic strongly connected components (size > 1 or self-loop), with the arguments inside and on the boundary of each. |
| `plan <file> <id> [--given a,b,...]` | Argument planning: given what an audience already accepts, which foundations they must still grant and which statements must be established, with the arguments available for each. |
| `lint well-founded <file>` | Optional, informational: statements not grounded in any foundation. |
| `lint duplicates`, `lint unused`, `lint empty-justifications`, `lint is-ought`, `lint all` | More optional lints: the same proposition under several ids; statements in no argument; arguments with a blank justification; arguments deriving an `ought` from `is` premises alone. |
| `present <file> <id> [--given ...]` | The full case for a statement as a Markdown document: every argument with its justification, down to the foundations. |
| `stats <file>` | Counts, cycle sizes, longest chain of arguments, most supporting and most supported statements. |
| `ids <file>` | `prop_id` and `just_id` for every statement, `arg_hash` for every argument. |
| `diff <a> <b>` | Match statements across two files by identity. Four buckets: **identical** (`just_id` matches), **rejustified** (`prop_id` matches, `just_id` does not), **added**, **removed**. Arguments are matched by `arg_hash`. |
| `merge <base> <ours> <theirs> [-o out]` | Three-way merge of two forks of one worldview, by local id and content. Exit 1 on conflicts. |
| `export <file> --format dot\|mermaid` | The hypergraph as Graphviz DOT or a Mermaid flowchart, for pictures. |
| `schema` | Print the JSON Schema. |

In `rests-on` and `supports` output, each statement is expanded once. A later
encounter of the same statement is a leaf marked "see above" (`"seen": true` in
JSON). That keeps the output linear in the size of the closure and makes cycles finite.
`--depth` limits how many argument hops are expanded; cut-off nodes are marked
"depth limit" (`"truncated": true`). The flat closure in the JSON output is always
complete regardless of depth.

`lint well-founded` calls a statement *grounded* if it is a foundation, or if some
argument concluding it has all of its premises grounded. This is the least fixed
point, so a statement whose only support runs through a cycle is ungrounded, and a
statement that needs two premises is ungrounded if either one is. A zero-premise
argument grounds its conclusions.

## Library

The CLI is a thin wrapper. Every operation is a function that takes a `Worldview` and
returns plain dicts and lists.

```python
from worldview_core import load, validate_dict, compute_identities
from worldview_core import rests_on, supports, foundations, sccs, well_founded, diff
from worldview_core import plan, lint_all, to_dot, to_mermaid

wv = load("examples/walking-to-work.json")        # raises LoadError / ValidationError
problems = validate_dict(raw_dict)                # [] if valid, else list of strings

ids = compute_identities(wv)
ids.prop_id["walk-commute"]                       # 64-hex proposition id
ids.just_id["walk-commute"]                       # 64-hex justified-statement id
ids.arg_hash["walk-for-health"]
ids.scc_of("habit-reports")                       # ['self-knowledge', 'habit-reports'] or None

rests_on(wv, "need-raincoat", depth=2)            # same dict the CLI prints as JSON
plan(wv, "need-raincoat", given=["walk-commute"])  # what an audience must still grant
present(wv, "need-raincoat")                      # Markdown: the whole case, foundations up
diff(wv, load("examples/walking-to-work-fork.json"))
merge(base, ours, theirs)                         # three-way merge of two forks
stats(wv)
to_mermaid(wv)                                    # picture source
```

`Worldview`, `Statement`, and `Argument` are plain dataclasses mirroring the JSON;
`Worldview.to_dict()` round-trips a loaded file exactly. `Graph.build(wv)` exposes
adjacency, `sccs()` in topological order, and reachability if you want to write your
own queries.

The library has no runtime dependencies and is meant to be vendored. The hand-written
validator mirrors the schema exactly; the test suite cross-checks the two with the
`jsonschema` package.

## Decisions on open items

These were left open in the design handoff and are decided here.

- **Canonicalization** uses the default rules above: NFC, trim, collapse whitespace,
  nothing else.
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

## Extensions and sister projects

The core reserves `ext` so sister projects can add data without changing what a file
means. Each reads core files unchanged, adds its data under its own namespace, and
ships its own evaluator. None of them modifies core semantics.

- **Visual editor.** Reads and writes core files; any logic it needs comes from this
  library.
- **Extraction tool.** LLM-assisted: build a worldview file from a person's writing or
  stated beliefs.
- **Defeasible extension** (`ext.defeasible`). Argument kinds (deductive, inductive,
  abductive, defeasible) and attack relations (rebut, undercut), evaluated with an
  acceptability semantics rather than reachability.
- **Bayesian extension** (`ext.bayes`). Priors on statements, factors on arguments. The
  core hypergraph is already a factor graph.

The full design rationale is in
[`docs/handoff.md`](docs/handoff.md).

## Development

```
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # Windows
.venv/bin/pip install -e ".[dev]"         # macOS / Linux
python -m pytest
```

Requires Python 3.11 or newer.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
