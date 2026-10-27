"""
Application configuration using Pydantic Settings.

This module defines all configuration parameters for the Giga-PDF application,
loaded from environment variables with sensible defaults.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
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
    # Semantic search (#85)
    # -------------------------------------------------------------------------
    # On-disk cache for the fastembed embedding model. Read directly from the
    # environment by app.services.embeddings (so it also works in Celery
    # workers without importing Settings); declared here for discoverability.
    fastembed_cache_dir: str = "/var/lib/gigapdf/fastembed-cache"

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
    # Upload size unified at 250 MB across Python, nginx, and .env examples.
    # nginx client_max_body_size, MAX_UPLOAD_SIZE_MB in env files, and Next.js
    # server action body limit must all stay aligned with this value.
    # See SESSION_20260423_023327 (security audit — SSRF/upload-size hardening).
    max_upload_size_mb: int = 250
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
    # Next.js internal URL (for server-to-server calls, e.g. Celery → TS engine)
    # In production this may differ from frontend_url when containers communicate
    # on an internal network (e.g. http://nextjs:3000 in Docker Compose).
    # -------------------------------------------------------------------------
    nextjs_internal_url: str = "http://localhost:3000"

    # Shared secret for internal server-to-server calls (Celery worker → Next.js
    # TS engine on /api/pdf/preview). Must match INTERNAL_API_SECRET in the
    # Next.js environment. Empty disables the internal-auth header.
    internal_api_secret: str = ""

    # -------------------------------------------------------------------------
    # Stripe Configuration
    # -------------------------------------------------------------------------
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""

    # -------------------------------------------------------------------------
    # Object storage (pluggable — see app/storage_backends/)
    # -------------------------------------------------------------------------
    # Which backend stores documents, versions and thumbnails:
    #   idrive   — iDrive e2 (S3-compatible, default)
    #   scaleway — Scaleway Object Storage
    #   aws      — Amazon S3
    #   minio    — MinIO / self-hosted S3
    #   s3       — any other S3-compatible provider (set S3_ENDPOINT)
    #   local    — local filesystem (dev / tests, no presigned URLs)
    #   pkg.module:Factory — custom backend (callable taking Settings)
    storage_provider: str = "idrive"

    # Credentials and target bucket, shared by every S3-compatible provider.
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_bucket_name: str = "gigapdf"
    # Leave empty to use the provider's default (Scaleway/AWS). iDrive e2 and
    # MinIO need it, e.g. https://xxxx.par.idrivee2-NN.com for iDrive e2.
    s3_endpoint: str = ""
    # Leave empty to use the provider's default region.
    s3_region: str = ""
    # Optional overrides of the provider preset.
    s3_addressing_style: Literal["", "path", "virtual", "auto"] = ""
    s3_server_side_encryption: bool | None = None
    # Root directory of the "local" provider (defaults to <storage_path>/objects).
    storage_local_root: Path | None = None

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

    @model_validator(mode="after")
    def validate_production_jwt_config(self) -> "Settings":
        """Refuse to boot in production with an unusable JWT verification setup.

        A placeholder key (copied from .env.example) makes every authenticated
        request fail with 401 while /health stays green — seen on the Ploi host
        on 2026-10-27. Failing at startup surfaces it in the deploy instead.
        """
        if not self.is_production:
            return self

        key = self.auth_jwt_public_key.strip()
        is_jwks_url = key.startswith(("http://", "https://"))
        is_pem = key.startswith("-----BEGIN")
        if not (is_jwks_url or is_pem):
            raise ValueError(
                "AUTH_JWT_PUBLIC_KEY must be a JWKS URL "
                "(e.g. http://127.0.0.1:3000/api/auth/jwks) or a PEM public key"
            )

        for name in ("auth_jwt_issuer", "auth_jwt_audience"):
            if "example.com" in getattr(self, name):
                raise ValueError(
                    f"{name.upper()} still holds a placeholder value; "
                    "set it to the Better Auth origin (BETTER_AUTH_URL)"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    """
    Get cached application settings.

    Returns:
        Settings: Application settings singleton.
    """
    return Settings()
