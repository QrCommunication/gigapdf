"""A JWT issued before the account was erased must stop working at once.

Regression (2026-10-28): DELETE /api/v1/account removes the Better Auth user,
but a JWT stays cryptographically valid until it expires. Without an account
check, the erased user could keep creating documents (and quota rows) for the
rest of the token's lifetime.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.middleware.auth import CurrentUser, authenticate_bearer, get_current_user
from app.middleware.error_handler import AuthInvalidError

# Shape of a JWT (three dot-separated parts); its content is mocked below.
_JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLWJ5dGVz"
_SETTINGS = SimpleNamespace(
    is_development=False,
    auth_jwt_public_key="configured",
    auth_session_url=None,
)


def _patches(account):
    return (
        patch("app.middleware.auth.get_settings", return_value=_SETTINGS),
        patch(
            "app.middleware.auth.decode_jwt_token",
            AsyncMock(return_value={"sub": "user-1", "email": "a@example.com"}),
        ),
        patch("app.middleware.auth._load_account", AsyncMock(return_value=account)),
    )


async def test_jwt_of_existing_account_authenticates() -> None:
    settings, decode, load = _patches(("a@example.com", "A"))
    with settings, decode, load as load_account:
        user = await authenticate_bearer(f"Bearer {_JWT}")

    assert user.user_id == "user-1"
    load_account.assert_awaited_once_with("user-1")


async def test_jwt_of_erased_account_is_rejected() -> None:
    settings, decode, load = _patches(None)
    with settings, decode, load:
        with pytest.raises(AuthInvalidError):
            await authenticate_bearer(f"Bearer {_JWT}")


async def test_dependency_reuses_identity_resolved_by_middleware() -> None:
    resolved = CurrentUser(user_id="user-1", roles=["user"])
    request = SimpleNamespace(state=SimpleNamespace(current_user=resolved))

    with patch("app.middleware.auth.authenticate_bearer", AsyncMock()) as bearer:
        user = await get_current_user(request, f"Bearer {_JWT}")

    assert user is resolved
    bearer.assert_not_awaited()
