"""Providers: schema check, FakeLLM, record/replay, and AnthropicLLM with a mocked SDK client."""

from __future__ import annotations

import json
import types
from unittest.mock import MagicMock

import anthropic
import httpx2
import pytest

from worldview_extract.llm import (
    AnthropicLLM,
    FakeLLM,
    LLMError,
    RecordingLLM,
    ReplayLLM,
    Usage,
    request_hash,
    schema_problems,
)

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "mode"],
                "properties": {"name": {"type": "string"}, "mode": {"type": "string", "enum": ["is", "ought"]}},
            },
        }
    },
}
GOOD = {"items": [{"name": "a", "mode": "is"}]}


# ------------------------------------------------------------- schema check


def test_schema_problems_accepts_conforming_data():
    assert schema_problems(GOOD, SCHEMA) == []
    assert schema_problems({"items": []}, SCHEMA) == []


@pytest.mark.parametrize(
    "data, fragment",
    [
        ({}, "missing required field 'items'"),
        ({"items": [{"name": "a", "mode": "maybe"}]}, "is not one of"),
        ({"items": [{"name": 1, "mode": "is"}]}, "expected string"),
        ({"items": [{"name": "a", "mode": "is", "extra": 1}]}, "unexpected field 'extra'"),
        ({"items": {}}, "expected array"),
        ([], "expected object"),
        (None, "expected object"),
    ],
)
def test_schema_problems_reports_violations(data, fragment):
    problems = schema_problems(data, SCHEMA)
    assert problems and fragment in problems[0]


def test_schema_problems_integer_vs_boolean():
    assert schema_problems(True, {"type": "integer"})
    assert not schema_problems(3, {"type": "integer"})
    assert not schema_problems(None, {"type": ["string", "null"]})


# -------------------------------------------------------------------- fake


def test_fake_llm_scripted_responses_in_order():
    llm = FakeLLM(responses=[GOOD, {"items": []}])
    assert llm.complete("s", "u", SCHEMA) == GOOD
    assert llm.complete("s", "u2", SCHEMA) == {"items": []}
    assert [c["user"] for c in llm.calls] == ["u", "u2"]
    assert llm.usage.calls == 2 and llm.usage.input_tokens > 0
    with pytest.raises(LLMError, match="no scripted response left"):
        llm.complete("s", "u3", SCHEMA)


def test_fake_llm_rejects_a_response_that_violates_the_schema():
    llm = FakeLLM(responses=[{"items": [{"name": "a"}]}])
    with pytest.raises(LLMError, match="does not match schema"):
        llm.complete("s", "u", SCHEMA)


def test_fake_llm_responder_receives_the_prompts():
    seen = []

    def responder(system, user, schema):
        seen.append((system, user, schema is SCHEMA))
        return GOOD

    FakeLLM(responder=responder).complete("sys", "usr", SCHEMA)
    assert seen == [("sys", "usr", True)]


# ---------------------------------------------------------- record / replay


def test_request_hash_is_stable_and_sensitive():
    assert request_hash("s", "u", SCHEMA) == request_hash("s", "u", json.loads(json.dumps(SCHEMA)))
    assert request_hash("s", "u", SCHEMA) != request_hash("s", "u!", SCHEMA)


def test_record_then_replay_round_trip(tmp_path):
    path = tmp_path / "log.jsonl"
    inner = FakeLLM(responses=[GOOD, {"items": []}], model="fake-x")
    with RecordingLLM(inner, path) as rec:
        assert rec.complete("s", "u1", SCHEMA) == GOOD
        assert rec.complete("s", "u2", SCHEMA) == {"items": []}
    lines = [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines()]
    assert [ln["index"] for ln in lines] == [0, 1]
    assert lines[0]["model"] == "fake-x" and lines[0]["user_preview"] == "u1"
    assert lines[0]["usage"]["calls"] == 1 and lines[0]["usage"]["input_tokens"] > 0
    assert lines[0]["request_hash"] == request_hash("s", "u1", SCHEMA)

    replay = ReplayLLM(path)
    assert replay.model == "fake-x"
    assert replay.complete("s", "u1", SCHEMA) == GOOD
    assert replay.complete("s", "u2", SCHEMA) == {"items": []}
    assert replay.usage.calls == 2 and replay.usage.input_tokens == inner.usage.input_tokens
    with pytest.raises(LLMError, match="replay exhausted"):
        replay.complete("s", "u3", SCHEMA)


def test_replay_hash_mismatch_warns_or_fails(tmp_path, caplog):
    path = tmp_path / "log.jsonl"
    with RecordingLLM(FakeLLM(responses=[GOOD]), path) as rec:
        rec.complete("s", "u", SCHEMA)
    with caplog.at_level("WARNING", logger="worldview_extract"):
        assert ReplayLLM(path).complete("s", "different", SCHEMA) == GOOD
    assert "hash mismatch" in caplog.text
    with pytest.raises(LLMError, match="hash mismatch"):
        ReplayLLM(path, strict=True).complete("s", "different", SCHEMA)


