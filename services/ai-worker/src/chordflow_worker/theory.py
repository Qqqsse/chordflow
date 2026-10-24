"""Just enough spelled diatonic harmony for the mock chain and the rule validator.

This is not a general music-theory engine (that lives in packages/music-theory);
it only spells the seven diatonic triads of a key so that generated chords and
the non-diatonic check use correct note names (e.g. F#m in D, Bb in F).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

LETTERS = "CDEFGAB"
NATURAL_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACCIDENTALS = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}

MAJOR_STEPS = (0, 2, 4, 5, 7, 9, 11)
MAJOR_QUALITIES = ("", "m", "m", "", "", "m", "dim")
MINOR_STEPS = (0, 2, 3, 5, 7, 8, 10)
MINOR_QUALITIES = ("m", "dim", "", "m", "m", "", "")

KEY_PATTERN = re.compile(r"^([A-G])(#|b)?(m)?$")


@dataclass(frozen=True)
class Key:
    tonic: str
    minor: bool

    @property
    def name(self) -> str:
        return f"{self.tonic}{'m' if self.minor else ''}"


def parse_key(name: str) -> Key:
    match = KEY_PATTERN.match(name)
    if match is None:
        raise ValueError(f"not a key name: {name!r}")
    return Key(tonic=match.group(1) + (match.group(2) or ""), minor=match.group(3) == "m")


def _pc(note: str) -> int:
    pc = NATURAL_PC[note[0]]
    for ch in note[1:]:
        pc += 1 if ch == "#" else -1
    return pc % 12


def scale(key: Key) -> list[str]:
    """Spelled scale degrees 1–7 (each letter used once)."""
    steps = MINOR_STEPS if key.minor else MAJOR_STEPS
    start = LETTERS.index(key.tonic[0])
    tonic_pc = _pc(key.tonic)
    notes = []
    for degree, step in enumerate(steps):
        letter = LETTERS[(start + degree) % 7]
        offset = (tonic_pc + step - NATURAL_PC[letter]) % 12
        if offset > 6:
            offset -= 12
        notes.append(letter + ACCIDENTALS[offset])
    return notes


def diatonic_triads(key: Key) -> list[str]:
    qualities = MINOR_QUALITIES if key.minor else MAJOR_QUALITIES
    return [root + quality for root, quality in zip(scale(key), qualities, strict=True)]


def secondary_dominant_of_v(key: Key) -> str:
    """V/V: a major triad on scale degree 2 (non-diatonic in major keys)."""
    return scale(key)[1]


CHORD_PATTERN = re.compile(r"^([A-G](?:#|b)?)(m|dim)?$")


def is_diatonic(symbol: str, key: Key) -> bool | None:
    """True/False for plain triads; None when the symbol is outside what this module checks."""
    if CHORD_PATTERN.match(symbol) is None:
        return None
    return symbol in diatonic_triads(key)
