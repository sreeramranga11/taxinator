"""FastAPI route definitions for the tax processor middleware."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from taxinator_backend.core.config import metadata
from taxinator_backend.core.models import (
    AITranslateRequest,
    AITranslateResponse,
    CostBasisIngestRequest,
    IngestionRequest,
    IngestionResponse,
    JobRecord,
    PersonalInfoIngestRequest,
    ReconciliationReport,
    StartJobRequest,
    StartJobResponse,
    TradesIngestRequest,
    TranslationRequest,
    TranslationResponse,
    UserRole,
    VendorTemplate,
)
from taxinator_backend.core.services import (
    VENDOR_TEMPLATES,
    export,
    get_job,
    ingest_legacy,
    ingest_cost_basis,
    ingest_personal_info,
    ingest_trades,
    list_jobs,
    reconcile,
    reset_store,
    start_job,
    transform,
)
from taxinator_backend.core.ai import ai_translate

router = APIRouter()


async def _role_dependency(x_user_role: Annotated[str | None, Header()] = None) -> UserRole:
    if not x_user_role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-User-Role header; specify provider, broker_admin, internal_ops, api_client, or tax_engine.",
        )
    try:
        return UserRole(x_user_role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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


@router.get("/templates", summary="Downstream vendor templates", response_model=list[VendorTemplate])
async def templates() -> list[VendorTemplate]:
    return list(VENDOR_TEMPLATES.values())


@router.post(
    "/ingestions",
    response_model=IngestionResponse,
    summary="Legacy ingestion endpoint (auto-creates a job)",
)
async def legacy_ingestion(
    request: IngestionRequest,
    role: UserRole = Depends(require_role(UserRole.PROVIDER, UserRole.BROKER_ADMIN, UserRole.API_CLIENT)),
) -> IngestionResponse:
    return ingest_legacy(request)


@router.post(
    "/ai/translate",
    response_model=AITranslateResponse,
    summary="AI-assisted translation and validation",
)
async def ai_translate_route(
    request: AITranslateRequest,
    role: UserRole = Depends(require_role(*metadata.supported_roles)),
) -> AITranslateResponse:
    return ai_translate(request)


@router.post("/jobs/start", response_model=StartJobResponse, summary="Start a new tax job")
async def start_tax_job(
    request: StartJobRequest,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.INTERNAL_OPS)),
) -> StartJobResponse:
    return start_job(request)


@router.post(
    "/ingest/costbasis",
    response_model=IngestionResponse,
    summary="Upload cost-basis dataset for a job",
)
async def upload_cost_basis(
    request: CostBasisIngestRequest,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.API_CLIENT)),
) -> IngestionResponse:
    try:
        return ingest_cost_basis(request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post(
    "/ingest/personal-info",
    summary="Upload personal info dataset",
)
async def upload_personal_info(
    request: PersonalInfoIngestRequest,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.API_CLIENT, UserRole.INTERNAL_OPS)),
) -> dict:
    try:
        return ingest_personal_info(request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post("/ingest/trades", summary="Upload trade activity")
async def upload_trades(
    request: TradesIngestRequest,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.API_CLIENT, UserRole.INTERNAL_OPS)),
) -> dict:
    try:
        return ingest_trades(request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.get("/jobs", response_model=list[JobRecord], summary="List jobs")
async def jobs(role: UserRole = Depends(require_role(*metadata.supported_roles))) -> list[JobRecord]:
    return list_jobs()


@router.get("/jobs/{job_id}", response_model=JobRecord, summary="Job detail")
async def job_detail(job_id: str, role: UserRole = Depends(require_role(*metadata.supported_roles))):
    try:
        return get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post(
    "/jobs/{job_id}/transform",
    response_model=TranslationResponse,
    summary="Transform normalized data for Vendor #2",
)
async def transform_job(
    job_id: str,
    request: TranslationRequest,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.INTERNAL_OPS, UserRole.TAX_ENGINE)),
) -> TranslationResponse:
    try:
        return transform(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/jobs/{job_id}/reconcile",
    response_model=ReconciliationReport,
    summary="Reconcile transactions and personal info",
)
async def reconcile_job(
    job_id: str,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.INTERNAL_OPS)),
) -> ReconciliationReport:
    try:
        return reconcile(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post(
    "/jobs/{job_id}/translate",
    response_model=TranslationResponse,
    summary="Legacy translate alias for downstream vendor payload",
)
async def translate_job(
    job_id: str,
    request: TranslationRequest,
    role: UserRole = Depends(require_role(UserRole.TAX_ENGINE, UserRole.BROKER_ADMIN, UserRole.INTERNAL_OPS)),
) -> TranslationResponse:
    try:
        return transform(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/jobs/{job_id}/export",
    summary="Export vendor-ready payload and emit webhook",
)
async def export_job(
    job_id: str,
    role: UserRole = Depends(require_role(UserRole.BROKER_ADMIN, UserRole.TAX_ENGINE)),
):
    try:
        return export(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/jobs/{job_id}/output",
    summary="Retrieve exported payload",
)
async def job_output(job_id: str, role: UserRole = Depends(require_role(*metadata.supported_roles))):
    try:
        job = get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    payload = job.translations.get(job.vendor_target)
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No exported payload available")
    return payload


@router.get(
    "/playbooks/sample-ingestion",
    summary="Provide ready-to-send sample payloads",
)
async def sample_ingestion() -> dict[str, object]:
    sample = {
        "tax_year": 2024,
        "vendor_source": "demo_cost_basis_vendor",
        "vendor_target": "fis",
        "cost_basis": [
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
                "memo": "exercise + sell",
            },
            {
                "transaction_id": "TX-CR-1",
                "account_id": "ACC-002",
                "asset_symbol": "ETH",
                "quantity": "2.5",
                "cost_basis": "3000.00",
                "proceeds": "2800.00",
                "acquisition_date": "2022-05-05",
                "disposition_date": "2024-03-01",
                "wallet_address": "0xabc123",
                "lot_method": "SpecID",
                "memo": "crypto sale",
            },
        ],
        "personal_info": [
            {
                "customer_id": "ACC-001",
                "tin": "123-45-6789",
                "full_name": "Jamie Example",
                "address": "123 Market Street, SF CA",
                "email": "jamie@example.com",
            },
            {
                "customer_id": "ACC-002",
                "tin": "321-54-9876",
                "full_name": "Taylor Ops",
                "address": "500 Mission St, SF CA",
                "email": "taylor@example.com",
            },
        ],
    }
    return {"generated_at": date.today().isoformat(), "payload": sample}


@router.post("/admin/reset", include_in_schema=False)
async def reset(role: UserRole = Depends(require_role(UserRole.INTERNAL_OPS))):
    reset_store()
    return {"status": "reset"}
