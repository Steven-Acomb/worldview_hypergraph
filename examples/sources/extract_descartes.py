"""Turn the Project Gutenberg HTML of Descartes' *Discourse on the Method*
(ebook #59, Veitch translation) into a paragraph-numbered plain-text file.

Usage:
    python extract_descartes.py <input.html> <output.txt>

Every paragraph is prefixed with a citation key such as ``[IV.3]`` (Part IV,
paragraph 3) so that a worldview built from the text can cite its sources in
``meta`` and a reviewer can check them.  The Project Gutenberg license text
is kept at the end of the output, as the license requires.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser

ROMAN = {"PART I": "I", "PART II": "II", "PART III": "III", "PART IV": "IV", "PART V": "V", "PART VI": "VI"}


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[tuple[str, str]] = []  # (kind, text) kind in {h1,h2,p,div,pre}
        self._stack: list[tuple[str, list[str]]] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h2", "h3", "p", "div", "pre"):
            self._stack.append((tag, []))
        elif tag == "br" and self._stack:
            self._stack[-1][1].append(" ")

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "p", "div", "pre") and self._stack and self._stack[-1][0] == tag:
            kind, parts = self._stack.pop()
            text = re.sub(r"\s+", " ", "".join(parts)).strip()
            if text:
                self.blocks.append((kind, text))

    def handle_data(self, data):
        if self._stack:
            self._stack[-1][1].append(data)


def main(src: str, dst: str) -> None:
    html = open(src, encoding="utf-8").read()
    p = _Parser()
    p.feed(html)

    out: list[str] = []
    part: str | None = None
    para = 0
    in_license = False
    counts: dict[str, int] = {}

    for kind, text in p.blocks:
        if "*** START OF THE PROJECT GUTENBERG EBOOK" in text:
            out.append(text)
            out.append("")
            continue
        if "*** END OF THE PROJECT GUTENBERG EBOOK" in text:
            in_license = True
            out.append("")
            out.append(text)
            out.append("")
            continue
        if in_license:
            out.append(text)
            out.append("")
            continue
        if kind in ("h1", "h2", "h3"):
            key = text.upper().strip()
            if key in ROMAN:
                part = ROMAN[key]
                para = 0
            elif key.startswith("PREFATORY NOTE") or key == "NOTE":
                part = "NOTE"
                para = 0
            out.append("")
            out.append(f"# {text}")
            out.append("")
            continue
        if kind == "p" and part is not None:
            para += 1
            counts[part] = para
            out.append(f"[{part}.{para}] {text}")
            out.append("")
        elif kind == "p":
            out.append(text)
            out.append("")

    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out).rstrip() + "\n")
    print("paragraphs per part:", counts)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
