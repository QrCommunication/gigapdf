"""DELETE /api/v1/account: guards in front of the erasure service.

The erasure itself is proven on PostgreSQL in tests/integration/
test_account_erasure.py; here the service is replaced to check what the
endpoint lets through: only an application session, only with the explicit
confirmation, and the 409 codes the clients rely on.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.database import get_db
from app.middleware.auth import CurrentUser, get_current_user
from app.services.account_erasure_service import (
    AccountErasureReport,
    TenantOwnershipTransferRequiredError,
)

USER_ID = "user-erase-0000-0000-0000-000000000001"
URL = "/api/v1/account"


def _user(auth_method: str | None) -> CurrentUser:
    user = CurrentUser(user_id=USER_ID, email="erase@example.com")
    if auth_method is not None:
        # Set even before CurrentUser declares the field: the endpoint reads
        # it with getattr(..., "session").
        object.__setattr__(user, "auth_method", auth_method)
    return user


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


@pytest.fixture
def erase(monkeypatch):
    mock = AsyncMock(
        return_value=AccountErasureReport(
            user_id=USER_ID,
            storage_objects_deleted=3,
            deleted={"stored_documents": 2, "users": 1},
            anonymized={"document_versions": 1},
        )
    )
    monkeypatch.setattr("app.api.v1.account.account_erasure_service.erase", mock)
    return mock


@pytest.fixture
def as_caller(app):
    def install(auth_method: str | None):
        app.dependency_overrides[get_current_user] = lambda: _user(auth_method)

    async def no_db():
        yield None

    app.dependency_overrides[get_db] = no_db
    yield install
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)


def _delete(client, body):
    return client.request("DELETE", URL, json=body)


class TestDeleteAccountEndpoint:
    def test_app_session_erases_the_account(self, client, as_caller, erase):
        as_caller("session")

        resp = _delete(client, {"confirmation": "DELETE"})

        assert resp.status_code == 200
        assert resp.json()["data"] == {
            "erased": True,
            "storage_objects_deleted": 3,
            "deleted": {"stored_documents": 2, "users": 1},
            "anonymized": {"document_versions": 1},
        }
        erase.assert_awaited_once()
        assert erase.await_args.args[1] == USER_ID

    def test_caller_without_auth_method_is_treated_as_session(self, client, as_caller, erase):
        as_caller(None)

        assert _delete(client, {"confirmation": "DELETE"}).status_code == 200

    def test_api_key_caller_is_refused(self, client, as_caller, erase):
        as_caller("api_key")

        resp = _delete(client, {"confirmation": "DELETE"})

        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "APP_SESSION_REQUIRED"
        erase.assert_not_awaited()

    @pytest.mark.parametrize(
        "body",
        [
            {"confirmation": "delete"},
            {"confirmation": "DELETE "},
            {"confirmation": ""},
            {},
            {"confirmation": "DELETE", "extra": True},
            None,
        ],
    )
    def test_wrong_or_missing_confirmation_is_422(self, client, as_caller, erase, body):
        as_caller("session")

        resp = _delete(client, body)

        assert resp.status_code == 422
        erase.assert_not_awaited()

    def test_tenant_ownership_conflict_is_409_with_code(self, client, as_caller, monkeypatch):
        as_caller("session")
        monkeypatch.setattr(
            "app.api.v1.account.account_erasure_service.erase",
            AsyncMock(side_effect=TenantOwnershipTransferRequiredError(["tenant-1"])),
        )

        resp = _delete(client, {"confirmation": "DELETE"})

        assert resp.status_code == 409
        error = resp.json()["error"]
        assert error["code"] == "TENANT_OWNERSHIP_TRANSFER_REQUIRED"
        assert error["details"] == {"tenant_ids": ["tenant-1"]}
