"""System prompts, user-prompt builders, and response schemas for each pass.

The system prompts are constant across a run (the document name goes in
the user message) so that the API's prompt cache can serve them.  The
schemas are JSON Schema in the subset structured outputs accept: every
object has ``additionalProperties: false`` and lists all its fields as
required; optional text is an empty string.
"""

from __future__ import annotations

from typing import Iterable

from .segment import Chunk

FORMAT_RULES = """\
You are helping build a "worldview" file in the worldview-core format: a graph of
natural-language STATEMENTS connected by ARGUMENTS, reconstructed from a document.
The file records the structure of what the author claims and why. It never records
whether the reasoning is any good.

Format rules (they are not negotiable):

1. There is exactly one kind of node, the statement: one proposition in natural
   language. There are no separate node types for axioms, definitions, questions,
   or examples. Whether a statement is foundational is computed later from the
   graph (it has no incoming argument); it is never declared.
2. Every statement has a mode: "is" for a descriptive claim about how things are,
   "ought" for a normative claim about what should be done, valued, or avoided.
   Choose the mode from the content of the proposition, not from its grammar.
3. An argument is a directed hyperedge: N premise statements (N >= 0) jointly
   entail M conclusion statements (M >= 1). The premises are consumed together:
   the argument claims that all of them, as a group, support all of the
   conclusions. If a conclusion can be reached in two independent ways, that is
   two separate arguments with the same conclusion, never one argument with
   alternatives inside it. An argument never encodes "or".
4. There are no weights, credences, probabilities, strengths, confidence levels,
   or argument kinds (deductive, inductive, defeasible). An argument only says
   "these premises, together, entail these conclusions".
5. Cycles are allowed. If the author justifies A by B and B by A, record both
   arguments. Do not avoid, repair, or flag circularity.
6. Voice: write each statement as the author would assert it. Use the author's
   own first person where the author speaks for themselves ("I should doubt
   whatever can be doubted", "I exist") and a plain assertion for general claims
   ("Good sense is equally distributed among people"). Never write "the author
   believes that ..." or "Descartes says ...".
7. Paraphrase. Restate each proposition in clear, self-contained modern prose:
   one proposition per statement, no pronoun whose referent is outside the
   statement, no quotation longer than a few words. A statement must be
   understandable on its own, without the surrounding text.
8. Surface hidden assumptions. When a conclusion the author draws depends on a
   premise the author never states, add that premise as a statement with role
   "assumption" so the argument can be made explicit. Do not invent views the
   author would reject.
9. Record what the author asserts or relies on, not what you believe. Do not
   correct, evaluate, or improve the author's reasoning.
"""

SYSTEM_STATEMENTS = FORMAT_RULES + """
Task: statement extraction (pass A).

You will be given one section of the document. Each paragraph begins with a
citation key in square brackets, for example [IV.3] or [p12]. Extract every
proposition the author asserts, relies on, or argues for in these paragraphs, as
a list of candidate statements. Skip purely narrative or rhetorical material that
carries no claim (greetings, transitions, apologies), but keep autobiographical
claims the author later reasons from.

For each statement give:
- text: the paraphrased proposition (rules 6 and 7).
- mode: "is" or "ought" (rule 2).
- sources: the citation keys of the paragraphs the statement comes from. Use only
  keys that appear in the input.
- role: "stated" if the author asserts it explicitly; "implied" if the author
  clearly relies on it without saying it in so many words; "assumption" if you are
  surfacing a hidden premise the author needs (rule 8).
- note: a short note for a human reviewer (an ambiguity, an alternative reading,
  why it matters), or an empty string.
- slug: a short kebab-case identifier of two to five words, for example
  "good-sense-equal", to serve as the statement's local id. Lowercase letters,
  digits, and hyphens only.

Aim for completeness over brevity: a statement that is later merged with another
costs little, a missed statement cannot be argued from. Do not extract arguments
yet; that is a later pass.
"""

SYSTEM_MERGE = FORMAT_RULES + """
Task: consolidation.

You will be given the list of candidate statements extracted from a document,
each with a local id, its mode, and its text. Some are near-duplicates: the same
proposition extracted twice from different paragraphs, or paraphrased slightly
differently. Propose merges.

Merge two statements only if they say the same thing in the same mode, so that
any argument using one would be equally correct using the other. Do not merge
statements that are merely related, that differ in scope or strength ("all"
versus "most", "always" versus "usually"), that differ in mode, or where one is a
reason for the other. When in doubt keep them separate: identity in this format
is literal, and a wrong merge silently changes what the author is recorded as
saying.

For each merge give the id to keep (prefer the clearest, most self-contained
text), the ids to drop, and a one-line reason. Return an empty list if nothing
should be merged.
"""

