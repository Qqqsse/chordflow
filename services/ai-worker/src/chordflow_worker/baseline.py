"""Chord recognition baseline without deep learning (M8-3, step 1).

Chromagram (short-time spectrum folded onto the 12 pitch classes), cosine
match against 24 major/minor triad templates plus "N" for silence, and Viterbi
smoothing so a chord does not flicker frame to frame. It only needs numpy and
exists to be measured against: learned models must beat it on the benchmark
before they are used. It reports labels and times only, never a confidence.
"""

from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

PITCH_CLASSES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
NO_CHORD = "N"
#: "N" first, then the 12 major and the 12 minor triads.
LABELS: tuple[str, ...] = (NO_CHORD, *PITCH_CLASSES, *(f"{pc}m" for pc in PITCH_CLASSES))

Samples = NDArray[np.float32]


@dataclass(frozen=True)
class ChordSegment:
    start: float
    end: float
    label: str


@dataclass(frozen=True)
class BaselineConfig:
    frame_seconds: float = 0.37
    hop_seconds: float = 0.093
    fmin: float = 55.0
    fmax: float = 2000.0
    #: Probability of staying on the same chord from one frame to the next.
    self_transition: float = 0.95
    #: Frames quieter than this (dBFS RMS) are "N".
    silence_db: float = -50.0
    #: Sharpness of the template match when turned into log-probabilities.
    sharpness: float = 20.0


def templates() -> NDArray[np.float64]:
    """Unit-length binary triad templates, one row per chord label after "N"."""
    rows = []
    for intervals in ((0, 4, 7), (0, 3, 7)):
        for root in range(12):
            row = np.zeros(12)
            row[[(root + i) % 12 for i in intervals]] = 1.0
            rows.append(row / np.linalg.norm(row))
    return np.array(rows)


def chromagram(
    samples: Samples, rate: int, config: BaselineConfig = BaselineConfig()
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Per-frame unit-length chroma vectors and frame loudness in dBFS."""
    n_fft = 1 << int(np.ceil(np.log2(config.frame_seconds * rate)))
    hop = max(1, int(round(config.hop_seconds * rate)))
    padded = np.pad(samples.astype(np.float64), (n_fft // 2, n_fft // 2))
    count = 1 + max(0, (len(padded) - n_fft) // hop)
    index = np.arange(n_fft)[None, :] + hop * np.arange(count)[:, None]
    frames = padded[index]
    loudness = 20 * np.log10(np.sqrt(np.mean(frames**2, axis=1)) + 1e-12)
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(n_fft), axis=1))
    freqs = np.fft.rfftfreq(n_fft, 1 / rate)
    keep = (freqs >= config.fmin) & (freqs <= config.fmax)
    pitch_class = np.round(12 * np.log2(freqs[keep] / 440.0) + 69).astype(int) % 12
    compressed = np.log1p(100 * spectrum[:, keep])
    # Remove the broadband floor (noise, room) so only tonal peaks fold into chroma;
    # otherwise the many high-frequency bins of noise flatten every pitch class.
    compressed = np.maximum(compressed - np.median(compressed, axis=1, keepdims=True), 0.0)
    chroma = np.zeros((count, 12))
    for pc in range(12):
        chroma[:, pc] = compressed[:, pitch_class == pc].sum(axis=1)
    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    return chroma / np.maximum(norms, 1e-12), loudness


def _log_emissions(
    chroma: NDArray[np.float64], loudness: NDArray[np.float64], config: BaselineConfig
) -> NDArray[np.float64]:
    match = chroma @ templates().T
    silent = loudness < config.silence_db
    # "N" wins on silent frames; elsewhere only when no triad fits at all.
    no_chord = np.where(silent, 2.0, 0.3)
    logits = config.sharpness * np.column_stack([no_chord, np.where(silent[:, None], 0.0, match)])
    logits -= logits.max(axis=1, keepdims=True)
    return logits - np.log(np.exp(logits).sum(axis=1, keepdims=True))


def _viterbi(log_emit: NDArray[np.float64], self_transition: float) -> NDArray[np.int64]:
    frames, states = log_emit.shape
    stay = np.log(self_transition)
    move = np.log((1 - self_transition) / (states - 1))
    score = log_emit[0].copy()
    back = np.zeros((frames, states), dtype=np.int64)
    for t in range(1, frames):
        best = int(np.argmax(score))
        # Either stay on the same chord or jump from the best previous chord.
        from_best = score[best] + move
        stay_score = score + stay
        back[t] = np.where(stay_score >= from_best, np.arange(states), best)
        score = np.maximum(stay_score, from_best) + log_emit[t]
    path = np.zeros(frames, dtype=np.int64)
    path[-1] = int(np.argmax(score))
    for t in range(frames - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return path


def recognize(
    samples: Samples, rate: int, config: BaselineConfig = BaselineConfig()
) -> list[ChordSegment]:
    """Chord segments covering the whole signal (consecutive equal labels merged)."""
    if len(samples) == 0:
        return []
    chroma, loudness = chromagram(samples, rate, config)
    path = _viterbi(_log_emissions(chroma, loudness, config), config.self_transition)
    duration = len(samples) / rate
    hop = config.hop_seconds
    segments: list[ChordSegment] = []
    start = 0
    for t in range(1, len(path) + 1):
        if t == len(path) or path[t] != path[start]:
            begin = 0.0 if start == 0 else start * hop
            end = duration if t == len(path) else t * hop
            segments.append(ChordSegment(begin, min(end, duration), LABELS[int(path[start])]))
            start = t
    return segments


def load_wav(path: Path) -> tuple[Samples, int]:
    """Mono float32 samples in [-1, 1] from 8/16/24/32-bit PCM WAV (standard library + numpy)."""
    with wave.open(str(path), "rb") as reader:
        channels = reader.getnchannels()
        width = reader.getsampwidth()
        rate = reader.getframerate()
        raw = reader.readframes(reader.getnframes())
    if width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif width == 3:
        bytes3 = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        value = bytes3[:, 0] | (bytes3[:, 1] << 8) | (bytes3[:, 2] << 16)
        data = (np.where(value >= 1 << 23, value - (1 << 24), value) / float(1 << 23)).astype(
            np.float32
        )
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / float(1 << 31)
    else:
        raise ValueError(f"unsupported WAV sample width: {width}")
    return data.reshape(-1, channels).mean(axis=1).astype(np.float32), rate
