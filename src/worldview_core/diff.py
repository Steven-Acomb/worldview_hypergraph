"""Diff two worldviews by computed identity.

Statements are matched in two passes: first on ``just_id`` (same
proposition, same complete justification history), then on ``prop_id``
among the leftovers (same proposition, different justification).  What
remains is added or removed.  Arguments are matched on ``arg_hash``.

If one file lists the same proposition twice (two statements with the
same canonical text and mode), matching is by multiset: a pair is
consumed once per occurrence.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .identity import Identities, compute_identities
from .model import Worldview


def _group(ids: list[str], key: dict[str, str]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for i in ids:
        groups[key[i]].append(i)
    return groups


def _match(a_ids: list[str], b_ids: list[str], a_key: dict[str, str], b_key: dict[str, str]):
    """Pair ids across A and B whose keys agree.  Returns (pairs, a_left, b_left)."""
    ga, gb = _group(a_ids, a_key), _group(b_ids, b_key)
    pairs: list[tuple[str, str, str]] = []
    a_left, b_left = [], []
    for k, alist in ga.items():
        blist = gb.get(k, [])
        for x, y in zip(alist, blist):
            pairs.append((x, y, k))
        a_left.extend(alist[len(blist):])
    for k, blist in gb.items():
        b_left.extend(blist[len(ga.get(k, [])):])
    # keep file order
    a_left.sort(key=a_ids.index)
    b_left.sort(key=b_ids.index)
    return pairs, a_left, b_left


def diff(a: Worldview, b: Worldview, ida: Identities | None = None, idb: Identities | None = None) -> dict[str, Any]:
    ida = ida or compute_identities(a)
    idb = idb or compute_identities(b)
    sa, sb = a.statement_ids(), b.statement_ids()

    identical, sa_left, sb_left = _match(sa, sb, ida.just_id, idb.just_id)
    rejustified, sa_left, sb_left = _match(sa_left, sb_left, ida.prop_id, idb.prop_id)

    arg_same, aa_left, ab_left = _match(a.argument_ids(), b.argument_ids(), ida.arg_hash, idb.arg_hash)

    def stmt(wv: Worldview, sid: str) -> dict[str, Any]:
        s = wv.statement(sid)
        return {"id": sid, "text": s.text, "mode": s.mode}

    def arg(wv: Worldview, aid: str) -> dict[str, Any]:
        x = wv.argument(aid)
        return {"id": aid, "premises": list(x.premises), "conclusions": list(x.conclusions)}

    result = {
        "a": a.source,
        "b": b.source,
        "statements": {
            "identical": [{"a": x, "b": y, "just_id": k} for x, y, k in identical],
            "rejustified": [
                {"a": x, "b": y, "prop_id": k, "text": b.statement(y).text} for x, y, k in rejustified
            ],
            "added": [stmt(b, y) for y in sb_left],
            "removed": [stmt(a, x) for x in sa_left],
        },
        "arguments": {
            "identical": [{"a": x, "b": y, "arg_hash": k} for x, y, k in arg_same],
            "added": [arg(b, y) for y in ab_left],
            "removed": [arg(a, x) for x in aa_left],
        },
    }
    result["summary"] = {
        "statements": {k: len(v) for k, v in result["statements"].items()},
        "arguments": {k: len(v) for k, v in result["arguments"].items()},
    }
    return result
