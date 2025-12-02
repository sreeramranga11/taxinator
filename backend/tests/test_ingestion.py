from fastapi.testclient import TestClient

from taxinator_backend.core.services import reset_store
from taxinator_backend.main import app

client = TestClient(app)


def setup_function() -> None:  # type: ignore[override]
    reset_store()


def _sample_payload() -> dict:
    return {
        "vendor": {"name": "Example Vendor", "kind": "cost_basis"},
        "payload_source": "unit-test",
        "tags": ["test"],
        "transactions": [
            {
                "transaction_id": "T-1",
                "account_id": "A-1",
                "asset_symbol": "AAPL",
                "quantity": "5",
                "cost_basis": "500.00",
                "proceeds": "650.00",
                "acquisition_date": "2023-01-01",
                "disposition_date": "2023-06-01",
            },
            {
                "transaction_id": "T-2",
                "account_id": "A-2",
                "asset_symbol": "BTC",
                "quantity": "0.5",
                "cost_basis": "10000.00",
                "proceeds": "9000.00",
                "acquisition_date": "2021-01-05",
                "disposition_date": "2024-01-05",
            },
        ],
    }


def test_ingestion_normalizes_and_summarizes() -> None:
    response = client.post(
        "/api/ingestions",
        headers={"X-User-Role": "provider"},
        json=_sample_payload(),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["total_transactions"] == 2
    assert data["summary"]["short_term_count"] == 1
    assert data["summary"]["long_term_count"] == 1
    assert data["warnings"] == []


def test_translation_generates_vendor_payload() -> None:
    ingest_response = client.post(
        "/api/ingestions",
        headers={"X-User-Role": "provider"},
        json=_sample_payload(),
    )
    job_id = ingest_response.json()["job_id"]

    translate_response = client.post(
        f"/api/jobs/{job_id}/translate",
        headers={"X-User-Role": "tax_engine"},
        json={"vendor_key": "fis", "include_normalized": True},
    )

    assert translate_response.status_code == 200
    body = translate_response.json()
    assert body["payload"]["vendor_key"] == "fis"
    assert body["payload"]["records"][0]["asset"] == "AAPL"
    assert body["normalized"] is not None


def test_role_enforcement_requires_header() -> None:
    response = client.get("/api/jobs")
    assert response.status_code == 401
