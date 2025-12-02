# Taxinator Frontend

A React + Vite dashboard that demonstrates how broker admins, internal ops, API clients, and tax
engines interact with the middleware API.

## Getting started

```bash
npm install
npm run dev
```

The UI expects the FastAPI backend to be running locally at `/api`. For each request the app
sends a role header to mimic personas (`broker_admin`, `internal_ops`, `api_client`, `tax_engine`).

## Features

- Health panel to verify the backend is reachable.
- Job creation form for tax year + vendor selections.
- Editors preloaded with sample personal-info and cost-basis payloads for ingestion.
- Validation, transformation, reconciliation, and export controls per job.
- Job list with statuses plus vendor template viewer to understand required fields and mapping notes.
