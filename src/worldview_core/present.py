"""Present an argument as a Markdown document with its full structure explicit.

This is motivating use 5 from the design handoff: show someone a
conclusion together with everything it rests on, per argument, including
the justification prose, so the whole case can be read top to bottom.
"""

from __future__ import annotations

from .canon import canon
from .graph import Graph
from .model import Worldview
from .queries import plan, rests_on


def present(
    wv: Worldview,
    sid: str,
    *,
    given: list[str] | tuple[str, ...] = (),
    depth: int | None = None,
    graph: Graph | None = None,
) -> str:
    """Markdown rendering of the case for ``sid``.

    With ``given``, the tree is pruned at statements the audience already
    accepts (see :func:`queries.plan`).  ``depth`` limits expansion as in
    :func:`queries.rests_on`.
    """
    g = graph or Graph.build(wv)
    if given:
        report = plan(wv, sid, given, graph=g)
    else:
        report = rests_on(wv, sid, depth=depth, graph=g)
    target = g.statements[sid]

    out: list[str] = []
    out.append(f"# {canon(target.text)}")
    out.append("")
    tags = [f"`{sid}`", target.mode]
    scc = report["tree"].get("scc")
    if scc:
        tags.append("in cycle: " + ", ".join(f"`{x}`" for x in scc))
    out.append(" · ".join(tags))
    out.append("")
    if given:
        shown = report["given"]
        out.append("Taken as given: " + (", ".join(f"`{x}`" for x in shown) if shown else "nothing in this statement's closure") + ".")
        out.append("")

    out.append("## The case")
    out.append("")
    _render(out, g, report["tree"], indent=0)
    out.append("")

    if given:
        grant = report["must_grant"]
        out.append("## What the audience must grant")
        out.append("")
        if not grant:
            out.append("Nothing: every foundation reached is already given.")
        for s in grant:
            out.append(f"- `{s['id']}`: {canon(s['text'])}")
        out.append("")
    else:
        founds = [s for s in report["closure"]["statements"] if g.is_foundation(s)]
        if g.is_foundation(sid):
            founds = [sid] + founds
        out.append("## Foundations reached")
        out.append("")
        if not founds:
            out.append("None: every statement in the closure has an argument for it (the closure is cyclic).")
        for s in founds:
            out.append(f"- `{s}`: {canon(g.statements[s].text)}")
        out.append("")

    if report["sccs"]:
        out.append("## Cycles involved")
        out.append("")
        for comp in report["sccs"]:
            out.append("- " + ", ".join(f"`{x}`" for x in comp))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def _render(out: list[str], g: Graph, node: dict, indent: int) -> None:
    pad = "  " * indent
    s = g.statements[node["statement"]]
    flags = []
    if node.get("given"):
        flags.append("given")
    if node.get("seen"):
        flags.append("see above")
    if node.get("truncated"):
        flags.append("not expanded further")
    if "arguments" in node and not node["arguments"]:
        flags.append("foundation")
    suffix = f" — *{'; '.join(flags)}*" if flags else ""
    out.append(f"{pad}- **{canon(s.text)}** (`{s.id}`, {s.mode}){suffix}")
    for entry in node.get("arguments", []):
        a = g.arguments[entry["argument"]]
        rule = f" [{a.rule}]" if a.rule else ""
        co = entry.get("co_conclusions") or []
        jointly = f" (jointly concludes {', '.join(f'`{c}`' for c in co)})" if co else ""
        just = canon(a.justification) or "(no justification given)"
        out.append(f"{pad}  - via `{a.id}`{rule}{jointly}: {just}")
        if not entry["premises"]:
            out.append(f"{pad}    - *no premises*")
        for p in entry["premises"]:
            _render(out, g, p, indent + 2)
