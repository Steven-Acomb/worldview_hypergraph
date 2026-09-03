"""In-memory model of a worldview file.

The model mirrors the JSON one-to-one.  It performs no interpretation:
``meta`` and ``ext`` are carried along untouched, and nothing here
computes identities or walks the graph (see :mod:`identity` and
:mod:`graph` for that).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import LoadError, UnknownIdError

FORMAT = "worldview-core"
FORMAT_VERSION = "0.1"


@dataclass(frozen=True)
class Statement:
    id: str
    text: str
    mode: str  # "is" | "ought"
    meta: dict[str, Any] | None = None
    ext: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "text": self.text, "mode": self.mode}
        if self.meta is not None:
            d["meta"] = self.meta
        if self.ext is not None:
            d["ext"] = self.ext
        return d


@dataclass(frozen=True)
class Argument:
    id: str
    premises: tuple[str, ...]
    conclusions: tuple[str, ...]
    justification: str
    rule: str | None = None
    meta: dict[str, Any] | None = None
    ext: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "premises": list(self.premises),
            "conclusions": list(self.conclusions),
            "justification": self.justification,
        }
        if self.rule is not None:
            d["rule"] = self.rule
        if self.meta is not None:
            d["meta"] = self.meta
        if self.ext is not None:
            d["ext"] = self.ext
        return d


@dataclass
class Worldview:
    statements: list[Statement] = field(default_factory=list)
    arguments: list[Argument] = field(default_factory=list)
    name: str | None = None
    description: str | None = None
    version: str = FORMAT_VERSION
    meta: dict[str, Any] | None = None
    ext: dict[str, Any] | None = None
    source: str | None = None  # path it was loaded from, if any

    # -- construction -------------------------------------------------

    @classmethod
    def from_dict(cls, data: dict[str, Any], source: str | None = None) -> "Worldview":
        """Build a Worldview from already-validated JSON data.

        This does not validate.  Call :func:`worldview_core.validate.validate_dict`
        first, or use :func:`load`, which does.
        """
        statements = [
            Statement(
                id=s["id"],
                text=s["text"],
                mode=s["mode"],
                meta=s.get("meta"),
                ext=s.get("ext"),
            )
            for s in data["statements"]
        ]
        arguments = [
            Argument(
                id=a["id"],
                premises=tuple(a["premises"]),
                conclusions=tuple(a["conclusions"]),
                justification=a["justification"],
                rule=a.get("rule"),
                meta=a.get("meta"),
                ext=a.get("ext"),
            )
            for a in data["arguments"]
        ]
        return cls(
            statements=statements,
            arguments=arguments,
            name=data.get("name"),
            description=data.get("description"),
            version=data["version"],
            meta=data.get("meta"),
            ext=data.get("ext"),
            source=source,
        )

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"format": FORMAT, "version": self.version}
        if self.name is not None:
            d["name"] = self.name
        if self.description is not None:
            d["description"] = self.description
        if self.meta is not None:
            d["meta"] = self.meta
        if self.ext is not None:
            d["ext"] = self.ext
        d["statements"] = [s.to_dict() for s in self.statements]
        d["arguments"] = [a.to_dict() for a in self.arguments]
        return d

    # -- lookup -------------------------------------------------------

    def statement(self, id_: str) -> Statement:
        for s in self.statements:
            if s.id == id_:
                return s
        raise UnknownIdError("statement", id_)

    def argument(self, id_: str) -> Argument:
        for a in self.arguments:
            if a.id == id_:
                return a
        raise UnknownIdError("argument", id_)

    def statement_ids(self) -> list[str]:
        return [s.id for s in self.statements]

    def argument_ids(self) -> list[str]:
        return [a.id for a in self.arguments]


def read_json(path: str | Path) -> Any:
    """Read and parse a JSON file, wrapping failures in :class:`LoadError`."""
    p = Path(path)
    try:
        raw = p.read_text(encoding="utf-8")
    except OSError as e:
        raise LoadError(f"cannot read {p}: {e.strerror or e}") from e
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise LoadError(f"{p}: not valid JSON: {e}") from e


def load(path: str | Path) -> Worldview:
    """Read, validate, and build a Worldview from a file.

    Raises :class:`LoadError` if the file cannot be read or parsed and
    :class:`ValidationError` if it is not a valid worldview-core file.
    """
    from .validate import validate_dict  # local import to avoid a cycle

    data = read_json(path)
    validate_dict(data, strict=True)
    return Worldview.from_dict(data, source=str(path))


def loads(text: str) -> Worldview:
    """Like :func:`load`, but from a JSON string."""
    from .validate import validate_dict

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise LoadError(f"not valid JSON: {e}") from e
    validate_dict(data, strict=True)
    return Worldview.from_dict(data)
