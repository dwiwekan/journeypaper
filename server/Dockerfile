# The JourneyPaper API for Cloud Run. Build from server/: docker build -t jp-api server
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv

# Runtime dependencies only (no pytest, no httpx).
COPY requirements.txt .
RUN pip install -r requirements.txt

# Only what the API needs at run time: no tests, no admin scripts, no .env.
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini .

RUN useradd --create-home --uid 10001 app
USER app

# Cloud Run sets PORT; --proxy-headers trusts its X-Forwarded-* headers.
CMD uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers
