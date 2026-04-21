"""
Application configuration using Pydantic Settings.

This module defines all configuration parameters for the Giga-PDF application,
loaded from environment variables with sensible defaults.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -------------------------------------------------------------------------
    # Application
    # -------------------------------------------------------------------------
    app_env: Literal["development", "production", "testing"] = "development"
    app_debug: bool = False
    app_secret_key: str = Field(min_length=32)
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_workers: int = 4

    # -------------------------------------------------------------------------
    # Database
    # -------------------------------------------------------------------------
    database_url: str = "postgresql://gigapdf:gigapdf@localhost:5432/gigapdf"
    database_pool_size: int = 20

    # -------------------------------------------------------------------------
    # Redis
    # -------------------------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    # -------------------------------------------------------------------------
    # Authentication (External JWT or Better Auth)
    # -------------------------------------------------------------------------
    auth_jwt_public_key: str = ""
    auth_jwt_algorithm: str = "RS256"
    auth_jwt_issuer: str = ""
    auth_jwt_audience: str = "giga-pdf"
    # Better Auth session validation URL (e.g., https://giga-pdf.com/api/auth/get-session)
    auth_session_url: str = ""

    # -------------------------------------------------------------------------
    # Storage
    # -------------------------------------------------------------------------
    storage_path: Path = Path("/var/lib/gigapdf/documents")
    storage_max_size_gb: int = 100

    # -------------------------------------------------------------------------
    # OCR (Tesseract)
    # -------------------------------------------------------------------------
    tesseract_path: str = "/usr/bin/tesseract"
    tesseract_data_path: str = "/usr/share/tesseract-ocr/5/tessdata"
    ocr_default_languages: str = "fra+eng"

    # -------------------------------------------------------------------------
    # Celery
    # -------------------------------------------------------------------------
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = (
        "db+postgresql://gigapdf:gigapdf@localhost:5432/gigapdf_celery"
    )
    job_timeout_seconds: int = 3600
    async_threshold_mb: float = 10.0

    # -------------------------------------------------------------------------
    # Limits
    # -------------------------------------------------------------------------
    max_upload_size_mb: int = 100  # Hard cap lowered to 100 MB (PDF-bomb mitigation)
    max_pages_per_document: int = 5000
    preview_max_dpi: int = 600
    history_max_states: int = 100

    # -------------------------------------------------------------------------
    # WebSocket
    # -------------------------------------------------------------------------
    socketio_message_queue: str = "redis://localhost:6379/2"

    # -------------------------------------------------------------------------
    # Email (SMTP)
    # -------------------------------------------------------------------------
    mail_server: str = "smtp.example.com"
    mail_port: int = 587
    mail_username: str = ""
    mail_password: str = ""
    mail_from_email: str = "noreply@example.com"
    mail_from_name: str = "GigaPDF"
    mail_use_tls: bool = True
    mail_use_ssl: bool = False
    mail_starttls: bool = True
    mail_timeout: int = 30

    # -------------------------------------------------------------------------
    # Frontend URL (for email links)
    # -------------------------------------------------------------------------
    frontend_url: str = "http://localhost:3000"

    # -------------------------------------------------------------------------
    # Stripe Configuration
    # -------------------------------------------------------------------------
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""

    # DEPRECATED: Price IDs are now managed in the database (plans table)
    # The billing queue will sync plans from DB to Stripe automatically
    # These are kept for backward compatibility but should not be used
    stripe_starter_price_id: str = ""  # Deprecated - use database
    stripe_pro_price_id: str = ""  # Deprecated - use database

    # -------------------------------------------------------------------------
    # S3 Storage (Scaleway / AWS compatible)
    # -------------------------------------------------------------------------
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_bucket_name: str = "gigapdf"
    s3_endpoint: str = "https://s3.fr-par.scw.cloud"
    s3_region: str = "fr-par"

    # -------------------------------------------------------------------------
    # Scaleway API (for infrastructure monitoring - used by scw CLI)
    # Note: The scw CLI uses environment variables directly with SCW_ prefix
    # These are defined here for documentation and optional programmatic access
    # -------------------------------------------------------------------------
    scw_access_key: str = ""
    scw_secret_key: str = ""
    scw_default_organization_id: str = ""
    scw_default_project_id: str = ""

    # -------------------------------------------------------------------------
    # Sentry — Error Tracking & Performance
    # -------------------------------------------------------------------------
    sentry_dsn: str = Field(
        default="",
        description="Sentry DSN.  Leave empty to disable Sentry (feature-toggled).",
    )
    sentry_environment: str = Field(
        default="production",
        description="Sentry environment tag (production | staging | development).",
    )
    sentry_release: str = Field(
        default="unknown",
        description="Release identifier sent to Sentry (e.g. git SHA or semver tag).",
    )
    sentry_traces_sample_rate: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Fraction of transactions sampled for performance monitoring (0.0–1.0).",
    )
    sentry_profiles_sample_rate: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Fraction of sampled transactions that also receive a profiling trace.",
    )

    # -------------------------------------------------------------------------
    # Embed JWT Session Tokens
    # -------------------------------------------------------------------------
    embed_jwt_secret: str = Field(
        default="",
        description=(
            "HMAC-SHA256 secret used to sign ephemeral embed session tokens. "
            "Must be at least 32 characters. Different from APP_SECRET_KEY. "
            "Required in production — leave empty only in development (insecure fallback used)."
        ),
    )
    embed_jwt_token_ttl_seconds: int = Field(
        default=1800,  # 30 minutes
        description="Lifetime of embed session tokens in seconds (default: 1800 = 30 min).",
    )

    # -------------------------------------------------------------------------
    # Feature Flags
    # -------------------------------------------------------------------------
    font_extraction_enabled: bool = Field(
        default=True,
        description="Enable the /api/v1/pdf/fonts/* endpoints. Set to False to return 503.",
    )

    # -------------------------------------------------------------------------
    # Computed Properties
    # -------------------------------------------------------------------------
    @property
    def max_upload_size_bytes(self) -> int:
        """Maximum upload size in bytes."""
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def async_threshold_bytes(self) -> int:
        """Threshold for async processing in bytes."""
        return int(self.async_threshold_mb * 1024 * 1024)

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.app_env == "development"

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.app_env == "production"

    @property
    def mail_configured(self) -> bool:
        """Check if email is properly configured."""
        return bool(
            self.mail_server
            and self.mail_server != "smtp.example.com"
            and self.mail_username
            and self.mail_password
        )

    @field_validator("storage_path", mode="before")
    @classmethod
    def validate_storage_path(cls, v: str | Path) -> Path:
        """Convert string to Path and ensure it's valid."""
        return Path(v) if isinstance(v, str) else v


@lru_cache
def get_settings() -> Settings:
    """
    Get cached application settings.

    Returns:
        Settings: Application settings singleton.
    """
    return Settings()
