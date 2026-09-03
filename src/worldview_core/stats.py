"""Descriptive statistics of a worldview.  Structural only, nothing evaluative."""

from __future__ import annotations

from typing import Any

from .graph import Graph
from .lint import unused
from .model import Worldview
from .queries import well_founded


def _dist(values: list[int]) -> dict[str, float | int]:
    if not values:
        return {"min": 0, "max": 0, "mean": 0.0}
    return {"min": min(values), "max": max(values), "mean": round(sum(values) / len(values), 3)}


def stats(wv: Worldview, graph: Graph | None = None, top: int = 5) -> dict[str, Any]:
    g = graph or Graph.build(wv)
    comps = g.sccs()
    cyclic = [c for c in comps if g.is_cyclic_component(c)]
    scc_of = g.scc_of()

    # Longest chain of arguments across the condensation (cycles count as one step).
    depth = [0] * len(comps)
    for ci, comp in enumerate(comps):
        members = set(comp)
        best = 0
        for s in comp:
            for aid in g.incoming[s]:
                for p in g.arguments[aid].premises:
                    if p not in members:
                        best = max(best, depth[scc_of[p]] + 1)
        depth[ci] = best

    downstream = {s: len(g.downstream(s)) for s in g.statements}
    upstream = {s: len(g.upstream(s)) for s in g.statements}
    order = {s: i for i, s in enumerate(g.statements)}

    def top_by(counts: dict[str, int], key: str) -> list[dict[str, Any]]:
        ranked = sorted(counts, key=lambda s: (-counts[s], order[s]))[:top]
        return [{"id": s, key: counts[s]} for s in ranked if counts[s] > 0]

    return {
        "statements": len(wv.statements),
        "arguments": len(wv.arguments),
        "modes": {
            "is": sum(1 for s in wv.statements if s.mode == "is"),
            "ought": sum(1 for s in wv.statements if s.mode == "ought"),
        },
        "foundations": len(g.foundations()),
        "terminals": sum(1 for s in g.statements if not g.outgoing[s]),
        "unused": len(unused(wv, g)),
        "ungrounded": len(well_founded(wv, g)["ungrounded"]),
        "cycles": len(cyclic),
        "largest_cycle": max((len(c) for c in cyclic), default=0),
        "statements_in_cycles": sum(len(c) for c in cyclic),
        "premises": _dist([len(a.premises) for a in wv.arguments]),
        "conclusions": _dist([len(a.conclusions) for a in wv.arguments]),
        "zero_premise_arguments": sum(1 for a in wv.arguments if not a.premises),
        "longest_chain": max(depth, default=0),
        "most_supporting": top_by(downstream, "downstream"),
        "most_supported": top_by(upstream, "upstream"),
    }
