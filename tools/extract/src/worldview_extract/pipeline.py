"""The extraction pipeline.

1. **Segment** the text into paragraphs with stable citation keys and
   pack them into chunks (:mod:`segment`).
2. **Pass A**, per chunk: candidate statements.
3. **Consolidate**: exact de-duplication (``worldview_core.canon`` + mode),
   id assignment, then an LLM pass that merges near-duplicates and yields
   a mapping ``dropped id -> kept id``.
4. **Pass B**, per chunk: arguments over the consolidated statements
   (windowed to the chunk's neighbourhood when the list is large).
5. **Pass C** (optional, ``link=True``): one whole-document pass proposing
   cross-chunk arguments.
6. **Assemble**, repair dangling references, validate with
   ``worldview_core.validate_dict``, and record ``meta.extraction``.

Every reply from the provider is checked against the pass's schema here,
whatever the provider is, so a malformed reply is an :class:`LLMError`
and never a crash.  The only entry points are :func:`extract` and
:func:`dry_run_report`.
"""

from __future__ import annotations

import datetime as _dt
import logging
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from ._version import __version__
from .assemble import (
    ArgumentRec,
    ExtractError,
    StatementRec,
    build_document,
    exact_key,
    repair,
    slug_from_text,
    slugify,
    unique_id,
)
from .llm import LLM, LLMError, schema_problems
from .prompts import (
    ARGUMENTS_SCHEMA,
    MERGE_SCHEMA,
    STATEMENTS_SCHEMA,
    SYSTEM_ARGUMENTS,
    SYSTEM_LINK,
    SYSTEM_MERGE,
    SYSTEM_STATEMENTS,
    arguments_prompt,
    link_prompt,
    merge_prompt,
    statements_prompt,
)
from .segment import Chunk, Segmentation, estimate_tokens, make_chunks, oversize_paragraphs, segment

log = logging.getLogger("worldview_extract")

Progress = Callable[[str], None]


@dataclass
class ExtractOptions:
    name: str | None = None  # document name: goes in the header and in every prompt
    description: str | None = None
    chunk_tokens: int = 3000  # approximate token budget per chunk
    link: bool = False  # run pass C
    source: str | None = None  # source file name, recorded in meta.extraction
    model: str | None = None  # recorded in meta.extraction; defaults to llm.model
    window_threshold: int = 150  # pass B sees every statement up to this many
    merge_batch: int = 600  # consolidation pass batch size
    progress: Progress | None = None  # called with one line per step; default: logging


@dataclass
class Candidate:
    """One statement as returned by pass A, before consolidation."""

    text: str
    mode: str
    sources: list[str]
    role: str
    note: str
    slug: str
    chunk: int


# ------------------------------------------------------------------ helpers


def _dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _known_keys(keys: Iterable[str], known: set[str]) -> list[str]:
    cleaned = _dedupe(k.strip().strip("[]") for k in keys)
    unknown = [k for k in cleaned if k not in known]
    if unknown:
        log.debug("dropping unknown citation key(s): %s", ", ".join(unknown))
    return [k for k in cleaned if k in known]


def _squash(text: str) -> str:
    return " ".join(text.split())


def _resolve(mapping: dict[str, str], id_: str) -> str:
    seen: set[str] = set()
    while id_ in mapping and id_ not in seen:
        seen.add(id_)
        id_ = mapping[id_]
    return id_


def _lines(statements: Iterable[StatementRec]) -> list[tuple[str, str, str]]:
    return [(s.id, s.mode, s.text) for s in statements]


def _call(llm: LLM, system: str, user: str, schema: dict, what: str) -> dict:
    """``llm.complete`` plus a schema check, so the pipeline never indexes a malformed reply."""
    response = llm.complete(system, user, schema)
    problems = schema_problems(response, schema)
    if problems:
        raise LLMError(f"{what}: the reply does not match the expected schema: " + "; ".join(problems[:5]))
    return response


# ------------------------------------------------------------------ pass A


