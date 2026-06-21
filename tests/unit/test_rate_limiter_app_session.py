"""Unit tests for the rate-limiter scope decision.

Regression guard for the 2026-06-21 production incident: logged-in users
browsing the app received HTTP 429 on ``/api/v1/storage/documents`` and
``/api/v1/quota/me``. The general rate limiter throttled interactive app
traffic — and because ``request.state.user_id`` is best-effort (often unset)
and ``TRUSTED_PROXIES`` was unset, those requests collapsed onto a single
shared ``ip:127.0.0.1`` bucket.

Contract (see ``app.middleware.rate_limiter._should_rate_limit``):
  * API-key requests (``api_key_id`` present) → ALWAYS rate limited.
  * The ``auth`` category (login / PDF unlock) → ALWAYS rate limited
    (brute-force protection), even for app sessions and anonymous callers.
  * Everything else (interactive app sessions AND ordinary browsing) → EXEMPT,
    regardless of ``user_id``.
"""

from types import SimpleNamespace

from app.middleware.rate_limiter import _should_rate_limit


def _request(**state_attrs) -> SimpleNamespace:
    """Minimal stand-in for a FastAPI Request exposing ``.state``."""
    return SimpleNamespace(state=SimpleNamespace(**state_attrs))


def test_api_key_request_is_rate_limited() -> None:
    # X-API-Key requests carry api_key_id → throttled on every category.
    assert _should_rate_limit(_request(api_key_id="key-1"), "default") is True
    assert _should_rate_limit(_request(api_key_id="key-1"), "upload") is True


def test_app_session_is_exempt_on_non_auth() -> None:
    # Logged-in app user (user_id set, no API key) → never throttled on the
    # ordinary categories that triggered the incident.
    assert _should_rate_limit(_request(user_id="user-123"), "default") is False
    assert _should_rate_limit(_request(user_id="user-123"), "export") is False
    assert _should_rate_limit(_request(user_id="user-123"), "ocr") is False


def test_anonymous_browsing_is_exempt_on_non_auth() -> None:
    # No auth at all → still exempt on non-auth categories. The route itself
    # returns 401, so there is nothing to abuse; crucially this no longer
    # depends on user_id being resolved.
    assert _should_rate_limit(_request(), "default") is False
    assert _should_rate_limit(_request(user_id=None, api_key_id=None), "fonts") is False


def test_auth_category_is_always_limited() -> None:
    # login / unlock → brute-force protection for everyone.
    assert _should_rate_limit(_request(), "auth") is True
    assert _should_rate_limit(_request(user_id="user-123"), "auth") is True
    assert _should_rate_limit(_request(api_key_id="key-1"), "auth") is True
