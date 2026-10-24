"""Worker API client (stdlib HTTP only; no Node-specific queue SDK, no extra deps)."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import TypeVar

from pydantic import BaseModel, SecretStr, ValidationError

from . import __version__
from .contracts import (
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
            raw = error.read()
            status = error.code
            code, message = _error_of(raw)
            if status in (429, 502, 503, 504) or status >= 500:
                raise TransientError(f"{status} {code}") from None
            if status == 409 and code == "LEASE_LOST":
                raise LeaseLost(status, code, message) from None
            raise ApiError(status, code, message) from None
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


def _error_of(raw: bytes) -> tuple[str, str]:
    try:
        error = json.loads(raw)["error"]
        return str(error["code"]), str(error["message"])[:300]
    except (ValueError, KeyError, TypeError):
        return "HTTP_ERROR", ""
