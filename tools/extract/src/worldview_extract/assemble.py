"""Records produced by the passes, id assignment, document assembly, and repair."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from worldview_core import canon, validate_dict

MAX_SLUG_LEN = 48


class ExtractError(Exception):
    """The extraction could not produce a valid worldview file."""


@dataclass
class StatementRec:
    id: str
    text: str
    mode: str
    sources: list[str] = field(default_factory=list)
    role: str = "stated"
    note: str = ""
    chunks: set[int] = field(default_factory=set)  # chunk indices that contributed

    def absorb(self, other: "StatementRec") -> None:
        """Fold ``other`` (a duplicate) into this record."""
        for s in other.sources:
            if s not in self.sources:
                self.sources.append(s)
        self.chunks |= other.chunks
        if not self.note and other.note:
            self.note = other.note
        if self.role != "stated" and other.role == "stated":
            self.role = "stated"

    def to_dict(self) -> dict[str, Any]:
        meta: dict[str, Any] = {"sources": list(self.sources), "role": self.role}
        if self.note:
            meta["note"] = self.note
        return {"id": self.id, "text": self.text, "mode": self.mode, "meta": meta}


@dataclass
class ArgumentRec:
    id: str
    premises: list[str]
    conclusions: list[str]
    justification: str
    rule: str = ""
    sources: list[str] = field(default_factory=list)
    origin: str = ""  # "chunk:3" or "link"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "premises": list(self.premises),
            "conclusions": list(self.conclusions),
            "justification": self.justification,
        }
        if self.rule:
            d["rule"] = self.rule
        meta: dict[str, Any] = {"sources": list(self.sources)}
        if self.origin == "link":
            meta["link"] = True
        d["meta"] = meta
        return d


# ------------------------------------------------------------------ ids


def slugify(text: str, fallback: str = "s") -> str:
    """Kebab-case id from free text: ASCII letters and digits, single hyphens."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = re.sub(r"-{2,}", "-", text)
    if len(text) > MAX_SLUG_LEN:
        cut = text[: MAX_SLUG_LEN + 1].rfind("-")
        text = text[:cut] if cut > 0 else text[:MAX_SLUG_LEN]
        text = text.strip("-")
    return text or fallback


def slug_from_text(text: str, words: int = 5, fallback: str = "statement") -> str:
    """A slug from the first few words of ``text``; ``fallback`` when none
    survive (text in a script that does not transliterate to ASCII)."""
    return slugify(" ".join(text.split()[:words]), fallback)


def unique_id(base: str, taken: set[str]) -> str:
    """``base`` if free, else ``base-2``, ``base-3``, ...; marks the result taken."""
    candidate = base
    n = 2
    while candidate in taken:
        candidate = f"{base}-{n}"
        n += 1
    taken.add(candidate)
    return candidate


# ------------------------------------------------------------- assembly


def build_document(
    statements: list[StatementRec],
    arguments: list[ArgumentRec],
    *,
    name: str | None = None,
    description: str | None = None,
    extraction: dict[str, Any] | None = None,
) -> dict[str, Any]:
    doc: dict[str, Any] = {"format": "worldview-core", "version": "0.1"}
    if name:
        doc["name"] = name
    if description:
        doc["description"] = description
    if extraction is not None:
        doc["meta"] = {"extraction": extraction}
    doc["statements"] = [s.to_dict() for s in statements]
    doc["arguments"] = [a.to_dict() for a in arguments]
    return doc


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _follow(mapping: dict[str, str], id_: str) -> str:
    """Follow a merge chain to its end (guarding against a cycle)."""
    seen: set[str] = set()
    while id_ in mapping and id_ not in seen:
        seen.add(id_)
        id_ = mapping[id_]
    return id_


