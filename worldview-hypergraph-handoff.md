# Worldview hypergraph — core format handoff

**Project name:** TBD (placeholder: `worldview-core`)
**License:** GPL-3.0 (provisional)
**Audience:** a fresh Claude Code session starting cold. Everything below is decided unless marked *open*.

---

## 1. What this is

An open-source, portable JSON format for representing a *worldview*: a set of natural-language **statements** connected by **arguments**, where an argument is a directed hyperedge taking N premise statements and producing M conclusion statements. Plus a Python reference implementation: a validator and a query CLI.

The format is the product. Everything else — a visual editor, LLM-assisted extraction from someone's writing, defeasible and Bayesian evaluators — is a downstream consumer or a sister project (Appendix A). Design for the format to be read and written by humans, LLMs, and tools, in roughly that order of readability priority, with the expectation that most authoring happens through tools.

### Motivating uses (the format must not foreclose any of these)

1. Rebuild a worldview from explicitly stated axioms ("belief reset").
2. Maintain multiple worldviews side by side — a daily driver plus sandboxes — and fork one to try a belief without contaminating the original.
3. Systematically surface hidden assumptions and unnoticed consequences within a worldview.
4. Plan an argument: given a conclusion and an audience, what has to be established.
5. Present an argument to someone with its full structure explicit.
6. Build a graph from another person's writing to understand their arguments and worldview.
7. Eventually: re-examine scientific results and the assumptions baked into theories.
8. Examine moral codes systematically.

Uses 7 and 8 are largely non-deductive. The core does **not** try to serve them directly; it reserves an extension mechanism (§7) so sister projects can.

---

## 2. Scope of the core

**In scope**

- JSON Schema for a worldview file (normative artifact).
- Python library: load, validate, canonicalize, compute identities, run queries.
- CLI exposing the queries in §6.
- Test suite.

**Out of scope (explicitly)**

- Any evaluator beyond structural reachability. No credences, weights, probabilities, or numeric strengths.
- Any judgement of *validity* of an argument. The core records that an author claims premises → conclusions; it does not check the logic.
- Semantic equivalence between statements. "All men are mortal" and "All humans are mortal" are different statements. This is intentional; they may genuinely differ in what the author means.
- A visual editor. Separate repo, later.
- Cross-file references or imports. One file is one worldview, self-contained.

---

## 3. Core concepts

### Statement (node)

There is exactly **one node type**. A statement is a natural-language proposition. Fields:

| field | type | required | notes |
|---|---|---|---|
| `id` | string | yes | Local, human-chosen, unique within the file. Slug-like. Used only for referencing within this file. |
| `text` | string | yes | The statement itself, natural language. |
| `mode` | `"is"` \| `"ought"` | yes | Descriptive vs normative. Exactly two values. |
| `meta` | object | no | Free-form. Roles like "axiom", "hypothesis", "observation" live here if the author wants them. The schema defines no role vocabulary. |
| `ext` | object | no | Namespaced extension slot, see §7. |

"Axiom" is **not** a schema concept. Whether a statement is foundational is a *computed* property: it has no incoming edges. Tooling reports this; it never requires it.

### Argument (hyperedge)

| field | type | required | notes |
|---|---|---|---|
| `id` | string | yes | Local, unique within the file. |
| `premises` | array of statement `id` | yes | N ≥ 0. Set semantics; order is not meaningful. The premises are consumed **jointly**: the argument asserts that all of them together support the conclusions. |
| `conclusions` | array of statement `id` | yes | M ≥ 1. Set semantics. Asserted **jointly** (conjunction): the argument yields all M. |
| `justification` | string | yes | Prose explaining why the conclusions follow from the premises. |
| `rule` | string | no | Optional name of the inference pattern (e.g. "modus ponens"). Free text; no vocabulary enforced. |
| `meta` | object | no | Free-form. |
| `ext` | object | no | Namespaced extension slot, see §7. |

Alternatives ("D follows from {A,B} *or* from {C}") are expressed as **two separate arguments** into D. An argument never encodes disjunction internally.

N = 0 is legal (an argument with no premises), though semantically unusual. Don't forbid it; let `meta` explain it.

### Worldview (file)

```
{
  "format": "worldview-core",
  "version": "0.1",
  "name": "...",
  "description": "...",
  "meta": { },
  "statements": [ ... ],
  "arguments": [ ... ]
}
```

`name` and `description` are free text. Nothing at the file level is evaluative.

### What the core deliberately does not encode

