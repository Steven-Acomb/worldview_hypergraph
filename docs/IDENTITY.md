# Identity and canonicalization

This document specifies, byte for byte, how a worldview-core implementation computes
the three content-derived identities: the **proposition id** of a statement, the
**argument hash** of an argument, and the **justified-statement id** of a statement.
An implementation in any language must produce the same hex strings as the Python
reference for the same input. The conformance vectors under
[`conformance/vectors/`](../conformance/vectors/) are the executable form of this
document.

Nothing here is ever stored in a worldview file. Identities are computed on demand.

## 1. Why two layers

Local ids only mean something inside one file. To recognise "the same statement" across
files, forks, and edits we need identities derived from content:

- The **proposition id** answers "what is being said?" It depends on the text and the
  mode only. Two statements with the same canonical text and mode are the same
  proposition, whatever their ids, files, or justifications.
- The **justified-statement id** answers "what is being said, and why?" It depends on
  the proposition and on the complete upstream graph: every argument concluding the
  statement, their justifications, and, recursively, the justified ids of their
  premises. Editing anything upstream changes it; editing anything downstream does
  not. It behaves like a git commit hash.

`diff` uses both: statements whose justified ids match are *identical*; statements
whose proposition ids match but justified ids do not are *rejustified*.

## 2. Canonical text

`canon(text)` maps a string to its canonical form in three steps, in this order:

1. Unicode normalization form C (NFC).
2. Remove every leading and trailing whitespace code point.
3. Replace every maximal run of one or more whitespace code points with a single
   U+0020 SPACE.

**Whitespace** is exactly these 29 code points and no others:

| code points | names |
|---|---|
| U+0009 U+000A U+000B U+000C U+000D | tab, line feed, vertical tab, form feed, carriage return |
| U+0020 | space |
| U+001C U+001D U+001E U+001F | file, group, record, unit separator |
| U+0085 | next line |
| U+00A0 | no-break space |
| U+1680 | ogham space mark |
| U+2000 to U+200A | en quad through hair space |
| U+2028 U+2029 | line separator, paragraph separator |
| U+202F | narrow no-break space |
| U+205F | medium mathematical space |
| U+3000 | ideographic space |

This is the set for which Python's `str.isspace()` is true. U+FEFF (zero-width
no-break space) and U+200B (zero-width space) are **not** whitespace. Do not use a
regular-expression `\s` class: JavaScript's includes U+FEFF and excludes U+001C to
U+001F and U+0085.

Nothing else is done. No case folding, no punctuation stripping, no stemming, no
compatibility normalization (NFKC): "ﬁ" stays a ligature, "Hello" and "hello" differ.

Examples:

| input | canon |
|---|---|
| `"  All  men\tare\n mortal "` | `"All men are mortal"` |
| `"café"` (decomposed) | `"café"` (precomposed) |
| `"﻿x"` | `"﻿x"` (BOM kept) |

## 3. The hash function H

`H(part1, part2, ...)` is the lowercase hex SHA-256 of a byte string built from the
parts. Each part is either a **string** or a **list of strings**.

For a string `s`, with `b = utf8(s)` and `n = len(b)` in bytes:

```
feed( ascii(str(n)) + ":" + b + "," )
```

For a list of strings `[s1, ..., sk]`:

```
feed the string "#k"      (as a string part, so it becomes  len("#k") ":" "#k" ",")
feed s1 ... sk            (each as a string part)
```

The parts are fed in order and the digest is taken once at the end. `H()` with no
parts is the SHA-256 of the empty byte string.

The length prefix makes the encoding unambiguous: `H("ab", "c")` feeds `2:ab,1:c,`
and `H("a", "bc")` feeds `1:a,2:bc,`, so different splits never collide. The `#k`
element makes a list distinguishable from its elements spread out as strings and
from lists of other lengths. Lists whose order carries no meaning are sorted by the
caller before hashing, by plain code-point order of the strings (which, for hex
digests, is ordinary ASCII order).

Worked values:

| call | bytes fed | hex |
|---|---|---|
| `H()` | (none) | `e3b0c442…b855` |
| `H("a", "b")` | `1:a,1:b,` | `9f2b0d502d181b391c81652fdca2ccb0b747828fe438ba90c3e0092bcb39b3a4` |
| `H("a", ["b", "c"])` | `1:a,2:#2,1:b,1:c,` | `eaa91e9f47c0a9daf4ad48f322a1014314aec8586102ddcabe3dfc0a9a9e24ed` |

