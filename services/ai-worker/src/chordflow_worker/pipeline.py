"""CPU mock processor chain (SPEC §11 stages, without audio).

Deterministic for a given job input: it turns user-supplied reference lyrics
into a playable diatonic draft so the whole job → review → publish path can be
exercised without GPU, model weights or audio. Everything it emits is labelled
as synthetic: no confidence values, a `synthetic_output` span per section, and
`decode_and_probe_audio` reported as skipped.

`source_reference` jobs fetch and check their authorized audio (download,
digest, WAV length), then fail with MODEL_UNAVAILABLE: the CPU mock never
pretends to have analysed audio. Recognition arrives with the GPU worker (M8-3).
"""

from __future__ import annotations

import tempfile
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn

from . import __version__
from .artifacts import LocalArtifactStore, cache_key, fingerprint
from .audio import AudioRejected, DownloadedAudio, probe_audio
from .client import ApiError, LeaseLost
from .contracts import (
    PIPELINE_STAGES,
    ArtifactManifestEntry,
    ChartLine,
    ChartSection,
    ChordAnchor,
    ChordEvent,
    ClaimedJob,
    Draft,
    DraftDocument,
    DraftTarget,
    ImportMetadata,
    Instrument,
    JobErrorCode,
    LlmUsage,
    PipelineStage,
    ProcessorInfo,
    QualityReport,
    QualitySpan,
    ReferenceLyricsInput,
    SectionKind,
    StageReport,
    VoicingPolicy,
)
from .graphemes import clusters, is_simple
from .llm import FakeReviewer, FlaggedChord, ReviewOutcome, disabled_review
from .theory import Key, diatonic_triads, is_diatonic, parse_key, secondary_dominant_of_v

MAX_LINE_GRAPHEMES = 200
DEFAULT_KEYS = ("C", "G", "D", "A", "F")
STANDARD_TUNING = ("E2", "A2", "D3", "G3", "B3", "E4")

# Scale-degree pairs per line (1-based degrees), cycled within a section.
PROGRESSIONS: dict[str, tuple[tuple[int, int], ...]] = {
    "verse": ((1, 5), (6, 4)),
    "chorus": ((4, 5), (1, 6)),
}