- Whether an argument is deductive, inductive, abductive, or defeasible. The core is deductive-only by convention: every argument is read as "premises entail conclusions." Non-deductive kinds are a sister project (Appendix A).
- Attacks, rebuttals, undercuts. Sister project.
- Any number attached to anything. Sister project.

---

## 4. Cycles

**Cycles are allowed, silently.** A worldview may contain circular justification. This is a deliberate stance: the format takes no position on the Münchhausen trilemma. Foundationalist, coherentist, and infinitist worldviews are all representable.

Consequences the implementation must honour:

- No validation rule rejects cycles. No warning is emitted by default.
- Every query in §6 must handle cycles as structure, not as an error. "What does X rest on" returns strongly connected components where they exist.
- Well-foundedness ("is every statement reachable from statements with no incoming edges?") is an **optional lint** a user can run. It is never a validation requirement.
- Do not reintroduce a DAG assumption anywhere — not in the schema, not in a helper, not in a default.

---

## 5. Identity and canonicalization

This section is the heart of the library. Get it right and diffing/forking fall out for free.

### The problem

Someone forks a worldview and edits it. We want to recognize, statement by statement, what is unchanged, what is the same proposition with different justification, what is new, and what is removed. Local `id`s are not enough: two files can use different slugs for the same thing, or the same slug for different things.

### Two layers of identity, both computed, neither stored

**Proposition ID** — identifies *what is being said*.

```
prop_id(s) = H( canon(s.text) || s.mode )
```

Two statements with the same normalized text and mode are the same proposition, regardless of file, slug, or justification.

**Justified-statement ID** — identifies *what is being said and why*, recursively.

```
arg_hash(a)  = H( canon(a.justification)
               || sorted( just_id(p) for p in a.premises )
               || sorted( prop_id(c)  for c in a.conclusions ) )

just_id(s)   = H( prop_id(s) || sorted( arg_hash(a) for a in incoming(s) ) )
```

A statement's justified ID encodes its entire upstream graph. Two statements are "the same justified statement" only if their text, mode, and complete justification history match. Consequences, all intended:

- Same justification prose over different premises → different argument.
- Same statement text over different justifications → same proposition, different justified statement.
- Editing one upstream statement ripples through every downstream justified ID (like git).

### Cycles in the hash

The recursion above doesn't terminate on cycles. Resolve by hashing strongly connected components as units:

