"""Environment-driven worker settings. Secrets are never printed in full."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, ValidationError

ProcessorMode = Literal["mock"]


class WorkerSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    api_base_url: HttpUrl
    token: SecretStr = Field(min_length=16)
    processor_mode: ProcessorMode = "mock"
    poll_interval_seconds: float = Field(default=5.0, gt=0, le=300)


class SettingsError(ValueError):
    """Raised when required worker configuration is missing or invalid."""


def load_settings(env: Mapping[str, str]) -> WorkerSettings:
    try:
        return WorkerSettings(
            api_base_url=env.get("WORKER_API_BASE_URL", ""),
            token=env.get("WORKER_TOKEN", ""),
            processor_mode=env.get("WORKER_PROCESSOR_MODE", "mock"),
            poll_interval_seconds=env.get("WORKER_POLL_INTERVAL_SECONDS", "5"),
        )
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in err["loc"]) for err in exc.errors()})
        # Only field names are reported, never the submitted values (they may be secrets).
        raise SettingsError(f"invalid worker settings: {', '.join(fields)}") from None


def describe(settings: WorkerSettings) -> dict[str, str]:
    """Non-sensitive summary suitable for logs."""
    return {
        "api_base_url": str(settings.api_base_url),
        "processor_mode": settings.processor_mode,
        "poll_interval_seconds": str(settings.poll_interval_seconds),
        "token": "***",
    }
