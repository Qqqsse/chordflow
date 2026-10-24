"""Environment-driven worker settings. Secrets are never printed in full."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, ValidationError

ProcessorMode = Literal["mock"]


class WorkerSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    api_base_url: HttpUrl
    token: SecretStr = Field(min_length=32)
    worker_id: str = Field(default="cpu-mock-1", pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")
    processor_mode: ProcessorMode = "mock"
    poll_interval_seconds: float = Field(default=5.0, gt=0, le=300)
    lease_seconds: int = Field(default=60, ge=10, le=600)
    artifact_dir: str = Field(default="artifacts", min_length=1)
    llm_max_calls: int = Field(default=4, ge=0, le=20)
    stage_delay_seconds: float = Field(default=0.0, ge=0, le=10)


class SettingsError(ValueError):
    """Raised when required worker configuration is missing or invalid."""


ENV = {
    "api_base_url": ("WORKER_API_BASE_URL", ""),
    "token": ("WORKER_TOKEN", ""),
    "worker_id": ("WORKER_ID", "cpu-mock-1"),
    "processor_mode": ("WORKER_PROCESSOR_MODE", "mock"),
    "poll_interval_seconds": ("WORKER_POLL_INTERVAL_SECONDS", "5"),
    "lease_seconds": ("WORKER_LEASE_SECONDS", "60"),
    "artifact_dir": ("WORKER_ARTIFACT_DIR", "artifacts"),
    "llm_max_calls": ("WORKER_LLM_MAX_CALLS", "4"),
    "stage_delay_seconds": ("WORKER_STAGE_DELAY_SECONDS", "0"),
}


def load_settings(env: Mapping[str, str]) -> WorkerSettings:
    try:
        return WorkerSettings(**{field: env.get(name, default) for field, (name, default) in ENV.items()})
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in err["loc"]) for err in exc.errors()})
        # Only field names are reported, never the submitted values (they may be secrets).
        raise SettingsError(f"invalid worker settings: {', '.join(fields)}") from None


def describe(settings: WorkerSettings) -> dict[str, str]:
    """Non-sensitive summary suitable for logs."""
    return {
        "api_base_url": str(settings.api_base_url),
        "worker_id": settings.worker_id,
        "processor_mode": settings.processor_mode,
        "poll_interval_seconds": str(settings.poll_interval_seconds),
        "lease_seconds": str(settings.lease_seconds),
        "llm_max_calls": str(settings.llm_max_calls),
        "token": "***",
    }
