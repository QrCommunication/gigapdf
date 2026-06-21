"""Unit tests for the API-quota metering scope.

Regression guard for the 2026-06-21 production incident: interactive app
sessions were counted against the monthly API-call quota (Free tier:
1000 calls/month). Normal browsing exhausted it within days, after which every
request returned ``API_QUOTA_EXCEEDED`` (429) — including ``/storage/documents``
and ``/quota/me``.

Contract (see ``app.middleware.api_quota._metered_user_id``): only requests
authenticated with an API key (``api_key_user_id`` set by
``ApiKeyAuthMiddleware``) are metered. App sessions (JWT/cookie) and anonymous
traffic are never metered.
"""

from types import SimpleNamespace

from app.middleware.api_quota import _metered_user_id


def _request(**state_attrs) -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(**state_attrs))


def test_api_key_request_is_metered() -> None:
    assert _metered_user_id(_request(api_key_user_id="k-user")) == "k-user"


def test_app_session_is_not_metered() -> None:
    # JWT app session: user_id present, no api_key_user_id → not metered.
    assert _metered_user_id(_request(user_id="jwt-user")) is None
    assert _metered_user_id(_request(user_id="jwt-user", api_key_user_id=None)) is None


def test_anonymous_is_not_metered() -> None:
    assert _metered_user_id(_request()) is None
