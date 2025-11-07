"""FastAPI route definitions."""

from fastapi import APIRouter

from taxinator_backend.core.config import metadata

router = APIRouter()


@router.get("/health", summary="Health check")
async def health_check() -> dict[str, str]:
    """Return service metadata for uptime monitoring."""

    return {
        "service": metadata.name,
        "version": metadata.version,
        "environment": metadata.environment,
        "status": "ok",
    }
