"""Structural queries.  None of these evaluates truth or validity.

Every function takes a :class:`Worldview` and returns plain data (dicts,
lists, strings) suitable for JSON output.  Cycles are reported as
structure, never raised.
"""

from __future__ import annotations

from typing import Any

from .errors import UnknownIdError
from .graph import Graph
from .model import Worldview


def _graph(wv: Worldview, graph: Graph | None) -> Graph:
    return graph or Graph.build(wv)


def _require(g: Graph, sid: str) -> None:
    if sid not in g.statements:
        raise UnknownIdError("statement", sid)


# ------------------------------------------------------------- foundations


def foundations(wv: Worldview, graph: Graph | None = None) -> list[dict[str, Any]]:
    """Statements with no incoming argument: the computed notion of "axiom"."""
    g = _graph(wv, graph)
    return [{"id": sid, "text": g.statements[sid].text, "mode": g.statements[sid].mode} for sid in g.foundations()]


# -------------------------------------------------------------------- sccs


def sccs(wv: Worldview, graph: Graph | None = None) -> list[dict[str, Any]]:
    """Cyclic strongly connected components: size > 1, or a self-loop.

    Each entry lists the member statements, the arguments that run
    entirely inside the component (premises and conclusions all members)
    and the arguments that run partly inside it.
    """
    g = _graph(wv, graph)
    out = []
    for comp in g.cyclic_sccs():
        members = set(comp)
        internal, boundary = [], []
        for aid, a in g.arguments.items():
            touches = members.intersection(a.premises) or members.intersection(a.conclusions)
            if not touches:
                continue
            if members.issuperset(a.premises) and members.issuperset(a.conclusions):
                internal.append(aid)
            else:
                boundary.append(aid)
        out.append(
            {
                "members": list(comp),
                "self_loops": [s for s in comp if g.has_self_loop(s)],
                "internal_arguments": internal,
                "boundary_arguments": boundary,
            }
        )
    return out


# ---------------------------------------------------------------- rests-on


def rests_on(wv: Worldview, sid: str, depth: int | None = None, graph: Graph | None = None) -> dict[str, Any]:
    """Upstream closure of a statement, reported per incoming argument.

    The ``tree`` expands each statement once; a later encounter of the
    same statement is a leaf marked ``"seen": true``.  That keeps the
    output linear in the size of the closure and makes cycles finite:
    a statement that rests on itself shows up as a ``seen`` leaf under
    its own subtree.  ``depth`` limits how many argument hops are
    expanded; a node cut off by the limit is marked ``"truncated": true``.

    ``closure`` is the flat set of every statement and argument upstream
    (regardless of ``depth``), and ``sccs`` lists every cyclic component
    that the target or its closure belongs to.
    """
    g = _graph(wv, graph)
    _require(g, sid)
    return _closure_report(g, sid, depth, direction="up")


def supports(wv: Worldview, sid: str, depth: int | None = None, graph: Graph | None = None) -> dict[str, Any]:
    """Downstream closure of a statement, reported per outgoing argument.

    Mirror image of :func:`rests_on`.  For each argument that uses the
    statement as a premise, the report lists its co-premises and expands
    its conclusions.
    """
    g = _graph(wv, graph)
    _require(g, sid)
    return _closure_report(g, sid, depth, direction="down")


def _closure_report(g: Graph, sid: str, depth: int | None, direction: str) -> dict[str, Any]:
    up = direction == "up"
    reach = g.upstream(sid) if up else g.downstream(sid)
    arg_ids: set[str] = set()
    for s in reach | {sid}:
        for aid in g.incoming[s] if up else g.outgoing[s]:
            a = g.arguments[aid]
            # An argument is in the closure if it is wholly on the relevant side.
            if up and set(a.conclusions) & (reach | {sid}):
                arg_ids.add(aid)
            elif not up and set(a.premises) & (reach | {sid}):
                arg_ids.add(aid)

    scc_of = g.scc_of()
    comps = g.sccs()
    involved = sorted({scc_of[s] for s in reach | {sid}})
    cyclic = [comps[i] for i in involved if g.is_cyclic_component(comps[i])]

    expanded: set[str] = set()

    def node(s: str, d: int) -> dict[str, Any]:
        n: dict[str, Any] = {"statement": s, "text": g.statements[s].text}
        comp = comps[scc_of[s]]
        if g.is_cyclic_component(comp):
            n["scc"] = list(comp)
        if s in expanded:
            n["seen"] = True
            return n
        expanded.add(s)
        if depth is not None and d >= depth:
            if g.incoming[s] if up else g.outgoing[s]:
                n["truncated"] = True
            return n
        args = []
        for aid in g.incoming[s] if up else g.outgoing[s]:
            a = g.arguments[aid]
            entry: dict[str, Any] = {"argument": aid}
            if a.rule is not None:
                entry["rule"] = a.rule
            if up:
                entry["co_conclusions"] = [c for c in a.conclusions if c != s]
                entry["premises"] = [node(p, d + 1) for p in a.premises]
            else:
                entry["co_premises"] = [p for p in a.premises if p != s]
                entry["conclusions"] = [node(c, d + 1) for c in a.conclusions]
            args.append(entry)
        n["arguments"] = args
        return n

    return {
        "statement": sid,
        "text": g.statements[sid].text,
        "direction": direction,
        "closure": {
            "statements": [s for s in g.statements if s in reach],
            "arguments": [a for a in g.arguments if a in arg_ids],
        },
        "sccs": cyclic,
        "tree": node(sid, 0),
    }


# ---------------------------------------------------------- well-founded


def well_founded(wv: Worldview, graph: Graph | None = None) -> dict[str, Any]:
    """Optional lint: which statements are grounded in foundations?

    A statement is *grounded* if it is a foundation, or if some argument
    concluding it has all of its premises grounded (an argument with no
    premises is trivially grounded).  This is the least fixed point, so
    a statement whose only support runs through a cycle is ungrounded,
    and a statement that needs two premises is ungrounded if either one
    is.  Informational only; never a validation failure.
    """
    g = _graph(wv, graph)
    grounded: set[str] = set(g.foundations())
    changed = True
    while changed:
        changed = False
        for a in g.arguments.values():
            if all(p in grounded for p in a.premises):
                for c in a.conclusions:
                    if c not in grounded:
                        grounded.add(c)
                        changed = True
    return {
        "foundations": g.foundations(),
        "grounded": [s for s in g.statements if s in grounded],
        "ungrounded": [s for s in g.statements if s not in grounded],
    }
