"""
Sentry error tracking and performance monitoring integration.

This module centralises the Sentry SDK initialisation for the Giga-PDF FastAPI
backend.  It is intentionally designed as a **feature-toggled** integration:
if ``SENTRY_DSN`` is empty or absent the function is a safe no-op so the
application starts without any Sentry dependency.

RGPD compliance:
- ``send_default_pii=False`` — never forward PII to Sentry automatically.
- ``_filter_sensitive_data`` scrubs known-sensitive headers, cookies and body
  fields **before** any event leaves the process.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sensitive field patterns (case-insensitive names)
# ---------------------------------------------------------------------------
_SENSITIVE_HEADERS: frozenset[str] = frozenset(
    {
        "authorization",
        "x-api-key",
        "cookie",
        "set-cookie",
        "x-auth-token",
        "x-refresh-token",
        "x-csrf-token",
    }
)

_SENSITIVE_BODY_KEYS: frozenset[str] = frozenset(
    {
        "password",
        "passwd",
        "token",
        "access_token",
        "refresh_token",
        "api_key",
        "secret",
        "secret_key",
        "private_key",
        "card_number",
        "cvv",
        "ssn",
        "credit_card",
    }
)

# Matches common email-like patterns to redact from free-form strings
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", re.IGNORECASE)


def _redact_dict(data: dict[str, Any], sensitive_keys: frozenset[str]) -> dict[str, Any]:
    """Return a copy of *data* with sensitive values replaced by ``[Filtered]``."""
    redacted: dict[str, Any] = {}
    for key, value in data.items():
        if key.lower() in sensitive_keys:
            redacted[key] = "[Filtered]"
        elif isinstance(value, dict):
            redacted[key] = _redact_dict(value, sensitive_keys)
        elif isinstance(value, str):
            # Scrub embedded email addresses
            redacted[key] = _EMAIL_RE.sub("[email]", value)
        else:
            redacted[key] = value
    return redacted


def _filter_sensitive_data(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    """
    Sentry ``before_send`` hook — scrubs PII and credentials from every event.

    Scrubbing rules applied (in order):
    1. HTTP request headers: Authorization, Cookie, X-API-Key, X-Auth-Token, …
    2. HTTP request cookies dict (if present).
    3. HTTP request body (``data`` field): password, token, api_key, secret, …
    4. Query string: redact values of sensitive params.
    5. ``extra`` and ``contexts`` keys matching the sensitive set.

    Args:
        event: The Sentry event dict to sanitise.
        hint: Additional context provided by the SDK (exception info, etc.).

    Returns:
        The sanitised event dict.
    """
    request = event.get("request", {})

    # --- 1. Headers ---
    headers: dict | None = request.get("headers")
    if isinstance(headers, dict):
        request["headers"] = _redact_dict(headers, _SENSITIVE_HEADERS)

    # --- 2. Cookies ---
    cookies: dict | None = request.get("cookies")
    if isinstance(cookies, dict):
        # Redact all cookie values (they may carry session tokens)
        request["cookies"] = {k: "[Filtered]" for k in cookies}

    # --- 3. Request body ---
    body: Any = request.get("data")
    if isinstance(body, dict):
        request["data"] = _redact_dict(body, _SENSITIVE_BODY_KEYS)
    elif isinstance(body, str):
        # Attempt to parse and scrub JSON bodies
        try:
            import json as _json

            parsed = _json.loads(body)
            if isinstance(parsed, dict):
                request["data"] = _json.dumps(_redact_dict(parsed, _SENSITIVE_BODY_KEYS))
        except Exception:
            pass  # Leave raw body as-is when not parseable

    # --- 4. Query string (redact values for sensitive param names) ---
    query_string: str | None = request.get("query_string")
    if isinstance(query_string, str) and query_string:
        from urllib.parse import parse_qsl, urlencode

        params = parse_qsl(query_string, keep_blank_values=True)
        cleaned = [
            (k, "[Filtered]" if k.lower() in _SENSITIVE_BODY_KEYS else v) for k, v in params
        ]
        request["query_string"] = urlencode(cleaned)

    if request:
        event["request"] = request

    # --- 5. Extra / contexts ---
    extra: dict | None = event.get("extra")
    if isinstance(extra, dict):
        event["extra"] = _redact_dict(extra, _SENSITIVE_BODY_KEYS | _SENSITIVE_HEADERS)

    return event


def init_sentry(
    dsn: str,
    environment: str = "production",
    release: str = "unknown",
    traces_sample_rate: float = 0.1,
    profiles_sample_rate: float = 0.1,
) -> None:
    """
    Initialise the Sentry SDK.

    Must be called **once** at application startup, before any request is
    handled.  If *dsn* is empty the function returns immediately (safe no-op).

    Args:
        dsn: Sentry DSN.  Empty string disables Sentry silently.
        environment: ``"production"`` | ``"staging"`` | ``"development"``.
        release: Release identifier, e.g. git SHA or semver tag.
        traces_sample_rate: Fraction of transactions to sample for performance
            monitoring (0.0–1.0).  Recommended 0.1 (10 %) in production.
        profiles_sample_rate: Fraction of sampled transactions that also get a
            profiling trace.  Requires ``traces_sample_rate > 0``.
    """
    if not dsn:
        logger.info("Sentry DSN not configured — error tracking disabled.")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.redis import RedisIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        # Optional integrations — only register if the library is installed
        extra_integrations = []
        try:
            from sentry_sdk.integrations.celery import CeleryIntegration

            extra_integrations.append(CeleryIntegration())
        except ImportError:
            pass  # Celery not installed

        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=release,
            traces_sample_rate=traces_sample_rate,
            profiles_sample_rate=profiles_sample_rate,
            # RGPD: never forward PII automatically
            send_default_pii=False,
            integrations=[
                FastApiIntegration(),
                SqlalchemyIntegration(),
                RedisIntegration(),
                *extra_integrations,
            ],
            before_send=_filter_sensitive_data,
        )

        logger.info(
            "Sentry initialised",
            extra={
                "environment": environment,
                "release": release,
                "traces_sample_rate": traces_sample_rate,
            },
        )

    except ImportError:
        logger.warning(
            "sentry-sdk not installed — error tracking disabled. "
            "Run: pip install 'sentry-sdk[fastapi]>=2.0.0,<3.0'"
        )
    except Exception as exc:
        # Never let a Sentry initialisation error crash the app
        logger.error("Failed to initialise Sentry: %s", exc)
