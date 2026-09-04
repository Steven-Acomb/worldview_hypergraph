# Worldview editor

A browser editor for [worldview-core](../README.md) files: statements connected by
arguments (directed hyperedges: N premises jointly entail M conclusions), drawn as a
graph, with the identities, structural queries, and diff of the SDK available on every
selection.

Everything runs in the browser. Nothing is uploaded anywhere: files are read with the
file picker or drag-and-drop, saved with a download, and the working document is
autosaved to the browser's `localStorage`. The editor adds no logic of its own to the
format: validation, foundations, cycles, rests-on/supports, well-foundedness, ids, and
diff are all computed by the TypeScript SDK in [`../sdk/typescript`](../sdk/typescript).

Hosted build: https://steven-acomb.github.io/worldview_hypergraph/

## Running it

The editor depends on the SDK through `file:../sdk/typescript`, so build the SDK first.

```
cd sdk/typescript && npm ci && npm run build
cd ../../editor
npm ci
npm run dev        # http://localhost:5173, examples copied from ../examples
npm run build      # production build in dist/
npm run preview    # serve dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest: pure logic and a jsdom smoke test of the whole UI
npm run e2e        # playwright: end-to-end smoke suite against the production build
```

`npm run examples` (run automatically by `dev` and `build`) copies `../examples/*.json`
into `public/examples/` and writes an `index.json`, which is how the Examples menu
discovers them.

### End-to-end tests

`npm run e2e` runs the Playwright suite in `e2e/` against the real build in a real
browser. `playwright.config.ts` builds the editor with
`VITE_BASE_PATH=/worldview_hypergraph/` (the GitHub Pages sub-path, so the suite also
proves that assets and example fetches resolve under a non-root base), serves `dist/`
with `vite preview` on port 4173, and drives headless Chromium through the flows a
person would use: loading examples from the menu, the inspector's rests-on tree and
cycle markers, adding and renaming through the forms, undo, Save (the download is
validated with the SDK), the graph, the diff tab in both directions, the theme toggle,
autosave across a reload, the shortcut guard while typing, and the 750-node Descartes
example. One-time setup: `npx playwright install chromium`. The run leaves `dist/`
built for the sub-path; run `npm run build` again for a root build.

## What is on the screen

- **Toolbar**: New, Open (or drop a `.json` file anywhere on the page), Save
  (downloads the serialized file in the canonical key order), Examples, Recent (documents
  opened in this browser, each removable), Undo/Redo, layout direction (LR/TB), show ids,
  lint overlay, theme (system/light/dark), help.
- **Sidebar** with four tabs:
  - *Statements*: search on id and text; filter by mode, foundations only, in a cycle,
    ungrounded; badges for foundation (F), cycle (↻), ungrounded (!). Click to select and
    centre the graph on it. "+ Statement" adds and selects a new one.
  - *Arguments*: search on id, rule, justification, and premise/conclusion ids; rows show
    `premises ⇒ conclusions`. "+ Argument" adds one, pre-filling the conclusion with the
    selected statement.
  - *Overview*: document name, description, and `meta`; foundations; cycles with their
    internal and boundary arguments; the well-founded lint; a table of `prop_id`,
    `just_id`, and `arg_hash` for everything, with "Copy all as JSON".
  - *Diff*: compare a file, a recent document, or an example (A) with the working
    document (B); "swap A/B" compares in the other direction. Shows the SDK diff:
    summary counts, then identical / rejustified / added / removed statements and
    identical / added / removed arguments. Clicking an entry selects it in the working
    document (entries that exist only in the other document are not selectable).
- **Graph canvas**: statements are boxes (ought statements have a double border),
  arguments are diamonds labelled with id and rule, edges run premise → argument →
  conclusion. Drag the background to pan, wheel to zoom around the cursor, Fit to see
  everything, double-click a node to centre it, hover for the full text. Selecting a
  statement tints what it rests on (upstream) and what it supports (downstream) in
  different colours and dims the rest; selecting an argument highlights its premises and
  conclusions. Foundations have a thick green border, cycle members a ↻ badge, and with
  the lint overlay on, ungrounded statements are dashed and marked with !.
  *Focus mode* (off / rests on / supports / both, with a depth slider 1..8 or "all")
  draws only the neighbourhood of the focused statement and reports how many statements
  are hidden. Documents with more than about 600 nodes start in focus mode; set Focus
  to off to draw everything (the Descartes example lays out in well under a second).
