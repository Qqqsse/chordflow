"""Optional structured reviewer (SPEC §11 `llm_reviewer`).

Reviewers return suggestions with rationale and evidence; they never edit the
draft. Only `disabled` and the deterministic `fake` provider exist in v1, so
tests and CI can never spend money. Every call is counted against a per-job
maximum and the reviewer stops (budgetExceeded) instead of overspending.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .contracts import DraftTarget, LlmProvider, ReviewSuggestion
from .theory import CHORD_PATTERN, Key, diatonic_triads


@dataclass(frozen=True)
class FlaggedChord:
    target: DraftTarget
    symbol: str


@dataclass
class ReviewOutcome:
    provider: LlmProvider
    calls: int
    max_calls: int
    budget_exceeded: bool
    suggestions: list[ReviewSuggestion] = field(default_factory=list)


def disabled_review() -> ReviewOutcome:
    return ReviewOutcome("disabled", 0, 0, False)


class FakeReviewer:
    """Deterministic stand-in for an LLM: proposes the diatonic triad on the same root."""

    def __init__(self, max_calls: int) -> None:
        self.max_calls = max_calls

    def review(self, key: Key | None, flagged: list[FlaggedChord]) -> ReviewOutcome:
        if self.max_calls < 1:
            return ReviewOutcome("fake", 0, self.max_calls, True)
        by_root: dict[str, str] = {}
        if key is not None:
            for triad in diatonic_triads(key):
                match = CHORD_PATTERN.match(triad)
                if match is not None:
                    by_root[match.group(1)] = triad
        suggestions: list[ReviewSuggestion] = []
        for item in flagged:
            match = CHORD_PATTERN.match(item.symbol)
            proposal = by_root.get(match.group(1)) if match is not None else None
            if key is None or proposal is None or proposal == item.symbol:
                continue
            suggestions.append(
                ReviewSuggestion(
                    target=item.target,
                    kind="replace_chord",
                    proposedSymbol=proposal,
                    rationale=(
                        f"{item.symbol} 不在 {key.name} 調的順階和弦內；可考慮改為 {proposal}。"
                        "這是測試用的假審查器，僅供參考，不會自動套用。"
                    ),
                    evidence=["rule_validator: non_diatonic", f"concertKey: {key.name}"],
                    provider="fake",
                )
            )
        return ReviewOutcome("fake", 1, self.max_calls, False, suggestions)
