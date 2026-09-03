# Documentation

| document | audience |
|---|---|
| [FORMAT.md](FORMAT.md) | Anyone writing or reading worldview files: the normative meaning of every field and the validity rules. |
| [IDENTITY.md](IDENTITY.md) | Implementers: the byte-level specification of canonicalization and the three content-derived identities, with worked values. |
| [QUERIES.md](QUERIES.md) | Tool authors: the exact shapes returned by every query and by `diff`. |
| [handoff.md](handoff.md) | The original design handoff: motivating uses, scope, decisions, and the sister projects that the extension slot exists for. |

Implementation-specific docs live next to each implementation:

- Python reference implementation: the top-level [README](../README.md).
- TypeScript SDK: `sdk/typescript/README.md`.
- Web editor: `editor/README.md`.
- Extraction tool: `tools/extract/README.md`.
- Conformance suite: `conformance/generate.py` docstring.
