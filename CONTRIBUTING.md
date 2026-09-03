# Contributing

This repository is a small monorepo around one thing: the `worldview-core` file
format. Everything else here exists to read, write, port, or check that format.
This document says where things are, how to run each test suite, how the
conformance vectors work, and how releases happen.

## The format is the product

Read [`docs/handoff.md`](docs/handoff.md) before changing anything under
`src/`, `conformance/`, or `sdk/`. It records the design decisions, and a few
of them are not up for renegotiation in a pull request:

- **The core records structure only.** A file says that its author claims some
  statements follow from some others. No credences, weights, probabilities,
  strengths, or argument kinds live in the core. Those belong to sister projects
  under the `ext` slot (`ext.defeasible`, `ext.bayes`), each with its own
  evaluator.
- **Evaluation logic is out of scope.** The validator checks that a file is
  well-formed and self-consistent; it never checks whether an argument is any
  good. The editor adds no evaluation logic of its own: anything it needs comes
  from the SDK, which mirrors the reference implementation.
- **Cycles are allowed, silently.** No validation rule, helper, or default may
  reintroduce a DAG assumption. Queries treat cycles as structure.
- **Identity is computed, never stored.** `prop_id`, `just_id`, and `arg_hash`
  are derived from content on demand and never written into a worldview file.
- **Canonicalization is literal.** NFC, trim, collapse whitespace, nothing else.
- **Unknown fields are rejected** at every level so extension data can never be
  mistaken for core data.

If a change needs one of these to bend, open an issue and discuss it first.

## Repository layout

| path | what it is | published as |
|---|---|---|
| `src/worldview_core/` | Python reference implementation and the normative JSON Schema | `worldview-core` on PyPI |
| `tests/` | Python test suite; also replays the conformance vectors | |
| `conformance/` | `generate.py` and the committed `vectors/` every implementation must match | |
| `sdk/typescript/` | TypeScript port of the core, hash-identical to Python | `worldview-core` on npm |
| `editor/` | Vite single-page web editor built on the TypeScript SDK | GitHub Pages |
| `tools/extract/` | LLM-assisted extraction of a worldview file from a text | `worldview-extract` on PyPI |
| `examples/` | Example worldview files and the source texts they were built from | |
| `docs/` | Design handoff and specifications | |
| `.github/` | CI, publishing, Pages, Dependabot, pull request template | |
| `ROADMAP.md` | Status of the project | |
| `HUMAN_TODO.md` | Things only a human can do (secrets, settings, accounts) | |

Requirements: Python 3.11 or newer, Node 22 or newer, npm.

## Running the test suites

Every suite is independent except that the editor needs a built SDK. Run the
ones for the components you touched; CI runs all of them on every push and
pull request.

### Python reference implementation (repo root)

```
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # Windows
.venv/bin/pip install -e ".[dev]"         # macOS / Linux
python -m pytest
```

### TypeScript SDK

```
cd sdk/typescript
npm ci
npm run build
npm test
```

### Editor

The editor depends on the SDK through `file:../sdk/typescript`, so build the SDK
first.

```
cd sdk/typescript && npm ci && npm run build
cd ../../editor
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` writes `editor/dist`. The Pages deployment builds with
`VITE_BASE_PATH=/worldview_hypergraph/` because the site is served from that
sub-path; leave the variable unset for a local build.

### Extraction tool

The tool depends on the root package, so install that first.

```
pip install -e ".[dev]"
pip install -e "tools/extract[dev]"
python -m pytest tools/extract
```

## Conformance vectors

`conformance/vectors/` is the cross-implementation contract. It holds JSON
files generated from the Python reference implementation:

- `primitives.json`: `canon` and `H` input/output pairs.
- `cases/*.json`: a worldview plus everything the library computes from it
  (identities, foundations, SCCs, well-founded lint, `rests_on` and `supports`).
- `invalid/*.json`: documents that must be rejected.
- `diffs/*.json`: pairs of cases and the expected diff between them.

Both the Python and the TypeScript test suites replay these files. They are
**committed on purpose**, even though Python can regenerate them, because:

