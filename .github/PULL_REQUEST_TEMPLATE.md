## What

<!-- One or two sentences: what changes and why. Link the roadmap item or issue if there is one. -->

## Checklist

- [ ] I ran the test suite for every component I touched (the commands are in CONTRIBUTING.md).
- [ ] If I changed hashing, canonicalization, validation, a query, or `diff` in the Python reference implementation, I ran `python conformance/generate.py`, committed the regenerated `conformance/vectors/`, and updated the TypeScript SDK to match.
- [ ] If I changed the file format, I updated `src/worldview_core/worldview-core.schema.json`, the hand-written validator, the README, and both example worldviews.
- [ ] Nothing here adds evaluation logic to the core or the editor: no credences, weights, validity checks, or attack relations outside `ext`. Cycles are still allowed silently. Hashes are still never stored in a file.
- [ ] If this needs something only a human can do (a secret, a repository setting, an account), I added it to `HUMAN_TODO.md`.
