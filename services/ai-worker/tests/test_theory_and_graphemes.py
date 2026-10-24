import pytest

from chordflow_worker.graphemes import clusters, is_simple
from chordflow_worker.theory import (
    diatonic_triads,
    is_diatonic,
    parse_key,
    scale,
    secondary_dominant_of_v,
)


@pytest.mark.parametrize(
    ("key", "triads"),
    [
        ("C", ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]),
        ("D", ["D", "Em", "F#m", "G", "A", "Bm", "C#dim"]),
        ("F", ["F", "Gm", "Am", "Bb", "C", "Dm", "Edim"]),
        ("Eb", ["Eb", "Fm", "Gm", "Ab", "Bb", "Cm", "Ddim"]),
        ("Am", ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]),
        ("F#m", ["F#m", "G#dim", "A", "Bm", "C#m", "D", "E"]),
        ("Ebm", ["Ebm", "Fdim", "Gb", "Abm", "Bbm", "Cb", "Db"]),
    ],
)
def test_spelled_diatonic_triads(key: str, triads: list[str]) -> None:
    assert diatonic_triads(parse_key(key)) == triads


def test_scale_uses_each_letter_once() -> None:
    assert scale(parse_key("F#")) == ["F#", "G#", "A#", "B", "C#", "D#", "E#"]


def test_non_diatonic_detection() -> None:
    c_major = parse_key("C")
    assert secondary_dominant_of_v(c_major) == "D"
    assert is_diatonic("D", c_major) is False
    assert is_diatonic("Dm", c_major) is True
    assert is_diatonic("G7", c_major) is None  # outside what the mock rule checks


@pytest.mark.parametrize(
    ("text", "count", "simple"),
    [
        ("清晨的風", 4, True),
        ("sweet home", 10, True),
        ("e\u0301te\u0301", 3, False),  # combining accents (NFD)
        ("👍🏽 ok", 4, False),  # emoji + skin tone modifier
        ("👨‍👩‍👧", 1, False),  # ZWJ family
        ("🇹🇼🇯🇵", 2, False),  # regional indicator pairs
    ],
)
def test_clusters(text: str, count: int, simple: bool) -> None:
    assert len(clusters(text)) == count
    assert is_simple(text) is simple
