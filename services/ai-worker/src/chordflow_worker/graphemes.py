"""Conservative grapheme clustering (the stdlib has no UAX #29 segmenter).

Clusters join a base character with following combining marks, variation
selectors, emoji modifiers, ZWJ sequences and regional-indicator pairs. The
mock chain only places a chord inside a line when every cluster is a single
code point, where this count is exactly the grapheme count the server uses.
"""

from __future__ import annotations

import unicodedata

ZWJ = "‍"


def _extends(ch: str) -> bool:
    cp = ord(ch)
    return (
        unicodedata.category(ch) in ("Mn", "Me", "Mc")
        or 0xFE00 <= cp <= 0xFE0F
        or 0xE0100 <= cp <= 0xE01EF
        or 0x1F3FB <= cp <= 0x1F3FF
        or 0xE0020 <= cp <= 0xE007F
    )


def _regional(ch: str) -> bool:
    return 0x1F1E6 <= ord(ch) <= 0x1F1FF


def clusters(text: str) -> list[str]:
    out: list[str] = []
    for ch in text:
        if out and (_extends(ch) or ch == ZWJ or out[-1].endswith(ZWJ)):
            out[-1] += ch
        elif out and _regional(ch) and len(out[-1]) == 1 and _regional(out[-1]):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def is_simple(text: str) -> bool:
    """Every cluster is one code point, so offsets are unambiguous."""
    return all(len(cluster) == 1 for cluster in clusters(text))
