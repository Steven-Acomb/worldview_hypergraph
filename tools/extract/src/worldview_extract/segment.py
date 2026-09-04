"""Split a document into paragraphs with stable citation keys, then chunks.

Two input styles are recognised:

* **Tagged**: every paragraph starts with a citation key in square
  brackets, ``[IV.3] Text of the paragraph...``, as produced for
  ``examples/sources/descartes-discourse-on-method.txt``.  Keys are taken
  from the tags.  Lines starting with ``# `` are headings and are kept as
  context.  Blocks with neither a tag nor a heading (front matter, a
  licence) are skipped.
* **Untagged**: paragraphs are separated by blank lines and receive keys
  ``p1``, ``p2``, ... in order.  ``# `` headings are context and are not
  numbered.

Paragraph boundaries are blank lines.  A line that starts with a heading
marker or a citation tag always begins a new paragraph even without a
blank line before it, and a document with no blank line anywhere is read
one paragraph per line.

Chunking packs consecutive paragraphs up to an approximate token budget.
A paragraph is never split; one larger than the budget becomes a chunk of
its own.  Once a chunk is at least half full, a change of heading starts
a new chunk so sections stay together.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

TAG_RE = re.compile(r"^\[([A-Za-z0-9][A-Za-z0-9._:-]*)\]\s*(.*)$", re.S)
HEADING_PREFIX = "# "
_BLANK_LINE = re.compile(r"\n[ \t]*\n")
#: A line that begins a new block even without a blank line before it: a
#: heading, or a citation tag followed by whitespace (or nothing).
_STARTS_BLOCK = re.compile(r"^(?:# |\[[A-Za-z0-9][A-Za-z0-9._:-]*\](?:\s|$))")
_UNSET = object()


@dataclass(frozen=True)
class Paragraph:
    key: str
    text: str
    heading: str | None  # the most recent "# " heading, if any
    index: int  # 0-based position among content paragraphs


@dataclass
class Chunk:
    index: int  # 0-based
    paragraphs: list[Paragraph] = field(default_factory=list)

    @property
    def keys(self) -> list[str]:
        return [p.key for p in self.paragraphs]

    @property
    def heading(self) -> str | None:
        return self.paragraphs[0].heading if self.paragraphs else None

    @property
    def headings(self) -> list[str]:
        """Every distinct heading the chunk's paragraphs fall under, in order."""
        out: list[str] = []
        for p in self.paragraphs:
            if p.heading and p.heading not in out:
                out.append(p.heading)
        return out

    @property
    def tokens(self) -> int:
        return sum(estimate_tokens(p.text) for p in self.paragraphs)

    def render(self) -> str:
        """The chunk as shown to the model: headings when they change, then tagged paragraphs."""
        out: list[str] = []
        current: object = _UNSET  # so the first paragraph's heading is always printed
        for p in self.paragraphs:
            if p.heading != current:
                current = p.heading
                if p.heading:
                    out.append(f"# {p.heading}")
                    out.append("")
            out.append(f"[{p.key}] {p.text}")
            out.append("")
        return "\n".join(out).rstrip()


@dataclass
class Segmentation:
    mode: str  # "tagged" | "untagged"
    paragraphs: list[Paragraph]
    skipped: int = 0  # untagged, non-heading blocks dropped in tagged mode

    @property
    def keys(self) -> set[str]:
        return {p.key for p in self.paragraphs}


def estimate_tokens(text: str) -> int:
    """Rough token count: about 3.5 characters per token for English prose
    on current Claude tokenizers.  Only used for chunk budgeting."""
    return max(1, math.ceil(len(text) / 3.5))


def split_blocks(text: str) -> list[str]:
    """Paragraph blocks, each with its internal line breaks joined by a space.

    Blocks are separated by blank lines.  Inside a block, a line that
    starts with ``# `` or with a citation tag begins a new block, so
    tagged or headed input without blank lines still splits correctly.
    If the whole text contains no blank line at all, every non-empty line
    is its own block (one paragraph per line).
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if _BLANK_LINE.search(text) is None:
        groups = [[line] for line in text.split("\n")]
    else:
        groups = [raw.split("\n") for raw in _BLANK_LINE.split(text)]
    blocks: list[str] = []
    for lines in groups:
        current: list[str] = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if current and _STARTS_BLOCK.match(line):
                blocks.append(" ".join(current))
                current = []
            current.append(line)
        if current:
            blocks.append(" ".join(current))
    return blocks


def segment(text: str) -> Segmentation:
    """Split ``text`` into paragraphs with citation keys.  See the module docstring."""
    blocks = split_blocks(text)
    content = [b for b in blocks if not b.startswith(HEADING_PREFIX)]
    tagged = sum(1 for b in content if TAG_RE.match(b))
    mode = "tagged" if tagged >= 2 and tagged * 2 >= len(content) else "untagged"

    paragraphs: list[Paragraph] = []
    heading: str | None = None
    skipped = 0
    seen: set[str] = set()
    for b in blocks:
        if b.startswith(HEADING_PREFIX):
            heading = b[len(HEADING_PREFIX):].strip() or None
            continue
        if mode == "tagged":
            m = TAG_RE.match(b)
            if not m or not m.group(2).strip():
                skipped += 1
                continue
            key, body = m.group(1), m.group(2).strip()
            if key in seen:  # duplicate tag: keep both, disambiguate the later one
                n = 2
                while f"{key}.{n}" in seen:
                    n += 1
                key = f"{key}.{n}"
        else:
            key, body = f"p{len(paragraphs) + 1}", b
        seen.add(key)
        paragraphs.append(Paragraph(key=key, text=body, heading=heading, index=len(paragraphs)))
    return Segmentation(mode=mode, paragraphs=paragraphs, skipped=skipped)


def make_chunks(paragraphs: list[Paragraph], chunk_tokens: int) -> list[Chunk]:
    """Pack paragraphs into chunks of roughly ``chunk_tokens`` tokens."""
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    chunks: list[Chunk] = []
    current: list[Paragraph] = []
    current_tokens = 0

    def flush() -> None:
        nonlocal current, current_tokens
        if current:
            chunks.append(Chunk(index=len(chunks), paragraphs=current))
        current, current_tokens = [], 0

    for p in paragraphs:
        t = estimate_tokens(p.text)
        if current and current_tokens + t > chunk_tokens:
            flush()
        elif current and p.heading != current[-1].heading and current_tokens * 2 >= chunk_tokens:
            flush()
        current.append(p)
        current_tokens += t
    flush()
    return chunks


def oversize_paragraphs(chunks: list[Chunk], chunk_tokens: int) -> list[Paragraph]:
    """Paragraphs larger than the budget, each of which forms a chunk of its own."""
    return [c.paragraphs[0] for c in chunks if len(c.paragraphs) == 1 and c.tokens > chunk_tokens]
