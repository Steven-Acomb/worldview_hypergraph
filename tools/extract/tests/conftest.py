"""Shared fixtures for the worldview-extract tests.  No test touches the network."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"
REPO = HERE.parent.parent.parent
DESCARTES = REPO / "examples" / "sources" / "descartes-discourse-on-method.txt"

if str(HERE) not in sys.path:  # make `import scripted` work regardless of rootdir
    sys.path.insert(0, str(HERE))

#: Every environment variable the SDK's credential chain consults.
CREDENTIAL_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_CONFIG_DIR",
    "ANTHROPIC_IDENTITY_TOKEN",
    "ANTHROPIC_IDENTITY_TOKEN_FILE",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_SERVICE_ACCOUNT_ID",
)


@pytest.fixture
def small_text() -> str:
    return (FIXTURES / "small.txt").read_text(encoding="utf-8")


@pytest.fixture
def untagged_text() -> str:
    return (FIXTURES / "untagged.txt").read_text(encoding="utf-8")


@pytest.fixture
def fake_llm():
    from worldview_extract import FakeLLM

    import scripted

    return FakeLLM(responder=scripted.respond)


@pytest.fixture(autouse=True)
def no_real_client(monkeypatch):
    """Any attempt to build a real Anthropic client during a test is a bug.

    Credentials are hidden too: the environment variables are removed and
    the SDK's on-disk discovery (an ``ant auth login`` profile, if the
    developer has one) is stubbed out, so the tests see the same "no
    credentials" world on every machine.
    """
    import anthropic
    import anthropic.lib.credentials as credentials

    def boom(*args, **kwargs):
        raise AssertionError("a test tried to construct anthropic.Anthropic")

    monkeypatch.setattr(anthropic, "Anthropic", boom)
    monkeypatch.setattr(credentials, "default_credentials", lambda **kw: None)
    for var in CREDENTIAL_ENV:
        monkeypatch.delenv(var, raising=False)