def test_replay_of_hand_written_records_without_hash_or_usage(tmp_path, caplog):
    path = tmp_path / "log.jsonl"
    path.write_text(json.dumps({"response": GOOD}) + "\n\n" + json.dumps({"response": {"items": []}, "usage": "?"}) + "\n", encoding="utf-8")
    replay = ReplayLLM(path, strict=True)
    assert replay.model == "replay"
    with caplog.at_level("WARNING", logger="worldview_extract"):
        assert replay.complete("s", "anything", SCHEMA) == GOOD
        assert replay.complete("s", "else", SCHEMA) == {"items": []}
    assert "hash mismatch" not in caplog.text
    assert replay.usage.calls == 2 and replay.usage.input_tokens == 0


def test_replay_rejects_recorded_response_that_violates_schema(tmp_path):
    path = tmp_path / "log.jsonl"
    path.write_text(json.dumps({"index": 0, "response": {"nope": 1}}) + "\n", encoding="utf-8")
    with pytest.raises(LLMError, match="does not match schema"):
        ReplayLLM(path).complete("s", "u", SCHEMA)


def test_replay_rejects_a_file_that_is_not_jsonl_objects(tmp_path):
    path = tmp_path / "log.jsonl"
    path.write_text("[1, 2]\n", encoding="utf-8")
    with pytest.raises(LLMError, match="must be a JSON object"):
        ReplayLLM(path)
    path.write_text("{not json\n", encoding="utf-8")
    with pytest.raises(LLMError, match="not valid JSON"):
        ReplayLLM(path)


def test_replay_missing_file_is_an_llm_error(tmp_path):
    with pytest.raises(LLMError, match="cannot read replay file"):
        ReplayLLM(tmp_path / "missing.jsonl")


def test_recording_to_an_unwritable_path_fails_before_any_call(tmp_path):
    with pytest.raises(OSError):
        RecordingLLM(FakeLLM(responses=[GOOD]), tmp_path)  # a directory


# --------------------------------------------------------------- anthropic


def _message(payload=GOOD, stop="end_turn", text=None):
    blocks = [
        types.SimpleNamespace(type="thinking", thinking=""),
        types.SimpleNamespace(type="text", text=json.dumps(payload) if text is None else text),
    ]
    return types.SimpleNamespace(
        stop_reason=stop,
        stop_details=types.SimpleNamespace(category="cat", explanation="why") if stop == "refusal" else None,
        content=blocks,
        usage=types.SimpleNamespace(
            input_tokens=100, output_tokens=20, cache_creation_input_tokens=5, cache_read_input_tokens=7
        ),
    )


def _client(*outcomes):
    """A mock SDK client whose messages.stream(...) yields the outcomes in order.

    The streamed final message carries no request id in the SDK; the
    stream object does (``MessageStream.request_id``), so the mock sets it
    there.
    """
    client = MagicMock()
    managers = []
    for i, o in enumerate(outcomes):
        cm = MagicMock()
        inner = cm.__enter__.return_value
        inner.request_id = f"req_stream_{i}"
        if isinstance(o, Exception):
            inner.get_final_message.side_effect = o
        else:
            inner.get_final_message.return_value = o
        managers.append(cm)
    client.messages.stream.side_effect = managers
    return client


def _request():
    return httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _status_error(cls, status, headers=None):
    return cls("boom", response=httpx2.Response(status, request=_request(), headers=headers), body=None)


def _llm(client, **kw):
    kw.setdefault("sleep", lambda s: None)
    return AnthropicLLM("claude-opus-5", client=client, **kw)