1. The TypeScript SDK (and any future port) has to prove it computes the same
   hashes without running Python.
2. A change that moves any hash shows up in code review as a diff to the
   vectors, where it can be seen and argued about, instead of silently
   rewriting the identity of every existing worldview file.
3. CI regenerates them on every run and fails if the committed files differ,
   so the reference implementation and the contract cannot drift apart.

To regenerate, from the repo root with the package installed:

```
python conformance/generate.py
git status conformance/vectors        # look at what changed and why
```

Regenerate whenever you deliberately change canonicalization, hashing,
validation, a query, `diff`, `generate.py` itself, or one of the two example
files under `examples/` that the generator reads. Commit the regenerated files
in the same commit as the change that caused them, and update the TypeScript
SDK in the same pull request so its suite stays green. If the vectors change
and you did not expect them to, that is a bug in your change, not in the
vectors.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

| job | what it does |
|---|---|
| `python` (3.11, 3.12, 3.13) | `pip install -e ".[dev]"`, `pytest`, then `python conformance/generate.py` and `git diff --exit-code -- conformance/vectors` |
| `typescript` | `npm ci`, `npm run build`, `npm test` in `sdk/typescript` |
| `editor` | builds the SDK, then `npm ci`, `npm run typecheck`, `npm test`, `npm run build` in `editor` |
| `extract` | installs the root package and `tools/extract[dev]`, then `pytest tools/extract` |

A newer push to the same branch cancels the run in flight. All four jobs must
pass before a pull request is merged.

## Releases

Each package is released by pushing a tag. The tag prefix picks the package and
the rest of the tag must equal the version recorded in that package; the
workflow refuses to publish otherwise.

| tag | publishes | version comes from | workflow |
|---|---|---|---|
| `py-vX.Y.Z` | `worldview-core` to PyPI | `pyproject.toml` | `publish-pypi.yml` |
| `extract-vX.Y.Z` | `worldview-extract` to PyPI | `tools/extract/pyproject.toml` | `publish-pypi.yml` |
| `ts-vX.Y.Z` | `worldview-core` to npm | `sdk/typescript/package.json` | `publish-npm.yml` |

To release, for example, the Python package at 0.2.0:

```
# 1. bump version = "0.2.0" in pyproject.toml and commit it
git commit -am "Release worldview-core 0.2.0"
# 2. tag and push
git tag py-v0.2.0
git push origin main py-v0.2.0
```

PyPI publishing uses Trusted Publishing (OIDC) through the `pypi` GitHub
environment; there is no API token in the repository. npm publishing uses the
`NPM_TOKEN` repository secret and attaches a provenance attestation, which
requires the `repository` field of `sdk/typescript/package.json` to point at
this repository.

The editor is not versioned. `.github/workflows/pages.yml` rebuilds and
deploys it to GitHub Pages on every push to `main` (and on demand from the
Actions tab).

Package versions are independent of each other and of the format's own
`version` field (`"0.1"`), which only changes when the meaning of a file
changes.

## Commit messages

Follow the style already in the history:

- A short imperative subject line, capitalized, no trailing period, ideally
  under 72 characters: `Add conformance vectors`, `Spell out canon whitespace
  with escapes`. Several related changes can share a subject joined by
  semicolons.
- A blank line, then a body when the subject is not the whole story. Say
  *why*; the diff already says what. Bullet lists are fine. Wrap at 72
  characters.
- One logical change per commit. Regenerated conformance vectors belong in the
  commit that caused them.
- Keep trailers such as `Co-Authored-By:` when work was done with a
  collaborator or an assistant.

## Pull requests

- Fill in the template. The checklist exists because the items on it are the
  things that would be expensive to get wrong.
- CI must be green, including the vector currency check.
- Update `ROADMAP.md` when a roadmap item changes state, and add anything only
  a human can do (a secret, a repository setting, an account) to
  `HUMAN_TODO.md` rather than leaving it in a comment.
- Line endings are LF everywhere; `.gitattributes` enforces this so that
  hashes of fixtures and vectors never depend on the operating system. Do not
  override it.

## License

Contributions are accepted under the repository license, GPL-3.0-or-later.
