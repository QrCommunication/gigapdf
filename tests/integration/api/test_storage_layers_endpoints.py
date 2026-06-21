"""Integration tests: editor-layers persistence endpoints.

Routes under test:
  GET /api/v1/storage/documents/{id}/layers  → owner-or-shared, default when empty
  PUT /api/v1/storage/documents/{id}/layers  → upsert (owner or edit grant)

Strategy mirrors test_storage_access_rls.py / test_storage_ged_endpoints.py:
``get_db`` and ``get_current_user`` are overridden, and a scripted
``FakeSession`` returns the results each handler consumes, in execution order.

The access guard (``authorize_document_access``) short-circuits for the owner
(no extra query); for a non-owner it issues ONE extra ``execute`` (the share
lookup), which the scripts account for. The Redis-backed rate limiter is
neutralized (autouse) so repeated runs don't exhaust the per-category budget
and start returning 429.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.middleware.auth import CurrentUser, get_current_user
from app.models.database import DocumentLayers, DocumentShare, StoredDocument
from app.services.sharing.constants import ShareStatus

OWNER_ID = "owner-layers-0000-0000-0000-000000000001"
SHARED_ID = "shared-layers-0000-0000-0000-000000000002"
STRANGER_ID = "stranger-layers-0000-0000-0000-000000000003"
DOC_ID = "770e8400-e29b-41d4-a716-446655440002"

_SAMPLE_BLOB = {
    "layers": [{"id": "layer-1", "name": "Background", "visible": True}],
    "membership": {"elem-aaaa": "layer-1"},
}


# ---------------------------------------------------------------------------
# Scripted fake AsyncSession (subset used by the layers handlers)
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, *, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class FakeSession:
    """Scripted AsyncSession stand-in returning results in order."""

    def __init__(self, results: list[FakeResult] | None = None):
        self._results = list(results or [])
        self.added: list = []
        self.commit_count = 0

    async def execute(self, stmt, *args, **kwargs):
        if not self._results:
            raise AssertionError(f"FakeSession: unexpected execute() for: {stmt}")
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_count += 1

    async def rollback(self):
        pass

    async def close(self):
        pass


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------

def _make_doc(**overrides) -> StoredDocument:
    now = datetime.now(UTC)
    defaults = dict(
        id=DOC_ID,
        name="Contrat.pdf",
        owner_id=OWNER_ID,
        folder_id=None,
        page_count=3,
        current_version=2,
        file_size_bytes=1024,
        mime_type="application/pdf",
        original_format="pdf",
        tags=["legal"],
        thumbnail_path=None,
        is_deleted=False,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    doc = StoredDocument(**{k: v for k, v in defaults.items() if k != "extracted_text"})
    doc.extracted_text = overrides.get("extracted_text")
    return doc


def _make_share(**overrides) -> DocumentShare:
    defaults = dict(
        id="share-layers-1",
        document_id=DOC_ID,
        shared_with_user_id=SHARED_ID,
        permission="view",
        status=ShareStatus.ACTIVE,
        expires_at=None,
        created_by=OWNER_ID,
    )
    defaults.update(overrides)
    return DocumentShare(**defaults)


def _make_layers_row(data: dict | None = None) -> DocumentLayers:
    now = datetime.now(UTC)
    row = DocumentLayers(stored_document_id=DOC_ID, data=data or dict(_SAMPLE_BLOB))
    row.id = "layers-row-1"
    row.created_at = now
    row.updated_at = now
    return row


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_db(app):
    session = FakeSession()

    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    yield session
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _as_user(app, user_id: str) -> None:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=user_id, email=f"{user_id}@example.com"
    )


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    """Neutralize the Redis-backed rate limiter (PUT is rate-limited).

    The sliding-window counters live in the local Redis and persist across
    pytest runs; without this, repeated runs exhaust the budget and the PUT
    starts returning 429.
    """
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


# ---------------------------------------------------------------------------
# GET /documents/{id}/layers
# ---------------------------------------------------------------------------

class TestGetDocumentLayers:
    def test_owner_empty_returns_default(self, client: TestClient, app, fake_db):
        _as_user(app, OWNER_ID)
        # owner → guard short-circuits (no share query); then layers lookup → None
        fake_db._results = [
            FakeResult(scalar=_make_doc()),   # doc lookup
            FakeResult(scalar=None),          # no layers row yet
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/layers")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data == {"layers": [], "membership": {}}

    def test_owner_round_trip_returns_stored_blob(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=_make_layers_row(dict(_SAMPLE_BLOB))),
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/layers")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["layers"] == _SAMPLE_BLOB["layers"]
        assert data["membership"] == _SAMPLE_BLOB["membership"]

    def test_shared_user_can_read(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),     # doc lookup
            FakeResult(scalar=_make_share()),   # guard: active (view) share
            FakeResult(scalar=_make_layers_row(dict(_SAMPLE_BLOB))),
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/layers")

        assert resp.status_code == 200
        assert resp.json()["data"]["membership"] == _SAMPLE_BLOB["membership"]

    def test_stranger_gets_403_not_404(self, client, app, fake_db):
        _as_user(app, STRANGER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),  # doc exists…
            FakeResult(scalar=None),         # …but no share for the stranger
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/layers")

        assert resp.status_code == 403

    def test_missing_document_is_404(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/layers")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /documents/{id}/layers
# ---------------------------------------------------------------------------

class TestPutDocumentLayers:
    def test_owner_first_save_inserts_row(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),   # doc lookup (owner → no guard query)
            FakeResult(scalar=None),          # no existing layers row → INSERT
        ]

        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["layers"] == _SAMPLE_BLOB["layers"]
        assert data["membership"] == _SAMPLE_BLOB["membership"]
        # A new DocumentLayers row was inserted + committed.
        row = next(o for o in fake_db.added if isinstance(o, DocumentLayers))
        assert row.stored_document_id == DOC_ID
        assert row.data == _SAMPLE_BLOB
        assert fake_db.commit_count == 1

    def test_owner_upsert_overwrites_existing_row(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        existing = _make_layers_row({"layers": [], "membership": {}})
        fake_db._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=existing),      # existing row → UPDATE in place
        ]

        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )

        assert resp.status_code == 200
        # The same row object was mutated, not a new insert.
        assert not any(isinstance(o, DocumentLayers) for o in fake_db.added)
        assert existing.data == _SAMPLE_BLOB
        assert fake_db.commit_count == 1

    def test_shared_edit_grantee_can_save(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),                       # doc lookup
            FakeResult(scalar=_make_share(permission="edit")),   # guard: edit grant
            FakeResult(scalar=None),                             # no existing row
        ]

        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )

        assert resp.status_code == 200
        assert fake_db.commit_count == 1

    def test_view_only_grantee_gets_403(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),                       # doc lookup
            FakeResult(scalar=_make_share(permission="view")),   # guard: view only
        ]

        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )

        assert resp.status_code == 403
        assert fake_db.commit_count == 0

    def test_stranger_gets_403_not_404(self, client, app, fake_db):
        _as_user(app, STRANGER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),  # doc exists…
            FakeResult(scalar=None),         # …no share for the stranger
        ]

        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )

        assert resp.status_code == 403
        assert fake_db.commit_count == 0

    def test_missing_document_is_404(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )

        assert resp.status_code == 404
        assert fake_db.commit_count == 0

    def test_rejects_non_list_layers(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        # Pydantic body validation fires before any DB access → 422.
        resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers",
            json={"layers": "not-a-list", "membership": {}},
        )

        assert resp.status_code == 422
        assert fake_db.commit_count == 0


# ---------------------------------------------------------------------------
# Round-trip (PUT then GET) — end-to-end persistence shape
# ---------------------------------------------------------------------------

class TestLayersRoundTrip:
    def test_put_then_get_returns_same_blob(self, client, app, fake_db):
        _as_user(app, OWNER_ID)

        # 1. First save (insert).
        fake_db._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=None),
        ]
        put_resp = client.put(
            f"/api/v1/storage/documents/{DOC_ID}/layers", json=_SAMPLE_BLOB
        )
        assert put_resp.status_code == 200
        saved_row = next(o for o in fake_db.added if isinstance(o, DocumentLayers))

        # 2. GET reads back the row persisted by the PUT.
        fake_db._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=saved_row),
        ]
        get_resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/layers")

        assert get_resp.status_code == 200
        assert get_resp.json()["data"]["layers"] == put_resp.json()["data"]["layers"]
        assert (
            get_resp.json()["data"]["membership"]
            == put_resp.json()["data"]["membership"]
        )
