"""Startup guard: production must not boot with an unusable JWT setup.

Regression for the Ploi host (2026-10-27): AUTH_JWT_PUBLIC_KEY kept the
.env.example placeholder, so every authenticated call returned 401 while
/health stayed green.
"""

import pytest
from pydantic import ValidationError

from app.config import Settings

VALID_PROD_JWT = {
    "app_env": "production",
    "auth_jwt_public_key": "http://127.0.0.1:3000/api/auth/jwks",
    "auth_jwt_issuer": "https://giga-pdf.com",
    "auth_jwt_audience": "https://giga-pdf.com",
}


def build_settings(**overrides: str) -> Settings:
    return Settings(_env_file=None, **{**VALID_PROD_JWT, **overrides})


def test_production_accepts_jwks_url() -> None:
    settings = build_settings()

    assert settings.is_production


def test_production_accepts_pem_public_key() -> None:
    pem = "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----"

    settings = build_settings(auth_jwt_public_key=pem)

    assert settings.auth_jwt_public_key == pem


@pytest.mark.parametrize(
    "placeholder",
    ["your-jwt-public-key-or-jwks-url", "CONFIGURE_YOUR_JWT_PUBLIC_KEY", ""],
)
def test_production_rejects_placeholder_public_key(placeholder: str) -> None:
    with pytest.raises(ValidationError, match="AUTH_JWT_PUBLIC_KEY"):
        build_settings(auth_jwt_public_key=placeholder)


@pytest.mark.parametrize("field", ["auth_jwt_issuer", "auth_jwt_audience"])
def test_production_rejects_example_issuer_or_audience(field: str) -> None:
    with pytest.raises(ValidationError, match=field.upper()):
        build_settings(**{field: "https://auth.example.com"})


def test_development_keeps_permissive_defaults() -> None:
    settings = Settings(
        _env_file=None,
        app_env="development",
        auth_jwt_public_key="your-jwt-public-key-or-jwks-url",
    )

    assert settings.is_development
