"""Export a worldview as a picture description: Graphviz DOT or Mermaid.

Statements are boxes; arguments are small diamond nodes; edges run
premise -> argument -> conclusion.  Nothing evaluative is drawn.
"""

from __future__ import annotations

import textwrap

from .model import Worldview


def _wrap(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width) or [""]


def _dot_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def to_dot(wv: Worldview, *, ids: bool = True, wrap: int = 36, rankdir: str = "LR") -> str:
    """Graphviz DOT source.  ``ought`` statements are drawn with a double border."""
    s_index = {s.id: i for i, s in enumerate(wv.statements)}
    a_index = {a.id: i for i, a in enumerate(wv.arguments)}
    lines = [
        "digraph worldview {",
        f"  rankdir={rankdir};",
        '  node [fontname="Helvetica", fontsize=10];',
        '  edge [arrowsize=0.7];',
    ]
    if wv.name:
        lines.append(f'  label="{_dot_escape(wv.name)}"; labelloc=t;')
    for s in wv.statements:
        parts = ([s.id] if ids else []) + _wrap(s.text, wrap)
        label = "\\n".join(_dot_escape(p) for p in parts)
        shape = "box"
        extra = ', peripheries=2' if s.mode == "ought" else ""
        lines.append(f'  s{s_index[s.id]} [shape={shape}, style=rounded, label="{label}"{extra}];')
    for a in wv.arguments:
        parts = ([a.id] if ids else []) + ([a.rule] if a.rule else [])
        label = "\\n".join(_dot_escape(p) for p in parts)
        lines.append(f'  a{a_index[a.id]} [shape=diamond, fontsize=8, label="{label}"];')
    for a in wv.arguments:
        for p in a.premises:
            lines.append(f"  s{s_index[p]} -> a{a_index[a.id]};")
        for c in a.conclusions:
            lines.append(f"  a{a_index[a.id]} -> s{s_index[c]};")
    lines.append("}")
    return "\n".join(lines) + "\n"


def _mermaid_escape(s: str) -> str:
    return s.replace('"', "#quot;")


def to_mermaid(wv: Worldview, *, ids: bool = True, wrap: int = 36, direction: str = "LR") -> str:
    """Mermaid ``flowchart`` source.  ``ought`` statements get the class ``ought``."""
    s_index = {s.id: i for i, s in enumerate(wv.statements)}
    a_index = {a.id: i for i, a in enumerate(wv.arguments)}
    lines = [f"flowchart {direction}"]
    oughts = []
    for s in wv.statements:
        parts = ([s.id] if ids else []) + _wrap(s.text, wrap)
        label = "<br/>".join(_mermaid_escape(p) for p in parts)
        lines.append(f'  s{s_index[s.id]}["{label}"]')
        if s.mode == "ought":
            oughts.append(f"s{s_index[s.id]}")
    for a in wv.arguments:
        parts = ([a.id] if ids else []) + ([a.rule] if a.rule else [])
        label = "<br/>".join(_mermaid_escape(p) for p in parts) or " "
        lines.append(f'  a{a_index[a.id]}{{{{"{label}"}}}}')
    for a in wv.arguments:
        for p in a.premises:
            lines.append(f"  s{s_index[p]} --> a{a_index[a.id]}")
        for c in a.conclusions:
            lines.append(f"  a{a_index[a.id]} --> s{s_index[c]}")
    lines.append("  classDef ought stroke-width:3px,stroke-dasharray:4 2;")
    if oughts:
        lines.append(f"  class {','.join(oughts)} ought;")
    return "\n".join(lines) + "\n"
