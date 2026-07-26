FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Hermes NL agent + duckdb-analytics skill live under app/hermes/
COPY app ./app

# `tf` CLI — Hermes tools shell out to this with request-scoped agent tokens
RUN printf '#!/bin/sh\nexec python -m app.tf_cli "$@"\n' > /usr/local/bin/tf \
    && chmod +x /usr/local/bin/tf

ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV HERMES_SKILLS_DIR=/app/app/hermes/skills
ENV TRAINFABRIC_HERMES_VERSION=5

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
