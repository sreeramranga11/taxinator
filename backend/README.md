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

## Project layout

- `src/taxinator_backend/core`: Configuration, domain models, and shared utilities.
- `src/taxinator_backend/api`: Route definitions and request/response schemas.
- `tests`: Pytest-based automated test suite.
