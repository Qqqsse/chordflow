"""Pydantic mirror of the generation worker contract v1.

The source of truth is the Zod schema in packages/chart-schema/src/generation.ts,
published as OpenAPI components in packages/chart-schema/openapi/openapi.v1.json.
tests/test_contracts.py checks these models against the same fixtures and
against the published JSON Schemas, so drift fails CI on either side.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

CONTRACT_MAJOR = 1

OpaqueId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")]
SemVer = Annotated[str, StringConstraints(pattern=r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")]
LanguageTag = Annotated[str, StringConstraints(pattern=r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")]
KeyName = Annotated[str, StringConstraints(pattern=r"^[A-G](#|b)?m?$")]
PitchName = Annotated[str, StringConstraints(pattern=r"^[A-G](#|b)?-?\d$")]
TimeSignature = Annotated[str, StringConstraints(pattern=r"^([1-9]|[1-3]\d)/(1|2|4|8|16|32)$")]
ChordSymbol = Annotated[
    str, StringConstraints(min_length=1, max_length=32, pattern=r"^[^\s\[\]{}<>\"'`\\]+$")
]
UtcTimestamp = Annotated[
    str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
]
WorkerId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")]
LeaseToken = Annotated[str, StringConstraints(pattern=r"^lease_[0-9a-f]{32}$")]
ProcessorId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")]
ProcessorVersion = Annotated[
    str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._+-]+$")
]
Fingerprint = Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]

JobErrorCode = Literal[
    "SOURCE_NOT_AUTHORIZED",
    "SOURCE_UNSUPPORTED",
    "AUDIO_NOT_AVAILABLE",
    "AUDIO_INVALID",
    "AUDIO_TOO_LONG",
    "ALIGNMENT_LOW_CONFIDENCE",
    "MODEL_UNAVAILABLE",
    "ARTIFACT_VALIDATION_FAILED",
    "LEASE_EXPIRED",
    "RETRY_LIMIT_EXCEEDED",
    "LLM_BUDGET_EXCEEDED",
    "INTERNAL_ERROR",
]
PipelineStage = Literal[
    "resolve_source",
    "decode_and_probe_audio",
    "chord_recognition",
    "lyric_alignment",
    "fusion",
    "rule_validator",
    "llm_reviewer",
    "draft_producer",
]
PIPELINE_STAGES: tuple[PipelineStage, ...] = (
    "resolve_source",
    "decode_and_probe_audio",
    "chord_recognition",
    "lyric_alignment",
    "fusion",
    "rule_validator",
    "llm_reviewer",
    "draft_producer",
)
ProcessorMode = Literal["mock"]
LlmProvider = Literal["disabled", "fake"]
ArtifactKind = Literal[
    "source_metadata",
    "audio_preprocess",
    "separated_stems",
    "chord_timeline",
    "asr_transcript",
    "aligned_lyrics",
    "fusion_draft",
]
SectionKind = Literal[
    "intro",
    "verse",
    "pre_chorus",
    "chorus",
    "bridge",
    "instrumental",
    "interlude",
    "outro",
    "tag",
    "other",
]


class Strict(BaseModel):
    # python-re: the storagePath pattern needs look-ahead, like the TS schema.
    model_config = ConfigDict(extra="forbid", frozen=True, regex_engine="python-re")


# --- job input -------------------------------------------------------------------


class ReferenceLyricsInput(Strict):
    kind: Literal["reference_lyrics"]
    lyrics: str = Field(min_length=1, max_length=5000)
    language: LanguageTag
    concertKey: KeyName | None = None
    seed: int = Field(default=0, ge=0, le=2_147_483_647)


class SourceReferenceInput(Strict):
    kind: Literal["source_reference"]
    sourceReferenceId: OpaqueId


GenerationInput = Annotated[
    ReferenceLyricsInput | SourceReferenceInput, Field(discriminator="kind")
]


class GenerationOptions(Strict):
    processor: ProcessorMode = "mock"
    llmReview: LlmProvider = "disabled"


class ClaimedJob(Strict):
    id: OpaqueId
    contractVersion: SemVer
    attempt: int = Field(ge=1)
    maxAttempts: int = Field(ge=1)
    leaseToken: LeaseToken
    leaseExpiresAt: UtcTimestamp
    title: str = Field(min_length=1, max_length=200)
    input: GenerationInput
    options: GenerationOptions


# --- requests / responses ------------------------------------------------------------


class WorkerClaimRequest(Strict):
    workerId: WorkerId
    workerVersion: ProcessorVersion
    processors: list[ProcessorMode] = Field(min_length=1, max_length=1)
    leaseSeconds: int = Field(default=60, ge=10, le=600)


class WorkerClaimData(Strict):
    job: ClaimedJob | None


class JobProgress(Strict):
    stage: PipelineStage
    fraction: float = Field(ge=0, le=1)


class WorkerHeartbeatRequest(Strict):
    workerId: WorkerId
    leaseToken: LeaseToken
    progress: JobProgress


class WorkerHeartbeatData(Strict):
    leaseExpiresAt: UtcTimestamp


class DraftTarget(Strict):
    sectionId: OpaqueId
    lineId: OpaqueId | None
    chordId: OpaqueId | None


class QualitySpan(Strict):
    target: DraftTarget
    reason: Literal[
        "unaligned", "low_confidence", "non_diatonic", "ambiguous_section", "synthetic_output"
    ]
    message: str = Field(min_length=1, max_length=300)
    source: Literal["processor", "rule_validator", "llm_reviewer"]


class ReviewSuggestion(Strict):
    target: DraftTarget
    kind: Literal["replace_chord", "note"]
    proposedSymbol: ChordSymbol | None
    rationale: str = Field(min_length=1, max_length=500)
    evidence: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(
        max_length=8
    )
    provider: Literal["fake"]


class StageReport(Strict):
    stage: PipelineStage
    processorId: ProcessorId
    processorVersion: ProcessorVersion
    status: Literal["ok", "skipped"]
    note: str | None = Field(max_length=300)


class LlmUsage(Strict):
    provider: LlmProvider
    calls: int = Field(ge=0)
    maxCalls: int = Field(ge=0)
    budgetExceeded: bool


class QualityReport(Strict):
    analysis: Literal["synthetic_mock", "audio"]
    overallConfidence: float | None = Field(ge=0, le=1)
    spans: list[QualitySpan] = Field(max_length=2000)
    suggestions: list[ReviewSuggestion] = Field(max_length=200)
    stages: list[StageReport] = Field(max_length=16)
    llm: LlmUsage

    @model_validator(mode="after")
    def _honest(self) -> QualityReport:
        if self.analysis == "synthetic_mock" and self.overallConfidence is not None:
            raise ValueError("synthetic drafts have no measured confidence; use null")
        if self.llm.calls > self.llm.maxCalls:
            raise ValueError("calls exceed the per-job maximum")
        return self


class ChordAnchor(Strict):
    graphemeOffset: int = Field(ge=0)


class ChordEvent(Strict):
    id: OpaqueId
    symbol: ChordSymbol
    anchor: ChordAnchor | None


class ChartLine(Strict):
    id: OpaqueId
    text: str = Field(max_length=1000)
    chords: list[ChordEvent] = Field(max_length=64)


class ChartSection(Strict):
    id: OpaqueId
    kind: SectionKind
    label: str | None = Field(default=None, min_length=1, max_length=80)
    lines: list[ChartLine] = Field(max_length=400)


class Instrument(Strict):
    type: Literal["guitar"]
    tuning: tuple[PitchName, PitchName, PitchName, PitchName, PitchName, PitchName]


class VoicingPolicy(Strict):
    mode: Literal["recommended", "explicit"]
    defaultDifficulty: Literal["easy", "intermediate", "advanced"]
    symbolDefaults: dict[ChordSymbol, OpaqueId] | None = None
    occurrenceOverrides: dict[OpaqueId, OpaqueId]


class ImportMetadata(Strict):
    format: Literal["native", "chordpro", "ai_draft"]
    unhandledDirectives: list[dict[str, object]] = Field(max_length=500)


class DraftDocument(Strict):
    """Chart Document v1 without server-assigned ids (chartRevisionId, arrangementId, revision)."""

    schemaVersion: SemVer
    language: LanguageTag
    title: str = Field(min_length=1, max_length=200)
    concertKey: KeyName | None
    timeSignature: TimeSignature | None
    defaultBpm: float | None = Field(ge=20, le=400)
    instrument: Instrument
    sections: list[ChartSection] = Field(min_length=1, max_length=200)
    voicingPolicy: VoicingPolicy
    importMetadata: ImportMetadata
    extensions: (
        dict[
            Annotated[
                str,
                StringConstraints(
                    pattern=r"^x-[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$"
                ),
            ],
            object,
        ]
        | None
    ) = None


class ArtifactManifestEntry(Strict):
    id: OpaqueId
    kind: ArtifactKind
    cacheKey: str = Field(min_length=1, max_length=1024)
    storagePath: Annotated[
        str,
        StringConstraints(min_length=1, max_length=512, pattern=r"^(?!/)(?!.*\.\.)[A-Za-z0-9._/-]+$"),
    ]
    contentDigest: Fingerprint
    byteSize: int = Field(ge=0)
    mediaType: Annotated[str, StringConstraints(pattern=r"^[a-z]+/[a-z0-9.+-]+$")]
    parentArtifactIds: list[OpaqueId] = Field(max_length=32)


class ProcessorInfo(Strict):
    id: ProcessorId
    version: ProcessorVersion


class Draft(Strict):
    document: DraftDocument
    quality: QualityReport


class WorkerCompleteRequest(Strict):
    workerId: WorkerId
    leaseToken: LeaseToken
    processor: ProcessorInfo
    draft: Draft
    artifacts: list[ArtifactManifestEntry] = Field(min_length=1, max_length=64)


class WorkerCompleteData(Strict):
    jobId: OpaqueId
    arrangementId: OpaqueId
    revisionId: OpaqueId
    replayed: bool


class WorkerError(Strict):
    code: JobErrorCode
    message: str = Field(min_length=1, max_length=300)
    retryable: bool


class WorkerFailRequest(Strict):
    workerId: WorkerId
    leaseToken: LeaseToken
    error: WorkerError


class WorkerFailData(Strict):
    state: Literal["queued", "failed_terminal"]
    nextAttemptAt: UtcTimestamp | None
    replayed: bool


def contract_major(version: str) -> int:
    return int(version.split(".", 1)[0])
