"""
Pydantic schemas for API key management.

Covers request validation and response serialization for the
CRUD endpoints that let users create, list, update, and revoke
their programmatic API keys.
"""

from datetime import datetime

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
    scopes: str | None = Field(
        default="read,write",
        description=(
            "Comma-separated list of authorized scopes. "
            "Allowed values: read, write, admin. "
            "Defaults to 'read,write'."
        ),
        examples=["read,write"],
    )
    allowed_domains: str | None = Field(
        default=None,
        description=(
            "Comma-separated list of allowed origins (e.g. 'https://app.example.com'). "
            "Leave null to allow requests from any origin."
        ),
        examples=["https://app.example.com,https://www.example.com"],
    )
    rate_limit: int | None = Field(
        default=60,
        ge=1,
        le=10000,
        description="Maximum number of requests per minute for this key. Defaults to 60.",
        examples=[60],
    )
    expires_at: datetime | None = Field(
        default=None,
        description=(
            "ISO-8601 expiration date-time. "
            "Leave null for a key that never expires."
        ),
        examples=["2027-01-01T00:00:00Z"],
    )

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: str | None) -> str | None:
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

    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="New human-readable label for the key.",
        examples=["Renamed key"],
    )
    scopes: str | None = Field(
        default=None,
        description=(
            "Updated comma-separated list of authorized scopes. "
            "Allowed values: read, write, admin."
        ),
        examples=["read"],
    )
    allowed_domains: str | None = Field(
        default=None,
        description=(
            "Updated comma-separated list of allowed origins. "
            "Pass an empty string to remove domain restrictions."
        ),
        examples=["https://app.example.com"],
    )
    rate_limit: int | None = Field(
        default=None,
        ge=1,
        le=10000,
        description="Updated maximum requests per minute.",
        examples=[120],
    )
    is_active: bool | None = Field(
        default=None,
        description="Set to false to deactivate the key without deleting it.",
        examples=[False],
    )

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: str | None) -> str | None:
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

    The ``publishable_key_prefix`` exposes the beginning of the
    publishable key (``giga_pub_*``) which is safe for client-side use.
    """

    id: str = Field(description="Unique API key identifier (UUID).")
    name: str = Field(description="Human-readable label.")
    key_prefix: str = Field(
        description="First 16 characters of the secret key for identification (e.g. 'giga_pk_xxxxxxxx')."
    )
    publishable_key_prefix: str | None = Field(
        default=None,
        description="First 20 characters of the publishable key (e.g. 'giga_pub_xxxxxxxxxx').",
    )
    scopes: list[str] = Field(description="List of authorized scopes.")
    allowed_domains: list[str] | None = Field(
        default=None,
        description="List of allowed origin domains, or null if unrestricted.",
    )
    rate_limit: int = Field(description="Maximum requests per minute.")
    is_active: bool = Field(description="Whether the key is currently active.")
    last_used_at: datetime | None = Field(
        default=None, description="Timestamp of the last successful use."
    )
    expires_at: datetime | None = Field(
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
                "publishable_key_prefix": "giga_pub_abcdefghij",
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

    The ``key`` field contains the full plaintext secret key and is shown
    **only this one time** — it is never retrievable again.

    The ``publishable_key`` is safe to embed in client-side code
    and is always retrievable via the ``publishable_key_prefix``.
    """

    key: str = Field(
        description=(
            "Full plaintext secret API key — store this securely. "
            "It will NOT be shown again."
        ),
        examples=["giga_pk_AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
    )
    publishable_key: str = Field(
        description=(
            "Full plaintext publishable key — safe to use in client-side code. "
            "Use this in the embed widget SDK."
        ),
        examples=["giga_pub_AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
    )
    api_key: ApiKeyResponse = Field(description="Persisted API key metadata.")

    class Config:
        json_schema_extra = {
            "example": {
                "key": "giga_pk_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
                "publishable_key": "giga_pub_XyZaBcDeFgHiJkLmNoPqRsTuVwXy012345",
                "api_key": {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "My mobile app",
                    "key_prefix": "giga_pk_AbCdEfGh",
                    "publishable_key_prefix": "giga_pub_XyZaBcDeFg",
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


class RegenerateKeyResponse(BaseModel):
    """Response returned when a key is regenerated."""

    key: str = Field(
        description="The newly generated key in plaintext — store securely. Shown only once."
    )
    api_key: ApiKeyResponse = Field(description="Updated API key metadata.")
