"""Exception types for worldview-core."""

from __future__ import annotations


class WorldviewError(Exception):
    """Base class for all worldview-core errors."""


class LoadError(WorldviewError):
    """The file could not be read or parsed as JSON."""


class ValidationError(WorldviewError):
    """The document is not a valid worldview-core file.

    ``problems`` is the full list of human-readable problem strings; the
    message is the first of them (or a summary).
    """

    def __init__(self, problems: list[str]):
        self.problems = list(problems)
        if len(self.problems) == 1:
            msg = self.problems[0]
        else:
            msg = f"{len(self.problems)} validation problems; first: {self.problems[0]}"
        super().__init__(msg)


class UnknownIdError(WorldviewError, KeyError):
    """A query referenced a statement or argument id that is not in the file."""

    def __init__(self, kind: str, id_: str):
        self.kind = kind
        self.id = id_
        super().__init__(f"no {kind} with id {id_!r}")

    def __str__(self) -> str:  # KeyError quotes its argument; we want prose
        return f"no {self.kind} with id {self.id!r}"
