# Roadmap

Status of the worldview-core project. Kept current by whoever is working on it.
Last updated 2026-09-03.

## Done

- **Core format + Python reference implementation.** JSON Schema, zero-dependency
  validator, canonicalization with an explicit whitespace set, two-layer identity
  hashing with SCC handling, structural queries (`rests-on`, `supports`,
  `foundations`, `sccs`), `plan` (argument planning against an audience's accepted
  statements), `present` (the whole case as Markdown), `stats`, `diff`, three-way
  `merge`, lints (`well-founded`, `duplicates`, `unused`, `empty-justifications`),
  DOT and Mermaid `export`, CLI with `--json`. 263 tests.
- **Specs.** `docs/FORMAT.md`, `docs/IDENTITY.md` (byte-level), `docs/QUERIES.md`.
- **Conformance suite.** `conformance/generate.py` emits vectors (cases, invalid docs,
  diffs, merges, extras, primitives) that every implementation replays.
- **TypeScript SDK** (`sdk/typescript`). Hash-identical port with the same CLI; 341
  tests replaying the vectors plus a cross-language fuzz against Python. Parity for
  the newer Python features (plan, lints, stats, present, export, merge) is in
  progress.
- **Extraction tool** (`tools/extract`, `worldview-extract`). Segmentation with
  citation keys, statement and argument passes, consolidation, repair,
  record/replay. 107 tests with a fake provider. Needs an API key for a real run
  (HUMAN_TODO 1).
- **CI and publishing scaffolding.** `ci.yml`, `pages.yml`, `publish-pypi.yml`,
  `publish-npm.yml`, dependabot, `CONTRIBUTING.md`. Pages, PyPI, and npm need one-time
  human setup (HUMAN_TODO 2 to 4).
- **Examples.** `walking-to-work` and its fork; Descartes, *A Discourse on the Method*,
  all six parts (473 statements, 249 arguments, valid, the Cartesian circle shows up
  as a cycle). First adversarial review found 15 medium and 67 low fidelity issues.

## In progress

- **Web editor** (`editor/`). Store, persistence, derived data, and dagre layout
  modules exist with tests. The UI (toolbar, statements/arguments panels, graph
  canvas, inspector, overview, diff, keyboard shortcuts, themes) and an e2e smoke
  suite are being written.
- **Descartes fidelity.** Applying the review findings, then a second review round.
- **TypeScript parity** for plan, lints, stats, present, export, merge, with the
  `extras` and `merges` vectors.
- **Documentation pass.** README overhaul covering every component; editor,
  extraction, and SDK docs; a "start here" page.

## Planned

- **Editor: redesign the interface from scratch, with Steve piloting.** The current
  UI was generated in one pass and looks it: it demonstrates that every piece works
  (the SDK, the graph layout, the inspector, diff, autosave) but the visual design
  and the interaction model were never actually designed. The value of what exists is
  that it proves the shape of the problem, so a real design can start from evidence
  rather than guesses. Do this one interactively, deciding the layout, the visual
  language, and what belongs on screen together, instead of generating a whole UI
  unattended. The store, derived data, and graph-layout modules are worth keeping;
  everything under `editor/src/views/` and `styles.css` is replaceable.
- **Defeasible extension** (`ext.defeasible`): argument kinds, attack relations
  (rebut, undercut), acceptability semantics. Separate package.
- **Bayesian extension** (`ext.bayes`): priors on statements, factors on arguments,
  inference over the factor graph. Separate package.
- **Editor: merge and fork UI.** Drive the three-way `merge` from the editor; keep a
  daily-driver worldview plus sandboxes in the browser.
- **Editor: plan and present views.** Audience-aware planning and a printable case.
- **Extraction: iterative refinement.** Feed reviewer findings back into the model;
  extraction of arguments from dialogue or notes rather than essays.
- **More examples.** Other public-domain philosophical texts; a moral code; a
  scientific theory with its assumptions made explicit; a personal worldview built
  with the extraction tool.
- **Releases.** Tag `py-v0.1.0`, `ts-v0.1.0`, `extract-v0.1.0` once the human setup is
  done and the project name is final.

## Open questions

- Real project name. `worldview-core` is a placeholder Steve has agreed to keep for
  now. Renaming touches: `pyproject.toml` (root and `tools/extract`), the `format`
  discriminator in the schema and every example, `sdk/typescript/package.json`, the
  editor title, all docs.
- Whether the editor should ever gain evaluation features of its own. The handoff
  says no: anything it needs should come from the library.
- Whether `present` and `export` (text output) belong in the conformance contract or
  should be allowed to differ between implementations. Currently they are exact-match
  vectors.
