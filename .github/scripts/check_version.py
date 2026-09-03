"""Fail unless a pyproject.toml's project.version equals the expected string.

Used by the publish workflows so a tag like ``py-v0.2.0`` can only publish a
package whose ``pyproject.toml`` says ``version = "0.2.0"``.

    python .github/scripts/check_version.py <pyproject.toml> <expected-version>
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    pyproject, expected = Path(argv[1]), argv[2]
    with pyproject.open("rb") as f:
        version = tomllib.load(f)["project"]["version"]
    if version != expected:
        print(f"::error::{pyproject} has version {version!r} but the tag says {expected!r}")
        return 1
    print(f"{pyproject}: version {version} matches the tag")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
