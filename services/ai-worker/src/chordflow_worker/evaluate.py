"""Evaluation harness for chord recognition (SPEC §11 "Evaluation").

Synthetic signals (sine partials, optional noise and silent gaps) with known
chords, and two metrics: the share of time whose label matches the reference
(a weighted chord symbol recall over major/minor/N) and boundary precision,
recall and F1 within a tolerance. Real recordings join later as a private,
uncommitted benchmark; no accuracy target is set before that baseline exists.

    python -m chordflow_worker.evaluate            # synthetic suite, JSON report
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass

import numpy as np

from .baseline import NO_CHORD, PITCH_CLASSES, ChordSegment, Samples, recognize

RATE = 22050


def _triad(label: str) -> list[int]:
    minor = label.endswith("m")
    root = PITCH_CLASSES.index(label[:-1] if minor else label)
    return [root, root + (3 if minor else 4), root + 7]


def synth_chord(label: str, seconds: float, rate: int = RATE) -> Samples:
    """A strummed-like triad: chord tones around C4 plus the root an octave below."""
    count = int(seconds * rate)
    t = np.arange(count) / rate
    if label == NO_CHORD:
        return np.zeros(count, dtype=np.float32)
    notes = [60 + i for i in _triad(label)] + [48 + _triad(label)[0]]
    signal = np.zeros(count)
    for note in notes:
        freq = 440.0 * 2 ** ((note - 69) / 12)
        for harmonic, amplitude in ((1, 1.0), (2, 0.5), (3, 0.25)):
            signal += amplitude * np.sin(2 * np.pi * freq * harmonic * t)
    envelope = np.minimum(1.0, t / 0.02) * np.exp(-t / max(seconds, 0.1) * 0.7)
    return (0.1 * signal * envelope).astype(np.float32)


def synth_progression(
    chords: Sequence[tuple[str, float]], rate: int = RATE, snr_db: float | None = None, seed: int = 0
) -> tuple[Samples, list[ChordSegment]]:
    parts: list[Samples] = []
    reference: list[ChordSegment] = []
    clock = 0.0
    for label, seconds in chords:
        parts.append(synth_chord(label, seconds, rate))
        if reference and reference[-1].label == label:
            # A repeated chord is not an audible change: one reference segment.
            reference[-1] = ChordSegment(reference[-1].start, clock + seconds, label)
        else:
            reference.append(ChordSegment(clock, clock + seconds, label))
        clock += seconds
    signal = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    if snr_db is not None and signal.size:
        power = float(np.mean(signal[signal != 0] ** 2)) if np.any(signal) else 1e-6
        noise = np.random.default_rng(seed).normal(0, np.sqrt(power / 10 ** (snr_db / 10)), signal.size)
        signal = (signal + noise).astype(np.float32)
    return signal, reference


def _label_at(segments: Sequence[ChordSegment], time: float) -> str:
    for segment in segments:
        if segment.start <= time < segment.end:
            return segment.label
    return NO_CHORD


def overlap_accuracy(
    reference: Sequence[ChordSegment], predicted: Sequence[ChordSegment], step: float = 0.01
) -> float:
    """Share of the reference duration whose predicted label is the same."""
    if not reference:
        return 0.0
    times = np.arange(reference[0].start, reference[-1].end, step)
    hits = sum(_label_at(reference, t) == _label_at(predicted, t) for t in times)
    return hits / max(len(times), 1)


@dataclass(frozen=True)
class BoundaryScore:
    precision: float
    recall: float
    f1: float


def boundary_score(
    reference: Sequence[ChordSegment], predicted: Sequence[ChordSegment], tolerance: float = 0.5
) -> BoundaryScore:
    """Chord-change times matched one-to-one within `tolerance` seconds."""
    truth = [s.start for s in reference[1:]]
    guess = [s.start for s in predicted[1:]]
    unused = list(truth)
    matched = 0
    for time in guess:
        nearest = min(unused, key=lambda b: abs(b - time), default=None)
        if nearest is not None and abs(nearest - time) <= tolerance:
            unused.remove(nearest)
            matched += 1
    precision = matched / len(guess) if guess else float(not truth)
    recall = matched / len(truth) if truth else float(not guess)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return BoundaryScore(precision, recall, f1)


SYNTHETIC_SUITE: dict[str, dict[str, object]] = {
    "pop_four_chords": {"chords": [("C", 2.0), ("G", 2.0), ("Am", 2.0), ("F", 2.0)] * 2},
    "major_minor_pairs": {"chords": [("A", 2.0), ("Am", 2.0), ("E", 2.0), ("Em", 2.0)]},
    "fast_changes": {"chords": [("D", 0.75), ("G", 0.75), ("A", 0.75), ("D", 0.75)] * 2},
    "with_silence": {"chords": [("N", 1.0), ("F", 2.0), ("N", 1.0), ("Bb", 2.0), ("C", 2.0)]},
    "noisy_20db": {"chords": [("Em", 2.0), ("C", 2.0), ("G", 2.0), ("D", 2.0)], "snr_db": 20.0},
}


def run_synthetic_suite() -> dict[str, dict[str, object]]:
    report: dict[str, dict[str, object]] = {}
    for name, case in SYNTHETIC_SUITE.items():
        chords = case["chords"]
        snr = case.get("snr_db")
        signal, reference = synth_progression(chords, snr_db=snr)  # type: ignore[arg-type]
        predicted = recognize(signal, RATE)
        report[name] = {
            "accuracy": round(overlap_accuracy(reference, predicted), 3),
            "boundaries": {k: round(v, 3) for k, v in asdict(boundary_score(reference, predicted)).items()},
            "segments": len(predicted),
            "reference_segments": len(reference),
        }
    return report


def main() -> None:
    print(json.dumps({"processor": "baseline.chroma-viterbi", "synthetic": run_synthetic_suite()}, indent=2))


if __name__ == "__main__":
    main()
