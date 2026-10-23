import json

import pytest

from chordflow_worker.__main__ import main
from chordflow_worker.config import SettingsError, describe, load_settings

VALID = {
    "WORKER_API_BASE_URL": "http://web:3000",
    "WORKER_TOKEN": "test-token-0123456789",
}


def test_loads_valid_settings() -> None:
    settings = load_settings(VALID)
    assert str(settings.api_base_url) == "http://web:3000/"
    assert settings.processor_mode == "mock"
    assert settings.poll_interval_seconds == 5.0


def test_rejects_short_token_without_echoing_it() -> None:
    with pytest.raises(SettingsError) as info:
        load_settings({**VALID, "WORKER_TOKEN": "short-secret"})
    assert "token" in str(info.value)
    assert "short-secret" not in str(info.value)


def test_rejects_unknown_processor_mode() -> None:
    with pytest.raises(SettingsError, match="processor_mode"):
        load_settings({**VALID, "WORKER_PROCESSOR_MODE": "cuda"})


def test_rejects_missing_url() -> None:
    with pytest.raises(SettingsError, match="api_base_url"):
        load_settings({"WORKER_TOKEN": VALID["WORKER_TOKEN"]})


def test_describe_redacts_token() -> None:
    summary = describe(load_settings(VALID))
    assert summary["token"] == "***"
    assert VALID["WORKER_TOKEN"] not in json.dumps(summary)


def test_check_command(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    for key, value in VALID.items():
        monkeypatch.setenv(key, value)
    assert main(["check"]) == 0
    out = capsys.readouterr().out
    assert json.loads(out)["status"] == "ok"
    assert VALID["WORKER_TOKEN"] not in out


def test_check_command_fails_closed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("WORKER_TOKEN", raising=False)
    monkeypatch.setenv("WORKER_API_BASE_URL", "http://web:3000")
    assert main(["check"]) == 2
    assert json.loads(capsys.readouterr().err)["status"] == "error"
