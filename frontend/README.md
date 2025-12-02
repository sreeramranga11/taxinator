# Taxinator Frontend

A React + Vite dashboard that demonstrates how providers, auditors, and tax engines would
interact with the middleware API.

## Getting started

```bash
npm install
npm run dev
```

The UI expects the FastAPI backend to be running locally at `/api`. For each request the app
sends a role header to mimic personas (provider, admin, tax_engine, auditor).

## Features

- Health panel to verify the backend is reachable.
- Editor preloaded with the backend's sample ingestion payload for quick normalization tests.
- Job list with translation trigger to downstream vendors (FIS/WSC examples).
- Vendor template viewer to understand required fields and mapping notes.
