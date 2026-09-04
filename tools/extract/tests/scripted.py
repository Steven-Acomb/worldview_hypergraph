"""A scripted responder for the small fixture document.

It plays the model: given the system prompt, the user prompt, and the
schema of a pass, it returns a plausible answer built from fixed tables.
It is deliberately imperfect, so that the pipeline's consolidation and
repair paths are exercised:

* ``I.2`` re-extracts the ``I.1`` statement with different whitespace
  (exact de-duplication);
* ``II.2`` re-extracts the ``II.1`` senses statement with different
  wording and the same slug (id uniquification, then the merge pass);
* the merge pass also proposes an unknown id and a cross-mode merge, both
  of which the pipeline must ignore;
* pass B references an unknown statement id, proposes the cogito twice,
  and proposes an argument whose only conclusion does not exist.
"""

from __future__ import annotations

import re

from worldview_extract.prompts import (
    ARGUMENTS_SCHEMA,
    MERGE_SCHEMA,
    STATEMENTS_SCHEMA,
    SYSTEM_LINK,
)

KEY_RE = re.compile(r"^\[([^\]]+)\] ", re.M)
ID_RE = re.compile(r"^(\S+) \[(?:is|ought)\]: ", re.M)

# key -> [(text, mode, role, slug, note)]
STATEMENTS = {
    "I.1": [("Good sense is equally distributed among people.", "is", "stated", "good-sense-equal", "")],
    "I.2": [
        (
            "Differences of opinion come from conducting thoughts along different paths.",
            "is",
            "stated",
            "opinions-differ-paths",
            "",
        ),
        ("Good  sense is equally distributed among people. ", "is", "implied", "good-sense-equal", "restated"),
    ],
    "I.3": [
        ("I should apply my mind well.", "ought", "stated", "apply-mind-well", ""),
        ("Having a good mind is not enough.", "is", "stated", "good-mind-not-enough", ""),
    ],
    "II.1": [
        ("The senses sometimes deceive me.", "is", "stated", "senses-deceive", ""),
        ("I should not trust anything that has once deceived me.", "ought", "stated", "distrust-deceivers", ""),
    ],
    "II.2": [
        ("People sometimes err in reasoning.", "is", "stated", "people-err", ""),
        ("My senses have deceived me at times.", "is", "implied", "senses-deceive", "near-duplicate of II.1"),
    ],
    "II.3": [
        ("I think.", "is", "stated", "i-think", ""),
        ("I exist.", "is", "stated", "i-exist", ""),
        ("Whatever I clearly perceive is true.", "is", "assumption", "clear-perception-true", "hidden premise"),
    ],
}

# key -> [(premises, conclusions, justification, rule, slug)]
ARGUMENTS = {
    "I.2": [
        (
            ["good-sense-equal"],
            ["opinions-differ-paths"],
            "If reason is equal in everyone, differences of opinion cannot come from differences in reason.",
            "elimination",
            "paths-from-equal-sense",
        )
    ],
    "I.3": [
        (
            ["good-mind-not-enough"],
            ["apply-mind-well"],
            "Since having a good mind does not by itself yield truth, what matters is applying it well.",
            "practical syllogism",
            "apply-from-not-enough",
        )
    ],
    "II.1": [
        (
            ["senses-deceive"],
            ["distrust-deceivers"],
            "It is prudent never to trust completely those who have deceived us even once.",
            "",
            "distrust-from-deception",
        )
    ],
    "II.2": [
        (
            ["people-err", "no-such-id"],
            ["distrust-deceivers"],
            "Reasoning errs as the senses do, so the same distrust applies.",
            "analogy",
            "distrust-from-error",
        )
    ],
    "II.3": [
        (["i-think"], ["i-exist"], "Thinking requires a thinker; if I think, I am.", "cogito", "cogito"),
        (["i-think"], ["i-exist"], "The same inference stated again.", "cogito", "cogito"),
        ([], ["ghost-statement"], "This conclusion does not exist.", "", "ghost"),
    ],
}

LINK = [
    (
        ["clear-perception-true", "i-exist"],
        ["apply-mind-well"],
        "Having found one certain truth by clear perception, I should apply my mind to reach others.",
        "",
        "link-across-sections",
    ),
    (["i-think"], ["i-exist"], "Duplicate of the cogito, to be dropped.", "cogito", "cogito-again"),
]


def respond(system: str, user: str, schema: dict) -> dict:
    keys = KEY_RE.findall(user)
    if schema is STATEMENTS_SCHEMA:
        out = []
        for key in keys:
            for text, mode, role, slug, note in STATEMENTS.get(key, []):
                out.append({"text": text, "mode": mode, "sources": [key, "bogus-key"], "role": role, "note": note, "slug": slug})
        return {"statements": out}
    if schema is MERGE_SCHEMA:
        ids = set(ID_RE.findall(user))
        merges = []
        if {"senses-deceive", "senses-deceive-2"} <= ids:
            merges.append({"keep": "senses-deceive", "drop": ["senses-deceive-2"], "reason": "same claim"})
        merges.append({"keep": "nope", "drop": ["people-err"], "reason": "unknown id, must be ignored"})
        merges.append({"keep": "apply-mind-well", "drop": ["good-mind-not-enough"], "reason": "cross-mode, must be refused"})
        return {"merges": merges}
    if schema is ARGUMENTS_SCHEMA:
        visible = set(ID_RE.findall(user))
        out = []
        table = [(None, a) for a in LINK] if system == SYSTEM_LINK else [(k, a) for k in keys for a in ARGUMENTS.get(k, [])]
        for key, (premises, conclusions, just, rule, slug) in table:
            real = [x for x in premises + conclusions if x not in ("no-such-id", "ghost-statement")]
            if any(x not in visible for x in real):
                continue
            out.append(
                {
                    "premises": premises,
                    "conclusions": conclusions,
                    "justification": just,
                    "rule": rule,
                    "sources": [key] if key else ["I.3", "II.3"],
                    "slug": slug,
                }
            )
        return {"arguments": out}
    raise AssertionError("unexpected schema")
