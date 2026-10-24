"""Filesystem artifact store and cache keys (SPEC §9 layered analysis cache)."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

SCHEMA_VERSION = "1.0.0"
SAFE_PART = re.compile(r"^[A-Za-z0-9._-]+$")


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def fingerprint(value: object) -> str:
    return sha256_text(canonical_json(value))


def cache_key(
    *,
    kind: str,
    input_fingerprint: str,
    processor_id: str,
    processor_version: str,
    config_hash: str,
    schema_version: str = SCHEMA_VERSION,
) -> str:
    """Same format as `artifactCacheKey` in packages/chart-schema (checked by a shared fixture)."""
    return "|".join(
        [
            kind,
            f"v{schema_version}",
            f"{processor_id}@{processor_version}",
            config_hash,
            input_fingerprint,
        ]
    )


@dataclass(frozen=True)
class StoredArtifact:
    storage_path: str
    content_digest: str
    byte_size: int


class LocalArtifactStore:
    """Writes artifacts under `<root>/jobs/<job id>/<attempt>/` (relative paths only)."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def write_json(self, job_id: str, attempt: int, name: str, payload: object) -> StoredArtifact:
        for part in (job_id, name):
            if SAFE_PART.match(part) is None:
                raise ValueError(f"unsafe artifact path part: {part!r}")
        relative = f"jobs/{job_id}/{attempt}/{name}.json"
        data = (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".json.tmp")
        temporary.write_bytes(data)
        os.replace(temporary, target)
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        return StoredArtifact(storage_path=relative, content_digest=digest, byte_size=len(data))