def extract_statements(
    chunks: list[Chunk], llm: LLM, options: ExtractOptions, known: set[str], say: Progress
) -> list[Candidate]:
    out: list[Candidate] = []
    for chunk in chunks:
        say(
            f"pass A: chunk {chunk.index + 1}/{len(chunks)} "
            f"({len(chunk.paragraphs)} paragraphs, ~{chunk.tokens} tokens, keys {chunk.keys[0]}..{chunk.keys[-1]})"
        )
        response = _call(
            llm,
            SYSTEM_STATEMENTS,
            statements_prompt(chunk, options.name),
            STATEMENTS_SCHEMA,
            f"pass A, chunk {chunk.index + 1}",
        )
        n = 0
        for item in response["statements"]:
            text = _squash(item["text"])
            if not text:
                continue
            out.append(
                Candidate(
                    text=text,
                    mode=item["mode"],
                    sources=_known_keys(item["sources"], known),
                    role=item["role"],
                    note=_squash(item["note"]),
                    slug=item["slug"],
                    chunk=chunk.index,
                )
            )
            n += 1
        say(f"  {n} candidate statements")
    return out


# ----------------------------------------------------------- consolidation


def consolidate(
    candidates: list[Candidate], llm: LLM, options: ExtractOptions, say: Progress
) -> tuple[list[StatementRec], dict[str, str]]:
    """Exact de-duplication, id assignment, then the LLM merge pass.

    Returns the surviving statements (with final ids) and the mapping
    ``dropped id -> kept id`` produced by the merge pass.
    """
    by_key: dict[tuple[str, str], StatementRec] = {}
    order: list[StatementRec] = []
    preferred: list[str] = []
    for c in candidates:
        rec = StatementRec(
            id="", text=c.text, mode=c.mode, sources=list(c.sources), role=c.role, note=c.note, chunks={c.chunk}
        )
        key = exact_key(c.text, c.mode)
        if key in by_key:
            by_key[key].absorb(rec)
        else:
            by_key[key] = rec
            order.append(rec)
            preferred.append(c.slug)
    say(f"consolidation: {len(candidates)} candidates, {len(order)} distinct after exact de-duplication")

    taken: set[str] = set()
    for rec, slug in zip(order, preferred):
        base = slugify(slug, "") or slug_from_text(rec.text)
        rec.id = unique_id(base, taken)

    mapping: dict[str, str] = {}
    if len(order) >= 2:
        for start in range(0, len(order), max(1, options.merge_batch)):
            batch = order[start : start + max(1, options.merge_batch)]
            by_id = {r.id: r for r in batch}
            say(f"consolidation: merge pass over {len(batch)} statements")
            response = _call(
                llm, SYSTEM_MERGE, merge_prompt(_lines(batch), options.name), MERGE_SCHEMA, "consolidation"
            )
            for m in response["merges"]:
                keep = m["keep"].strip()
                if keep not in by_id:
                    log.warning("merge: unknown id to keep %r; ignored", keep)
                    continue
                for drop in m["drop"]:
                    drop = drop.strip()
                    if drop not in by_id or drop == keep or drop in mapping:
                        continue
                    if by_id[drop].mode != by_id[keep].mode:
                        log.warning("merge: %s and %s differ in mode; not merged", drop, keep)
                        continue
                    if _resolve(mapping, keep) == drop:
                        log.warning("merge: %s <-> %s would be circular; not merged", drop, keep)
                        continue
                    mapping[drop] = keep
                    log.debug("merge: %s -> %s (%s)", drop, keep, m["reason"])

    final = {d: _resolve(mapping, d) for d in mapping}
    all_by_id = {r.id: r for r in order}
    for rec in order:  # absorb in document order so merged sources stay ordered
        if rec.id in final:
            all_by_id[final[rec.id]].absorb(rec)
    statements = [r for r in order if r.id not in final]
    say(f"consolidation: {len(final)} merged by the model, {len(statements)} statements remain")
    return statements, final


# ------------------------------------------------------------------ pass B


def visible_statements(
    statements: list[StatementRec], chunk: Chunk, threshold: int
) -> list[StatementRec]:
    """The statements pass B shows for ``chunk``: all of them below the
    threshold, otherwise those that came from the chunk or its neighbours."""
    if len(statements) <= threshold:
        return list(statements)
    hood = {chunk.index - 1, chunk.index, chunk.index + 1}
    window = [s for s in statements if s.chunks & hood]
    return window or list(statements)


