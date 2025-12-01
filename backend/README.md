# Taxinator Backend

This FastAPI service provides the middleware layer that normalizes, validates, and translates
cost-basis data into tax-engine ready payloads.

## Getting started

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn taxinator_backend.main:app --reload
```

Include the `X-User-Role` header on requests to simulate personas: `admin`, `provider`,
`tax_engine`, or `auditor`.

## Project layout

- `src/taxinator_backend/core`: Configuration, domain models, and shared utilities.
- `src/taxinator_backend/api`: Route definitions and request/response schemas.
- `tests`: Pytest-based automated test suite.

## Key endpoints

- `GET /api/health` – service metadata and uptime check.
- `GET /api/roles` – advertised personas the API understands.
- `GET /api/schema/standard` – contract for normalized transaction payloads.
- `GET /api/templates` – downstream vendor payload templates (FIS/WSC examples).
- `GET /api/playbooks/sample-ingestion` – ready-to-send sample payload to test ingestion.
- `POST /api/ingestions` – accept and normalize transactions from upstream providers.
- `GET /api/jobs` / `GET /api/jobs/{job_id}` – retrieve normalized jobs and warnings.
- `POST /api/jobs/{job_id}/translate` – render payloads for downstream tax engines.

## Personas

- **Provider** – submits cost-basis transactions for normalization.
- **Tax engine** – triggers translations for downstream vendor formats.
- **Admin** – full access for configuration and operational overrides.
- **Auditor** – read-only access for monitoring and reconciliation.
