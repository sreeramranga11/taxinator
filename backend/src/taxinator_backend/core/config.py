"""Application configuration and settings."""

from pydantic import BaseModel

from taxinator_backend.core.models import UserRole


class ServiceMetadata(BaseModel):
    """Identifies the running service instance."""

    name: str = "taxinator-backend"
    version: str = "0.1.0"
    environment: str = "development"
    contact: str = "support@taxinator.local"
    supported_roles: list[UserRole] = list(UserRole)


metadata = ServiceMetadata()
