"""Graph structure over a worldview: adjacency, strongly connected components.

The *statement graph* has one edge ``p -> c`` for every argument that
lists ``p`` among its premises and ``c`` among its conclusions.  Cycles
are ordinary structure here, never an error.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .model import Argument, Statement, Worldview


@dataclass
class Graph:
    statements: dict[str, Statement]
    arguments: dict[str, Argument]
    incoming: dict[str, list[str]] = field(default_factory=dict)  # stmt -> args concluding it
    outgoing: dict[str, list[str]] = field(default_factory=dict)  # stmt -> args using it as premise
    succ: dict[str, set[str]] = field(default_factory=dict)  # stmt -> stmts it supports
    pred: dict[str, set[str]] = field(default_factory=dict)  # stmt -> stmts supporting it
    _sccs: list[list[str]] | None = field(default=None, repr=False)
    _scc_of: dict[str, int] | None = field(default=None, repr=False)

    @classmethod
    def build(cls, wv: Worldview) -> "Graph":
        statements = {s.id: s for s in wv.statements}
        arguments = {a.id: a for a in wv.arguments}
        g = cls(statements, arguments)
        for sid in statements:
            g.incoming[sid] = []
            g.outgoing[sid] = []
            g.succ[sid] = set()
            g.pred[sid] = set()
        for a in wv.arguments:
            for c in a.conclusions:
                g.incoming[c].append(a.id)
            for p in a.premises:
                g.outgoing[p].append(a.id)
                for c in a.conclusions:
                    g.succ[p].add(c)
                    g.pred[c].add(p)
        return g

    # ---------------------------------------------------------- basic facts

    def is_foundation(self, sid: str) -> bool:
        return not self.incoming[sid]

    def foundations(self) -> list[str]:
        """Statements with no incoming argument, in file order."""
        return [sid for sid in self.statements if self.is_foundation(sid)]

    def has_self_loop(self, sid: str) -> bool:
        return sid in self.succ[sid]

    # ------------------------------------------------------------------ SCCs

    def sccs(self) -> list[list[str]]:
        """Strongly connected components in topological order of the condensation.

        Components that only support others come first; components that
        only rest on others come last.  Every statement is in exactly one
        component; acyclic statements form singleton components.  Members
        are listed in file order.
        """
        if self._sccs is None:
            self._compute_sccs()
        return self._sccs  # type: ignore[return-value]

    def scc_of(self) -> dict[str, int]:
        """Map statement id -> index into :meth:`sccs`."""
        if self._scc_of is None:
            self._compute_sccs()
        return self._scc_of  # type: ignore[return-value]

    def is_cyclic_component(self, comp: list[str]) -> bool:
        """True if the component contains a cycle (size > 1, or a self-loop)."""
        return len(comp) > 1 or self.has_self_loop(comp[0])

    def cyclic_sccs(self) -> list[list[str]]:
        return [c for c in self.sccs() if self.is_cyclic_component(c)]

    def _compute_sccs(self) -> None:
        # Iterative Tarjan.  Emits components in reverse topological order
        # (a component is emitted only after everything reachable from it),
        # so we reverse at the end to get sources first.
        order = {sid: i for i, sid in enumerate(self.statements)}
        index: dict[str, int] = {}
        low: dict[str, int] = {}
        on_stack: set[str] = set()
        stack: list[str] = []
        comps: list[list[str]] = []
        counter = 0

        for root in self.statements:
            if root in index:
                continue
            work: list[tuple[str, list[str]]] = [(root, sorted(self.succ[root], key=order.__getitem__))]
            index[root] = low[root] = counter
            counter += 1
            stack.append(root)
            on_stack.add(root)
            while work:
                v, todo = work[-1]
                if todo:
                    w = todo.pop()
                    if w not in index:
                        index[w] = low[w] = counter
                        counter += 1
                        stack.append(w)
                        on_stack.add(w)
                        work.append((w, sorted(self.succ[w], key=order.__getitem__)))
                    elif w in on_stack:
                        low[v] = min(low[v], index[w])
                else:
                    work.pop()
                    if work:
                        parent = work[-1][0]
                        low[parent] = min(low[parent], low[v])
                    if low[v] == index[v]:
                        comp: list[str] = []
                        while True:
                            w = stack.pop()
                            on_stack.discard(w)
                            comp.append(w)
                            if w == v:
                                break
                        comp.sort(key=order.__getitem__)
                        comps.append(comp)
        comps.reverse()
        self._sccs = comps
        self._scc_of = {sid: i for i, comp in enumerate(comps) for sid in comp}

    # ---------------------------------------------------------- reachability

    def upstream(self, sid: str) -> set[str]:
        """All statements from which ``sid`` is reachable (excluding itself unless cyclic)."""
        return self._reach(sid, self.pred)

    def downstream(self, sid: str) -> set[str]:
        """All statements reachable from ``sid`` (excluding itself unless cyclic)."""
        return self._reach(sid, self.succ)

    @staticmethod
    def _reach(start: str, adj: dict[str, set[str]]) -> set[str]:
        seen: set[str] = set()
        todo = list(adj[start])
        while todo:
            v = todo.pop()
            if v in seen:
                continue
            seen.add(v)
            todo.extend(adj[v] - seen)
        return seen