def test_request_construction():
    client = _client(_message())
    llm = _llm(client)
    result = llm.complete("SYSTEM", "USER", SCHEMA)
    assert result == GOOD
    kwargs = client.messages.stream.call_args.kwargs
    assert kwargs["model"] == "claude-opus-5"
    assert kwargs["max_tokens"] == 32000
    assert kwargs["system"] == [{"type": "text", "text": "SYSTEM", "cache_control": {"type": "ephemeral"}}]
    assert kwargs["messages"] == [{"role": "user", "content": "USER"}]
    assert kwargs["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}}
    assert "thinking" not in kwargs and "temperature" not in kwargs
    assert llm.usage.to_dict() == {
        "calls": 1,
        "input_tokens": 100,
        "output_tokens": 20,
        "cache_creation_input_tokens": 5,
        "cache_read_input_tokens": 7,
    }


def test_effort_and_max_tokens_are_passed_through():
    client = _client(_message())
    _llm(client, effort="medium", max_tokens=8000).complete("s", "u", SCHEMA)
    kwargs = client.messages.stream.call_args.kwargs
    assert kwargs["output_config"]["effort"] == "medium"
    assert kwargs["max_tokens"] == 8000


def test_retry_after_rate_limit_and_connection_error():
    sleeps = []
    client = _client(
        _status_error(anthropic.RateLimitError, 429),
        anthropic.APIConnectionError(request=_request()),
        _message(),
    )
    llm = _llm(client, sleep=sleeps.append, base_delay=0.5, max_delay=1.0)
    assert llm.complete("s", "u", SCHEMA) == GOOD
    assert client.messages.stream.call_count == 3
    assert len(sleeps) == 2 and all(0 < s <= 1.0 for s in sleeps)
    assert llm.usage.calls == 1  # only the successful call reported usage


def test_retry_after_header_is_honoured():
    sleeps = []
    client = _client(
        _status_error(anthropic.RateLimitError, 429, headers={"retry-after": "7"}),
        _status_error(anthropic.OverloadedError, 529, headers={"retry-after-ms": "2500"}),
        _status_error(anthropic.RateLimitError, 429, headers={"retry-after": "garbage"}),
        _message(),
    )
    llm = _llm(client, sleep=sleeps.append, base_delay=0.5, max_delay=1.0)
    assert llm.complete("s", "u", SCHEMA) == GOOD
    assert sleeps[0] == 7.0 and sleeps[1] == 2.5 and 0 < sleeps[2] <= 1.0


def test_overloaded_and_server_errors_are_retried_then_given_up():
    client = _client(_status_error(anthropic.OverloadedError, 529), _status_error(anthropic.InternalServerError, 500))
    with pytest.raises(LLMError, match="giving up after 2 attempts"):
        _llm(client, max_attempts=2).complete("s", "u", SCHEMA)
    assert client.messages.stream.call_count == 2


@pytest.mark.parametrize(
    "cls, status",
    [
        (anthropic.BadRequestError, 400),
        (anthropic.AuthenticationError, 401),
        (anthropic.PermissionDeniedError, 403),
        (anthropic.NotFoundError, 404),
        (anthropic.RequestTooLargeError, 413),
        (anthropic.UnprocessableEntityError, 422),
    ],
)
def test_client_errors_are_not_retried(cls, status):
    client = _client(_status_error(cls, status))
    with pytest.raises(LLMError, match=cls.__name__) as exc:
        _llm(client).complete("s", "u", SCHEMA)
    assert client.messages.stream.call_count == 1
    if status == 413:
        assert "--chunk-tokens" in str(exc.value)


def test_other_sdk_errors_become_llm_errors():
    err = anthropic.APIResponseValidationError(response=httpx2.Response(200, request=_request()), body=None, message="odd")
    client = _client(err)
    with pytest.raises(LLMError, match="APIResponseValidationError"):
        _llm(client).complete("s", "u", SCHEMA)
    assert client.messages.stream.call_count == 1


def test_refusal_is_not_retried_and_names_the_request():
    client = _client(_message(stop="refusal"))
    with pytest.raises(LLMError, match="refused") as exc:
        _llm(client).complete("s", "u", SCHEMA)
    assert client.messages.stream.call_count == 1
    assert "category='cat'" in str(exc.value) and "request_id=req_stream_0" in str(exc.value)


def test_truncation_is_not_retried():
    client = _client(_message(stop="max_tokens"))
    with pytest.raises(LLMError, match="max_tokens") as exc:
        _llm(client).complete("s", "u", SCHEMA)
    assert client.messages.stream.call_count == 1
    assert "request_id=req_stream_0" in str(exc.value)


def test_malformed_replies_are_retried():
    client = _client(_message(text="not json"), _message(payload={"items": [{"name": "x"}]}), _message())
    llm = _llm(client)
    assert llm.complete("s", "u", SCHEMA) == GOOD
    assert client.messages.stream.call_count == 3
    assert llm.usage.calls == 3  # every reply that came back is billed


def test_reply_without_text_block_is_retried_then_given_up():
    empty = _message()
    empty.content = [types.SimpleNamespace(type="thinking", thinking="")]
    client = _client(empty, empty)
    with pytest.raises(LLMError, match="no text block") as exc:
        _llm(client, max_attempts=2).complete("s", "u", SCHEMA)
    assert "request_id=req_stream_1" in str(exc.value)


def test_default_client_is_built_from_the_sdk(monkeypatch):
    built = {}

    def fake_ctor(**kwargs):
        built.update(kwargs)
        return MagicMock()

    monkeypatch.setattr(anthropic, "Anthropic", fake_ctor)
    llm = AnthropicLLM(api_key="sk-test", timeout=12.5)
    assert built == {"api_key": "sk-test", "timeout": 12.5}
    assert llm.model == "claude-opus-5"


def test_usage_arithmetic():
    u = Usage()
    u.add(input_tokens=3, output_tokens=4)
    before = u.snapshot()
    u.add(input_tokens=10, cache_read_input_tokens=2)
    assert u.delta(before) == {
        "calls": 1,
        "input_tokens": 10,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 2,
    }
