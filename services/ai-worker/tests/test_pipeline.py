"""Mock processor chain: deterministic, honest about being synthetic, contract-valid."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from chordflow_worker.artifacts import LocalArtifactStore
from chordflow_worker.contracts import (
    PIPELINE_STAGES,
    ClaimedJob,
    WorkerClaimData,
    WorkerCompleteRequest,
)
from chordflow_worker.pipeline import (
    JobFailure,
    PipelineConfig,
    anchor_offsets,
    paragraphs,
    run_mock_pipeline,
)

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "fixtures" / "contracts" / "worker"
GOLDEN = FIXTURES / "mock-complete.golden.json"
OPENAPI = json.loads(
    (REPO / "packages" / "chart-schema" / "openapi" / "openapi.v1.json").read_text("utf-8")
)
COMPLETE_SCHEMA = Draft202012Validator(OPENAPI["components"]["schemas"]["WorkerCompleteRequest"])


def fixture_job(**changes: object) -> ClaimedJob:
    data = json.loads((FIXTURES / "claim-response.json").read_text("utf-8"))
    job = WorkerClaimData.model_validate(data).job
    assert job is not None
    return job.model_copy(update=changes) if changes else job


def run(job: ClaimedJob, tmp_path: Path, max_calls: int = 4):
    stages: list[tuple[str, float]] = []
    result = run_mock_pipeline(
        job,
        LocalArtifactStore(tmp_path),
        PipelineConfig(llm_max_calls=max_calls, worker_version="0.1.0"),
        lambda stage, fraction: stages.append((stage, fraction)),
    )
    request = WorkerCompleteRequest(
        workerId="cpu-mock-1",
        leaseToken=job.leaseToken,
        processor=result.processor,
        draft=result.draft,
        artifacts=result.artifacts,
    )
    return request, stages


def test_output_is_contract_valid_and_matches_golden(tmp_path: Path) -> None:
    request, stages = run(fixture_job(), tmp_path)
    payload = request.model_dump(mode="json", exclude_unset=True)
    COMPLETE_SCHEMA.validate(payload)
    assert [s for s, _ in stages] == list(PIPELINE_STAGES)
    assert [f for _, f in stages] == sorted(f for _, f in stages)
    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    # The TS side validates this golden file semantically (generation.test.ts).
    assert payload == json.loads(GOLDEN.read_text("utf-8"))


def test_is_deterministic_and_writes_the_manifest(tmp_path: Path) -> None:
    first, _ = run(fixture_job(), tmp_path / "a")
    second, _ = run(fixture_job(), tmp_path / "b")
    assert first == second
    for entry in first.artifacts:
        stored = (tmp_path / "a" / entry.storagePath).read_bytes()
        assert len(stored) == entry.byteSize
        assert entry.storagePath.startswith(f"jobs/{first_job_id()}/1/")
    kinds = [a.kind for a in first.artifacts]
    assert kinds == ["source_metadata", "chord_timeline", "aligned_lyrics", "fusion_draft"]
    fusion = first.artifacts[-1]
    assert set(fusion.parentArtifactIds) == {a.id for a in first.artifacts[:-1]}


def first_job_id() -> str:
    return fixture_job().id


def test_is_honest_about_being_synthetic(tmp_path: Path) -> None:
    request, _ = run(fixture_job(), tmp_path)
    quality = request.draft.quality
    assert quality.analysis == "synthetic_mock"
    assert quality.overallConfidence is None
    audio = next(s for s in quality.stages if s.stage == "decode_and_probe_audio")
    assert audio.status == "skipped"
    sections = {s.id for s in request.draft.document.sections}
    synthetic = {s.target.sectionId for s in quality.spans if s.reason == "synthetic_output"}
    assert synthetic == sections


def test_rule_validator_and_fake_reviewer(tmp_path: Path) -> None:
    request, _ = run(fixture_job(), tmp_path)
    quality = request.draft.quality
    flagged = [s for s in quality.spans if s.reason == "non_diatonic"]
    assert len(flagged) == 1 and flagged[0].message.startswith("D ")
    assert quality.llm.model_dump() == {
        "provider": "fake",
        "calls": 1,
        "maxCalls": 4,
        "budgetExceeded": False,
    }
    [suggestion] = quality.suggestions
    assert suggestion.target == flagged[0].target
    assert suggestion.proposedSymbol == "Dm"
    # Suggestions never change the draft.
    chords = {
        ch.id: ch.symbol
        for s in request.draft.document.sections
        for line in s.lines
        for ch in line.chords
    }
    assert chords[flagged[0].target.chordId or ""] == "D"


def test_llm_disabled_and_budget(tmp_path: Path) -> None:
    disabled = fixture_job(options=fixture_job().options.model_copy(update={"llmReview": "disabled"}))
    request, _ = run(disabled, tmp_path / "off")
    assert request.draft.quality.suggestions == []
    assert request.draft.quality.llm.provider == "disabled"
    no_budget, _ = run(fixture_job(), tmp_path / "budget", max_calls=0)
    assert no_budget.draft.quality.llm.budgetExceeded is True
    assert no_budget.draft.quality.llm.calls == 0
    assert no_budget.draft.quality.suggestions == []


def test_source_reference_jobs_fail_without_authorized_audio(tmp_path: Path) -> None:
    job = fixture_job()
    source_job = ClaimedJob.model_validate(
        {
            **job.model_dump(mode="json"),
            "input": {"kind": "source_reference", "sourceReferenceId": "src_demo_1"},
        }
    )
    with pytest.raises(JobFailure) as info:
        run(source_job, tmp_path)
    assert info.value.code == "AUDIO_NOT_AVAILABLE"
    assert info.value.retryable is False


def test_paragraphs_repeat_choruses_and_clean_text() -> None:
    lyrics = "A line\r\nB\tline\x07\n\n副歌一句\n\nC line\n\n副歌一句\n"
    result = paragraphs(lyrics)
    assert [p.kind for p in result] == ["verse", "chorus", "verse", "chorus"]
    assert result[0].lines == ["A line", "B line"]


def test_anchor_offsets() -> None:
    assert anchor_offsets("清晨的風吹過小路") == [0, 4]
    assert anchor_offsets("walk along the road") == [0, 11]
    assert anchor_offsets("短句") == [0]
    # After NFC "é" is one code point, so the line stays simple.
    assert anchor_offsets("caf\u00e9 au lait") == [0, 5]
    assert anchor_offsets("一起唱 \U0001f44d\U0001f3fd 好") == [0]


def test_line_with_emoji_is_flagged_and_text_is_nfc(tmp_path: Path) -> None:
    lyrics = "Cafe\u0301 au lait le matin\n\n一起唱 \U0001f44d\U0001f3fd 好不好"
    job = fixture_job(input=fixture_job().input.model_copy(update={"lyrics": lyrics}))
    request, _ = run(job, tmp_path)
    unaligned = [s for s in request.draft.quality.spans if s.reason == "unaligned"]
    assert [s.target.lineId for s in unaligned] == ["line_2_1"]
    verse, chorus = request.draft.document.sections[1:]
    assert verse.lines[0].text == "Caf\u00e9 au lait le matin"  # NFC
    assert [c.anchor.graphemeOffset for c in chorus.lines[0].chords if c.anchor] == [0]
