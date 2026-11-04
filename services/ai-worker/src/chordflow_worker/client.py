"""Worker API client (stdlib HTTP only; no Node-specific queue SDK, no extra deps)."""

from __future__ import annotations

import hashlib
import json
import re
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, SecretStr, ValidationError

from . import __version__
from .audio import DownloadedAudio
from .contracts import (
    AUDIO_FORMATS,
    WORKER_AUDIO_HEADERS,
    ClaimedJob,
    WorkerClaimData,
    WorkerClaimRequest,
    WorkerCompleteData,
    WorkerCompleteRequest,
    WorkerFailData,
    WorkerFailRequest,
    WorkerHeartbeatData,
    WorkerHeartbeatRequest,
)

T = TypeVar("T", bound=BaseModel)


class ApiError(Exception):
    """Non-retryable API refusal with the server's stable error code."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code


class LeaseLost(ApiError):
    """The lease expired, was reassigned, or the job was cancelled: stop working on it."""


class TransientError(Exception):
    """Network failure, 429 or 5xx: safe to retry the same request later."""


class WorkerApiClient:
    def __init__(
        self,
        base_url: str,
        token: SecretStr,
        *,
        timeout: float = 30.0,
        opener: urllib.request.OpenerDirector | None = None,
    ) -> None:
        self._base = base_url.rstrip("/") + "/api/v1/worker/jobs"
        self._token = token
        self._timeout = timeout
        self._opener = opener or urllib.request.build_opener()

    def _post(self, path: str, body: BaseModel, response: type[T]) -> T:
        payload = body.model_dump_json(exclude_unset=True).encode("utf-8")
        request = urllib.request.Request(
            self._base + path,
            data=payload,
            method="POST",
            headers={
                "authorization": f"Bearer {self._token.get_secret_value()}",
                "content-type": "application/json",
                "accept": "application/json",
                "user-agent": f"chordflow-worker/{__version__}",
            },
        )
        try:
            with self._opener.open(request, timeout=self._timeout) as reply:
                raw = reply.read()
        except urllib.error.HTTPError as error:
            raise _api_error(error) from None
        except (urllib.error.URLError, socket.timeout, ConnectionError) as error:
            raise TransientError(type(error).__name__) from None
        try:
            envelope = json.loads(raw)
            return response.model_validate(envelope["data"])
        except (ValueError, KeyError, TypeError, ValidationError) as error:
            raise ApiError(200, "INVALID_RESPONSE", type(error).__name__) from None

    def claim(self, request: WorkerClaimRequest) -> ClaimedJob | None:
        return self._post("/claim", request, WorkerClaimData).job

    def heartbeat(self, job_id: str, request: WorkerHeartbeatRequest) -> WorkerHeartbeatData:
        return self._post(f"/{job_id}/heartbeat", request, WorkerHeartbeatData)

    def complete(self, job_id: str, request: WorkerCompleteRequest) -> WorkerCompleteData:
        return self._post(f"/{job_id}/complete", request, WorkerCompleteData)

    def fail(self, job_id: str, request: WorkerFailRequest) -> WorkerFailData:
        return self._post(f"/{job_id}/fail", request, WorkerFailData)

    def download_audio(
        self, job_id: str, worker_id: str, lease_token: str, destination: Path
    ) -> DownloadedAudio:
        """Streams the job's authorized audio to `destination` and verifies its SHA-256.

        A digest mismatch is treated as a transient transfer error; the partial
        file is always removed on failure.
        """
        request = urllib.request.Request(
            f"{self._base}/{job_id}/audio",
            method="GET",
            headers={
                "authorization": f"Bearer {self._token.get_secret_value()}",
                "accept": "application/octet-stream",
                "user-agent": f"chordflow-worker/{__version__}",
                WORKER_AUDIO_HEADERS["workerId"]: worker_id,
                WORKER_AUDIO_HEADERS["leaseToken"]: lease_token,
            },
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self._opener.open(request, timeout=self._timeout) as reply:
                expected = reply.headers.get(WORKER_AUDIO_HEADERS["sha256"], "")
                audio_format = reply.headers.get(WORKER_AUDIO_HEADERS["format"], "")
                max_duration = reply.headers.get(WORKER_AUDIO_HEADERS["maxDurationSeconds"], "")
                if (
                    re.fullmatch(r"[0-9a-f]{64}", expected) is None
                    or audio_format not in AUDIO_FORMATS
                    or not max_duration.isdigit()
                ):
                    raise ApiError(200, "INVALID_RESPONSE", "missing audio headers")
                digest = hashlib.sha256()
                size = 0
                with destination.open("wb") as out:
                    while chunk := reply.read(CHUNK_BYTES):
                        digest.update(chunk)
                        size += len(chunk)
                        out.write(chunk)
            if digest.hexdigest() != expected:
                raise TransientError("audio digest mismatch")
        except urllib.error.HTTPError as error:
            destination.unlink(missing_ok=True)
            raise _api_error(error) from None
        except (urllib.error.URLError, socket.timeout, ConnectionError) as error:
            destination.unlink(missing_ok=True)
            raise TransientError(type(error).__name__) from None
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        return DownloadedAudio(
            path=destination,
            sha256=expected,
            format=audio_format,
            size_bytes=size,
            max_duration_seconds=int(max_duration),
        )


CHUNK_BYTES = 1 << 16


def _api_error(error: urllib.error.HTTPError) -> Exception:
    """Maps an HTTP refusal: 429/5xx are transient, LEASE_LOST stops work, the rest is final."""
    status = error.code
    code, message = _error_of(error.read())
    if status in (429, 502, 503, 504) or status >= 500:
        return TransientError(f"{status} {code}")
    if status == 409 and code == "LEASE_LOST":
        return LeaseLost(status, code, message)
    return ApiError(status, code, message)


def _error_of(raw: bytes) -> tuple[str, str]:
    try:
        error = json.loads(raw)["error"]
        return str(error["code"]), str(error["message"])[:300]
    except (ValueError, KeyError, TypeError):
        return "HTTP_ERROR", ""
