"""Worker loop against an in-process fake coordinator (HTTP, same contract)."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import threading
import wave
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from chordflow_worker.client import WorkerApiClient
from chordflow_worker.config import load_settings
from chordflow_worker.runner import Worker

REPO = Path(__file__).resolve().parents[3]
CLAIMED = json.loads(
    (REPO / "fixtures" / "contracts" / "worker" / "claim-response.json").read_text("utf-8")
)["job"]
TOKEN = "test-worker-token-0123456789abcdef-xyz"


class FakeCoordinator:
    def __init__(self) -> None:
        self.jobs: list[dict] = []
        self.calls: list[tuple[str, dict]] = []
        self.complete_failures = 0  # respond 503 this many times first
        self.lease_lost_after_heartbeats: int | None = None
        self.heartbeats = 0
        # Audio served by GET /worker/jobs/{id}/audio; None answers AUDIO_NOT_AVAILABLE.
        self.audio: bytes | None = None
        self.audio_digest: str | None = None  # overrides the real digest when set
        self.audio_max_seconds = 900
        self.audio_status = 200
        self.audio_requests: list[dict[str, str]] = []

    def handle_get(self, path: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
        if headers.get("authorization") != f"Bearer {TOKEN}" or not path.endswith("/audio"):
            return 401, {}, b""
        self.audio_requests.append(headers)
        if self.audio_status == 409:
            body = {"error": {"code": "LEASE_LOST", "message": "x", "details": None, "requestId": "r"}}
            return 409, {"content-type": "application/json"}, json.dumps(body).encode()
        if self.audio is None:
            body = {"error": {"code": "AUDIO_NOT_AVAILABLE", "message": "x", "details": None, "requestId": "r"}}
            return 404, {"content-type": "application/json"}, json.dumps(body).encode()
        digest = self.audio_digest or hashlib.sha256(self.audio).hexdigest()
        return 200, {
            "content-type": "application/octet-stream",
            "x-content-sha256": digest,
            "x-audio-format": "wav",
            "x-audio-max-duration-seconds": str(self.audio_max_seconds),
        }, self.audio

    def handle(self, path: str, auth: str | None, body: dict) -> tuple[int, dict]:
        if auth != f"Bearer {TOKEN}":
            return 401, {"error": {"code": "UNAUTHENTICATED", "message": "no", "details": None, "requestId": "r"}}
        self.calls.append((path, body))
        meta = {"requestId": "r", "schemaVersion": "1.0.0"}
        if path.endswith("/claim"):
            job = self.jobs.pop(0) if self.jobs else None
            return 200, {"data": {"job": job}, "meta": meta}
        if path.endswith("/heartbeat"):
            self.heartbeats += 1
            if self.lease_lost_after_heartbeats is not None and self.heartbeats > self.lease_lost_after_heartbeats:
                return 409, {"error": {"code": "LEASE_LOST", "message": "cancelled", "details": None, "requestId": "r"}}
            return 200, {"data": {"leaseExpiresAt": "2026-10-24T12:01:00.000Z"}, "meta": meta}
        if path.endswith("/complete"):
            if self.complete_failures > 0:
                self.complete_failures -= 1
                return 503, {"error": {"code": "SERVICE_UNAVAILABLE", "message": "x", "details": None, "requestId": "r"}}
            job_id = path.split("/")[-2]
            data = {"jobId": job_id, "arrangementId": "arr_x", "revisionId": "rev_x", "replayed": False}
            return 200, {"data": data, "meta": meta}
        if path.endswith("/fail"):
            return 200, {"data": {"state": "failed_terminal", "nextAttemptAt": None, "replayed": False}, "meta": meta}
        return 404, {"error": {"code": "NOT_FOUND", "message": "", "details": None, "requestId": "r"}}


@pytest.fixture
def coordinator() -> Iterator[tuple[FakeCoordinator, str]]:
    fake = FakeCoordinator()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - http.server API
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            status, reply = fake.handle(self.path, self.headers.get("authorization"), body)
            data = json.dumps(reply).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802 - http.server API
            headers = {k.lower(): v for k, v in self.headers.items()}
            status, reply_headers, data = fake.handle_get(self.path, headers)
            self.send_response(status)
            for name, value in reply_headers.items():
                self.send_header(name, value)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield fake, f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def make_worker(url: str, tmp_path: Path, token: str = TOKEN) -> Worker:
    settings = load_settings(
        {"WORKER_API_BASE_URL": url, "WORKER_TOKEN": token, "WORKER_ARTIFACT_DIR": str(tmp_path)}
    )
    return Worker(settings, WorkerApiClient(url, settings.token, timeout=5), sleep=lambda _: None)


def test_processes_a_job_end_to_end(
    coordinator: tuple[FakeCoordinator, str], tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    fake, url = coordinator
    fake.jobs.append(CLAIMED)
    caplog.set_level(logging.INFO, logger="chordflow_worker")
    assert make_worker(url, tmp_path).run(mode="drain") == 1
    paths = [p.rsplit("/", 1)[-1] for p, _ in fake.calls]
    assert paths == ["claim", *["heartbeat"] * 8, "complete", "claim"]
    complete = fake.calls[-2][1]
    assert complete["leaseToken"] == CLAIMED["leaseToken"]
    assert complete["draft"]["quality"]["overallConfidence"] is None
    assert "label" not in complete["draft"]["document"]["sections"][0]
    # Logs carry ids and outcomes, never the token or the lyrics.
    assert TOKEN not in caplog.text
    assert "清晨" not in caplog.text
    assert "job_completed" in caplog.text


def test_retries_a_transient_completion_failure(
    coordinator: tuple[FakeCoordinator, str], tmp_path: Path
) -> None:
    fake, url = coordinator
    fake.jobs.append(CLAIMED)
    fake.complete_failures = 2
    make_worker(url, tmp_path).run(mode="once")
    completes = [body for path, body in fake.calls if path.endswith("/complete")]
    assert len(completes) == 3
    assert completes[0] == completes[2]  # identical, so the server can deduplicate


def test_stops_when_the_lease_is_lost(coordinator: tuple[FakeCoordinator, str], tmp_path: Path) -> None:
    fake, url = coordinator
    fake.jobs.append(CLAIMED)
    fake.lease_lost_after_heartbeats = 2
    make_worker(url, tmp_path).run(mode="once")
    paths = [p.rsplit("/", 1)[-1] for p, _ in fake.calls]
    assert "complete" not in paths and "fail" not in paths


def test_reports_typed_failure_for_unanalysable_sources(
    coordinator: tuple[FakeCoordinator, str], tmp_path: Path
) -> None:
    fake, url = coordinator
    fake.jobs.append({**CLAIMED, "input": {"kind": "source_reference", "sourceReferenceId": "src_x"}})
    make_worker(url, tmp_path).run(mode="once")
    path, body = fake.calls[-1]
    assert path.endswith("/fail")
    assert body["error"] == {
        "code": "AUDIO_NOT_AVAILABLE",
        "message": body["error"]["message"],
        "retryable": False,
    }


SOURCE_JOB = {**CLAIMED, "input": {"kind": "source_reference", "sourceReferenceId": "src_x"}}


def synthetic_wav(seconds: float, rate: int = 8000) -> bytes:
    """Silent mono PCM; never real audio."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(b"\x00\x00" * int(seconds * rate))
    return buffer.getvalue()


