# Taxinator

A backend + Next.js (web) project for a middleware platform that standardizes cost-basis data
and delivers tax-engine ready payloads.

## Purpose

Taxinator sits between upstream cost-basis providers and downstream tax engines. It normalizes
inconsistent payloads, enforces validation, reconciles identities, and produces vendor-ready export
formats with webhook signals for downstream processing.

## Pain points it solves

- **Fragmented provider formats** – maps heterogeneous CSV/JSON inputs into a consistent normalized model.
- **Validation gaps** – catches missing fields, date/order errors, and vendor-specific requirements up front.
- **Reconciliation friction** – aligns cost-basis feeds with personal info to avoid export failures.
- **Vendor sprawl** – renders downstream payloads (e.g., FIS, WSC) from a single normalized job store.
- **Operational visibility** – surfaces job status, warnings, and export readiness via API + UI.
- **AI-assisted translation** – paste any payload and let the agent draft a translation plan plus validation checks.

## AI agent translator (new)

```
┌───────────────┐  Paste JSON/text  ┌──────────────┐  Plan + checks + draft  ┌──────────────┐
│ Your payload  │ ────────────────► │ AI agent API │ ───────────────────────►│ Vendor-ready │
│ (file/text)   │                   │              │                         │ draft payload│
└───────────────┘                   └──────────────┘                         └──────────────┘
```

- Enable with `OPENAI_API_KEY` in `.env`.
- Frontend surfaces an “AI translator & planner” panel to make this the primary workflow.

## System shape (text diagrams)

Ingestion and validation flow:

```
┌───────────────────┐    POST /api/ingest/*     ┌───────────────────┐
│ Cost-basis vendor │ ────────────────────────► │  Taxinator API    │
│  (CSV/JSON/etc.)  │                           │ (normalize +      │
└───────────────────┘ ◄──────────────────────── │  validate)        │
                 ▲   Validation errors/warnings └───────────────────┘
                 │                                  │
                 │        Normalized + summary      ▼
                 │                            ┌──────────────┐
                 └────────────────────────────│ Job store    │
                                              │ (normalized, │
                                              │  warnings)   │
                                              └──────────────┘
```

Transformation and export flow:

```
┌──────────────┐     /api/jobs/{id}/transform       ┌─────────────────────┐
│ Job store    │ ─────────────────────────────────► │ Vendor-specific     │
│ (normalized) │                                    │ payload (FIS/WSC)   │
└──────────────┘ ◄──────────────────────────────────└─────────────────────┘
            │                /api/jobs/{id}/export            │
            │                                                 ▼
            └─────────────────────────────────────────┌────────────────┐
                                                      │ Webhook event  │
                                                      │ + download URL │
                                                      └────────────────┘
```

Reconciliation loop:

```
┌─────────────────────┐     /api/ingest/personal-info      ┌──────────────┐
│ PII upload (CSV/JS) │ ─────────────────────────────────► │ Job store    │
└─────────────────────┘                                    │ (accounts)   │
          ▲                                                └──────────────┘
          │     /api/jobs/{id}/reconcile       mismatches / alignment
          └───────────────────────────────────────────────────────────────► READY or NEEDS_REVIEW
```

## Structure

- `backend/`: FastAPI service for ingesting, validating, and transforming cost-basis data.
- `web/`: Next.js + Tailwind UI with Tammy (AI) and manual flows.

## Getting started

- Backend: see `backend/README.md` (uvicorn, API keys, etc.).
- Web app: see `web/README.md` (Next.js dev server, env vars like `NEXT_PUBLIC_API_BASE`).

Note: The older `frontend/` (Vite) directory was used for testing/validation but is superseded by `web/`.
