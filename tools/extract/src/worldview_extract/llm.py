"""LLM provider abstraction.

Every provider implements one method::

    complete(system: str, user: str, schema: dict) -> dict

and returns a JSON object that conforms to ``schema``, a JSON Schema
subset (``object`` / ``array`` / ``string`` / ``boolean`` / ``integer`` /
``number`` / ``null``, ``enum``, ``required``, ``additionalProperties:
false``).  Providers may also expose two attributes the pipeline reads
with ``getattr``: ``model`` (a string recorded in the output file) and
``usage`` (a :class:`Usage`).

* :class:`AnthropicLLM` calls the Claude API through the official SDK.
  Structured outputs (``output_config.format``) force the reply to be
  schema-valid JSON; failures are retried with exponential backoff; token
  usage is accumulated.
* :class:`FakeLLM` returns scripted responses, for tests.
* :class:`RecordingLLM` wraps another provider and appends every response
  to a JSONL file; :class:`ReplayLLM` reads such a file back, so a run can
  be reproduced without an API key.

The pipeline checks every reply against the schema itself, so a provider
that skips the check (a hand-written one) cannot crash it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Protocol, runtime_checkable

log = logging.getLogger("worldview_extract")

#: The model used when none is given.  See README: "Default model".
DEFAULT_MODEL = "claude-opus-5"

#: Longest wait a ``retry-after`` header can impose on the tool's own retry loop.
MAX_RETRY_AFTER = 300.0


class LLMError(Exception):
    """A completion could not be obtained (or was not usable)."""


@dataclass
class Usage:
    """Token accounting, summed over every call made through a provider."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0

    def add(
        self,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        calls: int = 1,
    ) -> None:
        self.calls += calls
        self.input_tokens += input_tokens or 0
        self.output_tokens += output_tokens or 0
        self.cache_creation_input_tokens += cache_creation_input_tokens or 0
        self.cache_read_input_tokens += cache_read_input_tokens or 0

    def snapshot(self) -> "Usage":
        return Usage(**asdict(self))

    def delta(self, earlier: "Usage") -> dict[str, int]:
        return {k: v - getattr(earlier, k) for k, v in asdict(self).items()}

    def to_dict(self) -> dict[str, int]:
        return asdict(self)


@runtime_checkable
class LLM(Protocol):
    """The provider protocol.  ``model`` and ``usage`` attributes are optional."""

    def complete(self, system: str, user: str, schema: dict) -> dict: ...


# ------------------------------------------------------------ schema check


def schema_problems(data: Any, schema: dict, path: str = "$") -> list[str]:
    """Check ``data`` against the JSON Schema subset used by the prompts.

    Returns a list of problems (empty when the data conforms).  Supports
    ``type`` (single or list), ``enum``, ``properties`` / ``required`` /
    ``additionalProperties: false`` for objects, and ``items`` for arrays.
    """
    if "enum" in schema and data not in schema["enum"]:
        return [f"{path}: {data!r} is not one of {schema['enum']!r}"]
    t = schema.get("type")
    if t is None:
        return []
    types = t if isinstance(t, list) else [t]
    if not any(_is_type(data, x) for x in types):
        return [f"{path}: expected {t}, got {type(data).__name__}"]
    problems: list[str] = []
    if isinstance(data, dict) and "object" in types:
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in data:
                problems.append(f"{path}: missing required field {req!r}")
        for k, v in data.items():
            if k in props:
                problems.extend(schema_problems(v, props[k], f"{path}.{k}"))
            elif schema.get("additionalProperties") is False:
                problems.append(f"{path}: unexpected field {k!r}")
    elif isinstance(data, list) and "array" in types and "items" in schema:
        for i, v in enumerate(data):
            problems.extend(schema_problems(v, schema["items"], f"{path}[{i}]"))
    return problems


def _is_type(v: Any, t: str) -> bool:
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "string":
        return isinstance(v, str)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "null":
        return v is None
    return False


