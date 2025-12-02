"""FastAPI route definitions."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from taxinator_backend.core.config import metadata
from taxinator_backend.core.models import (
    IngestionRequest,
    IngestionResponse,
    JobRecord,
    TranslationRequest,
    TranslationResponse,
    UserRole,
    VendorTemplate,
)
from taxinator_backend.core.services import VENDOR_TEMPLATES, get_job, ingest, list_jobs, translate

router = APIRouter()


async def _role_dependency(x_user_role: Annotated[str | None, Header()] = None) -> UserRole:
    if not x_user_role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-User-Role header; specify admin, provider, tax_engine, or auditor.",
        )
    try:
        role = UserRole(x_user_role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return role


def require_role(*allowed: UserRole):
    async def _verify(role: UserRole = Depends(_role_dependency)) -> UserRole:
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role.value}' is not permitted for this operation",
            )
        return role

    return _verify


@router.get("/health", summary="Health check")
async def health_check() -> dict[str, str]:
    """Return service metadata for uptime monitoring."""

    return {
        "service": metadata.name,
        "version": metadata.version,
        "environment": metadata.environment,
        "contact": metadata.contact,
        "status": "ok",
    }


@router.get("/roles", summary="List supported personas")
async def supported_roles() -> dict[str, list[str]]:
    return {"roles": [role.value for role in metadata.supported_roles]}


@router.get("/schema/standard", summary="Describe normalized transaction schema")
async def standard_schema() -> dict[str, list[dict[str, str]]]:
    schema = [
        {"field": "transaction_id", "type": "string", "required": "yes", "notes": "Vendor provided"},
        {"field": "asset_symbol", "type": "string", "required": "yes", "notes": "Ticker or token"},
        {"field": "quantity", "type": "decimal", "required": "yes", "notes": "Up to 10 decimal places"},
        {"field": "cost_basis", "type": "decimal", "required": "yes", "notes": "USD"},
        {"field": "proceeds", "type": "decimal", "required": "yes", "notes": "USD"},
        {"field": "acquisition_date", "type": "date", "required": "yes", "notes": "ISO-8601"},
        {"field": "disposition_date", "type": "date", "required": "yes", "notes": "ISO-8601"},
        {"field": "lot_method", "type": "string", "required": "no", "notes": "FIFO/LIFO/SpecID"},
        {"field": "memo", "type": "string", "required": "no", "notes": "Optional context"},
    ]
    return {"fields": schema}


@router.get("/templates", summary="Downstream vendor templates", response_model=list[VendorTemplate])
async def templates() -> list[VendorTemplate]:
    return list(VENDOR_TEMPLATES.values())


@router.post(
    "/ingestions",
    summary="Ingest and normalize cost-basis transactions",
    response_model=IngestionResponse,
)
async def ingest_transactions(
    request: IngestionRequest, role: UserRole = Depends(require_role(UserRole.ADMIN, UserRole.PROVIDER))
) -> IngestionResponse:
    return ingest(request)


@router.get(
    "/jobs",
    summary="List ingestion jobs",
    response_model=list[JobRecord],
)
async def jobs(role: UserRole = Depends(require_role(UserRole.ADMIN, UserRole.AUDITOR, UserRole.TAX_ENGINE))):
    return list_jobs()


@router.get(
    "/jobs/{job_id}",
    summary="Fetch a single job",
    response_model=JobRecord,
)
async def job_detail(job_id: str, role: UserRole = Depends(require_role(*metadata.supported_roles))):
    try:
        return get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post(
    "/jobs/{job_id}/translate",
    summary="Translate normalized data for a downstream vendor",
    response_model=TranslationResponse,
)
async def translate_job(
    job_id: str,
    request: TranslationRequest,
    role: UserRole = Depends(require_role(UserRole.ADMIN, UserRole.TAX_ENGINE)),
) -> TranslationResponse:
    try:
        return translate(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/playbooks/sample-ingestion",
    summary="Provide a ready-to-send sample payload",
)
async def sample_ingestion() -> dict[str, object]:
    sample = {
        "vendor": {"name": "Upstream Cost Basis", "kind": "cost_basis", "contact": "vendor@cb.io"},
        "payload_source": "sandbox-upload",
        "tags": ["demo", "equities"],
        "transactions": [
            {
                "transaction_id": "TX-1001",
                "account_id": "ACC-001",
                "asset_symbol": "AAPL",
                "quantity": "10",
                "cost_basis": "1200.00",
                "proceeds": "1500.00",
                "acquisition_date": "2023-01-10",
                "disposition_date": "2023-09-20",
                "lot_method": "FIFO",
                "memo": "Exercise + sell",
            },
            {
                "transaction_id": "TX-1002",
                "account_id": "ACC-002",
                "asset_symbol": "ETH",
                "quantity": "2.5",
                "cost_basis": "3000.00",
                "proceeds": "2800.00",
                "acquisition_date": "2022-05-05",
                "disposition_date": "2024-03-01",
                "lot_method": "SpecID",
                "memo": "Crypto sale",
            },
        ],
    }
    return {"generated_at": date.today().isoformat(), "payload": sample}

