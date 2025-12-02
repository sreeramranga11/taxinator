from fastapi.testclient import TestClient

from taxinator_backend.core.services import reset_store
from taxinator_backend.main import app


client = TestClient(app)


def setup_function() -> None:  # type: ignore[override]
    reset_store()


def _start_job() -> str:
    response = client.post(
        "/api/jobs/start",
        headers={"X-User-Role": "broker_admin"},
        json={
            "tax_year": 2024,
            "vendor_source": "vendor-one",
            "vendor_target": "fis",
            "started_by": "broker_admin",
        },
    )
    assert response.status_code == 200
    return response.json()["job_id"]


def _upload_personal_info(job_id: str) -> None:
    response = client.post(
        "/api/ingest/personal-info",
        headers={"X-User-Role": "broker_admin"},
        json={
            "job_id": job_id,
            "records": [
                {
                    "customer_id": "ACC-001",
                    "tin": "123-45-6789",
                    "full_name": "Jamie Example",
                    "address": "123 Market St",
                }
            ],
        },
    )
    assert response.status_code == 200


def test_end_to_end_export_flow() -> None:
    job_id = _start_job()
    _upload_personal_info(job_id)

    ingest_response = client.post(
        "/api/ingest/costbasis",
        headers={"X-User-Role": "broker_admin"},
        json={
            "job_id": job_id,
            "records": [
                {
                    "transaction_id": "T-1",
                    "account_id": "ACC-001",
                    "asset_symbol": "AAPL",
                    "quantity": "10",
                    "cost_basis": "1000.00",
                    "proceeds": "1500.00",
                    "acquisition_date": "2023-01-01",
                    "disposition_date": "2023-06-01",
                }
            ],
        },
    )
    assert ingest_response.status_code == 200
    ingest_body = ingest_response.json()
    assert ingest_body["ingestion_summary"]["total_rows"] == 1
    assert ingest_body["validation"]["errors"] == []

    transform_response = client.post(
        f"/api/jobs/{job_id}/transform",
        headers={"X-User-Role": "tax_engine"},
        json={"vendor_key": "fis", "include_normalized": True},
    )
    assert transform_response.status_code == 200

    reconcile_response = client.post(
        f"/api/jobs/{job_id}/reconcile",
        headers={"X-User-Role": "internal_ops"},
    )
    assert reconcile_response.status_code == 200

    export_response = client.post(
        f"/api/jobs/{job_id}/export",
        headers={"X-User-Role": "tax_engine"},
    )
    assert export_response.status_code == 200
    assert export_response.json()["webhook_event"] == "job.completed"


def test_role_enforcement_requires_header() -> None:
    response = client.get("/api/jobs")
    assert response.status_code == 401