def repair(doc: dict[str, Any], merged: dict[str, str] | None = None) -> tuple[dict[str, Any], list[str]]:
    """Fix reference problems in an assembled document; return it and a log.

    ``merged`` is the consolidation pass's mapping ``dropped id -> kept
    id``.  For every premise and conclusion of every argument, in order:

    * a reference to an existing statement is kept as is;
    * a reference to an id that was merged into another statement is
      rewritten to the surviving id (the two were judged the same
      proposition, so the rewrite records what the model meant);
    * a reference that differs from an existing id only in case,
      whitespace, or punctuation is rewritten to that id;
    * any other reference is dropped.  The repair never invents one.

    Then duplicate ids inside ``premises`` or ``conclusions`` are
    collapsed, an argument left with no conclusion is dropped, a later
    argument with the same premise set and conclusion set as an earlier
    one is dropped, and a duplicate argument id is renamed.

    Every change is described in the returned log, and each surviving
    argument that was changed also lists its changes under
    ``meta.repairs``.  The result is validated with
    :func:`worldview_core.validate_dict`; if problems remain (they should
    not), :class:`ExtractError` is raised.
    """
    log: list[str] = []
    ids = {s["id"] for s in doc.get("statements", [])}
    merged = merged or {}

    def resolve(ref: str) -> tuple[str | None, str | None]:
        """(replacement, how) for a reference that is not an id, or (None, None) to drop it."""
        target = _follow(merged, ref)
        if target in ids:
            return target, "merged into"
        norm = slugify(ref, "")
        target = _follow(merged, norm)
        if target in ids:
            return target, "normalised to" if target == norm else "normalised and merged into"
        return None, None

    def fix(kind: str, refs: list[str], notes: list[str]) -> list[str]:
        out: list[str] = []
        unknown: list[str] = []
        for ref in refs:
            if ref in ids:
                out.append(ref)
                continue
            target, how = resolve(ref)
            if target is None:
                unknown.append(ref)
            else:
                notes.append(f"{kind} {ref} {how} {target}")
                out.append(target)
        if unknown:
            notes.append(f"dropped unknown {kind}(s) {', '.join(unknown)}")
        deduped = _dedupe(out)
        if len(deduped) != len(out):
            notes.append("collapsed duplicate ids")
        return deduped

    kept: list[dict[str, Any]] = []
    shapes: set[tuple[frozenset[str], frozenset[str]]] = set()
    arg_ids: set[str] = set()
    for a in doc.get("arguments", []):
        aid = a["id"]
        notes: list[str] = []
        premises = fix("premise", list(a["premises"]), notes)
        conclusions = fix("conclusion", list(a["conclusions"]), notes)
        if notes.count("collapsed duplicate ids") > 1:
            notes.remove("collapsed duplicate ids")
        log.extend(f"argument {aid}: {n}" for n in notes)
        if not conclusions:
            log.append(f"argument {aid}: dropped (no valid conclusion left)")
            continue
        shape = (frozenset(premises), frozenset(conclusions))
        if shape in shapes:
            log.append(f"argument {aid}: dropped (same premises and conclusions as an earlier argument)")
            continue
        shapes.add(shape)
        if aid in arg_ids:
            new = unique_id(aid, arg_ids)
            log.append(f"argument {aid}: renamed to {new} (duplicate id)")
            notes.append(f"renamed from {aid} (duplicate id)")
            aid = new
        else:
            arg_ids.add(aid)
        fixed = {**a, "id": aid, "premises": premises, "conclusions": conclusions}
        if notes:
            fixed["meta"] = {**(a.get("meta") or {}), "repairs": notes}
        kept.append(fixed)
    repaired = {**doc, "arguments": kept}
    problems = validate_dict(repaired)
    if problems:
        raise ExtractError("assembled document is not a valid worldview-core file: " + "; ".join(problems[:10]))
    return repaired, log


def exact_key(text: str, mode: str) -> tuple[str, str]:
    """Identity used for exact de-duplication: canonical text plus mode."""
    return canon(text), mode