def request_hash(system: str, user: str, schema: dict) -> str:
    """Stable identity of a request, used to match recordings to replays."""
    payload = json.dumps({"system": system, "user": user, "schema": schema}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


# -------------------------------------------------------------------- fake


class FakeLLM:
    """Scripted provider for tests.

    Either pass ``responses`` (a list of dicts returned in order) or a
    ``responder`` callable ``(system, user, schema) -> dict``.  Every call
    is recorded in ``calls`` and every response is checked against the
    schema, so a test with a malformed script fails loudly.
    """

    def __init__(
        self,
        responses: list[dict] | None = None,
        responder: Callable[[str, str, dict], dict] | None = None,
        model: str = "fake-model",
    ) -> None:
        self.responses = list(responses or [])
        self.responder = responder
        self.model = model
        self.usage = Usage()
        self.calls: list[dict[str, Any]] = []

    def complete(self, system: str, user: str, schema: dict) -> dict:
        self.calls.append({"system": system, "user": user, "schema": schema})
        if self.responder is not None:
            response = self.responder(system, user, schema)
        elif self.responses:
            response = self.responses.pop(0)
        else:
            raise LLMError(f"FakeLLM: no scripted response left for call {len(self.calls)}")
        problems = schema_problems(response, schema)
        if problems:
            raise LLMError("FakeLLM: scripted response does not match schema: " + "; ".join(problems[:5]))
        self.usage.add(
            input_tokens=_approx_tokens(system) + _approx_tokens(user),
            output_tokens=_approx_tokens(json.dumps(response)),
        )
        return response


# ------------------------------------------------------- record and replay


class RecordingLLM:
    """Wrap a provider and append every response to a JSONL file.

    Each line holds the call index, a hash of the request, the model, a
    short preview of the user prompt, the token usage of that call (when
    the inner provider reports it), and the response.  Prompts themselves
    are not stored; :class:`ReplayLLM` matches by order and warns (or, in
    strict mode, fails) when the hash differs.

    The file is opened in the constructor, so an unwritable path raises
    :class:`OSError` before any model call is made.
    """

    def __init__(self, inner: LLM, path: str | Path) -> None:
        self.inner = inner
        self.path = Path(path)
        self.model = getattr(inner, "model", "unknown")
        self.usage: Usage = getattr(inner, "usage", None) or Usage()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = self.path.open("w", encoding="utf-8")
        self._index = 0

    def complete(self, system: str, user: str, schema: dict) -> dict:
        before = self.usage.snapshot()
        response = self.inner.complete(system, user, schema)
        record = {
            "index": self._index,
            "request_hash": request_hash(system, user, schema),
            "model": self.model,
            "user_preview": user[:160],
            "usage": self.usage.delta(before),
            "response": response,
        }
        self._fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._fh.flush()
        self._index += 1
        return response

    def close(self) -> None:
        if not self._fh.closed:
            self._fh.close()

    def __enter__(self) -> "RecordingLLM":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class ReplayLLM:
    """Serve responses from a JSONL file written by :class:`RecordingLLM`.

    Responses are returned in recorded order.  If the request hash of a
    call differs from the recording, a warning is logged; with
    ``strict=True`` the call fails instead.  A record without a
    ``request_hash`` (a hand-written one) is never checked.  Running out
    of recorded responses is always an error.
    """

    def __init__(self, path: str | Path, *, strict: bool = False) -> None:
        self.path = Path(path)
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError as e:
            raise LLMError(f"cannot read replay file {self.path}: {e.strerror or e}") from e
        self.records: list[dict] = []
        for n, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                raise LLMError(f"{self.path}:{n}: not valid JSON: {e}") from e
            if not isinstance(record, dict):
                raise LLMError(f"{self.path}:{n}: each line must be a JSON object")
            self.records.append(record)
        self.strict = strict
        self.model = (self.records[0].get("model") if self.records else None) or "replay"
        self.usage = Usage()
        self.position = 0

    def complete(self, system: str, user: str, schema: dict) -> dict:
        if self.position >= len(self.records):
            raise LLMError(
                f"replay exhausted: the recording has {len(self.records)} responses but this run "
                "needs more (different input, chunk size, or --link setting than the recording?)"
            )
        record = self.records[self.position]
        self.position += 1
        expected = record.get("request_hash")
        if expected and expected != request_hash(system, user, schema):
            msg = f"replay call {self.position}: prompt differs from the recording (request hash mismatch)"
            if self.strict:
                raise LLMError(msg)
            log.warning("%s; using the recorded response anyway", msg)
        response = record.get("response")
        problems = schema_problems(response, schema)
        if problems:
            raise LLMError(
                f"replay call {self.position}: recorded response does not match schema: " + "; ".join(problems[:5])
            )
        usage = record.get("usage")
        if isinstance(usage, dict):
            self.usage.add(
                **{k: v for k, v in usage.items() if k in Usage.__dataclass_fields__ and isinstance(v, int)}
            )
        else:
            self.usage.add()
        return response


# --------------------------------------------------------------- anthropic


class _Unusable(Exception):
    """A response came back but cannot be used."""

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


def _retry_after_seconds(error: Exception) -> float | None:
    """The wait a 429 or 5xx response asked for, if it sent a usable header."""
    headers = getattr(getattr(error, "response", None), "headers", None)
    if not headers:
        return None
    for key, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        raw = headers.get(key)
        if raw:
            try:
                value = float(raw) * scale
            except ValueError:
                continue
            if 0 < value <= MAX_RETRY_AFTER:
                return value
    return None


class AnthropicLLM:
    """The Claude API through the official ``anthropic`` SDK.

    * JSON is forced with structured outputs: ``output_config.format`` of
      type ``json_schema``.  The reply's first text block is parsed and
      checked against the schema again client-side.
    * Requests are streamed (``messages.stream``) so long outputs do not
      hit HTTP timeouts; ``max_tokens`` defaults to 32000.
    * The stable system prompt carries a ``cache_control`` breakpoint so
      repeated chunks reuse the cached prefix when it is long enough.
    * Retries: rate limits, overload, 5xx, connection errors, and
      malformed replies are retried up to ``max_attempts`` times with
      exponential backoff plus jitter (on top of the SDK's own retries),
      waiting at least as long as a ``retry-after`` header asks.
      Authentication, permission, not-found, bad-request, and
      request-too-large errors, a refusal, and a reply truncated at
      ``max_tokens`` are not retried.  Every failure surfaces as an
      :class:`LLMError` that carries the request id when one is known.
    * ``usage`` accumulates input, output, and cache tokens per call.

    ``client`` may be any object with the ``messages.stream`` interface
    (tests pass a mock); ``sleep`` is injectable for the same reason.
    Credentials are resolved by the SDK (``ANTHROPIC_API_KEY``,
    ``ANTHROPIC_AUTH_TOKEN``, or an ``ant auth login`` profile) unless
    ``api_key`` is given.
    """

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        client: Any = None,
        api_key: str | None = None,
        max_tokens: int = 32000,
        max_attempts: int = 4,
        base_delay: float = 2.0,
        max_delay: float = 60.0,
        effort: str | None = None,
        timeout: float = 600.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
        self.client = client
        self.model = model
        self.max_tokens = max_tokens
        self.max_attempts = max(1, max_attempts)
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.effort = effort
        self.sleep = sleep
        self.usage = Usage()

    def build_request(self, system: str, user: str, schema: dict) -> dict[str, Any]:
        """The keyword arguments passed to ``client.messages.stream``."""
        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        if self.effort:
            output_config["effort"] = self.effort
        return {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": user}],
            "output_config": output_config,
        }

    def complete(self, system: str, user: str, schema: dict) -> dict:
        import anthropic

        request = self.build_request(system, user, schema)
        last: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            retry_after: float | None = None
            try:
                with self.client.messages.stream(**request) as stream:
                    message = stream.get_final_message()
                    request_id = getattr(stream, "request_id", None) or getattr(message, "_request_id", None)
                self._record_usage(message)
                return self._parse(message, schema, request_id)
            except (
                anthropic.AuthenticationError,
                anthropic.PermissionDeniedError,
                anthropic.NotFoundError,
                anthropic.BadRequestError,
            ) as e:
                raise LLMError(f"{type(e).__name__}: {e}") from e
            except anthropic.RateLimitError as e:
                last, retry_after = e, _retry_after_seconds(e)
            except anthropic.APIConnectionError as e:  # includes APITimeoutError
                last = e
            except anthropic.APIStatusError as e:
                if e.status_code < 500 and e.status_code not in (408, 409, 429):
                    hint = " (the request is too large: lower --chunk-tokens)" if e.status_code == 413 else ""
                    raise LLMError(f"{type(e).__name__}: {e}{hint}") from e
                last, retry_after = e, _retry_after_seconds(e)
            except anthropic.APIError as e:  # anything else the SDK raises, e.g. a malformed response
                raise LLMError(f"{type(e).__name__}: {e}") from e
            except _Unusable as e:
                if not e.retryable:
                    raise LLMError(str(e)) from e
                last = e
            if attempt < self.max_attempts:
                delay = min(self.base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1), self.max_delay)
                if retry_after:
                    delay = max(delay, retry_after)
                log.warning("attempt %d/%d failed (%s); retrying in %.1fs", attempt, self.max_attempts, last, delay)
                self.sleep(delay)
        raise LLMError(f"giving up after {self.max_attempts} attempts: {last}") from last

    def _record_usage(self, message: Any) -> None:
        u = getattr(message, "usage", None)
        if u is None:
            self.usage.add()
            return
        self.usage.add(
            input_tokens=getattr(u, "input_tokens", 0) or 0,
            output_tokens=getattr(u, "output_tokens", 0) or 0,
            cache_creation_input_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
            cache_read_input_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
        )

    def _parse(self, message: Any, schema: dict, request_id: str | None = None) -> dict:
        stop = getattr(message, "stop_reason", None)
        if stop == "refusal":
            details = getattr(message, "stop_details", None)
            category = getattr(details, "category", None)
            explanation = getattr(details, "explanation", None)
            raise _Unusable(
                f"the model refused the request (category={category!r}, explanation={explanation!r}, "
                f"request_id={request_id})",
                retryable=False,
            )
        if stop == "max_tokens":
            raise _Unusable(
                f"reply truncated at max_tokens={self.max_tokens} (request_id={request_id}); "
                "raise max_tokens, or lower --chunk-tokens if the chunk holds more than one paragraph",
                retryable=False,
            )
        text = next((b.text for b in getattr(message, "content", []) if getattr(b, "type", None) == "text"), None)
        if text is None:
            raise _Unusable(f"reply has no text block (stop_reason={stop!r}, request_id={request_id})", retryable=True)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise _Unusable(f"reply is not valid JSON ({e}; request_id={request_id})", retryable=True) from e
        problems = schema_problems(data, schema)
        if problems:
            raise _Unusable(
                f"reply does not match the schema (request_id={request_id}): " + "; ".join(problems[:5]),
                retryable=True,
            )
        return data
