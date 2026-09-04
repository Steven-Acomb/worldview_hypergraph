"""The command line: --dry-run, the credential check, exit codes, --replay, --record."""

from __future__ import annotations

import json
import shutil

import pytest

from conftest import FIXTURES
from worldview_core import validate_dict
from worldview_extract import LLMError, cli
from worldview_extract.prompts import SYSTEM_ARGUMENTS, SYSTEM_LINK, SYSTEM_MERGE, SYSTEM_STATEMENTS

SMALL = FIXTURES / "small.txt"
REPLAY = FIXTURES / "small-replay.jsonl"


@pytest.fixture(autouse=True)
def no_anthropic_llm(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the CLI tried to build an AnthropicLLM")

    monkeypatch.setattr(cli, "AnthropicLLM", boom)


# ------------------------------------------------------------------ dry run


def test_dry_run_prints_chunks_and_prompts_without_calling_anything(capsys):
    assert cli.main([str(SMALL), "--dry-run", "--chunk-tokens", "120"]) == 0
    out = capsys.readouterr().out
    assert "segmentation: tagged, 6 paragraphs, 3 untagged blocks skipped" in out
    assert "chunks: " in out and "chunk 1: " in out
    assert "no API calls made" in out
    assert SYSTEM_STATEMENTS in out and SYSTEM_MERGE in out and SYSTEM_ARGUMENTS in out
    assert SYSTEM_LINK not in out
    assert "=== user prompt: pass A, chunk 1/" in out
    assert "Document: small\n" in out  # the file stem is the default name
    assert "[I.1] Good sense" in out
    assert "more chunk prompt(s) not shown" in out


def test_dry_run_verbose_shows_every_chunk_and_the_link_prompt(capsys):
    assert cli.main([str(SMALL), "--dry-run", "--chunk-tokens", "120", "--link", "--verbose", "--name", "Doc"]) == 0
    out = capsys.readouterr().out
    assert SYSTEM_LINK in out
    assert "more chunk prompt(s) not shown" not in out
    assert out.count("=== user prompt: pass A, chunk ") >= 2
    assert "Document: Doc\n" in out


def test_dry_run_flags_oversize_paragraphs_and_spanned_headings(tmp_path, capsys):
    text = "# One\n\n[a] Short.\n\n# Two\n\n[b] Also short.\n\n[c] " + "word " * 200 + "\n"
    path = tmp_path / "t.txt"
    path.write_text(text, encoding="utf-8")
    assert cli.main([str(path), "--dry-run", "--chunk-tokens", "50"]) == 0
    out = capsys.readouterr().out
    assert 'chunk 1: 2 paragraphs, ~6 tokens, keys a..b, headings "One" > "Two"' in out
    assert 'chunk 2: 1 paragraphs, ~286 tokens, keys c..c, heading "Two" (one paragraph, larger than the budget)' in out


# --------------------------------------------------------------- usage errors


def test_missing_credentials_is_a_usage_error(tmp_path, capsys):
    rc = cli.main([str(SMALL), "-o", str(tmp_path / "out.json")])
    assert rc == 2
    err = capsys.readouterr().err
    assert "no Anthropic credentials found" in err
    assert "ANTHROPIC_API_KEY" in err and "ant auth login" in err and "--replay" in err
    assert not (tmp_path / "out.json").exists()


class _FakeProvider:
    """Stands in for AnthropicLLM: proves the CLI got past the credential check."""

    def __init__(self, model):
        self.model = model

    def complete(self, system, user, schema):
        raise LLMError(f"fake provider for {self.model}")


@pytest.mark.parametrize("how", ["auth-token", "sdk-profile"])
def test_credentials_the_sdk_can_discover_are_accepted(tmp_path, capsys, monkeypatch, how):
    import anthropic.lib.credentials as credentials

    if how == "auth-token":
        monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    else:  # an `ant auth login` profile on disk: the SDK's discovery chain finds it
        monkeypatch.setattr(credentials, "default_credentials", lambda **kw: object())
    monkeypatch.setattr(cli, "AnthropicLLM", _FakeProvider)
    rc = cli.main([str(SMALL), "-o", str(tmp_path / "out.json"), "--model", "claude-sonnet-5"])
    assert rc == 1
    assert "fake provider for claude-sonnet-5" in capsys.readouterr().err


def test_broken_explicit_profile_is_reported_as_a_usage_error(tmp_path, capsys, monkeypatch):
    import anthropic.lib.credentials as credentials

    def broken(**kw):
        raise RuntimeError("profile 'dev' not found")

    monkeypatch.setattr(credentials, "default_credentials", broken)
    rc = cli.main([str(SMALL), "-o", str(tmp_path / "out.json")])
    assert rc == 2
    err = capsys.readouterr().err
    assert "could not load its credentials" in err and "profile 'dev' not found" in err


def test_output_is_required_without_dry_run(capsys):
    assert cli.main([str(SMALL)]) == 2
    assert "-o/--output is required" in capsys.readouterr().err


def test_unreadable_input_is_a_usage_error(tmp_path, capsys):
    assert cli.main([str(tmp_path / "nope.txt"), "--dry-run"]) == 2
    assert "cannot read" in capsys.readouterr().err


def test_bad_chunk_tokens(capsys):
    assert cli.main([str(SMALL), "--dry-run", "--chunk-tokens", "0"]) == 2
    assert "must be positive" in capsys.readouterr().err


def test_missing_replay_file_is_a_usage_error(tmp_path, capsys):
    rc = cli.main([str(SMALL), "-o", str(tmp_path / "o.json"), "--replay", str(tmp_path / "nope.jsonl")])
    assert rc == 2
    assert "cannot read replay file" in capsys.readouterr().err


def test_missing_output_directory_is_a_usage_error_before_any_call(tmp_path, capsys):
    rc = cli.main([str(SMALL), "-o", str(tmp_path / "no-such-dir" / "o.json"), "--replay", str(REPLAY)])
    assert rc == 2
    assert "does not exist" in capsys.readouterr().err


def test_unwritable_record_file_is_a_usage_error(tmp_path, capsys):
    # the record path is a directory, so it cannot be opened for writing
    rc = cli.main([str(SMALL), "-o", str(tmp_path / "o.json"), "--replay", str(REPLAY), "--record", str(tmp_path)])
    assert rc == 2
    assert "cannot write" in capsys.readouterr().err
    assert not (tmp_path / "o.json").exists()


def test_unwritable_output_dumps_the_document_to_stdout(tmp_path, capsys):
    # the output path is a directory: the run succeeded, so the result must not be lost
    rc = cli.main([str(SMALL), "-o", str(tmp_path), "--replay", str(REPLAY)])
    assert rc == 1
    captured = capsys.readouterr()
    assert "cannot write" in captured.err and "stdout" in captured.err
    doc = json.loads(captured.out)
    assert validate_dict(doc) == [] and doc["name"] == "small"


# ------------------------------------------------------------ replay / record


def test_replay_from_recorded_fixture(tmp_path, capsys):
    out = tmp_path / "small.json"
    rc = cli.main([str(SMALL), "-o", str(out), "--replay", str(REPLAY), "--verbose"])
    err = capsys.readouterr().err
    assert rc == 0, err
    assert "hash mismatch" not in err, "the fixture is stale: regenerate it with tests/fixtures/regenerate.py"
    assert "wrote " in err and "statements" in err and "model fake-model" in err
    assert "pass A: chunk 1/" in err  # --verbose progress
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert validate_dict(doc) == []
    assert doc["name"] == "small"
    ex = doc["meta"]["extraction"]
    assert ex["model"] == "fake-model" and ex["source"] == "small.txt"
    assert ex["usage"]["calls"] == len(REPLAY.read_text(encoding="utf-8").splitlines())
    ids = {s["id"] for s in doc["statements"]}
    assert {"good-sense-equal", "senses-deceive", "i-think", "i-exist"} <= ids
    assert {a["id"] for a in doc["arguments"]} >= {"cogito", "distrust-from-deception"}


def test_replay_with_different_input_fails_cleanly(tmp_path, capsys):
    other = tmp_path / "other.txt"
    other.write_text("# H\n\n[A.1] Alpha.\n\n[A.2] Beta.\n\n[A.3] Gamma.\n\n[A.4] Delta.\n", encoding="utf-8")
    shutil.copy(REPLAY, tmp_path / "r.jsonl")
    # --chunk-tokens 1 puts every paragraph in its own chunk, so this run makes more
    # pass A calls than the recording has; the second recorded reply is the merge
    # pass and does not fit the statements schema.
    rc = cli.main([str(other), "-o", str(tmp_path / "o.json"), "--replay", str(tmp_path / "r.jsonl"), "--chunk-tokens", "1"])
    assert rc == 1
    err = capsys.readouterr().err
    assert "hash mismatch" in err and "error:" in err and "does not match schema" in err
    assert not (tmp_path / "o.json").exists()


def test_record_writes_a_replayable_log(tmp_path, capsys):
    log = tmp_path / "rec.jsonl"
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    assert cli.main([str(SMALL), "-o", str(first), "--replay", str(REPLAY), "--record", str(log)]) == 0
    lines = [json.loads(ln) for ln in log.read_text(encoding="utf-8").splitlines()]
    assert len(lines) == len(REPLAY.read_text(encoding="utf-8").splitlines())
    assert all("request_hash" in ln and "response" in ln for ln in lines)
    assert cli.main([str(SMALL), "-o", str(second), "--replay", str(log)]) == 0
    assert "hash mismatch" not in capsys.readouterr().err
    a = json.loads(first.read_text(encoding="utf-8"))
    b = json.loads(second.read_text(encoding="utf-8"))
    a["meta"]["extraction"].pop("date")
    b["meta"]["extraction"].pop("date")
    assert a == b


def test_version_flag(capsys):
    with pytest.raises(SystemExit) as exc:
        cli.main(["--version"])
    assert exc.value.code == 0
    assert "worldview-extract" in capsys.readouterr().out
