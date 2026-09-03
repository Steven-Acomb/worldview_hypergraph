# worldview-core file format, version 0.1

This is the normative description of a worldview-core file, written for someone
implementing a reader, writer, or tool. The machine-checkable half is the JSON Schema
at [`src/worldview_core/worldview-core.schema.json`](../src/worldview_core/worldview-core.schema.json);
this document adds the rules the schema cannot express and the meaning of each part.
Where the two disagree, the schema wins for shape and this document wins for meaning.

## 1. Model

A worldview is a directed hypergraph.

- A **statement** is a node: one natural-language proposition with a mode.
- An **argument** is a hyperedge from a set of premise statements to a set of
  conclusion statements. It records that the author claims the premises, taken
  together, entail the conclusions, taken together.

That is the whole model. There is exactly one node type and one edge type.

### What an argument means

An argument with premises {P1..Pn} and conclusions {C1..Cm} asserts:

> If all of P1..Pn hold, then all of C1..Cm hold, for the reason given in the
> justification.

- Premises are **joint**. An argument never means "P1 or P2". If a conclusion follows
  from P1 alone and separately from P2 alone, write two arguments.
- Conclusions are **joint**. The argument yields all of them.
- n may be 0. A zero-premise argument asserts its conclusions on the strength of its
  justification alone. It is legal and unusual; use `meta` to explain.
- m must be at least 1.
- A statement may appear in both the premises and the conclusions of one argument.
  That is a self-loop and is treated like any other cycle.

### What the format does not say

- Nothing about truth, credence, probability, weight, or strength.
- Nothing about whether an argument is valid, sound, deductive, inductive, or
  defeasible. Every argument is read the same way: premises entail conclusions.
- Nothing about attacks, rebuttals, or undercuts.
- Nothing about whether a statement is an axiom. Foundationality is computed (no
  incoming argument), never declared.
- Nothing across files. One file is one self-contained worldview.

Sister projects add such things through the extension slot (section 5) without
changing the meaning of the core.

## 2. Document

A file is a UTF-8 JSON text whose top-level value is an object with these members
and no others:

| member | type | required | meaning |
|---|---|---|---|
| `format` | string | yes | Exactly `"worldview-core"`. |
| `version` | string | yes | `"major.minor"`, currently `"0.1"`. Not semver: there is no patch component. A reader supporting `0.1` may reject any other value. |
| `name` | string | no | Display name. Free text. |
| `description` | string | no | Free text. |
| `meta` | object | no | Free-form notes, see section 5. |
| `ext` | object | no | Namespaced extensions, see section 5. |
| `statements` | array of statement | yes | May be empty. Order carries no meaning. |
| `arguments` | array of argument | yes | May be empty. Order carries no meaning. |

Order carries no meaning for identity or for any query. Tools should nonetheless
preserve the order they read, because authors use it for presentation.

## 3. Statement

An object with these members and no others:

| member | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | Local identifier. See section 4. |
| `text` | string, non-empty | yes | The proposition in natural language. |
| `mode` | `"is"` or `"ought"` | yes | Descriptive or normative. Part of the statement's identity: the same words in the other mode are a different proposition. |
| `meta` | object | no | Free-form. |
| `ext` | object | no | Namespaced extensions. |

Guidance for authors (not enforced): one proposition per statement, phrased so it can
be true or false (or, for `ought`, complied with or not); write it as the worldview's
owner would assert it; paraphrase sources rather than quoting at length.

## 4. Argument

An object with these members and no others:

| member | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | Local identifier. |
| `premises` | array of id | yes | Statement ids. May be empty. No duplicates. Order carries no meaning. |
| `conclusions` | array of id | yes | Statement ids. At least one. No duplicates. Order carries no meaning. |
| `justification` | string | yes | Prose explaining why the conclusions follow from the premises. May be empty in a draft; it is part of the argument's identity. |
| `rule` | string | no | Name of the inference pattern, e.g. `"modus ponens"`. Free text, not part of identity. |
| `meta` | object | no | Free-form. |
| `ext` | object | no | Namespaced extensions. |

### Identifiers