1. Compute SCCs over the statement graph (a statement u points to v if some argument has u in premises and v in conclusions). A statement with a self-supporting argument is its own SCC of size 1 with a cycle; treat it like any other cyclic SCC.
2. The condensation of SCCs is a DAG. Process SCCs in topological order.
3. For a cyclic SCC C:
   ```
   scc_hash(C) = H( sorted( prop_id(s) for s in C )
                  || sorted( arg_hash'(a) for a in args touching C ) )
   ```
   where `arg_hash'` uses `just_id` for premises *outside* C and `prop_id` for premises *inside* C (the inside ones are what we're defining).
   ```
   just_id(s in C) = H( scc_hash(C) || prop_id(s) )
   ```
4. For an acyclic SCC (single statement, no self-loop), the plain definition applies.

Changing any member of a coherentist cluster changes the identity of every member. That's correct: in a mutually-justifying cluster the justifications are shared.

### Canonicalization (`canon`)

*Open — the session should implement this and state its choice; the following is the default:*

- Unicode NFC normalization.
- Strip leading/trailing whitespace.
- Collapse internal runs of whitespace to a single space.
- **No** case folding, **no** punctuation stripping, **no** stemming. Identity is literal by design.

Hash function: SHA-256, hex. Use a length-prefixed or delimiter-safe concatenation so `H(a||b)` can't collide with `H(ab)` for different splits.

### Never store hashes in the file

Hash IDs are unreadable for humans and LLMs, and every edit ripples downstream — exactly what an author shouldn't have to manage. The file of record uses only local slugs. Both hash layers are computed on demand by the library. A cache file is acceptable; the worldview file itself never contains them.

### Tests that pin this down

- Reordering `statements`, `arguments`, `premises`, or `conclusions` arrays changes no hash.
- Renaming a local `id` (and updating references) changes no hash.
- Changing one character of a leaf statement changes its `prop_id`, its `just_id`, and every downstream `just_id`, and nothing upstream.
- Two independently written files with the same content produce identical hashes.
- A cyclic SCC: editing one member changes every member's `just_id`; editing a statement downstream of the SCC changes only itself and its downstream.

---

## 6. Queries (CLI + library)

All queries are structural. None evaluates truth or validity.

| command | meaning |
|---|---|
| `validate <file>` | Schema check + referential integrity (every referenced `id` exists; ids unique). Exit non-zero on failure. Does not warn on cycles. |
| `rests-on <file> <id>` | Upstream closure of a statement. Reports **per incoming argument**, not a union — the user needs to see which justifications exist and what each depends on. Cycles reported as SCCs. |
| `supports <file> <id>` | Downstream closure: what this statement contributes to, per argument. |
| `foundations <file>` | Statements with no incoming arguments. (The computed notion of "axiom".) |
| `sccs <file>` | List strongly connected components of size > 1 or with self-loops. |
| `lint well-founded <file>` | Optional: statements not reachable from any foundation. Informational only. |
| `ids <file>` | Emit `prop_id` and `just_id` for every statement (debugging / caching). |
| `diff <a> <b>` | Match statements across two files by identity (§5). Report four buckets: **identical** (`just_id` matches), **rejustified** (`prop_id` matches, `just_id` doesn't), **added** (in B only), **removed** (in A only). Also report arguments added/removed by `arg_hash`. |

Library API should expose the same operations as functions returning plain data structures; the CLI is a thin wrapper. JSON output mode for every command so other tools (and LLMs) can consume results.

---

## 7. Extension mechanism

Sister projects must be able to add fields without changing the core's meaning of a file. Rule:

- Every statement, argument, and the worldview header has an optional `ext` object.
- Keys in `ext` are namespaced: `"ext": { "defeasible": { ... }, "bayes": { ... } }`.
- The core validator checks that `ext` is an object and its keys are strings. It does not validate contents.
- Core queries and hashing **ignore `ext` entirely**. A file with extension data is a valid core file; the core just doesn't understand the extra parts.
- `meta` is for free-form human notes and is likewise ignored by hashing and queries. The distinction: `ext` is for machine-readable structured extensions with a namespace; `meta` is unstructured.

Whether `meta` should be excluded from hashing is decided: yes, excluded. Two files differing only in `meta` are identical to the core.

---

## 8. Build milestones

1. **Schema + validator.** JSON Schema written; `validate` passes/fails correctly on hand-built fixtures including a cyclic file (must pass).
2. **Canonicalization + identity.** `ids` command; all §5 tests green, including the SCC cases.
3. **Structural queries.** `rests-on`, `supports`, `foundations`, `sccs`, `lint well-founded`.
4. **Diff.**
5. **Packaging + docs.** Installable Python package, README with the schema explained for a reader who has not seen this document, and a generated example worldview (the session writes examples; none are provided here).

Stack: Python 3.11+, standard library where reasonable; a JSON Schema validator library is fine. Keep dependencies minimal — this is meant to be vendored into other projects.

---

## 9. Open items (decide in-session, state the decision in the README)

- Exact `canon` rules (§5 gives the default).
- Whether `version` uses semver or a simple integer.
- Whether `premises` may reference a statement that is also in `conclusions` of the same argument (a self-loop within one argument). Default: allow; it's a size-1 cyclic SCC.
- Output format details for `rests-on` on large graphs (depth limit? pagination?).

---

## Appendix A — Sister projects (not in scope; here so the extension slot's purpose is visible)

**Visual editor.** First consumer. Reads and writes core files only. Cross-platform, low-friction. Must not add evaluation logic of its own; anything it needs should come from the library. UI undesigned.

**Extraction tool.** LLM-assisted: build a worldview file from a person's writing or stated beliefs (use 6). A consumer of the core format, likely the second one built.

**Defeasible extension.** Adds an argument `kind` (deductive / inductive / abductive / defeasible) and **attack** relations (rebut, undercut) — because defeasible reasoning without attacks isn't the useful part. Evaluation changes from reachability to an acceptability semantics (Dung abstract argumentation, ASPIC+ family). Serves uses 7 and 8 qualitatively. Lives under `ext.defeasible`.

**Bayesian extension.** Priors on statements, factors on arguments. The core hypergraph is already a factor graph — statements are variables, hyperedges are factors over their N inputs and M outputs — so the mapping is direct. The work is the inference engine and the interface for entering numbers. Lives under `ext.bayes`. Known risk: numbers that don't exist get typed in anyway, and the graph looks more rigorous than it is.

Each sister project reads core files unchanged, adds its data under its namespace, and ships its own evaluator. None of them modifies core semantics.
