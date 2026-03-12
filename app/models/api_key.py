"""
SQLAlchemy model for API key management.

Provides persistent storage for external API access keys,
with hashed key storage, scope control, rate limiting, and expiration.
"""

from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.database import Base


class ApiKey(Base):
    """
    External API access key.

    Allows users to create named API keys for programmatic access.
    The full key is shown only once at creation time; only its SHA-256
    hash is persisted. The prefix (e.g. "giga_pk_abc") lets users
    identify a key without exposing the secret.
    """

    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(
        String(255), nullable=False
    )  # Human-readable label, e.g. "Mon app mobile"
    key_prefix: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # First 16 chars of the key for identification, e.g. "giga_pk_AbCdEfGh"
    key_hash: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True
    )  # SHA-256 of the full key — never store the plaintext
    scopes: Mapped[str] = mapped_column(
        Text, nullable=False, default="read,write"
    )  # Comma-separated list of authorised scopes
    allowed_domains: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Comma-separated list of allowed origins for CORS, NULL means unrestricted
    rate_limit: Mapped[int] = mapped_column(
        Integer, nullable=False, default=60
    )  # Maximum requests per minute
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # NULL means the key never expires
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_api_keys_user_id", "user_id"),
        Index("idx_api_keys_key_hash", "key_hash", unique=True),
        Index("idx_api_keys_is_active", "is_active"),
        Index("idx_api_keys_user_active", "user_id", "is_active"),
    )
