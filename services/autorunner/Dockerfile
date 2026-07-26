# GPU trial worker for self-hosted machines (poll/claim). Not the Box orchestrator.
#
# Canonical public image lives at:
#   https://github.com/cybertheory/trainfabric-gpu-runner
#
# This Dockerfile is kept for local monorepo builds; prefer the public repo.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY gpu_runner.py /app/gpu_runner.py

ENV WORKDIR=/tmp/tf-runner
ENTRYPOINT ["python3", "/app/gpu_runner.py"]
