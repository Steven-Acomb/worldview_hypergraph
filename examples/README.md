# Examples

Worked worldview files. Each is valid under the core schema and exercises specific
features of the format. Load any of them in the editor or run the CLI on them:

```
worldview validate examples/walking-to-work.json
worldview rests-on examples/walking-to-work.json need-raincoat
worldview diff examples/walking-to-work.json examples/walking-to-work-fork.json
```

| file | what it shows |
|---|---|
| `walking-to-work.json` | A twelve-statement everyday worldview: foundations, jointly consumed premises, two independent arguments for one conclusion, `is` and `ought`, and a two-statement cycle (a coherentist pair). |
| `walking-to-work-fork.json` | The same worldview after three edits, to demonstrate `diff`: a reworded statement, a dropped argument, a new statement with its argument. |
| `keeping-promises.json` | A small moral code: two independent arguments for keeping promises, each with an explicit `ought` bridge principle, two derived duties, and one argument deliberately deriving an `ought` from an `is` alone so that `worldview lint is-ought` has something to flag. |
| `semmelweis-handwashing.json` | A scientific argument with its assumptions made explicit: Semmelweis's 1847 case that chlorine handwashing prevents childbed fever. Observations as foundations, an inferred mechanism, four `meta.role: assumption` statements the inference silently needs, a confirmation step, and a practical `ought` at the end. Try `worldview plan ... must-wash --given <the observations>` to see what an audience still has to grant. |
| `descartes-discourse-on-method.json` | René Descartes, *A Discourse on the Method* (1637, Veitch translation), all six parts, extracted into statements and arguments with paragraph citations in `meta.source`. The companion `descartes-discourse-on-method.md` is a reader's guide. |

## Sources

`sources/` holds the public-domain texts the larger examples were built from, with a
citation key on every paragraph (`[IV.3]` = Part IV, paragraph 3) so that every
statement's `meta.source` can be checked against the text. `sources/extract_descartes.py`
regenerates the Descartes text from the Project Gutenberg HTML.

## Conventions used in these files

- Statements are written in the first person of the worldview's owner.
- `meta.source` on a statement or argument is a list of citation keys.
- `meta.role` is an informal label ("observation", "rule", "maxim", "assumption");
  the format defines no vocabulary and tools ignore it.
- Nothing in an example is an endorsement. The Descartes file records what Descartes
  argued, not what is true.
