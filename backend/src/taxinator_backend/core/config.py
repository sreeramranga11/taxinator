"""Application configuration and settings."""

from pydantic import BaseModel


class ServiceMetadata(BaseModel):
    """Identifies the running service instance."""

    name: str = "taxinator-backend"
    version: str = "0.1.0"
    environment: str = "development"


metadata = ServiceMetadata()
