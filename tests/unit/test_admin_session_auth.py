"""Authentication tests for the separate Admin Better Auth session tables."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.middleware.auth import CurrentUser, authenticate_admin_session, get_current_user
from app.middleware.error_handler import AuthInvalidError


class _Result:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _Session:
    def __init__(self, row):
        self.row = row
        self.params = None

    async def execute(self, _statement, params):
        self.params = params
        return _Result(self.row)


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *_args):
        return False


@pytest.mark.parametrize("role", ["admin", "super_admin"])
async def test_admin_session_accepts_back_office_roles(role: str) -> None:
    session = _Session(("admin-1", "admin@example.com", "Admin", role))
    with patch("app.middleware.auth.get_db_session", return_value=_SessionContext(session)):
        user = await authenticate_admin_session("session-token")

    assert user == CurrentUser(
        user_id="admin-1",
        email="admin@example.com",
        name="Admin",
        roles=["admin"],
    )
    assert session.params == {"token": "session-token"}


@pytest.mark.parametrize(
    "row",
    [
        None,
        ("admin-1", "admin@example.com", "Admin", "user"),
    ],
)
async def test_admin_session_rejects_missing_expired_and_non_admin_sessions(row) -> None:
    session = _Session(row)
    with patch("app.middleware.auth.get_db_session", return_value=_SessionContext(session)):
        with pytest.raises(AuthInvalidError):
            await authenticate_admin_session("invalid-token")


async def test_admin_header_uses_admin_session_validator() -> None:
    request = SimpleNamespace(
        headers={"X-Admin-Session": "1"},
        state=SimpleNamespace(current_user=None),
    )
    expected = CurrentUser(user_id="admin-1", roles=["admin"])
    with (
        patch(
            "app.middleware.auth.authenticate_admin_session",
            AsyncMock(return_value=expected),
        ) as validate_admin,
        patch("app.middleware.auth.authenticate_bearer", AsyncMock()) as validate_web,
    ):
        user = await get_current_user(request, "Bearer admin-token")

    assert user is expected
    validate_admin.assert_awaited_once_with("admin-token")
    validate_web.assert_not_awaited()
