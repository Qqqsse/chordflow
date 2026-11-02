"""The Pydantic models accept/reject the same fixtures as the TS Zod schemas, and
agree with the published OpenAPI components field by field."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import BaseModel, ValidationError

from chordflow_worker import contracts as c
from chordflow_worker.artifacts import cache_key

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "fixtures" / "contracts" / "worker"
OPENAPI = json.loads(
    (REPO / "packages" / "chart-schema" / "openapi" / "openapi.v1.json").read_text("utf-8")
)
COMPONENTS: dict[str, dict] = OPENAPI["components"]["schemas"]


def load(name: str) -> object:
    return json.loads((FIXTURES / name).read_text("utf-8"))


def component_validator(name: str) -> Draft202012Validator:
    schema = COMPONENTS[name]
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


MODELS: dict[str, type[BaseModel]] = {
    "WorkerClaimRequest": c.WorkerClaimRequest,
    "WorkerHeartbeatRequest": c.WorkerHeartbeatRequest,
    "WorkerCompleteRequest": c.WorkerCompleteRequest,
    "WorkerFailRequest": c.WorkerFailRequest,
}

VALID = [
    ("claim-request.json", c.WorkerClaimRequest, "WorkerClaimRequest"),
    ("heartbeat-request.json", c.WorkerHeartbeatRequest, "WorkerHeartbeatRequest"),
    ("complete-request.json", c.WorkerCompleteRequest, "WorkerCompleteRequest"),
    ("fail-request.json", c.WorkerFailRequest, "WorkerFailRequest"),
    ("claim-response.json", c.WorkerClaimData, None),
    ("claim-response-empty.json", c.WorkerClaimData, None),
]


@pytest.mark.parametrize(("name", "model", "component"), VALID, ids=[v[0] for v in VALID])
def test_valid_fixture(name: str, model: type[BaseModel], component: str | None) -> None:
    payload = load(name)
    parsed = model.model_validate(payload)
    # Round trip: what the worker would send is what the fixture says.
    assert parsed.model_dump(mode="json", exclude_unset=True) == payload
    if component is not None:
        component_validator(component).validate(payload)


def test_claim_response_matches_openapi() -> None:
    schema = COMPONENTS["WorkerClaimResponse"]
    envelope = {"data": load("claim-response.json"), "meta": {"requestId": "r", "schemaVersion": "1.0.0"}}
    Draft202012Validator(schema).validate(envelope)


INVALID = sorted((FIXTURES / "invalid").glob("*.case.json"))


@pytest.mark.parametrize("path", INVALID, ids=[p.name for p in INVALID])
def test_invalid_fixture(path: Path) -> None:
    case = json.loads(path.read_text("utf-8"))
    with pytest.raises(ValidationError):
        MODELS[case["schema"]].model_validate(case["payload"])
    errors = list(component_validator(case["schema"]).iter_errors(case["payload"]))
    if case["layer"] == "structural":
        assert errors, f"{path.name} should fail JSON Schema validation"
    else:
        # Cross-field rules are not expressible in JSON Schema; both models enforce them.
        assert not errors, errors[0].message


def _properties(schema: dict) -> set[str]:
    return set(schema.get("properties", {}))


@pytest.mark.parametrize("name", sorted(MODELS))
def test_model_fields_match_openapi(name: str) -> None:
    assert set(MODELS[name].model_fields) == _properties(COMPONENTS[name])


def test_nested_quality_and_document_fields_match_openapi() -> None:
    complete = COMPONENTS["WorkerCompleteRequest"]["properties"]
    draft = complete["draft"]["properties"]
    assert set(c.QualityReport.model_fields) == _properties(draft["quality"])
    assert set(c.DraftDocument.model_fields) == _properties(draft["document"])
    assert set(c.ArtifactManifestEntry.model_fields) == _properties(complete["artifacts"]["items"])


def test_enumerations_match_openapi() -> None:
    fail = COMPONENTS["WorkerFailRequest"]["properties"]["error"]["properties"]
    assert set(fail["code"]["enum"]) == set(c.JobErrorCode.__args__)
    progress = COMPONENTS["WorkerHeartbeatRequest"]["properties"]["progress"]["properties"]
    assert list(progress["stage"]["enum"]) == list(c.PIPELINE_STAGES)


def test_cache_key_matches_typescript_fixture() -> None:
    fixture = load("cache-key.json")
    assert isinstance(fixture, dict)
    p = fixture["parts"]
    assert (
        cache_key(
            kind=p["kind"],
            input_fingerprint=p["inputFingerprint"],
            processor_id=p["processorId"],
            processor_version=p["processorVersion"],
            config_hash=p["configHash"],
            schema_version=p["schemaVersion"],
        )
        == fixture["key"]
    )


def test_audio_download_headers_match_openapi() -> None:
    operation = OPENAPI["paths"]["/worker/jobs/{id}/audio"]["get"]
    request_headers = {p["name"] for p in operation["parameters"] if p["in"] == "header"}
    assert request_headers == {c.WORKER_AUDIO_HEADERS["workerId"], c.WORKER_AUDIO_HEADERS["leaseToken"]}
    response_headers = operation["responses"]["200"]["headers"]
    assert set(response_headers) == {
        c.WORKER_AUDIO_HEADERS["sha256"],
        c.WORKER_AUDIO_HEADERS["format"],
        c.WORKER_AUDIO_HEADERS["maxDurationSeconds"],
    }
    assert tuple(response_headers[c.WORKER_AUDIO_HEADERS["format"]]["schema"]["enum"]) == c.AUDIO_FORMATS