class JobFailure(Exception):
    """A typed, sanitised failure to report through the worker API."""

    def __init__(self, code: JobErrorCode, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code: JobErrorCode = code
        self.message = message
        self.retryable = retryable


ProgressCallback = Callable[[PipelineStage, float], None]
#: Downloads a job's authorized audio to the given path (WorkerApiClient.download_audio).
AudioFetcher = Callable[[ClaimedJob, Path], DownloadedAudio]


@dataclass(frozen=True)
class PipelineConfig:
    llm_max_calls: int = 4
    worker_version: str = __version__
    fetch_audio: AudioFetcher | None = None


@dataclass(frozen=True)
class PipelineResult:
    processor: ProcessorInfo
    draft: Draft
    artifacts: list[ArtifactManifestEntry]


@dataclass(frozen=True)
class Paragraph:
    kind: SectionKind
    lines: list[str]


def clean_line(line: str) -> str:
    """NFC, tabs as spaces, other control characters removed, trailing space trimmed."""
    text = unicodedata.normalize("NFC", line.replace("\t", " "))
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cc").rstrip()


def split_long(line: str) -> list[str]:
    parts = clusters(line)
    if len(parts) <= MAX_LINE_GRAPHEMES:
        return [line]
    return [
        "".join(parts[i : i + MAX_LINE_GRAPHEMES]).strip()
        for i in range(0, len(parts), MAX_LINE_GRAPHEMES)
    ]


def paragraphs(lyrics: str) -> list[Paragraph]:
    """Blank lines separate sections; a repeated paragraph is the chorus again."""
    blocks: list[list[str]] = [[]]
    for raw in lyrics.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = clean_line(raw)
        if line.strip() == "":
            if blocks[-1]:
                blocks.append([])
        else:
            blocks[-1].extend(split_long(line))
    blocks = [b for b in blocks if b]
    seen: dict[tuple[str, ...], SectionKind] = {}
    out: list[Paragraph] = []
    for block in blocks:
        key = tuple(block)
        kind = seen.get(key)
        if kind is None:
            kind = "verse" if len(seen) % 2 == 0 else "chorus"
            seen[key] = kind
        out.append(Paragraph(kind=kind, lines=block))
    return out


def anchor_offsets(text: str) -> list[int]:
    """Offset 0, plus a mid-line offset (at a word start when there are spaces)."""
    parts = clusters(text)
    if len(parts) < 4 or not is_simple(text):
        return [0]
    mid = len(parts) // 2
    starts = [i for i in range(1, len(parts)) if parts[i - 1] == " " and parts[i] != " "]
    if starts:
        mid = min(starts, key=lambda i: (abs(i - mid), i))
    return [0, mid]


def choose_key(job_input: ReferenceLyricsInput) -> Key:
    if job_input.concertKey is not None:
        return parse_key(job_input.concertKey)
    return parse_key(DEFAULT_KEYS[job_input.seed % len(DEFAULT_KEYS)])


def check_source_audio(
    job: ClaimedJob, config: PipelineConfig, begin: Callable[[PipelineStage], None]
) -> NoReturn:
    """Fetches and checks the job's authorized audio; the mock never invents an analysis."""
    if config.fetch_audio is None:
        raise JobFailure("AUDIO_NOT_AVAILABLE", "這個 worker 無法取得音訊", retryable=False)
    # The audio is private: it exists only in this temporary directory, removed on exit.
    with tempfile.TemporaryDirectory(prefix="chordflow-audio-") as scratch:
        try:
            audio = config.fetch_audio(job, Path(scratch) / "input.audio")
        except LeaseLost:
            raise
        except ApiError as error:
            if error.code == "AUDIO_NOT_AVAILABLE":
                raise JobFailure(
                    "AUDIO_NOT_AVAILABLE", "沒有可分析的授權音訊", retryable=False
                ) from None
            raise JobFailure("INTERNAL_ERROR", "無法取得音訊", retryable=True) from None
        begin("decode_and_probe_audio")
        try:
            probe_audio(audio)
        except AudioRejected as rejected:
            raise JobFailure(rejected.code, rejected.message, retryable=False) from None
    raise JobFailure(
        "MODEL_UNAVAILABLE",
        "已取得並檢查音訊，但 CPU mock 處理器不做音訊辨識；需要 GPU 處理器（M8-3）",
        retryable=False,
    )


def run_mock_pipeline(
    job: ClaimedJob,
    store: LocalArtifactStore,
    config: PipelineConfig,
    on_stage: ProgressCallback,
) -> PipelineResult:
    version = config.worker_version
    stages: list[StageReport] = []
    step = iter(range(len(PIPELINE_STAGES)))

    def begin(stage: PipelineStage) -> None:
        on_stage(stage, next(step) / len(PIPELINE_STAGES))

    def report(stage: PipelineStage, processor_id: str, *, note: str | None = None) -> None:
        stages.append(
            StageReport(
                stage=stage,
                processorId=processor_id,
                processorVersion=version,
                status="skipped" if note is not None else "ok",
                note=note,
            )
        )

    # 1. resolve_source / check_rights
    begin("resolve_source")
    if not isinstance(job.input, ReferenceLyricsInput):
        check_source_audio(job, config, begin)
    job_input = job.input
    sections_in = paragraphs(job_input.lyrics)
    if not sections_in:
        raise JobFailure("SOURCE_UNSUPPORTED", "歌詞是空的", retryable=False)
    key = choose_key(job_input)
    config_hash = fingerprint(
        {"seed": job_input.seed, "key": key.name, "llm": job.options.llmReview}
    )
    input_fp = fingerprint(job_input.model_dump(mode="json"))
    manifest: list[ArtifactManifestEntry] = []

    def store_artifact(
        kind: str, processor_id: str, payload: object, parents: list[ArtifactManifestEntry]
    ) -> ArtifactManifestEntry:
        stored = store.write_json(job.id, job.attempt, kind, payload)
        upstream = fingerprint([p.cacheKey for p in parents]) if parents else input_fp
        entry = ArtifactManifestEntry(
            id=f"art_{job.id}_{kind}",
            kind=kind,  # type: ignore[arg-type]
            cacheKey=cache_key(
                kind=kind,
                input_fingerprint=upstream,
                processor_id=processor_id,
                processor_version=version,
                config_hash=config_hash,
            ),
            storagePath=stored.storage_path,
            contentDigest=stored.content_digest,
            byteSize=stored.byte_size,
            mediaType="application/json",
            parentArtifactIds=[p.id for p in parents],
        )
        manifest.append(entry)
        return entry

    source = store_artifact(
        "source_metadata",
        "mock.source",
        {
            "title": job.title,
            "language": job_input.language,
            "inputKind": job_input.kind,
            "paragraphs": len(sections_in),
            "audio": None,
        },
        [],
    )
    report("resolve_source", "mock.source")

    # 2. decode_and_probe_audio — there is no audio in a reference-lyrics job.
    begin("decode_and_probe_audio")
    report("decode_and_probe_audio", "mock.audio", note="沒有音訊輸入（僅參考歌詞）")

    # 3. chord recognition (synthetic: diatonic progressions, one V/V for review practice)
    begin("chord_recognition")
    triads = diatonic_triads(key)
    secondary = secondary_dominant_of_v(key)
    chords_by_line: list[list[list[str]]] = []
    first_chorus = next((i for i, p in enumerate(sections_in) if p.kind == "chorus"), None)
    for s_index, paragraph in enumerate(sections_in):
        pattern = PROGRESSIONS["chorus" if paragraph.kind == "chorus" else "verse"]
        lines: list[list[str]] = []
        for l_index, _ in enumerate(paragraph.lines):
            first, second = pattern[(l_index + job_input.seed) % len(pattern)]
            lines.append([triads[first - 1], triads[second - 1]])
        chords_by_line.append(lines)
    target_section = first_chorus if first_chorus is not None else len(sections_in) - 1
    target_line = chords_by_line[target_section][-1]
    target_line[-1] = secondary
    intro = [triads[0], triads[4]]
    chords = store_artifact(
        "chord_timeline",
        "mock.chords",
        {"key": key.name, "intro": intro, "lines": chords_by_line, "timebase": None},
        [],
    )
    report("chord_recognition", "mock.chords")

    # 4. lyric alignment (positional only: no audio timebase)
    begin("lyric_alignment")
    anchors = [[anchor_offsets(text) for text in p.lines] for p in sections_in]
    lyrics = store_artifact(
        "aligned_lyrics",
        "mock.lyrics",
        {
            "lines": [
                {"section": s, "line": i, "graphemes": len(clusters(text)), "anchors": a}
                for s, p in enumerate(sections_in)
                for i, (text, a) in enumerate(zip(p.lines, anchors[s], strict=True))
            ],
            "timebase": None,
        },
        [],
    )
    report("lyric_alignment", "mock.lyrics")

    # 5. fusion
    begin("fusion")
    sections: list[ChartSection] = [
        ChartSection(
            id="sec_intro",
            kind="intro",
            lines=[
                ChartLine(
                    id="line_intro",
                    text="",
                    chords=[
                        ChordEvent(id=f"ch_intro_{i + 1}", symbol=symbol, anchor=None)
                        for i, symbol in enumerate(intro)
                    ],
                )
            ],
        )
    ]
    for s_index, paragraph in enumerate(sections_in):
        lines_out: list[ChartLine] = []
        for l_index, text in enumerate(paragraph.lines):
            offsets = anchors[s_index][l_index]
            symbols = chords_by_line[s_index][l_index][: len(offsets)]
            if len(offsets) == 1 and chords_by_line[s_index][l_index][-1] == secondary:
                symbols = [secondary]
            lines_out.append(
                ChartLine(
                    id=f"line_{s_index + 1}_{l_index + 1}",
                    text=text,
                    chords=[
                        ChordEvent(
                            id=f"ch_{s_index + 1}_{l_index + 1}_{c + 1}",
                            symbol=symbol,
                            anchor=ChordAnchor(graphemeOffset=offset),
                        )
                        for c, (symbol, offset) in enumerate(zip(symbols, offsets, strict=False))
                    ],
                )
            )
        sections.append(ChartSection(id=f"sec_{s_index + 1}", kind=paragraph.kind, lines=lines_out))
    document = DraftDocument(
        schemaVersion="1.0.0",
        language=job_input.language,
        title=job.title,
        concertKey=key.name,
        timeSignature=None,
        defaultBpm=None,
        instrument=Instrument(type="guitar", tuning=STANDARD_TUNING),
        sections=sections,
        voicingPolicy=VoicingPolicy(
            mode="recommended", defaultDifficulty="easy", occurrenceOverrides={}
        ),
        importMetadata=ImportMetadata(format="ai_draft", unhandledDirectives=[]),
    )
    store_artifact(
        "fusion_draft",
        "mock.fusion",
        document.model_dump(mode="json", exclude_unset=True),
        [chords, lyrics, source],
    )
    report("fusion", "mock.fusion")

    # 6. rule validator (real checks on the synthetic draft)
    begin("rule_validator")
    spans: list[QualitySpan] = []
    flagged: list[FlaggedChord] = []
    for section in sections:
        spans.append(
            QualitySpan(
                target=DraftTarget(sectionId=section.id, lineId=None, chordId=None),
                reason="synthetic_output",
                message="合成測試輸出：和弦未經音訊分析，需人工確認",
                source="processor",
            )
        )
        for line in section.lines:
            for chord in line.chords:
                if is_diatonic(chord.symbol, key) is False:
                    target = DraftTarget(sectionId=section.id, lineId=line.id, chordId=chord.id)
                    flagged.append(FlaggedChord(target=target, symbol=chord.symbol))
                    spans.append(
                        QualitySpan(
                            target=target,
                            reason="non_diatonic",
                            message=f"{chord.symbol} 不在 {key.name} 調的順階和弦內",
                            source="rule_validator",
                        )
                    )
            if line.text and not is_simple(line.text):
                spans.append(
                    QualitySpan(
                        target=DraftTarget(sectionId=section.id, lineId=line.id, chordId=None),
                        reason="unaligned",
                        message="此行含組合字元或表情符號，只在行首放置和弦",
                        source="rule_validator",
                    )
                )
    report("rule_validator", "rules")

    # 7. optional reviewer
    begin("llm_reviewer")
    review: ReviewOutcome
    if job.options.llmReview == "fake":
        review = FakeReviewer(config.llm_max_calls).review(key, flagged)
        report(
            "llm_reviewer",
            "llm.fake",
            note="已達每個任務的呼叫上限" if review.budget_exceeded else None,
        )
    else:
        review = disabled_review()
        report("llm_reviewer", "llm.disabled", note="未啟用")

    # 8. draft producer
    begin("draft_producer")
    report("draft_producer", "mock.draft")
    quality = QualityReport(
        analysis="synthetic_mock",
        overallConfidence=None,
        spans=spans,
        suggestions=review.suggestions,
        stages=stages,
        llm=LlmUsage(
            provider=review.provider,
            calls=review.calls,
            maxCalls=review.max_calls,
            budgetExceeded=review.budget_exceeded,
        ),
    )
    return PipelineResult(
        processor=ProcessorInfo(id="mock", version=version),
        draft=Draft(document=document, quality=quality),
        artifacts=manifest,
    )