More are in `conformance/vectors/primitives.json`.

## 4. Proposition id

```
prop_id(s) = H("prop", canon(s.text), s.mode)
```

`mode` is the literal string `"is"` or `"ought"`. Examples:

| statement | prop_id |
|---|---|
| text `"A"`, mode `is` | `5040f885c69084ab7ed5715c39e3e0110db8a1fc5a7c9faba8e5e6a8674fe4ce` |
| text `"A"`, mode `ought` | `a28f8493cabc7581790b7d3e370465aa8c0cd51ea18645f602a65f2a543688be` |

## 5. Argument hash and justified-statement id (acyclic case)

```
arg_hash(a) = H("arg",
                canon(a.justification),
                sorted(just_id(p) for p in a.premises),
                sorted(prop_id(c) for c in a.conclusions))

just_id(s)  = H("just",
                prop_id(s),
                sorted(arg_hash(a) for a in incoming(s)))
```

`incoming(s)` is the set of arguments with `s` among their conclusions. A foundation
has an empty list there, so its justified id is `H("just", prop_id, [])`, which still
differs from its proposition id.

`rule`, `meta`, `ext`, and all local ids are ignored. Array order in the file is
ignored because every list is sorted before hashing.

## 6. Cycles

The recursion above does not terminate when the statement graph has a cycle, so
strongly connected components are hashed as units.

1. Build the statement graph: an edge p → c for every argument with p in `premises`
   and c in `conclusions`.
2. Compute its strongly connected components. A component is **cyclic** if it has more
   than one member, or its one member has a self-loop (an argument with that
   statement in both premises and conclusions).
3. The condensation of components is a DAG. Process components in a topological
   order: every component before any component that rests on it.
4. For an acyclic component (one statement, no self-loop) apply section 5. All
   premises of its incoming arguments lie in earlier components, so their justified
   ids are known.
5. For a cyclic component C:

   ```
   touching(C)   = arguments with at least one conclusion in C

   arg_hash'(a)  = H("arg",
                     canon(a.justification),
                     sorted( prop_id(p) if p in C else just_id(p)   for p in a.premises ),
                     sorted( prop_id(c) for c in a.conclusions ))

   scc_hash(C)   = H("scc",
                     sorted(prop_id(s) for s in C),
                     sorted(arg_hash'(a) for a in touching(C)))

   just_id(s)    = H("justscc", scc_hash(C), prop_id(s))        for each s in C
   ```

   Premises inside C use their proposition id because their justified id is what is
   being defined. Premises outside C lie in earlier components. Arguments that only
   *use* a member of C as a premise, with no conclusion in C, are downstream and do
   not touch C.

6. After every justified id is known, compute the reported `arg_hash(a)` for every
   argument with the section-5 formula, using the final justified ids of its premises.
   For arguments not touching a cyclic component this equals the value used during
   the computation; for arguments touching one it differs from `arg_hash'`, which is
   internal.

Consequences, all intended: editing any member of a mutually-justifying cluster, or
any argument into it, changes every member's justified id; editing a statement that
merely rests on the cluster changes only itself and its downstream; a cluster with
an entry argument from outside changes when that outside premise changes.

## 7. Invariants an implementation must satisfy

The test suites check each of these.

- Reordering `statements`, `arguments`, `premises`, or `conclusions` changes no hash.
- Renaming any local id, with its references, changes no hash.
- Changing `meta`, `ext`, `rule`, `name`, or `description` changes no hash.
- Changing one character of a foundation's text changes its proposition id, its
  justified id, the argument hash of every argument it feeds, and the justified id of
  everything downstream, and nothing else.
- Two files written independently with the same content produce identical hashes.
- Two independent implementations produce identical hashes on the conformance
  vectors, on random graphs, and on unicode edge cases.

## 8. Reference values for the bundled example

For `examples/walking-to-work.json`:

| statement | prop_id | just_id |
|---|---|---|
| `health-matters` (foundation) | `be5bd6a4…ccfe` | `97ee78f9…765a` |
| `walk-commute` (two arguments in) | `4f8e5294…863a` | `ea889d82…0865` |
| `habit-reports` (in a cycle) | `216df64e…ca15` | `b0aac66a…0e47` |
| `self-knowledge` (same cycle) | `7f55818c…679d` | `fa54b430…89d8` |

Full values: `worldview --json ids examples/walking-to-work.json`.
