# Changelog

All notable changes to this repository. The format version (the `version` field in a
worldview file) and the package versions are tracked separately below.

## Unreleased

### Format 0.1

- Initial format: statements (`is`/`ought`) and hyperedge arguments, `meta` and `ext`
  slots, unknown fields rejected, cycles allowed. See `docs/FORMAT.md`.
- Identity: proposition id, argument hash, justified-statement id with SCC handling;
  explicit whitespace set for canonicalization. See `docs/IDENTITY.md`.

### worldview-core (Python) 0.1.0

- Validator, identities, queries (`rests-on`, `supports`, `foundations`, `sccs`,
  `lint well-founded`), `diff`, CLI with `--json`.
- Conformance vectors generated from this implementation under `conformance/`.

### worldview-core (TypeScript) 0.1.0

- Hash-identical port of the Python implementation with the same CLI, verified
  against the conformance vectors.

### Editor

- Vite + TypeScript client-side editor: files, statements, arguments, graph, inspector,
  diff, undo/redo, themes. Deployed to GitHub Pages.

### worldview-extract 0.1.0

- LLM-assisted extraction of a worldview file from a text, with record/replay.

### Examples

- `walking-to-work` and its fork.
- Descartes, *A Discourse on the Method*, all six parts, with citations.
