"""Validation of worldview-core documents.

Two layers:

1. **Structural** checks that mirror ``worldview-core.schema.json``
   exactly (types, required fields, enums, no unknown fields).  These
   are hand-written so the library has no runtime dependencies; the
   test suite cross-checks them against the schema with ``jsonschema``.
2. **Referential** checks the schema cannot express: ids unique within
   their kind, every premise and conclusion refers to an existing
   statement.

Cycles are **never** reported here.  A worldview with circular
justification is a valid worldview.
"""

from __future__ import annotations

import json
import re
from importlib import resources
from typing import Any

from .errors import ValidationError

SCHEMA_FILENAME = "worldview-core.schema.json"

_ID_RE = re.compile(r"^\S+$")
_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+$")
_MODES = ("is", "ought")

_TOP_FIELDS = {"format", "version", "name", "description", "meta", "ext", "statements", "arguments"}
_STATEMENT_FIELDS = {"id", "text", "mode", "meta", "ext"}
_ARGUMENT_FIELDS = {"id", "premises", "conclusions", "justification", "rule", "meta", "ext"}


def schema() -> dict[str, Any]:
    """The normative JSON Schema, as a dict."""
    text = resources.files(__package__).joinpath(SCHEMA_FILENAME).read_text(encoding="utf-8")
    return json.loads(text)


def validate_dict(data: Any, *, strict: bool = False) -> list[str]:
    """Validate raw JSON data.  Returns a list of problems (empty if valid).

    With ``strict=True``, raises :class:`ValidationError` instead of
    returning a non-empty list.
    """
    problems = _structural(data)
    if not problems:
        problems = _referential(data)
    if strict and problems:
        raise ValidationError(problems)
    return problems


# ---------------------------------------------------------------- structure


def _structural(data: Any) -> list[str]:
    p: list[str] = []
    if not isinstance(data, dict):
        return ["document: must be a JSON object"]

    _unknown_fields(p, "document", data, _TOP_FIELDS)
    for req in ("format", "version", "statements", "arguments"):
        if req not in data:
            p.append(f"document: missing required field {req!r}")

    if "format" in data and data["format"] != "worldview-core":
        p.append(f"document: 'format' must be \"worldview-core\", got {data['format']!r}")
    if "version" in data:
        v = data["version"]
        if not isinstance(v, str) or not _VERSION_RE.match(v):
            p.append(f"document: 'version' must be a string like \"0.1\", got {v!r}")
    for f in ("name", "description"):
        if f in data and not isinstance(data[f], str):
            p.append(f"document: {f!r} must be a string")
    _meta_ext(p, "document", data)

    if "statements" in data:
        if not isinstance(data["statements"], list):
            p.append("document: 'statements' must be an array")
        else:
            for i, s in enumerate(data["statements"]):
                _statement(p, i, s)
    if "arguments" in data:
        if not isinstance(data["arguments"], list):
            p.append("document: 'arguments' must be an array")
        else:
            for i, a in enumerate(data["arguments"]):
                _argument(p, i, a)
    return p


def _unknown_fields(p: list[str], where: str, obj: dict, allowed: set[str]) -> None:
    for k in obj:
        if k not in allowed:
            p.append(f"{where}: unknown field {k!r} (extensions belong under 'ext')")


def _meta_ext(p: list[str], where: str, obj: dict) -> None:
    if "meta" in obj and not isinstance(obj["meta"], dict):
        p.append(f"{where}: 'meta' must be an object")
    if "ext" in obj:
        ext = obj["ext"]
        if not isinstance(ext, dict):
            p.append(f"{where}: 'ext' must be an object")
        else:
            for k, v in ext.items():
                if not isinstance(v, dict):
                    p.append(f"{where}: ext[{k!r}] must be an object (each ext key is a namespace)")


