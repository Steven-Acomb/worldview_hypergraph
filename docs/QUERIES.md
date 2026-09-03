# Query results

Every query returns plain data. The CLI prints it as JSON with `--json`; the Python
and TypeScript libraries return the same structures. This document fixes the shapes
so that other tools can consume them. All arrays that list statements or arguments
are in **file order** unless stated otherwise.

Shapes are given as JSON with `<...>` placeholders. Keys marked *optional* are absent,
not null, when they do not apply.

## foundations

Statements with no incoming argument.

```json
[ {"id": "<statement id>", "text": "<text>", "mode": "is|ought"}, ... ]
```

## sccs

Cyclic strongly connected components only: size greater than one, or a single
statement with a self-loop. Ordered by the topological order of the condensation
(components that only support others first).

```json
[
  {
    "members": ["<statement id>", ...],
    "self_loops": ["<statement id>", ...],
    "internal_arguments": ["<argument id>", ...],
    "boundary_arguments": ["<argument id>", ...]
  },
  ...
]
```

`internal_arguments` have all premises and conclusions inside the component;
`boundary_arguments` touch it on one side only.

## rests-on and supports

`rests-on` walks upstream (incoming arguments, premises); `supports` walks downstream
(outgoing arguments, conclusions). Both accept an optional depth.

```json
{
  "statement": "<id>",
  "text": "<text>",
  "direction": "up|down",
  "closure": {
    "statements": ["<id>", ...],
    "arguments": ["<id>", ...]
  },
  "sccs": [ ["<id>", ...], ... ],
  "tree": <node>
}
```

- `closure` is the complete set reachable in that direction, regardless of depth. A
  statement in a cycle with the target appears in its own closure.
- `sccs` lists every cyclic component containing the target or anything in its
  closure.
- `tree` is the per-argument expansion:

```json
<node> = {
  "statement": "<id>",
  "text": "<text>",
  "scc": ["<id>", ...],          // optional: members of the cyclic component it is in
  "seen": true,                  // optional: already expanded elsewhere in this tree
  "truncated": true,             // optional: cut off by the depth limit and has more
  "arguments": [ <arg>, ... ]    // absent when seen or truncated
}

<arg> (rests-on) = {
  "argument": "<id>",
  "rule": "<rule>",              // optional
  "co_conclusions": ["<id>", ...],
  "premises": [ <node>, ... ]
}

<arg> (supports) = {
  "argument": "<id>",
  "rule": "<rule>",              // optional
  "co_premises": ["<id>", ...],
  "conclusions": [ <node>, ... ]
}
```

Each statement is expanded at most once per query. The first encounter, in
depth-first order following file order of arguments and of their premises or
conclusions, gets the expansion; later encounters are `seen` leaves. This keeps the
tree linear in the size of the closure and makes cycles finite. A foundation (for
rests-on) or a terminal statement (for supports) has an empty `arguments` array. A
node cut off by the depth limit has `truncated` only if it had something to expand.

## plan

Argument planning: what has to be established to reach a target statement, given
the statements an audience already accepts. The upstream walk stops at given
statements.

```json
{
  "statement": "<target id>",
  "text": "<text>",
  "given": ["<id>", ...],                 // given statements actually reached
  "must_establish": [ {"id": "<id>", "text": "<text>", "via": ["<argument id>", ...]}, ... ],
  "must_grant":     [ {"id": "<id>", "text": "<text>"}, ... ],
  "arguments": ["<argument id>", ...],
  "sccs": [ ["<id>", ...], ... ],
  "tree": <node>
}
```

- `must_grant` lists foundations reached that are not given: nothing in the worldview
  argues for them, so the audience has to accept them as premises.
- `must_establish` lists every other statement reached that is not given, including
  the target itself unless it is a foundation, with the arguments available for it.
- `tree` is the rests-on tree pruned at given statements; a given leaf is
  `{"statement", "text", "given": true}` (plus `scc` when applicable) and is never
  expanded. Given statements outside the target's closure are not reported.
- If the target itself is given, every list is empty and `tree` is the single given
  leaf.

## lint well-founded

```json
{
  "foundations": ["<id>", ...],
  "grounded": ["<id>", ...],
  "ungrounded": ["<id>", ...]
}
```

Grounded is the least fixed point described in [FORMAT.md](FORMAT.md) section 8.

## lint duplicates, lint unused, lint empty-justifications, lint all

```json
// duplicates: groups of statements that are the same proposition
[ {"prop_id": "<hex>", "text": "<canonical text>", "mode": "is|ought", "ids": ["<id>", ...]}, ... ]

// unused: statements in no argument
["<id>", ...]

// empty-justifications: arguments whose justification canonicalizes to ""
["<argument id>", ...]

// all
{"well_founded": {...}, "duplicates": [...], "unused": [...], "empty_justifications": [...]}
```

## export

`export --format dot|mermaid` writes text, not JSON: Graphviz DOT or a Mermaid
`flowchart`. Statements are boxes (an `ought` statement has a double border in DOT
and the `ought` class in Mermaid); arguments are diamonds labelled with their id and
rule; edges run premise → argument → conclusion. Options: `--no-ids`, `--wrap N`,
`--direction LR|TB|RL|BT`, `-o FILE`. Node names are positional (`s0`, `a3`), labels
carry the ids, so any id is safe.

## ids

```json
{
  "statements": [
    {"id": "<id>", "prop_id": "<64 hex>", "just_id": "<64 hex>", "scc": ["<id>", ...]},
    ...
  ],
  "arguments": [
    {"id": "<id>", "arg_hash": "<64 hex>"},
    ...
  ]
}
```

`scc` is present only for members of cyclic components.

## diff

```json
{
  "a": "<source label of A or null>",
  "b": "<source label of B or null>",
  "statements": {
    "identical":   [ {"a": "<id in A>", "b": "<id in B>", "just_id": "<hex>"}, ... ],
    "rejustified": [ {"a": "<id in A>", "b": "<id in B>", "prop_id": "<hex>", "text": "<text>"}, ... ],
    "added":       [ {"id": "<id in B>", "text": "<text>", "mode": "is|ought"}, ... ],
    "removed":     [ {"id": "<id in A>", "text": "<text>", "mode": "is|ought"}, ... ]
  },
  "arguments": {
    "identical": [ {"a": "<id>", "b": "<id>", "arg_hash": "<hex>"}, ... ],
    "added":     [ {"id": "<id>", "premises": [...], "conclusions": [...]}, ... ],
    "removed":   [ {"id": "<id>", "premises": [...], "conclusions": [...]}, ... ]
  },
  "summary": {
    "statements": {"identical": n, "rejustified": n, "added": n, "removed": n},
    "arguments":  {"identical": n, "added": n, "removed": n}
  }
}
```

Matching is by multiset: if A lists a proposition twice and B once, one pair matches
and the other A entry is removed. Pairs are formed in file order of A.

## validate

```json
{"file": "<path>", "valid": true|false, "problems": ["<message>", ...]}
```

Problem messages are human-readable and implementation-specific; only `valid` is
part of the contract.

## Exit codes (CLI)

| code | meaning |
|---|---|
| 0 | success |
| 1 | the file is not a valid worldview, or (for `validate`) could not be read |
| 2 | usage error, or a statement id that does not exist |
