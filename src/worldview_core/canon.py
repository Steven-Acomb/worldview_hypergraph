"""Canonicalization and hashing primitives.

These are the rules that decide when two pieces of text "say the same
thing" for identity purposes.  They are deliberately literal:

* Unicode NFC normalization.
* Leading and trailing whitespace stripped.
* Every internal run of whitespace collapsed to a single ASCII space.
* No case folding, no punctuation stripping, no stemming.

The hash is SHA-256 over a delimiter-safe encoding of its parts (each
part is prefixed with its byte length, netstring-style), so that
``H(a, b)`` can never collide with ``H(ab)`` or with a different split
of the same characters.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable

#: The exact set of code points treated as whitespace by ``canon``.  This
#: is spelled out (rather than relying on ``\s``) so that every
#: implementation in every language agrees.  It equals Python's
#: ``str.isspace`` set: Unicode categories Zs, Zl, Zp plus the ASCII and
#: Latin-1 control characters with bidi class WS, B, or S.  U+FEFF (BOM /
#: zero-width no-break space) is deliberately *not* whitespace.
WHITESPACE = (
    "\t\n\x0b\x0c\r \x1c\x1d\x1e\x1f\x85\xa0 "
    "           "
    "    　"
)

_WS_CLASS = "[" + "".join(f"\\u{ord(c):04x}" for c in WHITESPACE) + "]"
_WS_RUN = re.compile(_WS_CLASS + "+")
_WS_EDGES = re.compile("^" + _WS_CLASS + "+|" + _WS_CLASS + "+$")


def canon(text: str) -> str:
    """Canonical form of a piece of natural-language text.

    1. Unicode NFC normalization.
    2. Strip leading and trailing whitespace (see :data:`WHITESPACE`).
    3. Collapse every internal run of whitespace to a single U+0020.
    """
    text = unicodedata.normalize("NFC", text)
    text = _WS_EDGES.sub("", text)
    return _WS_RUN.sub(" ", text)


def H(*parts: str | Iterable[str]) -> str:
    """SHA-256 hex digest of the parts, delimiter-safe.

    Each argument is either a string or an iterable of strings.  An
    iterable is encoded as its element count followed by its elements,
    so lists of different lengths can never be confused with one
    another or with their neighbours.  Callers are responsible for
    sorting iterables whose order is not meaningful.
    """
    h = hashlib.sha256()
    for part in parts:
        if isinstance(part, str):
            _feed(h, part)
        else:
            items = list(part)
            _feed(h, f"#{len(items)}")
            for item in items:
                _feed(h, item)
    return h.hexdigest()


def _feed(h, s: str) -> None:
    b = s.encode("utf-8")
    h.update(f"{len(b)}:".encode("ascii"))
    h.update(b)
    h.update(b",")
