"""
Pydantic schemas for API key management.

Covers request validation and response serialization for the
CRUD endpoints that let users create, list, update, and revoke
their programmatic API keys.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class CreateApiKeyRequest(BaseModel):
    """Request body for creating a new API key."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Human-readable label for the key, e.g. 'My mobile app'.",
        examples=["My mobile app"],
    )
    scopes: Optional[str] = Field(
        default="read,write",
        description=(
            "Comma-separated list of authorized scopes. "
            "Allowed values: read, write, admin. "
            "Defaults to 'read,write'."
        ),
        examples=["read,write"],
    )
    allowed_domains: Optional[str] = Field(
        default=None,
        description=(
            "Comma-separated list of allowed origins (e.g. 'https://app.example.com'). "
            "Leave null to allow requests from any origin."
        ),
        examples=["https://app.example.com,https://www.example.com"],
    )
    rate_limit: Optional[int] = Field(
        default=60,
        ge=1,
        le=10000,
        description="Maximum number of requests per minute for this key. Defaults to 60.",
        examples=[60],
    )
    expires_at: Optional[datetime] = Field(
        default=None,
        description=(
            "ISO-8601 expiration date-time. "
            "Leave null for a key that never expires."
        ),
        examples=["2027-01-01T00:00:00Z"],
    )

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: Optional[str]) -> Optional[str]:
        """Ensure all scope tokens are from the allowed set."""
        if v is None:
            return v
        allowed = {"read", "write", "admin"}
        tokens = [s.strip() for s in v.split(",") if s.strip()]
        invalid = set(tokens) - allowed
        if invalid:
            raise ValueError(
                f"Invalid scope(s): {', '.join(sorted(invalid))}. "
                f"Allowed values are: {', '.join(sorted(allowed))}."
            )
        return ",".join(tokens)

    class Config:
        json_schema_extra = {
            "example": {
                "name": "My mobile app",
                "scopes": "read,write",
                "allowed_domains": "https://app.example.com",
                "rate_limit": 60,
                "expires_at": None,
            }
        }


class UpdateApiKeyRequest(BaseModel):
    """Request body for partially updating an API key."""

    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="New human-readable label for the key.",
        examples=["Renamed key"],
    )
    scopes: Optional[str] = Field(
        default=None,
        description=(
            "Updated comma-separated list of authorized scopes. "
            "Allowed values: read, write, admin."
        ),
        examples=["read"],
    )
    allowed_domains: Optional[str] = Field(
        default=None,
        description=(
            "Updated comma-separated list of allowed origins. "
            "Pass an empty string to remove domain restrictions."
        ),
        examples=["https://app.example.com"],
    )
    rate_limit: Optional[int] = Field(
        default=None,
        ge=1,
        le=10000,
        description="Updated maximum requests per minute.",
        examples=[120],
    )
    is_active: Optional[bool] = Field(
        default=None,
        description="Set to false to deactivate the key without deleting it.",
        examples=[False],
    )

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: Optional[str]) -> Optional[str]:
        """Ensure all scope tokens are from the allowed set."""
        if v is None:
            return v
        allowed = {"read", "write", "admin"}
        tokens = [s.strip() for s in v.split(",") if s.strip()]
        invalid = set(tokens) - allowed
        if invalid:
            raise ValueError(
                f"Invalid scope(s): {', '.join(sorted(invalid))}. "
                f"Allowed values are: {', '.join(sorted(allowed))}."
            )
        return ",".join(tokens)

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Renamed key",
                "is_active": False,
            }
        }


class ApiKeyResponse(BaseModel):
    """
    Serialized API key — safe for listing.

    The secret key hash is never exposed; only the prefix
    (first 16 characters of the original key) is included
    so users can identify which key is which.
    """

    id: str = Field(description="Unique API key identifier (UUID).")
    name: str = Field(description="Human-readable label.")
    key_prefix: str = Field(
        description="First 16 characters of the key for identification (e.g. 'giga_pk_xxxxxxxx')."
    )
    scopes: List[str] = Field(description="List of authorized scopes.")
    allowed_domains: Optional[List[str]] = Field(
        default=None,
        description="List of allowed origin domains, or null if unrestricted.",
    )
    rate_limit: int = Field(description="Maximum requests per minute.")
    is_active: bool = Field(description="Whether the key is currently active.")
    last_used_at: Optional[datetime] = Field(
        default=None, description="Timestamp of the last successful use."
    )
    expires_at: Optional[datetime] = Field(
        default=None, description="Expiration date-time, or null if the key never expires."
    )
    created_at: datetime = Field(description="Creation timestamp.")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "My mobile app",
                "key_prefix": "giga_pk_abcdefgh",
                "scopes": ["read", "write"],
                "allowed_domains": ["https://app.example.com"],
                "rate_limit": 60,
                "is_active": True,
                "last_used_at": None,
                "expires_at": None,
                "created_at": "2026-01-01T12:00:00Z",
            }
        }


class CreateApiKeyResponse(BaseModel):
    """
    Response returned once when an API key is created.

    The ``key`` field contains the full plaintext key and is shown
    **only this one time** — it is never retrievable again.
    """

    key: str = Field(
        description=(
            "Full plaintext API key — store this securely. "
            "It will NOT be shown again."
        ),
        examples=["giga_pk_AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
    )
    api_key: ApiKeyResponse = Field(description="Persisted API key metadata.")

    class Config:
        json_schema_extra = {
            "example": {
                "key": "giga_pk_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
                "api_key": {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "My mobile app",
                    "key_prefix": "giga_pk_AbCdEfGh",
                    "scopes": ["read", "write"],
                    "allowed_domains": None,
                    "rate_limit": 60,
                    "is_active": True,
                    "last_used_at": None,
                    "expires_at": None,
                    "created_at": "2026-01-01T12:00:00Z",
                },
            }
        }
