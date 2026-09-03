"""Optional lints.  Informational only; none of these is a validity rule.

* ``well_founded`` (in :mod:`queries`): statements not grounded in foundations.
* ``duplicates``: several statements that are the same proposition.
* ``unused``: statements no argument mentions.
* ``empty_justifications``: arguments whose justification is blank.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .canon import canon
from .graph import Graph
from .identity import Identities, compute_identities
from .model import Worldview
from .queries import well_founded


def duplicates(wv: Worldview, ids: Identities | None = None) -> list[dict[str, Any]]:
    """Groups of statements sharing a proposition id (same canonical text and mode)."""
    ids = ids or compute_identities(wv)
    groups: dict[str, list[str]] = defaultdict(list)
    for s in wv.statements:
        groups[ids.prop_id[s.id]].append(s.id)
    out = []
    for prop, members in groups.items():
        if len(members) > 1:
            first = wv.statement(members[0])
            out.append({"prop_id": prop, "text": canon(first.text), "mode": first.mode, "ids": members})
    return out


def unused(wv: Worldview, graph: Graph | None = None) -> list[str]:
    """Statements that appear in no argument, as premise or conclusion."""
    g = graph or Graph.build(wv)
    return [sid for sid in g.statements if not g.incoming[sid] and not g.outgoing[sid]]


def empty_justifications(wv: Worldview) -> list[str]:
    """Arguments whose justification is empty after canonicalization."""
    return [a.id for a in wv.arguments if canon(a.justification) == ""]


def lint_all(wv: Worldview) -> dict[str, Any]:
    g = Graph.build(wv)
    return {
        "well_founded": well_founded(wv, g),
        "duplicates": duplicates(wv, compute_identities(wv, g)),
        "unused": unused(wv, g),
        "empty_justifications": empty_justifications(wv),
    }
