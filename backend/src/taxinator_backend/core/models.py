"""Domain models for the Taxinator API."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, computed_field


class UserRole(str, Enum):
    """Supported user personas for the service."""

    ADMIN = "admin"
    PROVIDER = "provider"  # upstream cost-basis vendor
    TAX_ENGINE = "tax_engine"  # downstream filing vendor
    AUDITOR = "auditor"  # internal compliance/review


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
    memo: Optional[str] = None


class ValidationWarning(BaseModel):
    """Non-blocking validation warnings for ingestion."""

    code: str
    message: str
    transaction_id: Optional[str] = None


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


class IngestionRequest(BaseModel):
    """Payload accepted from cost-basis vendors."""

    vendor: Party
    payload_source: str = Field(description="Identifier for the upload source or system")
    transactions: List[TransactionInput]
    tags: List[str] | None = None


class IngestionResponse(BaseModel):
    """Result of normalizing a batch of transactions."""

    job_id: str
    summary: JobSummary
    normalized: List[NormalizedTransaction]
    warnings: List[ValidationWarning]


class JobStatus(str, Enum):
    ACCEPTED = "accepted"
    NORMALIZED = "normalized"
    TRANSLATED = "translated"


class JobRecord(BaseModel):
    """Persisted view of a job in memory."""

    job_id: str
    vendor: Party
    payload_source: str
    status: JobStatus
    normalized: List[NormalizedTransaction]
    warnings: List[ValidationWarning]
    tags: List[str]
    translations: Dict[str, "TranslationPayload"]


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
