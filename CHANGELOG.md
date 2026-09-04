# Changelog

All notable changes to this repository. The format version (the `version` field inside
a worldview file) and the package versions move independently and are tracked
separately below.

Nothing has been released yet: no tag, no PyPI or npm package. Everything here is in
the `Unreleased` section until the one-time publishing setup in `HUMAN_TODO.md` is
done.

## Unreleased

### Format 0.1

- Initial format: one node type (a statement with `is`/`ought` mode) and one edge type
  (an argument as a directed hyperedge from N joint premises to M joint conclusions),
  free-form `meta`, namespaced `ext`, unknown fields rejected everywhere, cycles valid
  and never warned about. Specified in `docs/FORMAT.md`.
- Identity: proposition id, argument hash, and justified-statement id, with strongly
  connected components hashed as units so cycles terminate. Canonicalization is NFC,
  trim, and whitespace collapse over an explicit 29-code-point whitespace set.
  Specified byte for byte in `docs/IDENTITY.md`.
- Query result shapes fixed in `docs/QUERIES.md`, including the text output of
  `present` and `export`, which is compared character for character across
  implementations.

### worldview-core, Python 0.1.0

- Loading, validation (hand-written, mirroring the schema, cross-checked against the
  `jsonschema` package in tests), and content-derived identities.
- Structural queries: `rests-on`, `supports`, `foundations`, `sccs`.
- `plan`: what an audience must grant and what must still be established to reach a
  statement, given what they already accept.
- `present`: the full case for a statement as a Markdown document.
- `stats`: counts, cycle sizes, longest chain of arguments, most supporting and most
  supported statements.
- `diff` by content identity, and three-way `merge` of two forks with conflict
  reporting.
- `export` to Graphviz DOT and Mermaid.
- Lints, all informational and never validation failures: `well-founded`,
  `duplicates`, `unused`, `empty-justifications`, `is-ought` (arguments concluding an
  `ought` from `is` premises alone), and `all`.
- CLI covering every operation, with `--json` output and documented exit codes.
- No runtime dependencies. Python 3.11 or newer. 267 tests.

### worldview-core, TypeScript 0.1.0

- Port of the Python implementation for Node and browsers with identical hashes and
  identical `--json` and text output, including a pure-TypeScript SHA-256 and a port
  of CPython's `textwrap.wrap` so that `present` and `export` match character for
  character.
- The same CLI, including argparse conventions (`--`, unique-prefix option
  abbreviation, Python `int()` parsing of numeric options).
- No runtime dependencies. 516 tests, replaying every conformance vector, plus a
  cross-language fuzz script that compares against the Python implementation on
  randomly generated worldviews.

### Conformance suite

- `conformance/generate.py` emits vectors from the Python reference: 22 cases with
  their identities and query results, 27 invalid documents, 12 diffs, 8 merges, 22
  extras (plan, lints, stats, present, DOT, Mermaid), and hashing primitives.
- Both test suites replay them, and CI fails if the committed vectors differ from what
  the current Python code produces.

### Editor 0.1.0

- Vite and TypeScript single-page editor built on the TypeScript SDK, entirely
  client-side: no server, no accounts, autosave to `localStorage`.
- Statement and argument panels with search and filters; forms with id renaming that
  updates every reference, and `meta`/`ext` JSON editing that rejects invalid input
  without losing the document.
- SVG hypergraph view with pan, zoom, fit, and a focus mode that draws only a
  statement's closure to a chosen depth; foundations, cycle members, and ungrounded
  statements are marked.
- Inspector with identities and collapsible rests-on and supports trees; overview with
  foundations, cycles, lints, and an ids table; a diff view against another file.
- Undo and redo, keyboard shortcuts, light and dark themes, drag-and-drop opening,
  recent documents.
- 56 unit tests including jsdom smoke tests, plus a Playwright end-to-end suite.
- Not yet deployed: the Pages workflow exists but GitHub Pages has to be enabled once
  by hand.

### worldview-extract 0.1.0

- Builds a worldview file from a plain-text document using the Claude API: chunking
  with stable citation keys, a statement pass, consolidation and deduplication, an
  argument pass, an optional cross-chunk linking pass, validation, and repair.
- Record and replay of model responses, so a run can be reproduced without an API key,
  and `--dry-run` to inspect chunks and prompts without calling the API.
- 107 tests, none of which touch the network.

### Examples

- `walking-to-work` and `walking-to-work-fork`: a twelve-statement everyday worldview
  and an edited copy, for `diff`.
- `semmelweis-handwashing`: a scientific argument with its hidden assumptions made
  explicit.
- `keeping-promises`: a small moral code, including one argument that deliberately
  derives an `ought` from an `is` so the `is-ought` lint has something to find.
- `descartes-discourse-on-method`: all six parts of the *Discourse*, 510 statements and
  268 arguments with paragraph citations, reviewed twice against the source text. The
  Cartesian circle appears as a four-statement cycle.

### Infrastructure

- CI on every push and pull request: Python 3.11, 3.12 and 3.13, the TypeScript SDK,
  the editor, the extraction tool, and a conformance-vector drift check.
- Workflows for GitHub Pages deployment, PyPI publishing by trusted publishing, and
  npm publishing with provenance, all waiting on one-time account setup.
- Documentation: format, identity, and query specifications, a getting-started guide,
  per-component READMEs, `CONTRIBUTING.md`, `ROADMAP.md`, and `HUMAN_TODO.md`.
