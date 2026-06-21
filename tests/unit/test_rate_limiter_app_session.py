"""Unit tests for the rate-limiter app-session exemption.

Regression guard for the 2026-06-21 production incident: logged-in users
browsing the app received HTTP 429 on ``/api/v1/storage/documents`` and
``/api/v1/quota/me`` because the general rate limiter throttled their
interactive session (the ``default`` 100 req/min bucket, keyed by user_id).

Contract (see ``app.middleware.rate_limiter._is_app_session``):
  * Interactive app sessions (JWT/cookie → ``user_id``, no API key) are EXEMPT.
  * API-key requests (``api_key_id`` present) stay rate limited.
  * Anonymous requests (no auth) stay rate limited (anti-brute-force).
"""

from types import SimpleNamespace

from app.middleware.rate_limiter import _is_app_session


def _request(**state_attrs) -> SimpleNamespace:
    """Build a minimal stand-in for a FastAPI Request exposing ``.state``."""
    return SimpleNamespace(state=SimpleNamespace(**state_attrs))


def test_app_session_is_exempt() -> None:
    # JWT/cookie session: user_id present, no API key → exempt from limiting.
    assert _is_app_session(_request(user_id="user-123")) is True


def test_api_key_request_is_not_exempt() -> None:
    # X-API-Key requests carry api_key_id → must remain rate limited, even if a
    # user_id is also resolved.
    assert _is_app_session(_request(api_key_id="key-1")) is False
    assert _is_app_session(_request(user_id="user-123", api_key_id="key-1")) is False


def test_anonymous_request_is_not_exempt() -> None:
    # No authentication at all → keep IP-based limiting (login brute-force etc.).
    assert _is_app_session(_request()) is False
    assert _is_app_session(_request(user_id=None)) is False
    assert _is_app_session(_request(user_id=None, api_key_id=None)) is False
