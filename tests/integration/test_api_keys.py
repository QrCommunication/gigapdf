"""
Integration tests for the API Keys system.

Covers:
- CRUD endpoints (POST, GET, PATCH, DELETE) at /api/v1/api-keys
- ApiKeyAuthMiddleware behaviour (pass-through, invalid key, expired key,
  disabled key)

Strategy
--------
CRUD tests:
    ``get_current_user`` is overridden to return a fake user so that JWT
    validation is bypassed.  ``get_db`` is overridden to return a lightweight
    mock session whose ``execute`` / ``add`` / ``flush`` / ``refresh`` /
    ``delete`` methods are controlled per-test.  This keeps tests fast and
    avoids any real database dependency.

Middleware tests:
    ``ApiKeyAuthMiddleware._lookup_key`` and ``_check_rate_limit`` are patched
    so the middleware can be exercised in isolation.  Requests are sent via a
    clean ``TestClient`` (without auth overrides) so the full middleware stack
    runs exactly as in production.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncGenerator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.middleware.auth import CurrentUser, get_current_user

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001"
_FAKE_USER = CurrentUser(user_id=TEST_USER_ID, email="test@example.com")


def _hash_key(raw_key: str) -> str:
    """SHA-256 hex-digest — identical to the production helpers."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _make_api_key_orm(
    *,
    key_id: str = "aaaaaaaa-0000-0000-0000-000000000001",
    user_id: str = TEST_USER_ID,
    name: str = "Test Key",
    raw_key: str = "giga_pk_testkey0000000000000000000000000000000",
    scopes: str = "read,write",
    allowed_domains: str | None = None,
    rate_limit: int = 60,
    is_active: bool = True,
    expires_at: datetime | None = None,
    created_at: datetime | None = None,
) -> MagicMock:
    """
    Build a ``MagicMock`` that quacks like an ``ApiKey`` ORM instance.

    Only the fields consumed by ``_orm_to_response`` and the middleware are
    populated; the rest are set to sensible defaults.
    """
    m = MagicMock()
    m.id = key_id
    m.user_id = user_id
    m.name = name
    m.key_prefix = raw_key[:16]
    m.key_hash = _hash_key(raw_key)
    # Keys created before publishable keys existed have no publishable half;
    # left unset, MagicMock would leak into ApiKeyResponse (str | None) → 422.
    m.publishable_key_prefix = None
    m.scopes = scopes
    m.allowed_domains = allowed_domains
    m.rate_limit = rate_limit
    m.is_active = is_active
    m.last_used_at = None
    m.expires_at = expires_at
    m.created_at = created_at or datetime(2026, 1, 1, tzinfo=UTC)
    return m


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def app_with_auth_override():
    """
    Return the FastAPI application with ``get_current_user`` replaced by a
    function that always yields the fake test user.

    The ``get_db`` dependency is *not* overridden here; individual tests that
    need DB behaviour patch ``get_db`` on the fly via ``monkeypatch``.
    """
    from app.main import create_application

    application = create_application()

    async def _fake_current_user() -> CurrentUser:
        return _FAKE_USER

    application.dependency_overrides[get_current_user] = _fake_current_user
    yield application
    application.dependency_overrides.clear()


@pytest.fixture(scope="module")
def authed_client(app_with_auth_override) -> TestClient:
    """Sync TestClient with JWT auth pre-overridden."""
    with TestClient(app_with_auth_override, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture()
def mock_db_session():
    """
    Return a pre-configured async mock session.

    ``execute`` returns a scalar result that returns ``None`` by default.
    Tests can adjust ``session.execute.return_value`` as needed.
    """
    session = AsyncMock()

    # Default: execute returns a result whose scalar_one_or_none() is None
    scalar_result = MagicMock()
    scalar_result.scalar_one_or_none.return_value = None
    scalar_result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=scalar_result)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.close = AsyncMock()
    # Support async context manager usage (used internally)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


