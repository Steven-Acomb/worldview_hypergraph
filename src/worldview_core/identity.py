"""Computed identities: proposition ids, justified-statement ids, argument hashes.

Nothing here is ever stored in a worldview file.  Both identity layers
are derived from content on demand::

    prop_id(s)  = H("prop", canon(s.text), s.mode)

    arg_hash(a) = H("arg", canon(a.justification),
                    sorted(just_id(p) for p in a.premises),
                    sorted(prop_id(c) for c in a.conclusions))

    just_id(s)  = H("just", prop_id(s),
                    sorted(arg_hash(a) for a in incoming(s)))

That recursion does not terminate on cycles, so strongly connected
components are hashed as units.  For a cyclic component ``C`` (size > 1,
or a single statement with a self-loop)::

    arg_hash'(a) = arg_hash(a) but with prop_id(p) in place of just_id(p)
                   for premises p inside C

    scc_hash(C)  = H("scc", sorted(prop_id(s) for s in C),
                     sorted(arg_hash'(a) for a in args concluding into C))

    just_id(s in C) = H("justscc", scc_hash(C), prop_id(s))

"Args concluding into C" are the arguments with at least one conclusion
in C.  Arguments that merely *use* a member of C as a premise are
downstream of C and do not affect its identity.

``meta``, ``ext``, ``rule``, and every local ``id`` are ignored.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .canon import H, canon
from .graph import Graph
from .model import Argument, Worldview


@dataclass
class Identities:
    prop_id: dict[str, str]  # statement id -> proposition id
    just_id: dict[str, str]  # statement id -> justified-statement id
    arg_hash: dict[str, str]  # argument id -> argument hash
    sccs: list[list[str]]  # every component, topological order (see Graph.sccs)
    scc_hash: dict[int, str]  # component index -> scc hash, cyclic components only
    graph: Graph

    def scc_of(self, sid: str) -> list[str] | None:
        """Members of the cyclic component containing ``sid``, or None if acyclic."""
        i = self.graph.scc_of()[sid]
        return self.sccs[i] if i in self.scc_hash else None

    def to_dict(self) -> dict:
        """Plain-data form, keyed by local id, in file order."""
        return {
            "statements": [
                {
                    "id": sid,
                    "prop_id": self.prop_id[sid],
                    "just_id": self.just_id[sid],
                    **({"scc": self.scc_of(sid)} if self.scc_of(sid) else {}),
                }
                for sid in self.graph.statements
            ],
            "arguments": [
                {"id": aid, "arg_hash": self.arg_hash[aid]} for aid in self.graph.arguments
            ],
        }


def prop_id(text: str, mode: str) -> str:
    return H("prop", canon(text), mode)


def _arg_hash(a: Argument, premise_id: Callable[[str], str], prop: dict[str, str]) -> str:
    return H(
        "arg",
        canon(a.justification),
        sorted(premise_id(p) for p in a.premises),
        sorted(prop[c] for c in a.conclusions),
    )


def compute_identities(wv: Worldview, graph: Graph | None = None) -> Identities:
    g = graph or Graph.build(wv)
    prop = {sid: prop_id(s.text, s.mode) for sid, s in g.statements.items()}
    just: dict[str, str] = {}
    scc_hash: dict[int, str] = {}

    for ci, comp in enumerate(g.sccs()):
        if g.is_cyclic_component(comp):
            members = set(comp)
            touching = sorted({aid for sid in comp for aid in g.incoming[sid]})

            def premise_id(p: str, members=members) -> str:
                return prop[p] if p in members else just[p]

            sh = H(
                "scc",
                sorted(prop[s] for s in comp),
                sorted(_arg_hash(g.arguments[aid], premise_id, prop) for aid in touching),
            )
            scc_hash[ci] = sh
            for s in comp:
                just[s] = H("justscc", sh, prop[s])
        else:
            (s,) = comp
            # Every premise of an incoming argument lies in an earlier component.
            hashes = sorted(_arg_hash(g.arguments[aid], just.__getitem__, prop) for aid in g.incoming[s])
            just[s] = H("just", prop[s], hashes)

    arg_hash = {aid: _arg_hash(a, just.__getitem__, prop) for aid, a in g.arguments.items()}
    return Identities(prop, just, arg_hash, g.sccs(), scc_hash, g)