SYSTEM_ARGUMENTS = FORMAT_RULES + """
Task: argument extraction (pass B).

You will be given one section of the document (paragraphs with citation keys) and
the list of statements already extracted from the document, each with its local
id. Identify the arguments the author makes in this section: wherever the author
draws a conclusion from premises, treats one claim as the reason for another, or
relies on several claims jointly to reach a result.

For each argument give:
- premises: the ids of the premise statements. Use only ids from the list. The
  list may be empty when the author simply posits the conclusion, but that is
  rare.
- conclusions: the ids of the statements the premises jointly establish (at
  least one).
- justification: one to three sentences, in the author's voice, explaining why
  the conclusions follow from these premises. This is the author's reasoning
  paraphrased, not your assessment of it.
- rule: the name of the inference pattern if one is recognisable ("modus
  ponens", "practical syllogism", "inference to the best explanation",
  "elimination", "analogy", ...), or an empty string.
- sources: citation keys of the paragraphs where the argument is made.
- slug: a short kebab-case identifier for the argument, for example
  "doubt-from-error".

Rules 3, 4, and 5 apply strictly: premises are joint, alternatives are separate
arguments, no weights, cycles are fine. Copy statement ids exactly as they appear
in the list; a reference to an id that is not in the list is discarded. If a
premise the author needs is missing from the list, do not invent an id and do not
substitute a statement the author did not rely on: record the argument with the
listed premises it does use and name the missing premise in the justification, so
a reviewer can add it. Do not record the same argument twice.
"""

SYSTEM_LINK = FORMAT_RULES + """
Task: cross-section linking (pass C).

You will be given the complete list of statements extracted from a document and
the arguments already recorded, in compact form. Earlier passes saw one section
at a time, so arguments whose premises and conclusions live in different sections
are probably missing: a principle laid down early and applied later, a conclusion
of one part serving as a premise of another, a hidden assumption used throughout.

Propose only arguments that are not already recorded (same premise set and
conclusion set). Use the same fields as before: premises, conclusions,
justification, rule, sources, slug. Copy statement ids exactly as they appear in
the list and use no others. Prefer a small number of well-supported cross-section
arguments to many speculative ones. Return an empty list if nothing is missing.
"""

# ------------------------------------------------------------------ schemas

_STR_LIST = {"type": "array", "items": {"type": "string"}}

STATEMENTS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["statements"],
    "properties": {
        "statements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "mode", "sources", "role", "note", "slug"],
                "properties": {
                    "text": {"type": "string", "description": "The paraphrased proposition."},
                    "mode": {"type": "string", "enum": ["is", "ought"]},
                    "sources": {**_STR_LIST, "description": "Citation keys of the source paragraphs."},
                    "role": {"type": "string", "enum": ["stated", "implied", "assumption"]},
                    "note": {"type": "string", "description": "Reviewer note, or empty."},
                    "slug": {"type": "string", "description": "Short kebab-case local id."},
                },
            },
        }
    },
}

MERGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["merges"],
    "properties": {
        "merges": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["keep", "drop", "reason"],
                "properties": {
                    "keep": {"type": "string", "description": "Id of the statement to keep."},
                    "drop": {**_STR_LIST, "description": "Ids of the statements merged into it."},
                    "reason": {"type": "string"},
                },
            },
        }
    },
}

ARGUMENTS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["arguments"],
    "properties": {
        "arguments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["premises", "conclusions", "justification", "rule", "sources", "slug"],
                "properties": {
                    "premises": {**_STR_LIST, "description": "Statement ids, consumed jointly."},
                    "conclusions": {**_STR_LIST, "description": "Statement ids, at least one."},
                    "justification": {
                        "type": "string",
                        "description": "Why the conclusions follow, in the author's voice.",
                    },
                    "rule": {"type": "string", "description": "Inference pattern name, or empty."},
                    "sources": {**_STR_LIST, "description": "Citation keys."},
                    "slug": {"type": "string", "description": "Short kebab-case local id."},
                },
            },
        }
    },
}

# ------------------------------------------------------------ user prompts


def format_statement_line(id_: str, mode: str, text: str) -> str:
    """One line of a statement list as shown to the model: ``id [mode]: text``."""
    return f"{id_} [{mode}]: {text}"


def _doc_header(name: str | None) -> str:
    return f"Document: {name}\n\n" if name else ""


def statements_prompt(chunk: Chunk, name: str | None = None) -> str:
    return _doc_header(name) + chunk.render() + "\n\nExtract the candidate statements from the paragraphs above."


def merge_prompt(statements: Iterable[tuple[str, str, str]], name: str | None = None) -> str:
    lines = "\n".join(format_statement_line(*s) for s in statements)
    return (
        _doc_header(name)
        + "Candidate statements (id [mode]: text):\n"
        + lines
        + "\n\nPropose merges of near-duplicate statements, or an empty list."
    )


def arguments_prompt(chunk: Chunk, statements: Iterable[tuple[str, str, str]], name: str | None = None) -> str:
    lines = "\n".join(format_statement_line(*s) for s in statements)
    return (
        _doc_header(name)
        + chunk.render()
        + "\n\nStatements available for this section (id [mode]: text):\n"
        + lines
        + "\n\nExtract the arguments the author makes in the paragraphs above, using only these statement ids."
    )


def link_prompt(
    statements: Iterable[tuple[str, str, str]],
    arguments: Iterable[tuple[str, list[str], list[str]]],
    name: str | None = None,
) -> str:
    s_lines = "\n".join(format_statement_line(*s) for s in statements)
    a_lines = "\n".join(f"{aid}: {', '.join(p) or '(none)'} => {', '.join(c)}" for aid, p, c in arguments)
    return (
        _doc_header(name)
        + "All statements (id [mode]: text):\n"
        + s_lines
        + "\n\nArguments already recorded (id: premises => conclusions):\n"
        + (a_lines or "(none)")
        + "\n\nPropose the missing cross-section arguments, or an empty list."
    )
