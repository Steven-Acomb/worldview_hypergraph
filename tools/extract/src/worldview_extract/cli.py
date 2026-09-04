"""Command-line interface: ``worldview-extract INPUT.txt -o OUT.json``.

Exit codes: 0 success; 1 the extraction failed (API error, refusal, a
result that could not be made valid, or an output file that could not be
written after the run); 2 usage error (unreadable input, missing output
path or output directory, unreadable replay file, unwritable record file,
no credentials).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from ._version import __version__
from .assemble import ExtractError
from .llm import DEFAULT_MODEL, AnthropicLLM, LLMError, RecordingLLM, ReplayLLM
from .pipeline import ExtractOptions, dry_run_report, extract

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_USAGE = 2

_CREDENTIAL_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="worldview-extract",
        description="Turn a plain-text document into a worldview-core file using the Claude API.",
        epilog=(
            "Credentials come from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile; "
            "--dry-run and --replay need none. Review the output with `worldview validate`, "
            "`worldview foundations`, and `worldview lint well-founded` before trusting it."
        ),
    )
    p.add_argument("input", help="plain-text document (UTF-8); [KEY] paragraph tags are recognised")
    p.add_argument("-o", "--output", help="worldview-core JSON file to write (required unless --dry-run)")
    p.add_argument("--name", help="document name for the header and the prompts (default: input file stem)")
    p.add_argument("--description", help="free-text description for the header")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"Claude model id (default: {DEFAULT_MODEL})")
    p.add_argument("--chunk-tokens", type=int, default=3000, help="approximate token budget per chunk (default: 3000)")
    p.add_argument("--link", action="store_true", help="run the whole-document cross-chunk linking pass")
    p.add_argument("--dry-run", action="store_true", help="print the chunks and the prompts; call no API")
    p.add_argument("--record", metavar="RESPONSES.jsonl", help="write every model response to this JSONL file")
    p.add_argument("--replay", metavar="RESPONSES.jsonl", help="serve responses from this JSONL file instead of the API")
    p.add_argument("-v", "--verbose", action="store_true", help="progress and repair log on stderr")
    p.add_argument("--version", action="version", version=f"worldview-extract {__version__}")
    return p


class _StderrHandler(logging.StreamHandler):
    """Like StreamHandler(sys.stderr), but resolves sys.stderr at emit time."""

    def __init__(self) -> None:
        super().__init__()

    @property
    def stream(self):  # type: ignore[override]
        return sys.stderr

    @stream.setter
    def stream(self, value) -> None:
        pass


def _configure_logging(verbose: bool) -> None:
    handler = _StderrHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING, handlers=[handler], force=True)


def _err(msg: str) -> None:
    sys.stderr.write(msg + "\n")


def _credentials_available() -> tuple[bool, str]:
    """Whether the SDK will find a credential, and why not if it will not.

    An API key or auth token in the environment counts; otherwise the SDK's
    own discovery chain is consulted (``ANTHROPIC_PROFILE``, a profile
    written by ``ant auth login``, workload identity federation).
    """
    if any(os.environ.get(k) for k in _CREDENTIAL_ENV):
        return True, ""
    try:
        from anthropic.lib.credentials import default_credentials

        found = default_credentials() is not None
    except Exception as e:  # an explicitly selected profile that cannot be loaded
        return False, f"the Anthropic SDK could not load its credentials ({e})"
    return found, "" if found else "no Anthropic credentials found"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    try:  # Windows consoles may default to a legacy code page
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass

    if args.chunk_tokens <= 0:
        _err("error: --chunk-tokens must be positive")
        return EXIT_USAGE
    try:
        text = Path(args.input).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        _err(f"error: cannot read {args.input}: {e}")
        return EXIT_USAGE

    options = ExtractOptions(
        name=args.name or Path(args.input).stem,
        description=args.description,
        chunk_tokens=args.chunk_tokens,
        link=args.link,
        source=Path(args.input).name,
    )

    if args.dry_run:
        print(dry_run_report(text, options, verbose=args.verbose))
        return EXIT_OK

    if not args.output:
        _err("error: -o/--output is required unless --dry-run is given")
        return EXIT_USAGE
    out = Path(args.output)
    if not out.parent.is_dir():
        _err(f"error: cannot write {out}: directory {out.parent} does not exist")
        return EXIT_USAGE

    # Build the provider before any model call, so a configuration problem is a usage error.
    if args.replay:
        try:
            llm = ReplayLLM(args.replay)
        except LLMError as e:
            _err(f"error: {e}")
            return EXIT_USAGE
    else:
        ok, why = _credentials_available()
        if not ok:
            _err(
                f"error: {why}. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN, or log in with `ant auth login`), "
                "or use --dry-run (no model calls) or --replay RESPONSES.jsonl (recorded responses)."
            )
            return EXIT_USAGE
        try:
            llm = AnthropicLLM(args.model)
        except Exception as e:  # the SDK rejected the credential configuration
            _err(f"error: cannot create the Anthropic client: {e}")
            return EXIT_USAGE
    recorder: RecordingLLM | None = None
    if args.record:
        try:
            llm = recorder = RecordingLLM(llm, args.record)
        except OSError as e:
            _err(f"error: cannot write {args.record}: {e}")
            return EXIT_USAGE

    try:
        doc = extract(text, llm, options)
    except (ExtractError, LLMError) as e:
        _err(f"error: {e}")
        return EXIT_FAIL
    except KeyboardInterrupt:
        _err("interrupted")
        return 130
    finally:
        if recorder is not None:
            recorder.close()

    payload = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    try:
        out.write_text(payload, encoding="utf-8")
    except OSError as e:
        _err(f"error: cannot write {out}: {e}; the document follows on stdout so the run is not lost")
        sys.stdout.write(payload)
        sys.stdout.flush()
        return EXIT_FAIL
    ex = doc.get("meta", {}).get("extraction", {})
    usage = ex.get("usage", {})
    _err(
        f"wrote {out}: {len(doc['statements'])} statements, {len(doc['arguments'])} arguments"
        + (f", {len(ex['repairs'])} repair(s)" if ex.get("repairs") else "")
        + (
            f"; model {ex.get('model')}, {usage.get('calls', 0)} calls, "
            f"{usage.get('input_tokens', 0)} input / {usage.get('output_tokens', 0)} output tokens"
            if usage
            else ""
        )
    )
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
