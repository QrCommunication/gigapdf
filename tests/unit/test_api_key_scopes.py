"""
Unit tests for the secret API-key scope rule (``app.middleware.api_key_scopes``)
and for the API-key branch of ``get_current_user`` / ``get_optional_user``.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.middleware.api_key_scopes import (
    api_key_scope_denial,
    parse_scopes,
    required_api_key_scope,
)
from app.middleware.auth import CurrentUser, get_current_user, get_optional_user
from app.middleware.error_handler import AuthInvalidError, AuthRequiredError

# ---------------------------------------------------------------------------
# required_api_key_scope
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("GET", "/api/v1/storage/documents", "read"),
        ("HEAD", "/api/v1/storage/documents", "read"),
        ("OPTIONS", "/api/v1/storage/documents", "read"),
        ("get", "/api/v1/storage/documents", "read"),
        ("POST", "/api/v1/storage/documents", "write"),
        ("PUT", "/api/v1/documents/abc", "write"),
        ("PATCH", "/api/v1/storage/documents/abc", "write"),
        ("DELETE", "/api/v1/storage/documents/abc", "write"),
        # Key management and billing: admin, whatever the method
        ("GET", "/api/v1/api-keys", "admin"),
        ("GET", "/api/v1/api-keys/", "admin"),
        ("POST", "/api/v1/api-keys", "admin"),
        ("DELETE", "/api/v1/api-keys/some-id", "admin"),
        ("GET", "/api/v1/billing/subscription", "admin"),
        ("POST", "/api/v1/billing", "admin"),
        # Public billing is not billing management
        ("GET", "/api/v1/public/billing/plans", "read"),
        # Prefix matching is segment-aware
        ("GET", "/api/v1/billingx", "read"),
        ("POST", "/api/v1/api-keysfoo", "write"),
        ("GET", "/api/v1/administrator", "read"),
    ],
)
def test_required_scope(method: str, path: str, expected: str) -> None:
    assert required_api_key_scope(method, path) == expected


@pytest.mark.parametrize(
    "path",
    ["/api/v1/admin", "/api/v1/admin/", "/api/v1/admin/users", "/api/v1/admin/stats/overview"],
)
@pytest.mark.parametrize("method", ["GET", "POST", "DELETE"])
def test_platform_admin_routes_are_never_reachable(method: str, path: str) -> None:
    assert required_api_key_scope(method, path) is None
    assert api_key_scope_denial(method, path, "read,write,admin") is not None


# ---------------------------------------------------------------------------
# parse_scopes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, frozenset()),
        ("", frozenset()),
        ("read", frozenset({"read"})),
        (" read , write ,", frozenset({"read", "write"})),
        ("read,write,admin", frozenset({"read", "write", "admin"})),
    ],
)
def test_parse_scopes(raw: str | None, expected: frozenset[str]) -> None:
    assert parse_scopes(raw) == expected


# ---------------------------------------------------------------------------
# api_key_scope_denial
# ---------------------------------------------------------------------------


def test_read_key_can_get_but_not_write() -> None:
    assert api_key_scope_denial("GET", "/api/v1/storage/documents", "read") is None
    denial = api_key_scope_denial("POST", "/api/v1/storage/documents", "read")
    assert denial is not None
    assert "'write'" in denial


def test_write_implies_read() -> None:
    assert api_key_scope_denial("GET", "/api/v1/storage/documents", "write") is None
    assert api_key_scope_denial("POST", "/api/v1/storage/documents", "write") is None


def test_admin_implies_read_and_write() -> None:
    assert api_key_scope_denial("GET", "/api/v1/storage/documents", "admin") is None
    assert api_key_scope_denial("POST", "/api/v1/storage/documents", "admin") is None


def test_write_does_not_reach_admin_scope_routes() -> None:
    assert api_key_scope_denial("GET", "/api/v1/api-keys", "write") is not None


def test_unknown_scope_grants_nothing() -> None:
    assert api_key_scope_denial("GET", "/api/v1/storage/documents", "superuser") is not None


def test_api_keys_route_requires_admin() -> None:
    denial = api_key_scope_denial("POST", "/api/v1/api-keys", "read,write")
    assert denial is not None
    assert "'admin'" in denial
    assert api_key_scope_denial("POST", "/api/v1/api-keys", "admin") is None


def test_billing_route_requires_admin() -> None:
    assert api_key_scope_denial("GET", "/api/v1/billing/invoices", "read,write") is not None
    assert api_key_scope_denial("GET", "/api/v1/billing/invoices", "admin") is None


def test_key_without_scopes_is_denied_everywhere() -> None:
    assert api_key_scope_denial("GET", "/api/v1/storage/documents", "") is not None
    assert api_key_scope_denial("GET", "/api/v1/storage/documents", None) is not None


# ---------------------------------------------------------------------------
# get_current_user / get_optional_user — API-key identity
# ---------------------------------------------------------------------------

_OWNER_PATH = "app.middleware.auth._load_account"


def _request(**state: object) -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(**state))


def _secret_key_request() -> SimpleNamespace:
    return _request(
        api_key_user_id="owner-1",
        api_key_id="key-1",
        api_key_scopes="read,write,admin",
        api_key_is_publishable=False,
    )


async def test_secret_key_builds_api_key_identity_from_users_row() -> None:
    with patch(_OWNER_PATH, AsyncMock(return_value=("owner@example.com", "Owner"))) as load:
        user = await get_current_user(_secret_key_request(), None)

    load.assert_awaited_once_with("owner-1")
    assert user == CurrentUser(
        user_id="owner-1",
        email="owner@example.com",
        name="Owner",
        roles=["user"],
        auth_method="api_key",
        api_key_id="key-1",
    )


async def test_admin_scope_never_grants_platform_admin_role() -> None:
    with patch(_OWNER_PATH, AsyncMock(return_value=("owner@example.com", None))):
        user = await get_current_user(_secret_key_request(), None)
    assert user.roles == ["user"]


async def test_deleted_owner_is_rejected() -> None:
    with patch(_OWNER_PATH, AsyncMock(return_value=None)):
        with pytest.raises(AuthInvalidError):
            await get_current_user(_secret_key_request(), None)


async def test_publishable_key_does_not_authenticate_a_user() -> None:
    request = _request(
        api_key_user_id="owner-1",
        api_key_id="key-1",
        api_key_scopes="embed",
        api_key_is_publishable=True,
    )
    with patch(_OWNER_PATH, AsyncMock()) as load:
        with pytest.raises(AuthRequiredError):
            await get_current_user(request, None)
        assert await get_optional_user(request, None) is None
    load.assert_not_awaited()


async def test_no_credential_raises_auth_required() -> None:
    with pytest.raises(AuthRequiredError):
        await get_current_user(_request(), None)
    assert await get_optional_user(_request(), None) is None


async def test_bearer_header_wins_over_api_key() -> None:
    bearer_user = CurrentUser(user_id="bearer-user", roles=["user"])
    with patch(
        "app.middleware.auth.authenticate_bearer", AsyncMock(return_value=bearer_user)
    ) as bearer, patch(_OWNER_PATH, AsyncMock()) as load:
        user = await get_current_user(_secret_key_request(), "Bearer token")
        optional = await get_optional_user(_secret_key_request(), "Bearer token")

    assert user is bearer_user
    assert optional is bearer_user
    assert bearer.await_count == 2
    load.assert_not_awaited()


async def test_invalid_bearer_header_is_not_rescued_by_api_key() -> None:
    with patch(_OWNER_PATH, AsyncMock()) as load:
        with pytest.raises(AuthInvalidError):
            await get_current_user(_secret_key_request(), "Basic abc")
    load.assert_not_awaited()


async def test_optional_user_resolves_secret_key() -> None:
    with patch(_OWNER_PATH, AsyncMock(return_value=("owner@example.com", "Owner"))):
        user = await get_optional_user(_secret_key_request(), None)
    assert user is not None
    assert user.auth_method == "api_key"
