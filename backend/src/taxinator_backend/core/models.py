"""Domain models for the Taxinator API."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, computed_field


class UserRole(str, Enum):
    """Supported user personas for the service."""

    BROKER_ADMIN = "broker_admin"
    INTERNAL_OPS = "internal_ops"
    API_CLIENT = "api_client"
    TAX_ENGINE = "tax_engine"


class Party(BaseModel):
    """Represents an actor or vendor in the pipeline."""

    name: str
    kind: str = Field(description="Examples: broker, exchange, tax_engine, cost_basis")
    contact: Optional[str] = None


class TransactionInput(BaseModel):
    """Raw transaction from a cost-basis provider."""

    transaction_id: str
    account_id: str
    asset_symbol: str
    quantity: Decimal
    cost_basis: Decimal
    proceeds: Decimal
    acquisition_date: date
    disposition_date: date
    lot_method: str = Field(
        default="FIFO",
        description="Accounting method used by the provider (FIFO/LIFO/Specific Identification)",
    )
    cost_basis_source: Optional[str] = None
    wallet_address: Optional[str] = Field(default=None, description="Digital asset source wallet")
    memo: Optional[str] = None


class ValidationIssue(BaseModel):
    """A structured validation issue used for errors and warnings."""

    code: str
    message: str
    severity: str = Field(description="error or warning")
    transaction_id: Optional[str] = None
    suggestion: Optional[str] = None


class NormalizedTransaction(TransactionInput):
    """Transaction enriched with middleware-derived fields."""

    @computed_field
    @property
    def gain_loss(self) -> Decimal:
        return self.proceeds - self.cost_basis

    @computed_field
    @property
    def holding_period_days(self) -> int:
        return (self.disposition_date - self.acquisition_date).days

    @computed_field
    @property
    def treatment(self) -> str:
        return "short_term" if self.holding_period_days < 365 else "long_term"


class JobSummary(BaseModel):
    """Aggregated rollups for an ingestion job."""

    total_transactions: int
    total_proceeds: Decimal
    total_cost_basis: Decimal
    total_gain_loss: Decimal
    short_term_count: int
    long_term_count: int


class IngestionSummary(BaseModel):
    """Captures ingestion level statistics and schema observations."""

    total_rows: int
    malformed_rows: int
    missing_fields: List[str]
    unexpected_fields: List[str]
    potential_schema_drift: bool


class PersonalInfoRecord(BaseModel):
    """PII details required for filings."""

    customer_id: str
    tin: str
    full_name: str
    address: str
    email: Optional[str] = None
    phone: Optional[str] = None


class IngestionRequest(BaseModel):
    """Payload accepted from cost-basis vendors."""

    vendor: Party
    payload_source: str = Field(description="Identifier for the upload source or system")
    transactions: List[TransactionInput]
    tags: List[str] | None = None


class CostBasisIngestRequest(BaseModel):
    """Cost-basis upload payload for a specific job."""

    job_id: str
    vendor_format: Optional[str] = None
    records: List[dict]


class PersonalInfoIngestRequest(BaseModel):
    """Personal info upload payload."""

    job_id: str
    records: List[PersonalInfoRecord]


class TradesIngestRequest(BaseModel):
    """Optional supplementary trade history ingest."""

    job_id: str
    trades: List[dict]


class IngestionResponse(BaseModel):
    """Result of normalizing a batch of transactions."""

    job_id: str
    summary: JobSummary
    ingestion_summary: IngestionSummary
    normalized: List[NormalizedTransaction]
    validation: "ValidationReport"


class JobStatus(str, Enum):
    PENDING_UPLOAD = "pending_upload"
    INGESTED = "ingested"
    VALIDATION_FAILED = "validation_failed"
    READY_FOR_TRANSFORMATION = "ready_for_transformation"
    TRANSFORMED = "transformed"
    READY_FOR_EXPORT = "ready_for_export"
    RECONCILIATION_FAILED = "reconciliation_failed"
    COMPLETED = "completed"


class ValidationReport(BaseModel):
    """Structured validation results for a job."""

    errors: List[ValidationIssue]
    warnings: List[ValidationIssue]
    suggested_fixes: List[str]


class TransformationSummary(BaseModel):
    """Captures output of the transformation step."""

    tax_year: int
    vendor_key: str
    lots_created: int
    wash_sales_detected: int
    gain_loss_records: int
    notes: List[str] = []


class ReconciliationReport(BaseModel):
    """Reconciliation results between datasets."""

    matched_accounts: int
    mismatched_accounts: List[str]
    gain_loss_alignment: bool
    notes: List[str]


class ExportReport(BaseModel):
    """Final export details and webhook events."""

    format: str
    download_url: str
    delivered: bool
    webhook_event: str


class JobRecord(BaseModel):
    """Persisted view of a job in memory."""

    job_id: str
    tax_year: int
    vendor_source: str
    vendor_target: str
    status: JobStatus
    normalized: List[NormalizedTransaction]
    warnings: List[ValidationIssue]
    ingestion_summary: Optional[IngestionSummary] = None
    validation_report: Optional[ValidationReport] = None
    transformation: Optional[TransformationSummary] = None
    reconciliation: Optional[ReconciliationReport] = None
    export_report: Optional[ExportReport] = None
    translations: Dict[str, "TranslationPayload"]
    personal_info: List[PersonalInfoRecord] = []
    raw_cost_basis: List[dict] = []
    raw_trades: List[dict] = []
    started_by: UserRole


class StartJobRequest(BaseModel):
    """Initialize a new job before uploads arrive."""

    tax_year: int
    vendor_source: str
    vendor_target: str
    started_by: UserRole


class StartJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    vendor_source: str
    vendor_target: str
    tax_year: int


class VendorTemplate(BaseModel):
    """Describes a downstream tax engine payload contract."""

    vendor_key: str
    display_name: str
    version: str
    format: str = Field(description="Examples: json, csv, xml")
    required_fields: List[str]
    mapping_notes: List[str]


class TranslationRequest(BaseModel):
    """Request to translate a job into a downstream payload."""

    vendor_key: str
    include_normalized: bool = False


class TranslationPayload(BaseModel):
    """Payload produced for a downstream tax engine."""

    vendor_key: str
    exported_at: date
    records: List[dict]
    schema_version: str
    human_readable: Optional[str] = None


class TranslationResponse(BaseModel):
    """Response envelope for translation results."""

    job_id: str
    vendor_key: str
    status: JobStatus
    payload: TranslationPayload
    normalized: List[NormalizedTransaction] | None = None
