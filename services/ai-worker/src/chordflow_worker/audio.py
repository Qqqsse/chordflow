"""Authorized audio in the worker (contract 1.1.0).

The client downloads and verifies the file; this module probes what the CPU
worker can decode with the standard library (WAV). Other containers are
decoded by the GPU worker's decoder (M8-3). Audio is private: callers keep it
in a temporary directory that is deleted when the job step ends.
"""

from __future__ import annotations

import struct
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class DownloadedAudio:
    path: Path
    sha256: str
    format: str
    size_bytes: int
    max_duration_seconds: int


@dataclass(frozen=True)
class AudioProbe:
    duration_seconds: float | None
    sample_rate: int | None
    channels: int | None


class AudioRejected(Exception):
    """The audio cannot be analysed; reported as a typed, non-retryable job failure."""

    def __init__(self, code: Literal["AUDIO_INVALID", "AUDIO_TOO_LONG"], message: str) -> None:
        super().__init__(message)
        self.code: Literal["AUDIO_INVALID", "AUDIO_TOO_LONG"] = code
        self.message = message


def probe_audio(audio: DownloadedAudio) -> AudioProbe:
    if audio.format != "wav":
        return AudioProbe(duration_seconds=None, sample_rate=None, channels=None)
    try:
        with wave.open(str(audio.path), "rb") as reader:
            frames = reader.getnframes()
            rate = reader.getframerate()
            channels = reader.getnchannels()
    except (wave.Error, EOFError, struct.error, ValueError):
        raise AudioRejected("AUDIO_INVALID", "WAV 檔案無法解析") from None
    if rate <= 0 or channels <= 0:
        raise AudioRejected("AUDIO_INVALID", "WAV 檔案的取樣率或聲道數無效")
    duration = frames / rate
    if duration > audio.max_duration_seconds:
        raise AudioRejected(
            "AUDIO_TOO_LONG",
            f"音訊長 {duration:.0f} 秒，超過上限 {audio.max_duration_seconds} 秒",
        )
    return AudioProbe(duration_seconds=duration, sample_rate=rate, channels=channels)
