# Roadmap

Status of the worldview-core project. Kept current by whoever is working on it.

## Done

- **Core format + Python reference implementation** (2026-09-03). JSON Schema,
  zero-dependency validator, canonicalization and two-layer identity hashing with
  SCC handling, structural queries (`rests-on`, `supports`, `foundations`, `sccs`,
  `lint well-founded`), `diff`, CLI with JSON mode, 137 tests, two example worldviews.

## In progress

- **Conformance suite.** Shared JSON test vectors generated from the Python
  implementation so every other implementation can prove it computes identical hashes
  and query results.
- **TypeScript SDK.** Full port of the core (validate, identities, queries, diff),
  hash-identical to Python, verified against the conformance suite. npm-publishable.
- **Web editor.** Vite + TypeScript single-page app under `editor/`, built on the
  TypeScript SDK. Load, edit, visualise, query, diff, and save worldview files
  entirely client-side. Deployed to GitHub Pages.
- **Descartes example.** *A Discourse on Method* (all six parts) extracted into a
  worldview file with citations back to the text.
- **LLM extraction tool.** CLI that builds a worldview file from a text using the
  Claude API.
- **Publishing.** CI on every push; PyPI and npm publishing on tags; Pages deploy for
  the editor.
- **Documentation.** Format spec, identity spec, SDK docs, editor docs, extraction docs.

## Planned

- **Defeasible extension** (`ext.defeasible`): argument kinds, attack relations
  (rebut, undercut), acceptability semantics. Separate package.
- **Bayesian extension** (`ext.bayes`): priors on statements, factors on arguments,
  inference over the factor graph. Separate package.
- **Worldview forking workflow.** Tooling around `diff` for maintaining a daily-driver
  worldview plus sandboxes: fork, edit, three-way merge by identity.
- **Argument planning.** Given a conclusion and a set of statements an audience already
  accepts, compute what still has to be established.
- **More examples.** Other public-domain philosophical texts; a moral code; a
  scientific theory with its assumptions made explicit.

## Open questions

- Real project name. `worldview-core` is a placeholder Steve has agreed to keep for now.
- Whether the editor should ever gain evaluation features of its own. The handoff
  says no: anything it needs should come from the library.
