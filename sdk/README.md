# SDKs

worldview-core ships two implementations of the same library. They produce identical
hashes and identical query results, and both are checked against the shared
conformance vectors in [`../conformance/`](../conformance/).

| language | where | package | install |
|---|---|---|---|
| Python 3.11+ | repository root, `src/worldview_core/` | `worldview-core` on PyPI | `pip install worldview-core` |
| TypeScript / JavaScript (Node 18+ and browsers) | [`typescript/`](typescript/) | `worldview-core` on npm | `npm install worldview-core` |

The Python package is the **reference implementation**: when the two disagree, Python
is right and the vectors are regenerated from it. The TypeScript package is what the
[web editor](../editor/) is built on.

Both expose the same operations under language-appropriate names:

| operation | Python | TypeScript |
|---|---|---|
| canonical text | `canon(text)` | `canon(text)` |
| hash | `H(*parts)` | `H(...parts)` |
| validate raw JSON | `validate_dict(data)` | `validateDict(data)` |
| load and validate | `load(path)`, `loads(text)` | `parseWorldview(data, source?)` |
| identities | `compute_identities(wv)` | `computeIdentities(wv)` |
| foundations | `foundations(wv)` | `foundations(wv)` |
| cycles | `sccs(wv)` | `sccs(wv)` |
| upstream | `rests_on(wv, id, depth=None)` | `restsOn(wv, id, depth?)` |
| downstream | `supports(wv, id, depth=None)` | `supports(wv, id, depth?)` |
| well-founded lint | `well_founded(wv)` | `wellFounded(wv)` |
| argument planning | `plan(wv, id, given=())` | `plan(wv, id, given?)` |
| duplicate propositions | `duplicates(wv)` | `duplicates(wv)` |
| unused statements | `unused(wv)` | `unused(wv)` |
| blank justifications | `empty_justifications(wv)` | `emptyJustifications(wv)` |
| is-ought gaps | `is_ought_gaps(wv)` | `isOughtGaps(wv)` |
| every lint | `lint_all(wv)` | `lintAll(wv)` |
| statistics | `stats(wv)` | `stats(wv)` |
| Markdown presentation | `present(wv, id, given=(), depth=None)` | `present(wv, id, { given?, depth? })` |
| Graphviz DOT | `to_dot(wv, ids=True, wrap=36, rankdir="LR")` | `toDot(wv, { ids?, wrap?, rankdir? })` |
| Mermaid | `to_mermaid(wv, ids=True, wrap=36, direction="LR")` | `toMermaid(wv, { ids?, wrap?, direction? })` |
| diff | `diff(a, b)` | `diff(a, b)` |
| three-way merge | `merge(base, ours, theirs)` | `merge(base, ours, theirs)` |
| JSON Schema | `schema()` | `schema` |
| CLI | `worldview ...` | `npx worldview ...` |

`present`, `to_dot`, and `to_mermaid` return text; the TypeScript port produces the
same text character for character (it ports Python's `textwrap.wrap` for the label
wrapping). `stats` rounds its means exactly as Python's `round(x, 3)` does.

Result shapes are documented once, in [`../docs/QUERIES.md`](../docs/QUERIES.md).

## Adding another language

1. Implement `canon` and `H` exactly as [`../docs/IDENTITY.md`](../docs/IDENTITY.md)
   specifies and make `conformance/vectors/primitives.json` pass.
2. Port `graph` (Tarjan with the same tie-breaking), `identity`, `queries`, `diff`;
   then `lint`, `stats`, `present`, `export`, and `merge` (`conformance/vectors/extras/`
   and `merges/` cover those; the text outputs are compared as exact strings).
3. Replay every file under `conformance/vectors/` with deep equality.
4. Add a cross-language fuzz against the Python implementation on random graphs; the
   TypeScript port's `scripts/fuzz` is a template.