def _to_arguments(items: list[dict[str, Any]], known: set[str], taken: set[str], origin: str) -> list[ArgumentRec]:
    out: list[ArgumentRec] = []
    for item in items:
        premises = _dedupe(p.strip() for p in item["premises"])
        conclusions = _dedupe(c.strip() for c in item["conclusions"])
        if not conclusions:
            log.warning("skipping an argument with no conclusions (%s)", origin)
            continue
        base = slugify(item["slug"], "") or slugify("-".join(premises[:2]) + "-to-" + conclusions[0], "arg")
        out.append(
            ArgumentRec(
                id=unique_id(base, taken),
                premises=premises,
                conclusions=conclusions,
                justification=_squash(item["justification"]),
                rule=_squash(item["rule"]),
                sources=_known_keys(item["sources"], known),
                origin=origin,
            )
        )
    return out


def extract_arguments(
    chunks: list[Chunk],
    statements: list[StatementRec],
    llm: LLM,
    options: ExtractOptions,
    known: set[str],
    taken: set[str],
    say: Progress,
) -> list[ArgumentRec]:
    out: list[ArgumentRec] = []
    for chunk in chunks:
        visible = visible_statements(statements, chunk, options.window_threshold)
        say(f"pass B: chunk {chunk.index + 1}/{len(chunks)} ({len(visible)} statements visible)")
        response = _call(
            llm,
            SYSTEM_ARGUMENTS,
            arguments_prompt(chunk, _lines(visible), options.name),
            ARGUMENTS_SCHEMA,
            f"pass B, chunk {chunk.index + 1}",
        )
        found = _to_arguments(response["arguments"], known, taken, origin=f"chunk:{chunk.index}")
        say(f"  {len(found)} arguments")
        out.extend(found)
    return out


# ------------------------------------------------------------------ pass C


def link_arguments(
    statements: list[StatementRec],
    arguments: list[ArgumentRec],
    llm: LLM,
    options: ExtractOptions,
    known: set[str],
    taken: set[str],
    say: Progress,
) -> list[ArgumentRec]:
    say(f"pass C: cross-section linking over {len(statements)} statements, {len(arguments)} arguments")
    response = _call(
        llm,
        SYSTEM_LINK,
        link_prompt(_lines(statements), [(a.id, a.premises, a.conclusions) for a in arguments], options.name),
        ARGUMENTS_SCHEMA,
        "pass C",
    )
    found = _to_arguments(response["arguments"], known, taken, origin="link")
    say(f"  {len(found)} cross-section arguments proposed")
    return found


# ---------------------------------------------------------------- assembly


def _extraction_meta(options: ExtractOptions, llm: LLM, seg: Segmentation, chunks: list[Chunk]) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "tool": "worldview-extract",
        "version": __version__,
        "model": options.model or getattr(llm, "model", None) or "unknown",
        "date": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if options.source:
        meta["source"] = options.source
    meta["chunking"] = {
        "segmentation": seg.mode,
        "paragraphs": len(seg.paragraphs),
        "skipped_blocks": seg.skipped,
        "chunk_tokens": options.chunk_tokens,
        "chunks": len(chunks),
        "window_threshold": options.window_threshold,
    }
    meta["link_pass"] = bool(options.link)
    return meta