def last_failure(fake: FakeCoordinator) -> dict:
    path, body = fake.calls[-1]
    assert path.endswith("/fail")
    return body["error"]


def test_downloads_and_checks_audio_but_never_invents_an_analysis(
    coordinator: tuple[FakeCoordinator, str], tmp_path: Path
) -> None:
    fake, url = coordinator
    fake.jobs.append(SOURCE_JOB)
    fake.audio = synthetic_wav(1.5)
    make_worker(url, tmp_path).run(mode="once")
    request = fake.audio_requests[0]
    assert request["x-worker-id"] == "cpu-mock-1"
    assert request["x-lease-token"] == CLAIMED["leaseToken"]
    assert last_failure(fake)["code"] == "MODEL_UNAVAILABLE"
    assert last_failure(fake)["retryable"] is False
    stages = [b["progress"]["stage"] for p, b in fake.calls if p.endswith("/heartbeat")]
    assert stages == ["resolve_source", "decode_and_probe_audio"]
    # The private audio is not kept anywhere in the worker's artifact store.
    assert not [p for p in tmp_path.rglob("*") if p.is_file()]


def test_rejects_audio_longer_than_the_limit(
    coordinator: tuple[FakeCoordinator, str], tmp_path: Path
) -> None:
    fake, url = coordinator
    fake.jobs.append(SOURCE_JOB)
    fake.audio = synthetic_wav(2.0)
    fake.audio_max_seconds = 1
    make_worker(url, tmp_path).run(mode="once")
    assert last_failure(fake)["code"] == "AUDIO_TOO_LONG"


def test_rejects_unreadable_wav(coordinator: tuple[FakeCoordinator, str], tmp_path: Path) -> None:
    fake, url = coordinator
    fake.jobs.append(SOURCE_JOB)
    fake.audio = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 64
    make_worker(url, tmp_path).run(mode="once")
    assert last_failure(fake)["code"] == "AUDIO_INVALID"


@pytest.mark.parametrize("problem", ["digest", "lease"])
def test_stops_without_reporting_on_a_bad_transfer_or_lost_lease(
    coordinator: tuple[FakeCoordinator, str], tmp_path: Path, problem: str
) -> None:
    fake, url = coordinator
    fake.jobs.append(SOURCE_JOB)
    fake.audio = synthetic_wav(1.0)
    if problem == "digest":
        fake.audio_digest = "0" * 64
    else:
        fake.audio_status = 409
    make_worker(url, tmp_path).run(mode="once")
    paths = [p.rsplit("/", 1)[-1] for p, _ in fake.calls]
    # A corrupt transfer lets the lease expire (the job is retried); a lost lease just stops.
    assert "fail" not in paths and "complete" not in paths


def test_wrong_token_is_not_retried_forever(coordinator: tuple[FakeCoordinator, str], tmp_path: Path) -> None:
    _, url = coordinator
    from chordflow_worker.client import ApiError

    with pytest.raises(ApiError) as info:
        make_worker(url, tmp_path, token="wrong-token-0123456789abcdef-0123456").run(mode="once")
    assert info.value.status == 401


def test_unreachable_api_gives_up_in_drain_mode(tmp_path: Path) -> None:
    worker = make_worker("http://127.0.0.1:9", tmp_path)
    assert worker.run(mode="drain") == 0
