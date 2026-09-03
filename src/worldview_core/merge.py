"""Three-way merge of worldviews, for the fork-and-experiment workflow.

Given a common ancestor ``base`` and two descendants ``ours`` and
``theirs``, produce a merged worldview and a list of conflicts.  Entries
are matched by **local id** (the way a human tracks a statement across
edits of one lineage), and compared by **content**:

* statement content = canonical text, mode, meta, ext;
* argument content = premise set, conclusion set, canonical
  justification, rule, meta, ext.

Per id the usual rule applies: if both sides agree, take it; if only one
side changed (edited, added, or deleted) relative to base, take that
side; if both changed differently, it is a conflict and ``ours`` wins in
the merged output while the conflict is reported.  An argument left
referring to a statement that the other side deleted is a dangling
conflict and is dropped from the output.

Use :func:`diff` (identity-based) to *understand* how two worldviews
differ; use this to *combine* two lines of edits.
"""

from __future__ import annotations

from typing import Any

from .canon import canon
from .model import Argument, Statement, Worldview


def _stmt_key(s: Statement | None):
    if s is None:
        return None
    return (canon(s.text), s.mode, _freeze(s.meta), _freeze(s.ext))


def _arg_key(a: Argument | None):
    if a is None:
        return None
    return (frozenset(a.premises), frozenset(a.conclusions), canon(a.justification), a.rule, _freeze(a.meta), _freeze(a.ext))


def _freeze(x: Any):
    if isinstance(x, dict):
        return tuple(sorted((k, _freeze(v)) for k, v in x.items()))
    if isinstance(x, list):
        return tuple(_freeze(v) for v in x)
    return x


def _three_way(b, o, t, key):
    """Return (chosen, conflict) for one id."""
    kb, ko, kt = key(b), key(o), key(t)
    if ko == kt:
        return o, False
    if ko == kb:
        return t, False
    if kt == kb:
        return o, False
    return (o if o is not None else t), True


def _ordered_ids(base_ids, ours_ids, theirs_ids) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for seq in (base_ids, ours_ids, theirs_ids):
        for i in seq:
            if i not in seen:
                seen.add(i)
                out.append(i)
    return out


def merge(base: Worldview, ours: Worldview, theirs: Worldview) -> dict[str, Any]:
    conflicts: list[dict[str, Any]] = []
    summary = {"statements": {"kept": 0, "added_ours": 0, "added_theirs": 0, "added_both": 0, "removed": 0, "changed": 0},
               "arguments": {"kept": 0, "added_ours": 0, "added_theirs": 0, "added_both": 0, "removed": 0, "changed": 0}}

    def run(kind: str, b_items, o_items, t_items, key, describe):
        b = {x.id: x for x in b_items}
        o = {x.id: x for x in o_items}
        t = {x.id: x for x in t_items}
        result = []
        tally = summary[kind]
        for i in _ordered_ids(b, o, t):
            bi, oi, ti = b.get(i), o.get(i), t.get(i)
            chosen, conflict = _three_way(bi, oi, ti, key)
            if conflict:
                conflicts.append({
                    "kind": kind[:-1],  # "statement" / "argument"
                    "id": i,
                    "base": describe(bi),
                    "ours": describe(oi),
                    "theirs": describe(ti),
                    "resolution": "kept ours" if oi is not None else "kept theirs",
                })
            if chosen is None:
                if bi is not None:
                    tally["removed"] += 1
                continue
            result.append(chosen)
            if bi is None:
                if oi is not None and ti is not None:
                    tally["added_both"] += 1
                elif oi is not None:
                    tally["added_ours"] += 1
                else:
                    tally["added_theirs"] += 1
            elif key(chosen) == key(bi):
                tally["kept"] += 1
            else:
                tally["changed"] += 1
        return result

    statements = run("statements", base.statements, ours.statements, theirs.statements, _stmt_key, lambda s: s.to_dict() if s else None)
    arguments = run("arguments", base.arguments, ours.arguments, theirs.arguments, _arg_key, lambda a: a.to_dict() if a else None)

    # Dangling references: an argument survived but a statement it needs did not.
    present = {s.id for s in statements}
    kept_args = []
    for a in arguments:
        missing = [x for x in (*a.premises, *a.conclusions) if x not in present]
        if missing:
            conflicts.append({
                "kind": "dangling",
                "id": a.id,
                "missing": missing,
                "argument": a.to_dict(),
                "resolution": "dropped argument",
            })
        else:
            kept_args.append(a)

    # Header fields, same rule per field.
    def field(name):
        chosen, conflict = _three_way(getattr(base, name), getattr(ours, name), getattr(theirs, name), _freeze)
        if conflict:
            conflicts.append({"kind": "header", "id": name, "base": getattr(base, name), "ours": getattr(ours, name), "theirs": getattr(theirs, name), "resolution": "kept ours"})
        return chosen

    merged = Worldview(
        statements=statements,
        arguments=kept_args,
        name=field("name"),
        description=field("description"),
        version=ours.version,
        meta=field("meta"),
        ext=field("ext"),
    )
    return {"merged": merged.to_dict(), "conflicts": conflicts, "summary": summary}
