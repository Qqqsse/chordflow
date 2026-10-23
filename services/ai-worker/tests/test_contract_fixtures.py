"""Cross-language contract check: the published JSON Schemas (generated from the
TS Zod schemas) accept every valid fixture and reject structural-invalid cases.

Semantic invariants (unique ids, grapheme bounds, NFC, monotonic tracks) are not
expressible in JSON Schema; the worker re-implements the ones it needs (M7).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parents[3]
SCHEMAS = REPO / "packages" / "chart-schema" / "json-schema"
FIXTURES = REPO / "fixtures"


def load(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def validator(name: str) -> Draft202012Validator:
    schema = load(SCHEMAS / name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


CHART = validator("chart-document.v1.schema.json")
SYNC = validator("recording-sync.v1.schema.json")
CATALOG = validator("catalog-snapshot.v1.schema.json")


def ids(paths: list[Path]) -> list[str]:
    return [p.name for p in paths]


VALID_CHARTS = sorted((FIXTURES / "charts").glob("*.chart.json"))
VALID_SYNCS = sorted((FIXTURES / "ai").glob("*.sync.json"))
INVALID_CHARTS = sorted((FIXTURES / "charts" / "invalid").glob("*.case.json"))
INVALID_SYNCS = sorted((FIXTURES / "ai" / "invalid").glob("*.case.json"))


def test_fixture_sets_are_not_empty() -> None:
    assert len(VALID_CHARTS) >= 3
    assert len(VALID_SYNCS) >= 2
    assert len(INVALID_CHARTS) >= 15
    assert len(INVALID_SYNCS) >= 5


@pytest.mark.parametrize("path", VALID_CHARTS, ids=ids(VALID_CHARTS))
def test_valid_chart_fixture(path: Path) -> None:
    CHART.validate(load(path))


@pytest.mark.parametrize("path", VALID_SYNCS, ids=ids(VALID_SYNCS))
def test_valid_sync_fixture(path: Path) -> None:
    SYNC.validate(load(path))


def test_catalog_snapshot_fixture() -> None:
    CATALOG.validate(load(FIXTURES / "contracts" / "catalog-demo.json"))


@pytest.mark.parametrize(
    ("path", "schema"),
    [(p, CHART) for p in INVALID_CHARTS] + [(p, SYNC) for p in INVALID_SYNCS],
    ids=ids(INVALID_CHARTS) + ids(INVALID_SYNCS),
)
def test_invalid_case_layer(path: Path, schema: Draft202012Validator) -> None:
    case = load(path)
    assert isinstance(case, dict)
    errors = list(schema.iter_errors(case["document"]))
    if case["layer"] == "structural":
        assert errors, f"{path.name} should fail JSON Schema validation"
    else:
        assert not errors, f"{path.name} is semantic-only but failed JSON Schema: {errors[0].message}"