@pytest.fixture()
def patch_get_db(app_with_auth_override, mock_db_session):
    """
    Override ``get_db`` on the app to yield *mock_db_session*.

    Returns (app, session) so tests can configure ``session.execute`` before
    the request is sent.
    """
    from app.core.database import get_db

    async def _fake_get_db() -> AsyncGenerator:
        yield mock_db_session

    app_with_auth_override.dependency_overrides[get_db] = _fake_get_db
    yield mock_db_session
    # Remove override after test
    app_with_auth_override.dependency_overrides.pop(get_db, None)


# ===========================================================================
# CRUD Endpoint Tests
# ===========================================================================


class TestCreateApiKey:
    """POST /api/v1/api-keys"""

    def test_create_api_key_returns_full_key(self, authed_client, patch_get_db):
        """
        A successful create must return 201 with the plaintext key starting
        with ``giga_pk_`` and the key metadata.
        """
        session = patch_get_db

        created_orm = _make_api_key_orm(name="My integration key")

        # refresh populates the ORM instance with DB-side defaults
        async def _refresh(obj):
            obj.id = created_orm.id
            obj.key_prefix = created_orm.key_prefix
            obj.name = created_orm.name
            obj.scopes = created_orm.scopes
            obj.allowed_domains = created_orm.allowed_domains
            obj.rate_limit = created_orm.rate_limit
            obj.is_active = created_orm.is_active
            obj.last_used_at = created_orm.last_used_at
            obj.expires_at = created_orm.expires_at
            obj.created_at = created_orm.created_at

        session.refresh = AsyncMock(side_effect=_refresh)

        response = authed_client.post(
            "/api/v1/api-keys",
            json={"name": "My integration key"},
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 201

        body = response.json()
        assert body["success"] is True

        data = body["data"]
        assert "key" in data
        assert data["key"].startswith("giga_pk_")

        api_key = data["api_key"]
        assert api_key["name"] == "My integration key"
        assert api_key["key_prefix"].startswith("giga_pk_")
        assert api_key["is_active"] is True

    def test_create_api_key_with_scopes(self, authed_client, patch_get_db):
        """Scopes provided in the request must be stored and returned as a list."""
        session = patch_get_db

        created_orm = _make_api_key_orm(name="Read-only key", scopes="read")

        async def _refresh(obj):
            obj.id = created_orm.id
            obj.key_prefix = created_orm.key_prefix
            obj.name = "Read-only key"
            obj.scopes = "read"
            obj.allowed_domains = None
            obj.rate_limit = 60
            obj.is_active = True
            obj.last_used_at = None
            obj.expires_at = None
            obj.created_at = created_orm.created_at

        session.refresh = AsyncMock(side_effect=_refresh)

        response = authed_client.post(
            "/api/v1/api-keys",
            json={"name": "Read-only key", "scopes": "read"},
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["api_key"]["scopes"] == ["read"]

    def test_create_api_key_key_hash_not_in_response(self, authed_client, patch_get_db):
        """The SHA-256 hash must never be present in the response body."""
        session = patch_get_db

        created_orm = _make_api_key_orm(name="Hash check")

        async def _refresh(obj):
            obj.id = created_orm.id
            obj.key_prefix = created_orm.key_prefix
            obj.name = "Hash check"
            obj.scopes = "read,write"
            obj.allowed_domains = None
            obj.rate_limit = 60
            obj.is_active = True
            obj.last_used_at = None
            obj.expires_at = None
            obj.created_at = created_orm.created_at

        session.refresh = AsyncMock(side_effect=_refresh)

        response = authed_client.post(
            "/api/v1/api-keys",
            json={"name": "Hash check"},
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 201
        assert "key_hash" not in response.text

    def test_create_without_auth_returns_401(self, authed_client, patch_get_db, app_with_auth_override):
        """
        When the auth override is removed a request without a valid JWT must
        return 401.
        """
        # Temporarily restore the real auth dependency
        app_with_auth_override.dependency_overrides.pop(get_current_user, None)
        try:
            response = authed_client.post(
                "/api/v1/api-keys",
                json={"name": "No auth key"},
                # Deliberately omitting Authorization header
            )
            assert response.status_code == 401
        finally:
            # Restore auth override for subsequent tests
            async def _fake_current_user() -> CurrentUser:
                return _FAKE_USER

            app_with_auth_override.dependency_overrides[get_current_user] = _fake_current_user

    def test_create_with_invalid_scope_returns_422(self, authed_client, patch_get_db):
        """Invalid scope values must fail schema validation with 422."""
        response = authed_client.post(
            "/api/v1/api-keys",
            json={"name": "Bad scope", "scopes": "superadmin"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert response.status_code == 422


class TestListApiKeys:
    """GET /api/v1/api-keys"""

    def test_list_api_keys(self, authed_client, patch_get_db):
        """List endpoint must return 200 with a list of the user's keys."""
        session = patch_get_db

        key1 = _make_api_key_orm(key_id="id-001", name="Key 1")
        key2 = _make_api_key_orm(key_id="id-002", name="Key 2")

        scalar_result = MagicMock()
        scalar_result.scalars.return_value.all.return_value = [key1, key2]
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.get(
            "/api/v1/api-keys",
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200

        body = response.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)
        assert len(body["data"]) == 2

    def test_list_api_keys_does_not_expose_hash(self, authed_client, patch_get_db):
        """key_hash must be absent from every item in the list response."""
        session = patch_get_db

        key = _make_api_key_orm(key_id="id-003", name="Sensitive")

        scalar_result = MagicMock()
        scalar_result.scalars.return_value.all.return_value = [key]
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.get(
            "/api/v1/api-keys",
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200
        assert "key_hash" not in response.text

    def test_list_returns_key_prefix(self, authed_client, patch_get_db):
        """Each item must expose key_prefix for identification."""
        session = patch_get_db

        key = _make_api_key_orm(key_id="id-004", name="Prefix check")

        scalar_result = MagicMock()
        scalar_result.scalars.return_value.all.return_value = [key]
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.get(
            "/api/v1/api-keys",
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200
        items = response.json()["data"]
        assert len(items) == 1
        assert items[0]["key_prefix"].startswith("giga_pk_")

    def test_list_empty_when_no_keys(self, authed_client, patch_get_db):
        """List must return an empty array when the user has no keys."""
        session = patch_get_db

        scalar_result = MagicMock()
        scalar_result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.get(
            "/api/v1/api-keys",
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200
        assert response.json()["data"] == []

    def test_list_without_auth_returns_401(self, authed_client, app_with_auth_override):
        """List endpoint must return 401 when no token is supplied."""
        app_with_auth_override.dependency_overrides.pop(get_current_user, None)
        try:
            response = authed_client.get("/api/v1/api-keys")
            assert response.status_code == 401
        finally:
            async def _fake_current_user() -> CurrentUser:
                return _FAKE_USER

            app_with_auth_override.dependency_overrides[get_current_user] = _fake_current_user


class TestUpdateApiKey:
    """PATCH /api/v1/api-keys/{key_id}"""

    def test_update_api_key(self, authed_client, patch_get_db):
        """PATCH must update the name and return the modified key."""
        session = patch_get_db
        key_id = "aaaaaaaa-0000-0000-0000-000000000099"

        existing = _make_api_key_orm(key_id=key_id, name="Original")

        # First execute: fetch the key; second refresh: reload updated values
        scalar_result = MagicMock()
        scalar_result.scalar_one_or_none.return_value = existing
        session.execute = AsyncMock(return_value=scalar_result)

        async def _refresh(obj):
            # Simulate the DB returning the object after flush
            obj.id = key_id
            obj.name = "Updated name"
            obj.key_prefix = existing.key_prefix
            obj.scopes = "read,write"
            obj.allowed_domains = None
            obj.rate_limit = 60
            obj.is_active = True
            obj.last_used_at = None
            obj.expires_at = None
            obj.created_at = existing.created_at

        session.refresh = AsyncMock(side_effect=_refresh)

        response = authed_client.patch(
            f"/api/v1/api-keys/{key_id}",
            json={"name": "Updated name"},
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200

        body = response.json()
        assert body["success"] is True
        assert body["data"]["name"] == "Updated name"
        assert body["data"]["id"] == key_id

    def test_update_api_key_scopes(self, authed_client, patch_get_db):
        """PATCH must update the scopes field."""
        session = patch_get_db
        key_id = "bbbbbbbb-0000-0000-0000-000000000001"

        existing = _make_api_key_orm(key_id=key_id, name="Scope key", scopes="read,write")

        scalar_result = MagicMock()
        scalar_result.scalar_one_or_none.return_value = existing
        session.execute = AsyncMock(return_value=scalar_result)

        async def _refresh(obj):
            obj.id = key_id
            obj.name = "Scope key"
            obj.key_prefix = existing.key_prefix
            obj.scopes = "read"
            obj.allowed_domains = None
            obj.rate_limit = 60
            obj.is_active = True
            obj.last_used_at = None
            obj.expires_at = None
            obj.created_at = existing.created_at

        session.refresh = AsyncMock(side_effect=_refresh)

        response = authed_client.patch(
            f"/api/v1/api-keys/{key_id}",
            json={"scopes": "read"},
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200
        assert response.json()["data"]["scopes"] == ["read"]

    def test_update_nonexistent_key_returns_404(self, authed_client, patch_get_db):
        """PATCH on an unknown key_id must return 404."""
        session = patch_get_db

        scalar_result = MagicMock()
        scalar_result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.patch(
            "/api/v1/api-keys/00000000-dead-dead-dead-000000000000",
            json={"name": "Ghost"},
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 404

    def test_update_without_auth_returns_401(self, authed_client, app_with_auth_override):
        """PATCH without a token must return 401."""
        app_with_auth_override.dependency_overrides.pop(get_current_user, None)
        try:
            response = authed_client.patch(
                "/api/v1/api-keys/some-id",
                json={"name": "No auth"},
            )
            assert response.status_code == 401
        finally:
            async def _fake_current_user() -> CurrentUser:
                return _FAKE_USER

            app_with_auth_override.dependency_overrides[get_current_user] = _fake_current_user


class TestDeleteApiKey:
    """DELETE /api/v1/api-keys/{key_id}"""

    def test_delete_api_key(self, authed_client, patch_get_db):
        """DELETE must return 200 and confirm the deleted key id."""
        session = patch_get_db
        key_id = "cccccccc-0000-0000-0000-000000000001"

        existing = _make_api_key_orm(key_id=key_id)

        scalar_result = MagicMock()
        scalar_result.scalar_one_or_none.return_value = existing
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.delete(
            f"/api/v1/api-keys/{key_id}",
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 200

        body = response.json()
        assert body["success"] is True
        assert body["data"]["deleted_key_id"] == key_id

        # Verify the session's delete was called with the ORM object
        session.delete.assert_awaited_once_with(existing)

    def test_delete_nonexistent_key_returns_404(self, authed_client, patch_get_db):
        """DELETE on an unknown key_id must return 404."""
        session = patch_get_db

        scalar_result = MagicMock()
        scalar_result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=scalar_result)

        response = authed_client.delete(
            "/api/v1/api-keys/00000000-dead-dead-dead-000000000000",
            headers={"Authorization": "Bearer fake-token"},
        )

        assert response.status_code == 404

    def test_delete_without_auth_returns_401(self, authed_client, app_with_auth_override):
        """DELETE without a token must return 401."""
        app_with_auth_override.dependency_overrides.pop(get_current_user, None)
        try:
            response = authed_client.delete("/api/v1/api-keys/some-id")
            assert response.status_code == 401
        finally:
            async def _fake_current_user() -> CurrentUser:
                return _FAKE_USER

            app_with_auth_override.dependency_overrides[get_current_user] = _fake_current_user


# ===========================================================================
# Middleware Tests
# ===========================================================================


@pytest.fixture(scope="module")
def raw_app():
    """
    Return a fresh app instance without any dependency overrides.

    This lets middleware run in its natural configuration, isolated from the
    CRUD test fixtures.
    """
    from app.main import create_application

    return create_application()


@pytest.fixture(scope="module")
def raw_client(raw_app) -> TestClient:
    with TestClient(raw_app, raise_server_exceptions=False) as c:
        yield c


KEY_OWNER_ID = "key-owner-00000000-0000-0000-0000-000000000002"
BEARER_USER_ID = "bearer-user-0000-0000-0000-0000-000000000003"


@contextmanager
def _api_key_middleware_patches(
    key_orm: MagicMock,
    owner: tuple[str | None, str | None] | None = ("owner@example.com", "Key Owner"),
) -> Iterator[SimpleNamespace]:
    """
    Run the real middleware stack with its I/O replaced.

    - ``_lookup_key`` returns *key_orm* (real signature, records each call);
    - rate limit, ``last_used_at`` update and security audit are no-ops;
    - the ``users`` row lookup returns *owner* (``None`` = deleted account);
    - the API-call quota allows the request.
    """
    calls = SimpleNamespace(lookups=[], load_owner=AsyncMock(return_value=owner))

    async def _fake_lookup(self_mw, raw_key: str, *, publishable: bool = False):
        calls.lookups.append((raw_key, publishable))
        return key_orm

    async def _no_rate_limit(self_mw, key_record):
        return False, {}

    async def _noop(self_mw, *args, **kwargs):
        return None

    quota_info = {
        "api_calls_limit": 1000,
        "api_calls_remaining": 999,
        "reset_at": "2026-11-01T00:00:00Z",
    }
    mw = "app.middleware.api_key_auth.ApiKeyAuthMiddleware"
    with patch(f"{mw}._lookup_key", new=_fake_lookup), patch(
        f"{mw}._check_rate_limit", new=_no_rate_limit
    ), patch(f"{mw}._update_last_used", new=_noop), patch(
        f"{mw}._audit_auth_failure", new=_noop
    ), patch("app.middleware.auth._load_account", new=calls.load_owner), patch(
        "app.middleware.api_quota.quota_service.check_api_quota",
        new=AsyncMock(return_value=(True, quota_info)),
    ), patch(
        "app.middleware.api_quota.quota_service.increment_api_calls",
        new=AsyncMock(return_value=quota_info),
    ):
        yield calls


def _queried_owner_ids(session: AsyncMock) -> set[str]:
    """Owner ids bound into the SQL statements the route executed."""
    owner_ids: set[str] = set()
    for call in session.execute.call_args_list:
        params = call.args[0].compile().params
        owner_ids.update(v for k, v in params.items() if k.startswith("owner_id"))
    return owner_ids


@pytest.fixture(scope="module")
def scoped_test_client() -> Iterator[tuple[TestClient, object]]:
    """Real app (no auth override) + one TestClient shared by the module."""
    from app.main import create_application

    application = create_application()
    with TestClient(application, raise_server_exceptions=False) as c:
        yield c, application


@pytest.fixture()
def scoped_client(scoped_test_client) -> Iterator[tuple[TestClient, AsyncMock]]:
    """
    Client whose ``get_db`` yields an empty mock session.

    ``execute`` returns a result with ``scalar() == 0`` and no rows, enough
    for list endpoints (storage documents, api-keys) to answer 200.
    """
    from app.core.database import get_db

    client, application = scoped_test_client
    session = AsyncMock()
    result = MagicMock()
    result.scalar.return_value = 0
    result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=result)

    async def _fake_get_db() -> AsyncGenerator:
        yield session

    application.dependency_overrides[get_db] = _fake_get_db
    yield client, session
    application.dependency_overrides.pop(get_db, None)


class TestApiKeyAuthMiddleware:
    """
    Unit tests for ``ApiKeyAuthMiddleware``.

    The middleware's private helpers (``_lookup_key``, ``_check_rate_limit``,
    ``_update_last_used``) are patched directly so that no real database or
    Redis instance is required.
    """

    _PROBE_PATH = "/api/v1/api-keys"

    def test_request_without_api_key_passes_through(self, raw_client):
        """
        When no X-API-Key header is present the middleware must be a no-op.

        The request reaches the endpoint; we expect a 401 from the JWT
        dependency (not from the middleware), which proves the middleware
        did not intercept it.
        """
        response = raw_client.get(self._PROBE_PATH)
        # 401 is expected (no JWT), but the body must NOT carry API_KEY_INVALID
        assert response.status_code == 401

        body = response.json()
        error = body.get("error") or {}
        if isinstance(error, dict):
            assert error.get("code") != "API_KEY_INVALID"

    def test_invalid_api_key_returns_401(self, raw_client):
        """An unrecognised X-API-Key must be rejected with 401 / API_KEY_INVALID."""

        async def _fake_lookup(self_mw, raw_key: str, *, publishable: bool = False):
            return None  # key not found in DB

        with patch(
            "app.middleware.api_key_auth.ApiKeyAuthMiddleware._lookup_key",
            new=_fake_lookup,
        ):
            response = raw_client.get(
                self._PROBE_PATH,
                headers={"X-API-Key": "giga_pk_totally_invalid_key_00000000000000"},
            )

        assert response.status_code == 401

        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "API_KEY_INVALID"

    def test_expired_api_key_returns_401(self, raw_client):
        """A key whose ``expires_at`` is in the past must return 401 / API_KEY_EXPIRED."""
        raw_key = "giga_pk_expiredkey000000000000000000000000000"
        expired_orm = _make_api_key_orm(
            raw_key=raw_key,
            expires_at=datetime(2000, 1, 1, tzinfo=UTC),
        )

        async def _fake_lookup(self_mw, k: str, *, publishable: bool = False):
            return expired_orm

        with patch(
            "app.middleware.api_key_auth.ApiKeyAuthMiddleware._lookup_key",
            new=_fake_lookup,
        ):
            response = raw_client.get(
                self._PROBE_PATH,
                headers={"X-API-Key": raw_key},
            )

        assert response.status_code == 401

        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "API_KEY_EXPIRED"

    def test_disabled_api_key_returns_401(self, raw_client):
        """
        Inactive keys are excluded by the DB query (``is_active IS TRUE``),
        so ``_lookup_key`` returns None → middleware returns 401 / API_KEY_INVALID.
        """

        async def _fake_lookup(self_mw, raw_key: str, *, publishable: bool = False):
            # Simulate: DB returns None because is_active=False filtered it out
            return None

        with patch(
            "app.middleware.api_key_auth.ApiKeyAuthMiddleware._lookup_key",
            new=_fake_lookup,
        ):
            response = raw_client.get(
                self._PROBE_PATH,
                headers={"X-API-Key": "giga_pk_inactivekey0000000000000000000000000"},
            )

        assert response.status_code == 401

        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "API_KEY_INVALID"

    def test_domain_restricted_key_wrong_origin_returns_403(self, raw_client):
        """
        A key restricted to a specific domain must reject requests from a
        different origin with 403 / API_KEY_DOMAIN_NOT_ALLOWED.
        """
        raw_key = "giga_pk_domainkey00000000000000000000000000"
        restricted_orm = _make_api_key_orm(
            raw_key=raw_key,
            allowed_domains="https://allowed.example.com",
        )

        async def _fake_lookup(self_mw, k: str, *, publishable: bool = False):
            return restricted_orm

        async def _no_rate_limit(self_mw, key_record):
            return False, {}

        with patch(
            "app.middleware.api_key_auth.ApiKeyAuthMiddleware._lookup_key",
            new=_fake_lookup,
        ), patch(
            "app.middleware.api_key_auth.ApiKeyAuthMiddleware._check_rate_limit",
            new=_no_rate_limit,
        ):
            response = raw_client.get(
                self._PROBE_PATH,
                headers={
                    "X-API-Key": raw_key,
                    "Origin": "https://evil.attacker.com",
                },
            )

        assert response.status_code == 403

        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "API_KEY_DOMAIN_NOT_ALLOWED"

    def test_valid_active_key_passes_through_middleware(self, scoped_client):
        """
        A valid, active, unexpired, unrestricted key must pass the middleware
        and reach a protected endpoint, which then runs as the key's owner.

        The probe is a real protected route (not ``/health``, which the
        middleware exempts and would therefore never call ``_lookup_key``).
        """
        client, session = scoped_client
        raw_key = "giga_pk_validkey000000000000000000000000000"
        valid_orm = _make_api_key_orm(raw_key=raw_key, user_id=KEY_OWNER_ID)

        with _api_key_middleware_patches(valid_orm) as calls:
            response = client.get(
                "/api/v1/storage/documents",
                headers={"X-API-Key": raw_key},
            )

        assert response.status_code == 200, response.text
        assert calls.lookups == [(raw_key, False)]
        assert _queried_owner_ids(session) == {KEY_OWNER_ID}


# ===========================================================================
# Secret API keys on the whole /api/v1 API — identity + scope enforcement
# ===========================================================================


class TestApiKeyScopeEnforcement:
    """
    A secret key (``giga_pk_*``) authenticates the whole ``/api/v1`` API as its
    owner, within its scopes: ``read`` for GET/HEAD, ``write`` for the other
    methods, ``admin`` for ``/api-keys`` and ``/billing``; ``/admin/*`` never.
    """

    _RAW_KEY = "giga_pk_scopekey00000000000000000000000000000"

    def _key(self, scopes: str) -> MagicMock:
        return _make_api_key_orm(raw_key=self._RAW_KEY, user_id=KEY_OWNER_ID, scopes=scopes)

    @staticmethod
    def _assert_scope_denied(response, missing: str | None) -> None:
        assert response.status_code == 403, response.text
        error = response.json()["error"]
        assert error["code"] == "API_KEY_SCOPE_DENIED"
        if missing is not None:
            assert f"'{missing}'" in error["message"]

    def test_read_key_can_list_documents_as_owner(self, scoped_client):
        client, session = scoped_client
        with _api_key_middleware_patches(self._key("read")) as calls:
            response = client.get(
                "/api/v1/storage/documents", headers={"X-API-Key": self._RAW_KEY}
            )

        assert response.status_code == 200, response.text
        assert response.json()["data"]["items"] == []
        assert _queried_owner_ids(session) == {KEY_OWNER_ID}
        calls.load_owner.assert_awaited_once_with(KEY_OWNER_ID)

    def test_read_only_key_cannot_post(self, scoped_client):
        client, session = scoped_client
        with _api_key_middleware_patches(self._key("read")):
            response = client.post(
                "/api/v1/storage/documents",
                headers={"X-API-Key": self._RAW_KEY},
                json={"name": "x"},
            )

        self._assert_scope_denied(response, "write")
        session.execute.assert_not_called()

    def test_write_key_can_also_read(self, scoped_client):
        client, session = scoped_client
        with _api_key_middleware_patches(self._key("write")):
            response = client.get(
                "/api/v1/storage/documents", headers={"X-API-Key": self._RAW_KEY}
            )

        assert response.status_code == 200, response.text
        assert _queried_owner_ids(session) == {KEY_OWNER_ID}

    def test_platform_admin_route_is_refused_even_with_every_scope(self, scoped_client):
        client, session = scoped_client
        with _api_key_middleware_patches(self._key("read,write,admin")) as calls:
            response = client.get("/api/v1/admin/users", headers={"X-API-Key": self._RAW_KEY})

        self._assert_scope_denied(response, None)
        session.execute.assert_not_called()
        calls.load_owner.assert_not_awaited()

    @pytest.mark.parametrize("method", ["get", "post"])
    def test_api_keys_route_requires_admin_scope(self, scoped_client, method):
        client, session = scoped_client
        with _api_key_middleware_patches(self._key("read,write")):
            response = client.request(
                method.upper(),
                "/api/v1/api-keys",
                headers={"X-API-Key": self._RAW_KEY},
                json={"name": "minted by a leaked key"} if method == "post" else None,
            )

        self._assert_scope_denied(response, "admin")
        session.add.assert_not_called()

    def test_billing_route_requires_admin_scope(self, scoped_client):
        client, _ = scoped_client
        with _api_key_middleware_patches(self._key("read,write")):
            response = client.get(
                "/api/v1/billing/subscription", headers={"X-API-Key": self._RAW_KEY}
            )

        self._assert_scope_denied(response, "admin")

    def test_admin_scope_can_list_own_api_keys(self, scoped_client):
        client, _ = scoped_client
        with _api_key_middleware_patches(self._key("admin")):
            response = client.get("/api/v1/api-keys", headers={"X-API-Key": self._RAW_KEY})

        assert response.status_code == 200, response.text
        assert response.json()["data"] == []

    def test_key_of_deleted_account_is_rejected(self, scoped_client):
        client, session = scoped_client
        with _api_key_middleware_patches(self._key("read"), owner=None):
            response = client.get(
                "/api/v1/storage/documents", headers={"X-API-Key": self._RAW_KEY}
            )

        assert response.status_code == 401, response.text
        session.execute.assert_not_called()

    def test_bearer_alone_still_works(self, scoped_client):
        client, session = scoped_client
        bearer_user = CurrentUser(user_id=BEARER_USER_ID, roles=["user"])
        with patch(
            "app.middleware.auth.authenticate_bearer",
            new=AsyncMock(return_value=bearer_user),
        ):
            response = client.get(
                "/api/v1/storage/documents",
                headers={"Authorization": "Bearer session-token"},
            )

        assert response.status_code == 200, response.text
        assert _queried_owner_ids(session) == {BEARER_USER_ID}

    def test_bearer_wins_over_api_key_for_identity(self, scoped_client):
        client, session = scoped_client
        bearer_user = CurrentUser(user_id=BEARER_USER_ID, roles=["user"])
        with _api_key_middleware_patches(self._key("read")) as calls, patch(
            "app.middleware.auth.authenticate_bearer",
            new=AsyncMock(return_value=bearer_user),
        ):
            response = client.get(
                "/api/v1/storage/documents",
                headers={
                    "Authorization": "Bearer session-token",
                    "X-API-Key": self._RAW_KEY,
                },
            )

        assert response.status_code == 200, response.text
        assert _queried_owner_ids(session) == {BEARER_USER_ID}
        calls.load_owner.assert_not_awaited()

    def test_key_scopes_still_apply_alongside_bearer(self, scoped_client):
        """A Bearer header never lifts the restrictions of an X-API-Key sent with it."""
        client, _ = scoped_client
        bearer_user = CurrentUser(user_id=BEARER_USER_ID, roles=["admin"])
        with _api_key_middleware_patches(self._key("read")), patch(
            "app.middleware.auth.authenticate_bearer",
            new=AsyncMock(return_value=bearer_user),
        ):
            response = client.post(
                "/api/v1/storage/documents",
                headers={
                    "Authorization": "Bearer session-token",
                    "X-API-Key": self._RAW_KEY,
                },
                json={"name": "x"},
            )

        self._assert_scope_denied(response, "write")
