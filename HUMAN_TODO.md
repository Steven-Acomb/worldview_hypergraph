# HUMAN_TODO

Things that need a human (Steve). Each entry says what is blocked, why, and the exact
steps. Claude appends here whenever it hits something it cannot do itself, then moves
on to other work. Tick items off and delete them when done.

Format: newest at the bottom. `[ ]` open, `[x]` done.

---

## Open

### [ ] 1. Anthropic API key for the extraction tool

**Blocks:** running `worldview-extract` for real (the tool under `tools/extract/`).
Tests use a fake provider and pass without a key, and `--replay` reproduces a recorded
run, but no real extraction has been run yet.

**Steps:**
1. Create a key at https://console.anthropic.com/settings/keys.
2. Set it for your shell: PowerShell `setx ANTHROPIC_API_KEY "sk-ant-..."` (new
   terminals only) or `$env:ANTHROPIC_API_KEY = "sk-ant-..."` for the current one.
3. Try it on the bundled text:
   ```
   .venv\Scripts\worldview-extract examples\sources\descartes-discourse-on-method.txt -o out.json --record run.jsonl
   ```
   Then `worldview validate out.json` and open it in the editor.
4. If you want CI or a scheduled job to run extractions, add the key as a repository
   secret named `ANTHROPIC_API_KEY` (Settings > Secrets and variables > Actions).

### [ ] 2. Enable GitHub Pages for the editor

**Blocks:** the public editor URL https://steven-acomb.github.io/worldview_hypergraph/.
The workflow `.github/workflows/pages.yml` builds and deploys on every push to `main`
but GitHub refuses the deployment until Pages is switched on.

**Steps:**
1. Open https://github.com/Steven-Acomb/worldview_hypergraph/settings/pages.
2. Under "Build and deployment", set **Source** to **GitHub Actions**.
3. Re-run the latest "pages" workflow from the Actions tab, or push any commit.

### [ ] 3. PyPI trusted publishing for `worldview-core` and `worldview-extract`

**Blocks:** publishing to PyPI on `py-v*` and `extract-v*` tags. Both names were free
on PyPI on 2026-09-03.

**Steps:**
1. Create a PyPI account if needed, enable 2FA.
2. On https://pypi.org/manage/account/publishing/ add a **pending publisher** for each
   project with: PyPI project name `worldview-core` (then again for
   `worldview-extract`), owner `Steven-Acomb`, repository `worldview_hypergraph`,
   workflow `publish-pypi.yml`, environment `pypi`.
3. In the GitHub repo create an environment named `pypi`
   (Settings > Environments > New environment). Optionally require your approval.
4. Release by tagging: `git tag py-v0.1.0 && git push origin py-v0.1.0`
   (and `extract-v0.1.0` for the extraction tool).

### [ ] 4. npm token for `worldview-core` on npm

**Blocks:** publishing the TypeScript SDK on `ts-v*` tags. The name `worldview-core`
was free on npm on 2026-09-03.

**Steps:**
1. Create an npm account if needed, enable 2FA.
2. Generate a **granular access token** with publish rights
   (https://www.npmjs.com/settings/~/tokens), or an automation token.
3. Add it as the repository secret `NPM_TOKEN`
   (Settings > Secrets and variables > Actions > New repository secret).
4. Release by tagging: `git tag ts-v0.1.0 && git push origin ts-v0.1.0`.
   The first publish claims the name.

### [ ] 5. Decide the real project name

`worldview-core` is a placeholder you agreed to keep for now. Renaming after the first
PyPI/npm publish is painful, so decide before tagging a release. Places to change are
listed in ROADMAP.md under "Open questions".

## Done

_(nothing yet)_
