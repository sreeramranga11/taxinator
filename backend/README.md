# Taxinator Backend

This FastAPI service provides the middleware layer that normalizes, validates, reconciles, and
translates cost-basis + personal info data into tax-engine ready payloads.

## Getting started

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn taxinator_backend.main:app --reload
```

Include the `X-User-Role` header on requests to simulate personas: `broker_admin`, `internal_ops`,
`api_client`, or `tax_engine`.

## Project layout

- `src/taxinator_backend/core`: Configuration, domain models, and shared utilities.
- `src/taxinator_backend/api`: Route definitions and request/response schemas.
- `tests`: Pytest-based automated test suite.

## Key endpoints

- `GET /api/health` – service metadata and uptime check.
- `GET /api/roles` – advertised personas the API understands.
- `GET /api/templates` – downstream vendor payload templates (FIS/WSC examples).
- `POST /api/jobs/start` – create a new job (tax year + vendors) with status `pending_upload`.
- `POST /api/ingest/personal-info` – upload PII/identity records for a job.
- `POST /api/ingest/costbasis` – upload cost-basis payloads; auto-normalizes + validates.
- `POST /api/ingest/trades` – upload optional trade history for reconciliation.
- `POST /api/jobs/{job_id}/transform` – convert normalized data into Vendor #2 format.
- `POST /api/jobs/{job_id}/reconcile` – reconcile transactions with PII and totals.
- `POST /api/jobs/{job_id}/export` – deliver vendor-ready payload + webhook event.
- `GET /api/jobs` / `GET /api/jobs/{job_id}` – retrieve job status and reports.

## Personas

- **Broker admin** – uploads cost basis + PII and triggers the job pipeline.
- **Internal ops** – views ingestion logs, reprocesses, reconciles, and manages mappings.
- **API client** – headless ingestion for partner automation.
- **Tax engine** – triggers transformations/exports to Vendor #2.
