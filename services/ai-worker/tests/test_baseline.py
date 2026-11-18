"""Chord recognition baseline and evaluation harness (synthetic signals only)."""

from __future__ import annotations

import dataclasses
import wave
from pathlib import Path

import numpy as np
import pytest

from chordflow_worker.baseline import LABELS, ChordSegment, load_wav, recognize, templates
from chordflow_worker.evaluate import (
    RATE,
    SYNTHETIC_SUITE,
    boundary_score,
    overlap_accuracy,
    run_synthetic_suite,
    synth_chord,
    synth_progression,
)


def test_vocabulary_is_no_chord_plus_major_and_minor_triads() -> None:
    assert len(LABELS) == 25
    assert LABELS[:2] == ("N", "C") and LABELS[13] == "Cm"
    assert templates().shape == (24, 12)
    np.testing.assert_allclose(np.linalg.norm(templates(), axis=1), 1.0)


def test_reports_labels_and_times_only_never_a_confidence() -> None:
    assert [f.name for f in dataclasses.fields(ChordSegment)] == ["start", "end", "label"]
    assert recognize(np.zeros(0, dtype=np.float32), RATE) == []


@pytest.mark.parametrize("name", sorted(SYNTHETIC_SUITE))
def test_synthetic_suite_sanity(name: str) -> None:
    # Sanity floors on clean synthetic tones, not quality claims about real music.
    result = run_synthetic_suite()[name]
    assert result["accuracy"] >= 0.85
    assert result["boundaries"]["f1"] >= 0.9  # type: ignore[index]


def test_silence_is_no_chord() -> None:
    segments = recognize(np.zeros(RATE * 3, dtype=np.float32), RATE)
    assert [s.label for s in segments] == ["N"]
    assert segments[0].start == 0.0 and segments[0].end == pytest.approx(3.0)


@pytest.mark.parametrize("label", ["A", "Am", "Eb", "F#m"])
def test_distinguishes_major_and_minor(label: str) -> None:
    segments = recognize(synth_chord(label, 3.0), RATE)
    longest = max(segments, key=lambda s: s.end - s.start)
    assert longest.label == label


def test_segments_cover_the_signal_without_gaps() -> None:
    signal, _ = synth_progression([("C", 1.5), ("G", 1.5), ("N", 1.0)])
    segments = recognize(signal, RATE)
    assert segments[0].start == 0.0
    assert segments[-1].end == pytest.approx(len(signal) / RATE)
    assert all(a.end == pytest.approx(b.start) for a, b in zip(segments, segments[1:]))


def test_repeated_chords_form_one_reference_segment() -> None:
    _, reference = synth_progression([("D", 1.0), ("D", 1.0), ("G", 1.0)])
    assert [(s.label, s.start, s.end) for s in reference] == [("D", 0.0, 2.0), ("G", 2.0, 3.0)]


def test_metrics() -> None:
    reference = [ChordSegment(0, 2, "C"), ChordSegment(2, 4, "G")]
    assert overlap_accuracy(reference, reference) == pytest.approx(1.0)
    shifted = [ChordSegment(0, 2.4, "C"), ChordSegment(2.4, 4, "G")]
    assert overlap_accuracy(reference, shifted) == pytest.approx(0.9, abs=0.01)
    assert boundary_score(reference, shifted, tolerance=0.5).f1 == 1.0
    assert boundary_score(reference, shifted, tolerance=0.2).f1 == 0.0
    extra = [ChordSegment(0, 1, "C"), ChordSegment(1, 2, "Am"), ChordSegment(2, 4, "G")]
    score = boundary_score(reference, extra)
    assert (score.precision, score.recall) == (0.5, 1.0)


@pytest.mark.parametrize(("width", "channels"), [(2, 1), (2, 2), (3, 2), (4, 1), (1, 1)])
def test_load_wav_mixes_down_pcm(tmp_path: Path, width: int, channels: int) -> None:
    rate = 8000
    tone = 0.5 * np.sin(2 * np.pi * 440 * np.arange(rate // 4) / rate)
    peak = (1 << (8 * width - 1)) - 1
    ints = np.round(tone * peak).astype(np.int64)
    frames = np.repeat(ints[:, None], channels, axis=1).reshape(-1)
    if width == 1:
        raw = (frames + 128).astype(np.uint8).tobytes()
    elif width == 3:
        unsigned = frames & 0xFFFFFF
        raw = np.stack([unsigned & 0xFF, (unsigned >> 8) & 0xFF, (unsigned >> 16) & 0xFF], 1)
        raw = raw.astype(np.uint8).tobytes()
    else:
        raw = frames.astype({2: "<i2", 4: "<i4"}[width]).tobytes()
    path = tmp_path / "tone.wav"
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(width)
        writer.setframerate(rate)
        writer.writeframes(raw)
    samples, loaded_rate = load_wav(path)
    assert loaded_rate == rate
    assert samples.dtype == np.float32 and samples.shape == tone.shape
    np.testing.assert_allclose(samples, tone, atol=0.02)
