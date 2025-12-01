"""Domain services for ingestion, normalization, and translation."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Dict, List
from uuid import uuid4

from taxinator_backend.core.models import (
    IngestionRequest,
    IngestionResponse,
    JobRecord,
    JobStatus,
    JobSummary,
    NormalizedTransaction,
    TranslationPayload,
    TranslationRequest,
    TranslationResponse,
    ValidationWarning,
    VendorTemplate,
)

# In-memory job store for demonstration purposes
_JOB_STORE: Dict[str, JobRecord] = {}

# Supported downstream vendors (would be dynamic or DB-backed in production)
VENDOR_TEMPLATES: Dict[str, VendorTemplate] = {
    "fis": VendorTemplate(
        vendor_key="fis",
        display_name="FIS Tax Gateway",
        version="2024.1",
        format="json",
        required_fields=["account_id", "asset_symbol", "quantity", "proceeds", "cost_basis"],
        mapping_notes=[
            "FIS expects monetary values as decimal strings with two places.",
            "Short-term vs long-term drives their Box 1b mapping for 1099-B.",
        ],
    ),
    "wsc": VendorTemplate(
        vendor_key="wsc",
        display_name="WSC Reporting",
        version="2023.4",
        format="csv",
        required_fields=["transaction_id", "treatment", "gain_loss", "disposition_date"],
        mapping_notes=[
            "CSV must retain vendor-provided transaction IDs for reconciliation.",
            "Long-term lots require supplemental statement if proceeds exceed $1M.",
        ],
    ),
}


def _compute_summary(normalized: List[NormalizedTransaction]) -> JobSummary:
    total_proceeds = sum((tx.proceeds for tx in normalized), start=Decimal("0"))
    total_cost = sum((tx.cost_basis for tx in normalized), start=Decimal("0"))
    total_gain_loss = sum((tx.gain_loss for tx in normalized), start=Decimal("0"))
    short_term_count = sum(1 for tx in normalized if tx.treatment == "short_term")
    long_term_count = sum(1 for tx in normalized if tx.treatment == "long_term")

    return JobSummary(
        total_transactions=len(normalized),
        total_proceeds=total_proceeds,
        total_cost_basis=total_cost,
        total_gain_loss=total_gain_loss,
        short_term_count=short_term_count,
        long_term_count=long_term_count,
    )


def _validate_transactions(transactions: List[NormalizedTransaction]) -> List[ValidationWarning]:
    warnings: List[ValidationWarning] = []
    seen_ids: set[str] = set()
    for tx in transactions:
        if tx.transaction_id in seen_ids:
            warnings.append(
                ValidationWarning(
                    code="duplicate_transaction_id",
                    message="Duplicate transaction IDs detected; downstream vendors require uniqueness.",
                    transaction_id=tx.transaction_id,
                )
            )
        seen_ids.add(tx.transaction_id)

        if tx.holding_period_days < 0:
            warnings.append(
                ValidationWarning(
                    code="negative_holding_period",
                    message="Disposition precedes acquisition date; verify upstream timestamps.",
                    transaction_id=tx.transaction_id,
                )
            )

        if tx.proceeds < Decimal("0") or tx.cost_basis < Decimal("0"):
            warnings.append(
                ValidationWarning(
                    code="negative_amount",
                    message="Negative proceeds or cost basis detected; vendor requires signed abs values.",
                    transaction_id=tx.transaction_id,
                )
            )

    return warnings


def ingest(request: IngestionRequest) -> IngestionResponse:
    """Normalize and store a new ingestion job."""

    normalized = [NormalizedTransaction(**tx.model_dump()) for tx in request.transactions]
    warnings = _validate_transactions(normalized)
    job_id = str(uuid4())
    summary = _compute_summary(normalized)

    record = JobRecord(
        job_id=job_id,
        vendor=request.vendor,
        payload_source=request.payload_source,
        status=JobStatus.NORMALIZED,
        normalized=normalized,
        warnings=warnings,
        tags=request.tags or [],
        translations={},
    )
    _JOB_STORE[job_id] = record

    return IngestionResponse(job_id=job_id, summary=summary, normalized=normalized, warnings=warnings)


def list_jobs() -> List[JobRecord]:
    return list(_JOB_STORE.values())


def get_job(job_id: str) -> JobRecord:
    if job_id not in _JOB_STORE:
        raise KeyError(job_id)
    return _JOB_STORE[job_id]


def translate(job_id: str, request: TranslationRequest) -> TranslationResponse:
    job = get_job(job_id)
    template = VENDOR_TEMPLATES.get(request.vendor_key)
    if not template:
        raise ValueError(f"Unknown vendor template: {request.vendor_key}")

    payload = _render_translation(job.normalized, template)
    job.translations[template.vendor_key] = payload
    job.status = JobStatus.TRANSLATED
    _JOB_STORE[job_id] = job

    return TranslationResponse(
        job_id=job.job_id,
        vendor_key=template.vendor_key,
        status=job.status,
        payload=payload,
        normalized=job.normalized if request.include_normalized else None,
    )


def _render_translation(
    normalized: List[NormalizedTransaction], template: VendorTemplate
) -> TranslationPayload:
    """Create vendor-specific payloads from normalized data."""

    records: List[dict] = []
    for tx in normalized:
        if template.vendor_key == "fis":
            records.append(
                {
                    "accountId": tx.account_id,
                    "asset": tx.asset_symbol,
                    "proceeds": f"{tx.proceeds:.2f}",
                    "costBasis": f"{tx.cost_basis:.2f}",
                    "gainLoss": f"{tx.gain_loss:.2f}",
                    "treatment": tx.treatment,
                    "acquired": tx.acquisition_date.isoformat(),
                    "disposed": tx.disposition_date.isoformat(),
                    "lotMethod": tx.lot_method,
                }
            )
        elif template.vendor_key == "wsc":
            records.append(
                {
                    "id": tx.transaction_id,
                    "symbol": tx.asset_symbol,
                    "quantity": str(tx.quantity),
                    "treatment": tx.treatment,
                    "gainLoss": str(tx.gain_loss),
                    "dispositionDate": tx.disposition_date.isoformat(),
                    "memo": tx.memo or "",
                }
            )
        else:
            records.append(tx.model_dump())

    human_readable = _summarize(records, template.vendor_key)
    return TranslationPayload(
        vendor_key=template.vendor_key,
        exported_at=date.today(),
        records=records,
        schema_version=template.version,
        human_readable=human_readable,
    )


def _summarize(records: List[dict], vendor_key: str) -> str:
    count = len(records)
    sample = records[0] if records else {}
    return f"{vendor_key.upper()} payload with {count} record(s); sample: {sample}" if records else "no records"


def reset_store() -> None:
    """Utility for tests to clear in-memory state."""

    _JOB_STORE.clear()