def _check_id(p: list[str], where: str, obj: dict) -> str:
    """Validate obj['id'] and return a label for later messages."""
    if "id" not in obj:
        p.append(f"{where}: missing required field 'id'")
        return where
    v = obj["id"]
    if not isinstance(v, str) or not v or not _ID_RE.match(v):
        p.append(f"{where}: 'id' must be a non-empty string without whitespace, got {v!r}")
        return where
    return f"{where} ({v})"


def _statement(p: list[str], i: int, s: Any) -> None:
    where = f"statements[{i}]"
    if not isinstance(s, dict):
        p.append(f"{where}: must be an object")
        return
    _unknown_fields(p, where, s, _STATEMENT_FIELDS)
    where = _check_id(p, where, s)
    if "text" not in s:
        p.append(f"{where}: missing required field 'text'")
    elif not isinstance(s["text"], str) or not s["text"]:
        p.append(f"{where}: 'text' must be a non-empty string")
    if "mode" not in s:
        p.append(f"{where}: missing required field 'mode'")
    elif s["mode"] not in _MODES:
        p.append(f"{where}: 'mode' must be \"is\" or \"ought\", got {s['mode']!r}")
    _meta_ext(p, where, s)


def _argument(p: list[str], i: int, a: Any) -> None:
    where = f"arguments[{i}]"
    if not isinstance(a, dict):
        p.append(f"{where}: must be an object")
        return
    _unknown_fields(p, where, a, _ARGUMENT_FIELDS)
    where = _check_id(p, where, a)
    for f, min_items in (("premises", 0), ("conclusions", 1)):
        if f not in a:
            p.append(f"{where}: missing required field {f!r}")
            continue
        v = a[f]
        if not isinstance(v, list):
            p.append(f"{where}: {f!r} must be an array of statement ids")
            continue
        if len(v) < min_items:
            p.append(f"{where}: {f!r} must have at least {min_items} item(s)")
        for j, x in enumerate(v):
            if not isinstance(x, str) or not x or not _ID_RE.match(x):
                p.append(f"{where}: {f}[{j}] must be a statement id (non-empty string without whitespace), got {x!r}")
        if len(set(x for x in v if isinstance(x, str))) != len(v):
            p.append(f"{where}: {f!r} contains duplicate ids")
    if "justification" not in a:
        p.append(f"{where}: missing required field 'justification'")
    elif not isinstance(a["justification"], str):
        p.append(f"{where}: 'justification' must be a string")
    if "rule" in a and not isinstance(a["rule"], str):
        p.append(f"{where}: 'rule' must be a string")
    _meta_ext(p, where, a)


# --------------------------------------------------------------- references


def _referential(data: dict) -> list[str]:
    p: list[str] = []
    seen: set[str] = set()
    for i, s in enumerate(data["statements"]):
        if s["id"] in seen:
            p.append(f"statements[{i}]: duplicate statement id {s['id']!r}")
        seen.add(s["id"])
    statement_ids = seen

    seen_args: set[str] = set()
    for i, a in enumerate(data["arguments"]):
        if a["id"] in seen_args:
            p.append(f"arguments[{i}]: duplicate argument id {a['id']!r}")
        seen_args.add(a["id"])
        for f in ("premises", "conclusions"):
            for ref in a[f]:
                if ref not in statement_ids:
                    p.append(f"arguments[{i}] ({a['id']}): {f} references unknown statement {ref!r}")
    return p


def validate_with_jsonschema(data: Any) -> list[str]:
    """Validate against the shipped JSON Schema using the ``jsonschema`` package.

    Optional: raises :class:`ImportError` if ``jsonschema`` is not installed.
    The built-in validator is authoritative for this library; this exists so
    users can confirm the two agree on their files.
    """
    import jsonschema  # type: ignore[import-not-found]

    validator = jsonschema.Draft202012Validator(schema())
    return [
        f"{'/'.join(str(x) for x in e.absolute_path) or 'document'}: {e.message}"
        for e in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    ]
