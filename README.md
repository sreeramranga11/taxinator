# Taxinator

A dual frontend and backend project for a middleware platform that standardizes cost-basis data
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
- `frontend/`: React + Vite dashboard for configuring integrations and monitoring pipelines.

## Getting started

Each workspace can be bootstrapped independently. Refer to the README within `backend/` and
`frontend/` for environment-specific instructions.
