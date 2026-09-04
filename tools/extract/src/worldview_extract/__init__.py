"""worldview-extract: LLM-assisted extraction of worldview-core files.

Turn a plain-text document into a worldview-core file: statements (the
propositions an author asserts or relies on) connected by arguments
(premises that jointly entail conclusions).  The Claude API does the
reading; this package does the segmentation, consolidation, assembly,
validation, and bookkeeping.

Typical use::

    from worldview_extract import AnthropicLLM, ExtractOptions, extract

    doc = extract(text, AnthropicLLM(), ExtractOptions(name="Discourse on Method", link=True))
"""

from ._version import __version__
from .assemble import ExtractError
from .llm import DEFAULT_MODEL, LLM, AnthropicLLM, FakeLLM, LLMError, RecordingLLM, ReplayLLM, Usage
from .pipeline import ExtractOptions, dry_run_report, extract

__all__ = [
    "DEFAULT_MODEL",
    "AnthropicLLM",
    "ExtractError",
    "ExtractOptions",
    "FakeLLM",
    "LLM",
    "LLMError",
    "RecordingLLM",
    "ReplayLLM",
    "Usage",
    "__version__",
    "dry_run_report",
    "extract",
]
