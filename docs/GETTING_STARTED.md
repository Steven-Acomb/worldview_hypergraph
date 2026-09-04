# Getting started

Ten minutes from a clone to a worldview you can query, edit, and diff.

## 1. Install the Python CLI

```
git clone https://github.com/Steven-Acomb/worldview_hypergraph.git
cd worldview_hypergraph
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"        # Windows
.venv/bin/pip install -e ".[dev]"            # macOS / Linux
worldview --help
```

Python 3.11 or newer. The library has no runtime dependencies.

## 2. Look at an example

```
worldview validate examples/walking-to-work.json
worldview stats examples/walking-to-work.json
worldview foundations examples/walking-to-work.json
worldview rests-on examples/walking-to-work.json need-raincoat
worldview present examples/walking-to-work.json need-raincoat > case.md
```

`rests-on` shows what a statement depends on, one incoming argument at a time, down to
the foundations. `present` writes the same thing as a Markdown document with the
justifications inline. Add `--json` before any command for machine-readable output.

The bigger example is Descartes' *Discourse on the Method*:

```
worldview stats examples/descartes-discourse-on-method.json
worldview sccs examples/descartes-discourse-on-method.json
worldview present examples/descartes-discourse-on-method.json cogito
```

`sccs` lists the cycles. One of them is the Cartesian circle.

## 3. Write your own

A worldview file is JSON with statements and arguments. The smallest useful one:

```json
{
  "format": "worldview-core",
  "version": "0.1",
  "name": "Why I keep a notebook",
  "statements": [
    {"id": "forget", "text": "I forget most ideas within a day.", "mode": "is"},
    {"id": "ideas-matter", "text": "I should not lose ideas I might act on.", "mode": "ought"},
    {"id": "notebook", "text": "I should carry a notebook.", "mode": "ought"}
  ],
  "arguments": [
    {
      "id": "why-notebook",
      "premises": ["forget", "ideas-matter"],
      "conclusions": ["notebook"],
      "justification": "If ideas are lost quickly and losing them is bad, a way to capture them at once is called for."
    }
  ]
}
```

Rules that matter: every statement has a `mode` (`is` or `ought`); premises are used
jointly; if a conclusion has two independent reasons, write two arguments; cycles are
allowed; nothing carries a weight. The full description is in [FORMAT.md](FORMAT.md).

Check it:

```
worldview validate my-worldview.json
worldview lint all my-worldview.json
```

## 4. Edit in the browser

The editor is entirely client-side. Run it locally:

```
cd sdk/typescript && npm ci && npm run build && cd ../../editor
npm ci
npm run dev
```

or use the hosted copy at https://steven-acomb.github.io/worldview_hypergraph/ once
GitHub Pages is enabled. Open a file, click statements, add arguments with the picker,
watch the graph and the inspector update. Ctrl+S downloads the file. The working
document autosaves in the browser.

## 5. Plan an argument for an audience

```
worldview plan examples/walking-to-work.json need-raincoat --given walk-commute,rain-often
```

The output splits the closure into what the audience must still *grant* (foundations
with no argument behind them) and what must be *established* (statements with
arguments available). `present --given ...` renders the same as Markdown.

## 6. Fork, edit, diff, merge

```
copy examples\walking-to-work.json mine.json
# edit mine.json
worldview diff examples/walking-to-work.json mine.json
```

`diff` matches statements by content identity, not by id: the same proposition with
a changed justification is *rejustified*; new and gone statements are *added* and
*removed*. Two forks of one base can be combined:

```
worldview merge base.json ours.json theirs.json -o merged.json
```

## 7. Build a worldview from a text

```
.venv\Scripts\pip install -e "tools/extract[dev]"
set ANTHROPIC_API_KEY=sk-ant-...
worldview-extract examples/sources/descartes-discourse-on-method.txt -o descartes.json --record run.jsonl
```

The tool reads the text in chunks, extracts statements with citations, then
arguments, and validates the result. `--dry-run` shows the chunks and prompts without
calling the API; `--replay run.jsonl` reproduces a recorded run. Review the output
with `lint all`, `foundations`, and the editor; the model can misread a text.

## 8. Use the library

Python:

```python
from worldview_core import load, rests_on, plan, compute_identities
wv = load("examples/walking-to-work.json")
print(rests_on(wv, "need-raincoat")["closure"])
print(compute_identities(wv).just_id["need-raincoat"])
```

TypeScript (Node or browser):

```ts
import { parseWorldviewJson, restsOn, computeIdentities } from "worldview-core";
const wv = parseWorldviewJson(text);
console.log(restsOn(wv, "need-raincoat").closure);
console.log(computeIdentities(wv).justId.get("need-raincoat"));
```

Both produce the same hashes and the same query results; the conformance suite under
`conformance/` proves it.

## Where to go next

- [FORMAT.md](FORMAT.md): every field and every rule.
- [IDENTITY.md](IDENTITY.md): how statements are identified across files.
- [QUERIES.md](QUERIES.md): the shape of every result.
- [../ROADMAP.md](../ROADMAP.md): what exists, what is being built, what is planned.