An **id** is a non-empty string containing no whitespace (no code point from the
whitespace set in [IDENTITY.md](IDENTITY.md), section 2). Statement ids must be unique
among statements; argument ids must be unique among arguments; a statement and an
argument may share an id. Every id in `premises` and `conclusions` must name a
statement in the same file.

Ids are local. They mean nothing outside the file and are not part of any computed
identity. Renaming an id, with its references, changes nothing that any tool
computes. Choose readable slugs.

## 5. `meta` and `ext`

Both may appear on the document, on any statement, and on any argument. Both are
ignored by identity hashing and by every query. Two files differing only in `meta`
or `ext` are the same worldview to the core.

- **`meta`** is an object with any contents. It is for humans: roles ("axiom",
  "observation"), source citations, notes. The format defines no vocabulary and no
  tool may require any key.
- **`ext`** is an object whose keys are namespaces and whose values are objects:
  `"ext": {"defeasible": {...}, "bayes": {...}}`. It is for machine-readable
  extensions. A reader that does not know a namespace must preserve it unchanged and
  otherwise ignore it. The core validates only the shape.

No member other than those listed in sections 2 to 4 is permitted anywhere. A reader
must reject a file with unknown members. This is deliberate: extension data must
live under `ext` so that it can never be mistaken for core data.

## 6. Validity

A file is valid if and only if:

1. It satisfies the JSON Schema.
2. Statement ids are unique among statements.
3. Argument ids are unique among arguments.
4. Every id in every `premises` and `conclusions` array names a statement in the file.

Nothing else is a validity condition. In particular:

- Cycles of any shape, including self-loops, are valid.
- Statements no argument mentions are valid.
- Arguments with no premises are valid.
- Two statements with identical text and mode are valid (they are the same
  proposition under two local ids).
- A `justification` that is empty is valid.

A validator must not warn about any of these by default. Optional lints (such as
well-foundedness) may report them when asked.

## 7. Cycles

The format takes no position on the Münchhausen trilemma. A worldview may be
foundationalist (everything rests on statements with no incoming argument),
coherentist (statements justify one another in cycles), or infinitist in spirit.
Tools must handle cycles as structure: strongly connected components are reported,
never rejected, and no default assumes a DAG.

## 8. Computed notions

These are defined over a valid file and are what tools report. None is stored.

- **Foundation**: a statement with no incoming argument.
- **Incoming arguments** of a statement: arguments listing it among their conclusions.
- **Outgoing arguments**: arguments listing it among their premises.
- **Statement graph**: an edge p → c for every argument with p in premises and c in
  conclusions.
- **Rests on**: the upstream closure in the statement graph, reported per incoming
  argument.
- **Supports**: the downstream closure, reported per outgoing argument.
- **Strongly connected component (SCC)**: as usual; a component is *cyclic* if it has
  more than one member or its single member has a self-loop.
- **Grounded** (well-founded lint): the least set containing every foundation and the
  conclusions of every argument all of whose premises are in the set. A zero-premise
  argument grounds its conclusions. A statement outside the set is *ungrounded*.
- **Proposition id**, **justified-statement id**, **argument hash**: see
  [IDENTITY.md](IDENTITY.md).

## 9. Example

```json
{
  "format": "worldview-core",
  "version": "0.1",
  "name": "Minimal",
  "statements": [
    {"id": "all-men-mortal", "text": "All men are mortal.", "mode": "is"},
    {"id": "socrates-man", "text": "Socrates is a man.", "mode": "is"},
    {"id": "socrates-mortal", "text": "Socrates is mortal.", "mode": "is"}
  ],
  "arguments": [
    {
      "id": "syllogism",
      "premises": ["all-men-mortal", "socrates-man"],
      "conclusions": ["socrates-mortal"],
      "justification": "Universal instantiation of the first premise to Socrates.",
      "rule": "Barbara"
    }
  ]
}
```

Two foundations, one argument, one conclusion. Adding a second argument into
`socrates-mortal` from different premises would record an alternative justification;
it would not merge with the first.

## 10. Versioning

`version` changes when the meaning of a file changes. A minor bump adds optional
members or relaxes a rule; a major bump changes or removes something. Readers should
accept files whose major matches and whose minor is less than or equal to what they
implement. Extensions never change `version`; they live under `ext`.