def extract(text: str, llm: LLM, options: ExtractOptions | None = None) -> dict[str, Any]:
    """Run the whole pipeline and return a valid worldview-core document (a dict).

    Raises :class:`ExtractError` if the input has no paragraphs or the
    result cannot be made valid, and lets :class:`LLMError` from the
    provider (or from a reply that does not match the schema) propagate.
    """
    options = options or ExtractOptions()
    say: Progress = options.progress or (lambda msg: log.info("%s", msg))

    seg = segment(text)
    chunks = make_chunks(seg.paragraphs, options.chunk_tokens)
    if not chunks:
        raise ExtractError("no paragraphs found in the input")
    say(
        f"segmentation: {seg.mode}, {len(seg.paragraphs)} paragraphs"
        + (f" ({seg.skipped} untagged blocks skipped)" if seg.skipped else "")
        + f", {len(chunks)} chunks of ~{options.chunk_tokens} tokens"
    )
    for p in oversize_paragraphs(chunks, options.chunk_tokens):
        say(f"  note: paragraph {p.key} (~{estimate_tokens(p.text)} tokens) exceeds the budget; it is a chunk on its own")
    known = seg.keys

    candidates = extract_statements(chunks, llm, options, known, say)
    statements, merged = consolidate(candidates, llm, options, say)
    if not statements:
        raise ExtractError("the model extracted no statements")

    taken: set[str] = set()
    arguments = extract_arguments(chunks, statements, llm, options, known, taken, say)
    if options.link:
        arguments.extend(link_arguments(statements, arguments, llm, options, known, taken, say))

    extraction = _extraction_meta(options, llm, seg, chunks)
    doc = build_document(
        statements, arguments, name=options.name, description=options.description, extraction=extraction
    )
    doc, repairs = repair(doc, merged)
    for line in repairs:
        log.info("repair: %s", line)
    extraction["repairs"] = repairs
    if merged:
        extraction["merged"] = dict(merged)
    usage = getattr(llm, "usage", None)
    if usage is not None:
        extraction["usage"] = usage.to_dict()
    say(
        f"done: {len(doc['statements'])} statements, {len(doc['arguments'])} arguments"
        + (f", {len(repairs)} repairs" if repairs else "")
    )
    return doc


# ----------------------------------------------------------------- dry run


def dry_run_report(text: str, options: ExtractOptions | None = None, *, verbose: bool = False) -> str:
    """Describe the chunks and show the prompts, without calling any model.

    Every chunk is listed; the system prompts of every pass are printed
    once; the pass A user prompt is printed for the first chunk only unless
    ``verbose`` is set.  Pass B and C prompts depend on pass A's results,
    so only their system prompts are shown.
    """
    options = options or ExtractOptions()
    seg = segment(text)
    chunks = make_chunks(seg.paragraphs, options.chunk_tokens)
    out: list[str] = []
    out.append(
        f"segmentation: {seg.mode}, {len(seg.paragraphs)} paragraphs"
        + (f", {seg.skipped} untagged blocks skipped" if seg.skipped else "")
    )
    out.append(f"chunks: {len(chunks)} (budget ~{options.chunk_tokens} tokens each)")
    for c in chunks:
        headings = c.headings
        if len(headings) > 1:
            heading = ", headings " + " > ".join(f'"{h}"' for h in headings)
        else:
            heading = f', heading "{headings[0]}"' if headings else ""
        oversize = ""
        if len(c.paragraphs) == 1 and c.tokens > options.chunk_tokens:
            oversize = " (one paragraph, larger than the budget)"
        out.append(
            f"  chunk {c.index + 1}: {len(c.paragraphs)} paragraphs, ~{c.tokens} tokens, "
            f"keys {c.keys[0]}..{c.keys[-1]}{heading}{oversize}"
        )
    sys_a = estimate_tokens(SYSTEM_STATEMENTS)
    sys_b = estimate_tokens(SYSTEM_ARGUMENTS)
    prompt_tokens = sum(c.tokens + sys_a for c in chunks) + sum(c.tokens + sys_b for c in chunks)
    out.append(
        f"approximate prompt tokens for passes A and B (before statement lists and outputs): {prompt_tokens}"
    )
    out.append(f"link pass: {'yes' if options.link else 'no'}")
    out.append("no API calls made")
    out.append("")
    out.append("=== system prompt: pass A (statements) ===")
    out.append(SYSTEM_STATEMENTS)
    out.append("=== system prompt: consolidation ===")
    out.append(SYSTEM_MERGE)
    out.append("=== system prompt: pass B (arguments) ===")
    out.append(SYSTEM_ARGUMENTS)
    if options.link:
        out.append("=== system prompt: pass C (linking) ===")
        out.append(SYSTEM_LINK)
    shown = chunks if verbose else chunks[:1]
    for c in shown:
        out.append(f"=== user prompt: pass A, chunk {c.index + 1}/{len(chunks)} ===")
        out.append(statements_prompt(c, options.name))
        out.append("")
    if not verbose and len(chunks) > 1:
        out.append(f"({len(chunks) - 1} more chunk prompt(s) not shown; use --verbose to print all)")
    return "\n".join(out)
