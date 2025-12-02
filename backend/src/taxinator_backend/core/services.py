"""Domain services for ingestion, validation, transformation, and export."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Dict, List
from uuid import uuid4

from taxinator_backend.core.models import (
    CostBasisIngestRequest,
    ExportReport,
    IngestionResponse,
    IngestionSummary,
    JobRecord,
    JobStatus,
    JobSummary,
    NormalizedTransaction,
    PersonalInfoIngestRequest,
    PersonalInfoRecord,
    ReconciliationReport,
    StartJobRequest,
    StartJobResponse,
    TradesIngestRequest,
    TransformationSummary,
    TranslationPayload,
    TranslationRequest,
    TranslationResponse,
    ValidationIssue,
    ValidationReport,
    VendorTemplate,
)

_JOB_STORE: Dict[str, JobRecord] = {}

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
            "Digital assets require wallet address when provided upstream.",
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


def start_job(request: StartJobRequest) -> StartJobResponse:
    job_id = str(uuid4())
    _JOB_STORE[job_id] = JobRecord(
        job_id=job_id,
        tax_year=request.tax_year,
        vendor_source=request.vendor_source,
        vendor_target=request.vendor_target,
        status=JobStatus.PENDING_UPLOAD,
        normalized=[],
        warnings=[],
        translations={},
        started_by=request.started_by,
    )
    return StartJobResponse(
        job_id=job_id,
        status=JobStatus.PENDING_UPLOAD,
        vendor_source=request.vendor_source,
        vendor_target=request.vendor_target,
        tax_year=request.tax_year,
    )


def _normalize_record(raw: dict) -> NormalizedTransaction:
    mapped = {
        "transaction_id": raw.get("transaction_id") or raw.get("id") or str(uuid4()),
        "account_id": raw.get("account_id") or raw.get("account"),
        "asset_symbol": raw.get("asset_symbol") or raw.get("symbol") or raw.get("asset"),
        "quantity": Decimal(str(raw.get("quantity") or raw.get("qty") or "0")),
        "cost_basis": Decimal(str(raw.get("cost_basis") or raw.get("basis") or "0")),
        "proceeds": Decimal(str(raw.get("proceeds") or raw.get("amount") or "0")),
        "acquisition_date": raw.get("acquisition_date") or raw.get("acquired") or raw.get("open_date"),
        "disposition_date": raw.get("disposition_date") or raw.get("disposed") or raw.get("close_date"),
        "lot_method": raw.get("lot_method") or raw.get("method") or "FIFO",
        "cost_basis_source": raw.get("cost_basis_source"),
        "wallet_address": raw.get("wallet_address"),
        "memo": raw.get("memo") or raw.get("note"),
    }
    return NormalizedTransaction(**mapped)


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


def _detect_missing_fields(raw_records: List[dict]) -> tuple[list[str], list[str]]:
    required = {
        "transaction_id",
        "account_id",
        "asset_symbol",
        "quantity",
        "cost_basis",
        "proceeds",
        "acquisition_date",
        "disposition_date",
    }
    seen_fields = set()
    missing: set[str] = set()
    for record in raw_records:
        seen_fields.update(record.keys())
        for field in required:
            if not record.get(field):
                missing.add(field)
    unexpected = [field for field in seen_fields if field not in required]
    return sorted(missing), unexpected


def _validate_transactions(
    normalized: List[NormalizedTransaction],
    personal_info: List[PersonalInfoRecord],
    vendor_target: str,
) -> ValidationReport:
    errors: List[ValidationIssue] = []
    warnings: List[ValidationIssue] = []
    known_customers = {info.customer_id for info in personal_info}
    for tx in normalized:
        if tx.acquisition_date > tx.disposition_date:
            errors.append(
                ValidationIssue(
                    code="acquisition_after_sale",
                    message="Acquisition date is after sale date.",
                    severity="error",
                    transaction_id=tx.transaction_id,
                    suggestion="Confirm upstream timestamps or lot matching rules.",
                )
            )
        if tx.quantity < Decimal("0"):
            errors.append(
                ValidationIssue(
                    code="negative_quantity",
                    message="Quantity cannot be negative.",
                    severity="error",
                    transaction_id=tx.transaction_id,
                )
            )
        if tx.cost_basis == Decimal("0") and tx.asset_symbol not in {"GIFT", "DONATION"}:
            warnings.append(
                ValidationIssue(
                    code="zero_cost_basis",
                    message="Cost basis is zero for taxable asset.",
                    severity="warning",
                    transaction_id=tx.transaction_id,
                    suggestion="Verify upstream basis or mark as non-taxable.",
                )
            )
        if tx.asset_symbol.upper() in {"BTC", "ETH", "SOL", "USDC"} and not tx.wallet_address:
            warnings.append(
                ValidationIssue(
                    code="missing_wallet_address",
                    message="Digital asset record missing wallet address.",
                    severity="warning",
                    transaction_id=tx.transaction_id,
                    suggestion="Include source wallet for 1099-DA support.",
                )
            )
        if tx.account_id not in known_customers:
            errors.append(
                ValidationIssue(
                    code="unknown_customer",
                    message="Transaction references a customer without personal info upload.",
                    severity="error",
                    transaction_id=tx.transaction_id,
                    suggestion="Upload matching personal-info dataset or fix account id.",
                )
            )
    template = VENDOR_TEMPLATES.get(vendor_target)
    if template and normalized:
        missing_required = [f for f in template.required_fields if f not in normalized[0].model_dump()]
        for field in missing_required:
            errors.append(
                ValidationIssue(
                    code="compatibility_missing_field",
                    message=f"Normalized payload missing field required by {vendor_target}: {field}",
                    severity="error",
                )
            )

    suggested_fixes = [
        "Provide wallet addresses for digital assets.",
        "Ensure every transaction references a customer present in the personal-info upload.",
        "Include acquisition and sale dates in ISO-8601 format.",
    ]
    return ValidationReport(errors=errors, warnings=warnings, suggested_fixes=suggested_fixes)


def ingest_cost_basis(request: CostBasisIngestRequest) -> IngestionResponse:
    job = get_job(request.job_id)
    normalized = [_normalize_record(record) for record in request.records]
    missing, unexpected = _detect_missing_fields(request.records)
    validation_report = _validate_transactions(normalized, job.personal_info, job.vendor_target)
    ingestion_summary = IngestionSummary(
        total_rows=len(request.records),
        malformed_rows=0,
        missing_fields=missing,
        unexpected_fields=unexpected,
        potential_schema_drift=bool(unexpected),
    )
    summary = _compute_summary(normalized)

    job.raw_cost_basis = request.records
    job.normalized = normalized
    job.ingestion_summary = ingestion_summary
    job.validation_report = validation_report
    job.warnings = validation_report.warnings
    job.status = (
        JobStatus.READY_FOR_TRANSFORMATION
        if not validation_report.errors
        else JobStatus.VALIDATION_FAILED
    )
    _JOB_STORE[job.job_id] = job

    return IngestionResponse(
        job_id=job.job_id,
        summary=summary,
        ingestion_summary=ingestion_summary,
        normalized=normalized,
        validation=validation_report,
    )


def ingest_personal_info(request: PersonalInfoIngestRequest) -> dict:
    job = get_job(request.job_id)
    job.personal_info = request.records
    _JOB_STORE[job.job_id] = job
    return {"job_id": job.job_id, "personal_info_records": len(request.records)}


def ingest_trades(request: TradesIngestRequest) -> dict:
    job = get_job(request.job_id)
    job.raw_trades = request.trades
    _JOB_STORE[job.job_id] = job
    return {"job_id": job.job_id, "trades": len(request.trades)}


def transform(job_id: str, request: TranslationRequest | None = None) -> TranslationResponse:
    job = get_job(job_id)
    vendor_key = request.vendor_key if request else job.vendor_target
    template = VENDOR_TEMPLATES.get(vendor_key)
    if not template:
        raise ValueError(f"Unknown vendor template: {vendor_key}")
    payload = _render_translation(job.normalized, template)
    transformation = TransformationSummary(
        tax_year=job.tax_year,
        vendor_key=vendor_key,
        lots_created=len(payload.records),
        wash_sales_detected=sum(1 for tx in job.normalized if "wash" in (tx.memo or "").lower()),
        gain_loss_records=len(payload.records),
        notes=["Applied basic wash-sale detection via memo search", "Rendered vendor-specific schema"],
    )
    job.translations[vendor_key] = payload
    job.transformation = transformation
    job.status = JobStatus.TRANSFORMED
    _JOB_STORE[job.job_id] = job
    return TranslationResponse(
        job_id=job.job_id,
        vendor_key=vendor_key,
        status=job.status,
        payload=payload,
        normalized=job.normalized if request and request.include_normalized else None,
    )


def reconcile(job_id: str) -> ReconciliationReport:
    job = get_job(job_id)
    customer_ids = {info.customer_id for info in job.personal_info}
    mismatches = [tx.account_id for tx in job.normalized if tx.account_id not in customer_ids]
    gain_loss_alignment = job.transformation is not None and job.transformation.gain_loss_records == len(job.normalized)
    report = ReconciliationReport(
        matched_accounts=len(job.normalized) - len(mismatches),
        mismatched_accounts=mismatches,
        gain_loss_alignment=gain_loss_alignment,
        notes=["Compared normalized transactions against uploaded personal-info dataset."],
    )
    job.reconciliation = report
    job.status = JobStatus.READY_FOR_EXPORT if not mismatches else JobStatus.RECONCILIATION_FAILED
    _JOB_STORE[job.job_id] = job
    return report


def export(job_id: str) -> ExportReport:
    job = get_job(job_id)
    export_payload = job.translations.get(job.vendor_target)
    if not export_payload:
        raise ValueError("Job must be transformed before export")
    report = ExportReport(
        format=export_payload.schema_version,
        download_url=f"/api/jobs/{job_id}/output",
        delivered=True,
        webhook_event="job.completed" if job.status != JobStatus.RECONCILIATION_FAILED else "job.needs_review",
    )
    job.export_report = report
    job.status = JobStatus.COMPLETED
    _JOB_STORE[job.job_id] = job
    return report


def _render_translation(normalized: List[NormalizedTransaction], template: VendorTemplate) -> TranslationPayload:
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
                    "wallet": tx.wallet_address,
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


def list_jobs() -> List[JobRecord]:
    return list(_JOB_STORE.values())


def get_job(job_id: str) -> JobRecord:
    if job_id not in _JOB_STORE:
        raise KeyError(job_id)
    return _JOB_STORE[job_id]


def reset_store() -> None:
    _JOB_STORE.clear()

