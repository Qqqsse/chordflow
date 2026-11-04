"""Job loop: claim → stages with heartbeats → complete or typed fail.

Logs are JSON lines with job ids, stages and outcomes only: never the token,
lyrics or source URLs.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Literal

from . import __version__
from .artifacts import LocalArtifactStore
from .client import ApiError, LeaseLost, TransientError, WorkerApiClient
from .config import WorkerSettings
from .contracts import (
    CONTRACT_MAJOR,
    ClaimedJob,
    JobProgress,
    PipelineStage,
    WorkerClaimRequest,
    WorkerCompleteRequest,
    WorkerError,
    WorkerFailRequest,
    WorkerHeartbeatRequest,
    contract_major,
)
from .pipeline import JobFailure, PipelineConfig, run_mock_pipeline

log = logging.getLogger("chordflow_worker")

Outcome = Literal["completed", "failed", "lease_lost", "rejected"]


def _log(event: str, **fields: object) -> None:
    log.info(json.dumps({"event": event, **fields}, ensure_ascii=False))


class Worker:
    def __init__(
        self,
        settings: WorkerSettings,
        client: WorkerApiClient,
        *,
        sleep: Callable[[float], None] = time.sleep,
        stop: threading.Event | None = None,
    ) -> None:
        self.settings = settings
        self.client = client
        self.store = LocalArtifactStore(Path(settings.artifact_dir))
        self.sleep = sleep
        self.stop = stop or threading.Event()

    def _retry(self, action: Callable[[], object], attempts: int = 4) -> object:
        """Retries transient failures; completion/fail requests are idempotent server-side."""
        for attempt in range(attempts):
            try:
                return action()
            except TransientError:
                if attempt == attempts - 1:
                    raise
                self.sleep(min(2.0**attempt, 30.0))
        raise AssertionError("unreachable")

    def _fail(self, job: ClaimedJob, code: str, message: str, retryable: bool) -> Outcome:
        request = WorkerFailRequest(
            workerId=self.settings.worker_id,
            leaseToken=job.leaseToken,
            error=WorkerError(code=code, message=message, retryable=retryable),  # type: ignore[arg-type]
        )
        try:
            self._retry(lambda: self.client.fail(job.id, request))
        except LeaseLost:
            return "lease_lost"
        _log("job_failed", job=job.id, attempt=job.attempt, code=code, retryable=retryable)
        return "failed"

    def process(self, job: ClaimedJob) -> Outcome:
        _log("job_claimed", job=job.id, attempt=job.attempt)
        if contract_major(job.contractVersion) != CONTRACT_MAJOR:
            return self._fail(job, "INTERNAL_ERROR", "unsupported contract version", True)

        def on_stage(stage: PipelineStage, fraction: float) -> None:
            self.client.heartbeat(
                job.id,
                WorkerHeartbeatRequest(
                    workerId=self.settings.worker_id,
                    leaseToken=job.leaseToken,
                    progress=JobProgress(stage=stage, fraction=fraction),
                ),
            )
            _log("stage", job=job.id, stage=stage)
            if self.settings.stage_delay_seconds > 0:
                self.sleep(self.settings.stage_delay_seconds)

        try:
            result = run_mock_pipeline(
                job,
                self.store,
                PipelineConfig(
                    llm_max_calls=self.settings.llm_max_calls,
                    fetch_audio=lambda claimed, destination: self.client.download_audio(
                        claimed.id, self.settings.worker_id, claimed.leaseToken, destination
                    ),
                ),
                on_stage,
            )
        except LeaseLost:
            _log("lease_lost", job=job.id)
            return "lease_lost"
        except JobFailure as failure:
            return self._fail(job, failure.code, failure.message, failure.retryable)
        except TransientError:
            # Could not heartbeat; the lease will expire and the job is requeued.
            _log("heartbeat_unavailable", job=job.id)
            return "lease_lost"
        except Exception as error:  # noqa: BLE001 - report every crash as a typed failure
            _log("processor_crash", job=job.id, error=type(error).__name__)
            return self._fail(job, "INTERNAL_ERROR", "unexpected worker error", True)

        request = WorkerCompleteRequest(
            workerId=self.settings.worker_id,
            leaseToken=job.leaseToken,
            processor=result.processor,
            draft=result.draft,
            artifacts=result.artifacts,
        )
        try:
            self._retry(lambda: self.client.complete(job.id, request))
        except LeaseLost:
            _log("lease_lost", job=job.id)
            return "lease_lost"
        except ApiError as error:
            _log("completion_rejected", job=job.id, code=error.code)
            return "rejected"
        _log("job_completed", job=job.id, attempt=job.attempt)
        return "completed"

    def claim(self) -> ClaimedJob | None:
        return self.client.claim(
            WorkerClaimRequest(
                workerId=self.settings.worker_id,
                workerVersion=__version__,
                processors=[self.settings.processor_mode],
                leaseSeconds=self.settings.lease_seconds,
            )
        )

    def run(self, *, mode: Literal["forever", "once", "drain"] = "forever") -> int:
        """Processes jobs; returns how many were processed. `drain` stops at an empty queue."""
        processed = 0
        failures = 0
        while not self.stop.is_set():
            try:
                job = self.claim()
                failures = 0
            except TransientError:
                failures += 1
                _log("api_unavailable", retry_in=min(2**failures, 60))
                if mode != "forever" and failures >= 5:
                    break
                self.sleep(min(2.0**failures, 60.0))
                continue
            if job is None:
                if mode != "forever":
                    break
                self.sleep(self.settings.poll_interval_seconds)
                continue
            self.process(job)
            processed += 1
            if mode == "once":
                break
        return processed