- **Right panel** (a slide-in drawer below 1000px wide, toggled with "Panel"):
  - For a statement: id (renaming updates every reference; ids with whitespace or
    duplicates are rejected inline), text, mode, `meta` and `ext` as JSON (parsed when
    you leave the field; invalid JSON is reported and not committed; every `ext` value
    must be an object), move up/down, Delete. Below it the inspector: `prop_id` and
    `just_id` with copy buttons, cycle membership, and collapsible *Rests on* and
    *Supports* trees mirroring the SDK's closure reports (one entry per argument with its
    rule and co-conclusions / co-premises, statements nested beneath, repeats marked "see
    above", a depth control), then the foundations reached. Every id in the trees is
    clickable.
  - For an argument: id, premises and conclusions as removable chips with a searchable,
    keyboard-navigable picker, justification, rule, `meta`/`ext`, `arg_hash`, and the
    validation problems that concern this argument.
- **Status bar**: validation state (click "N problems" to list them), counts, the dirty
  marker, and the source name.

Editing is allowed to pass through invalid states (a dangling reference while you
re-point an argument, an empty text). The status bar reports the problems, and the graph
and inspector keep working from a copy with the invalid parts removed.

Nothing in the editor evaluates anything: no scores, no truth, no strength. It shows
structure and identity, which is all the format records.

## Keyboard shortcuts

| key | action |
|---|---|
| Ctrl+N | New document (some browsers reserve this; use the toolbar) |
| Ctrl+O | Open a file |
| Ctrl+S | Save (download) |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z, Ctrl+Y | Redo |
| Delete | Delete the selected statement or argument, after confirming |
| Escape | Close a menu or dialog; leave a text field; clear the selection |
| F | Fit the graph in view |
| ? | Help |

Shortcuts do not fire while typing in a text field (a focused checkbox, radio, or
button does not count as typing). Undo treats a burst of typing into one field as a
single step: each debounced commit within 1.5 s of the previous one to the same field
is merged into it.

## Storage

Three `localStorage` keys, all optional (the editor works without storage):

- `worldview-editor:doc:v1`: the working document, source name, and dirty flag,
  autosaved about 300 ms after every change and restored on the next visit.
- `worldview-editor:recent:v1`: up to six recent documents (whole documents, so they can
  be reopened and diffed offline; documents over ~1.5 MB are not kept).
- `worldview-editor:prefs:v1`: theme, layout direction, sidebar tab, lint overlay,
  show ids.

## Deployment (GitHub Pages)

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds the SDK, then the
editor with `VITE_BASE_PATH=/worldview_hypergraph/`, and publishes `editor/dist` to
GitHub Pages on every push to `main`. `vite.config.ts` reads `VITE_BASE_PATH` for Vite's
`base`, and the examples index is fetched relative to `import.meta.env.BASE_URL`, so the
same build works at the root of a domain or under a sub-path. Pages must be enabled for
the repository with "GitHub Actions" as the source (see `HUMAN_TODO.md`).

The build is fully static: HTML, JS, CSS, and the example files. There is no server
component.

## Layout of the source

```
src/main.ts            entry: styles + App
src/app.ts             App: store, UI state, actions, keyboard, drag-drop, autosave, startup
src/context.ts         Ctx / Actions / UiState types shared by the views
src/store.ts           document, selection, undo/redo, canonical serialization
src/persist.ts         localStorage: working doc, recents, prefs
src/derived.ts         everything computed from the document via the SDK (memoised per version)
src/logic.ts           pure helpers: filters, picker search, JSON field parsing, id checks
src/fields.ts          form field bindings that survive re-renders while typing
src/ui.ts              DOM helpers
src/graph/layout.ts    hypergraph -> drawable model (focus mode) -> dagre layout
src/graph/view.ts      SVG canvas: pan/zoom, highlighting, focus controls
src/views/*.ts         toolbar, sidebar tabs, forms, inspector, picker, overlays, status bar
src/styles.css         hand-written CSS with custom properties (light and dark)
tests/                 vitest: store/derived/layout, pure logic, jsdom smoke test of the UI
e2e/                   playwright: end-to-end smoke suite against the built app (npm run e2e)
playwright.config.ts   builds with the Pages base path, serves dist/ with vite preview, Chromium
```
