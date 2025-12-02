"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from taxinator_backend.api.routes import router
from taxinator_backend.core.config import metadata

app = FastAPI(
    title="Taxinator API",
    description=(
        "Middleware service that normalizes cost-basis data and prepares it for downstream "
        "tax engines."
    ),
    version=metadata.version,
)

# Allow local frontend origins (dev + preview) to call the API directly without CORS failures.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    """Default index route with lightweight service description."""

    return {
        "message": "Welcome to the Taxinator API",
        "documentation": "/docs",
    }
