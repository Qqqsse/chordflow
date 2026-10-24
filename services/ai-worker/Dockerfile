# syntax=docker/dockerfile:1.7
# CPU-only worker image. GPU inference uses a separate pinned CUDA image (M8), never this one.
ARG PYTHON_IMAGE=python:3.12-slim-bookworm

FROM ${PYTHON_IMAGE} AS build
WORKDIR /src
COPY pyproject.toml ./
COPY src ./src
RUN pip wheel --no-cache-dir --wheel-dir /wheels .

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
ENV WORKER_ARTIFACT_DIR=/var/lib/chordflow/artifacts
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /var/lib/chordflow/artifacts \
    && chown worker:worker /var/lib/chordflow/artifacts
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl && rm -rf /wheels
USER worker
VOLUME ["/var/lib/chordflow/artifacts"]
# Polls the web app's worker API; `chordflow-worker check` validates configuration only.
CMD ["chordflow-worker", "run"]
