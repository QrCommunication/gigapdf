"""
Integration tests for the GED storage endpoints.

Routes under test:
  POST   /api/v1/storage/documents/{id}/duplicate  → server-side S3 copy
  DELETE /api/v1/storage/documents/{id}            → soft delete (trash)
  DELETE /api/v1/storage/documents/{id}?permanent=true → hard delete
  POST   /api/v1/storage/documents/{id}/restore    → restore from trash
  GET    /api/v1/storage/documents?trashed=true    → trash listing
  PATCH  /api/v1/storage/documents/{id}            → tags / extracted_text update
  PATCH  /api/v1/storage/folders/{id}              → rename folder (409 on conflict)
  POST   /api/v1/storage/documents/{id}/thumbnail  → magic-bytes validation

Strategy
--------
- ``get_current_user`` is overridden via app.dependency_overrides (no JWT).
- ``get_db`` is overridden with a scripted FakeSession: each test enqueues
  the results its handler will receive, in execution order.
- ``quota_service`` / ``s3_service`` / ``activity_service`` singletons are
  monkeypatched (the router holds references to the same instances).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.middleware.auth import CurrentUser, get_current_user
from app.models.database import DocumentVersion, Folder, StoredDocument

TEST_USER_ID = "test-user-ged-00000000-0000-0000-0000-000000000001"
DOC_ID = "770e8400-e29b-41d4-a716-446655440002"
FOLDER_ID = "660e8400-e29b-41d4-a716-446655440001"

_FAKE_USER = CurrentUser(user_id=TEST_USER_ID, email="ged@example.com")

SIGNED_URL = "https://s3.example/signed-thumbnail-url"


# ---------------------------------------------------------------------------
# Scripted fake AsyncSession
# ---------------------------------------------------------------------------

class FakeResult:
    """Mimics the subset of sqlalchemy Result used by the storage router."""

    def __init__(self, *, scalar=None, scalars_list=None, rows=None):
        self._scalar = scalar
        self._scalars_list = scalars_list if scalars_list is not None else []
        self._rows = rows if rows is not None else []

    def scalar_one_or_none(self):
        return self._scalar

    def scalar(self):
        return self._scalar

    def scalars(self):
        items = list(self._scalars_list)
        return SimpleNamespace(all=lambda: items)

    def all(self):
        return list(self._rows)

    def one(self):
        return self._rows[0]


class FakeSession:
    """AsyncSession stand-in returning scripted results in order."""

    def __init__(self, results: list[FakeResult] | None = None):
        self._results = list(results or [])
        self.added: list = []
        self.deleted: list = []
        self.commit_count = 0

    async def execute(self, stmt, *args, **kwargs):
        if not self._results:
            raise AssertionError(
                f"FakeSession: unexpected execute() call for statement: {stmt}"
            )
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

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
        owner_id=TEST_USER_ID,
        folder_id=None,
        page_count=3,
        current_version=2,
        file_size_bytes=1024,
        mime_type="application/pdf",
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


def _make_version(**overrides) -> DocumentVersion:
    defaults = dict(
        document_id=DOC_ID,
        version_number=2,
        file_path=f"documents/{TEST_USER_ID}/{DOC_ID}/v2.pdf",
        file_size_bytes=1024,
        file_hash="a" * 64,
        created_by=TEST_USER_ID,
        is_encrypted=False,
        encryption_key=None,
    )
    defaults.update(overrides)
    return DocumentVersion(**defaults)


def _make_folder(**overrides) -> Folder:
    now = datetime.now(UTC)
    defaults = dict(
        id=FOLDER_ID,
        name="Dossier",
        owner_id=TEST_USER_ID,
        parent_id=None,
        path="/",
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return Folder(**defaults)


def _personal_limits(**overrides) -> SimpleNamespace:
    defaults = dict(
        storage_used_bytes=0,
        storage_limit_bytes=5 * 1024 * 1024 * 1024,
        document_count=1,
        document_limit=1000,
        is_tenant_based=False,
        tenant_id=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_db(app):
    """Install a scripted FakeSession behind the get_db dependency."""
    session = FakeSession()

    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
    yield session
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    """Neutralize the Redis-backed rate limiter.

    The sliding-window counters live in the local Redis and persist across
    pytest runs: without this, repeated runs exhaust the per-category budget
    (e.g. "upload": 10/min) and endpoints start returning 429.
    """
    limiter = SimpleNamespace(
        is_allowed=AsyncMock(return_value=(True, 999, 60)),
    )
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


@pytest.fixture
def services(monkeypatch):
    """Monkeypatch the service singletons referenced by the storage router."""
    from app.api.v1 import storage as storage_module

    mocks = SimpleNamespace(
        get_effective_limits=AsyncMock(return_value=_personal_limits()),
        update_storage_usage=AsyncMock(),
        update_tenant_storage=AsyncMock(),
        log_activity=AsyncMock(return_value="activity-id"),
        copy_file=MagicMock(return_value={"dest_key": "x"}),
        upload_file=MagicMock(return_value={"key": "x"}),
        delete_file=MagicMock(return_value=True),
        get_presigned_url=MagicMock(return_value=SIGNED_URL),
    )

    qs = storage_module.quota_service
    monkeypatch.setattr(qs, "get_effective_limits", mocks.get_effective_limits)
    monkeypatch.setattr(qs, "update_storage_usage", mocks.update_storage_usage)
    monkeypatch.setattr(qs, "update_tenant_storage", mocks.update_tenant_storage)

    monkeypatch.setattr(
        storage_module.activity_service, "log_activity", mocks.log_activity
    )

    s3 = storage_module.s3_service
    monkeypatch.setattr(s3, "copy_file", mocks.copy_file)
    monkeypatch.setattr(s3, "upload_file", mocks.upload_file)
    monkeypatch.setattr(s3, "delete_file", mocks.delete_file)
    monkeypatch.setattr(s3, "get_presigned_url", mocks.get_presigned_url)

    return mocks


# ---------------------------------------------------------------------------
# Duplicate
# ---------------------------------------------------------------------------

class TestDuplicateDocument:
    def test_duplicate_success_server_side_copy(self, client: TestClient, fake_db, services):
        source = _make_doc(tags=["legal", "2024"], extracted_text="contenu indexé")
        version = _make_version()
        fake_db._results = [
            FakeResult(scalar=source),                       # source doc
            FakeResult(scalar=version),                      # current version
            FakeResult(rows=[("Contrat.pdf",)]),             # sibling names
        ]

        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/duplicate")

        assert resp.status_code == 201
        data = resp.json()["data"]
        assert data["name"] == "Contrat.pdf (copie)"
        assert data["tags"] == ["legal", "2024"]
        assert data["version"] == 1
        assert data["source_document_id"] == DOC_ID
        assert data["quota_source"] == "personal"
        assert data["stored_document_id"] != DOC_ID

        # Server-side S3 copy from the CURRENT version file to v1 of the copy
        services.copy_file.assert_called_once()
        kwargs = services.copy_file.call_args.kwargs
        assert kwargs["source_key"] == version.file_path
        assert kwargs["dest_key"] == (
            f"documents/{TEST_USER_ID}/{data['stored_document_id']}/v1.pdf"
        )

        # New StoredDocument + DocumentVersion rows committed
        assert len(fake_db.added) == 2
        new_doc = next(o for o in fake_db.added if isinstance(o, StoredDocument))
        new_version = next(o for o in fake_db.added if isinstance(o, DocumentVersion))
        assert new_doc.extracted_text == "contenu indexé"  # search material kept
        assert new_version.version_number == 1             # versions NOT copied
        assert fake_db.commit_count == 1

        # Quota consumed like an upload
        services.update_storage_usage.assert_awaited_once_with(
            TEST_USER_ID, 1024, delta_documents=1
        )

    def test_duplicate_increments_suffix_on_collision(self, client, fake_db, services):
        source = _make_doc()
        fake_db._results = [
            FakeResult(scalar=source),
            FakeResult(scalar=_make_version()),
            FakeResult(rows=[("Contrat.pdf",), ("Contrat.pdf (copie)",)]),
        ]

        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/duplicate")

        assert resp.status_code == 201
        assert resp.json()["data"]["name"] == "Contrat.pdf (copie 2)"

    def test_duplicate_unknown_document_returns_404(self, client, fake_db, services):
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/duplicate")

        assert resp.status_code == 404
        services.copy_file.assert_not_called()

    def test_duplicate_quota_exceeded_returns_400(self, client, fake_db, services):
        services.get_effective_limits.return_value = _personal_limits(
            storage_used_bytes=100, storage_limit_bytes=200
        )
        fake_db._results = [
            FakeResult(scalar=_make_doc(file_size_bytes=500)),
            FakeResult(scalar=_make_version(file_size_bytes=500)),
        ]

        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/duplicate")

        assert resp.status_code == 400
        services.copy_file.assert_not_called()
        assert fake_db.commit_count == 0


# ---------------------------------------------------------------------------
# Trash: soft delete / permanent delete
# ---------------------------------------------------------------------------

class TestDeleteDocument:
    def test_default_delete_is_soft(self, client, fake_db, services):
        doc = _make_doc()
        fake_db._results = [FakeResult(scalar=doc)]

        resp = client.delete(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["deleted"] is True
        assert data["permanent"] is False
        assert doc.is_deleted is True
        assert doc.deleted_at is not None
        assert fake_db.deleted == []  # row NOT removed
        services.delete_file.assert_not_called()  # S3 file kept
        services.update_storage_usage.assert_awaited_once_with(
            TEST_USER_ID, -1024, delta_documents=-1
        )

    def test_permanent_delete_removes_s3_and_db(self, client, fake_db, services):
        doc = _make_doc(thumbnail_path=f"thumbnails/{TEST_USER_ID}/{DOC_ID}.png")
        v1_key = f"documents/{TEST_USER_ID}/{DOC_ID}/v1.pdf"
        v2_key = f"documents/{TEST_USER_ID}/{DOC_ID}/v2.pdf"
        fake_db._results = [
            FakeResult(scalar=doc),
            FakeResult(rows=[(v1_key,), (v2_key,)]),  # version file paths
        ]

        resp = client.delete(
            f"/api/v1/storage/documents/{DOC_ID}", params={"permanent": "true"}
        )

        assert resp.status_code == 200
        assert resp.json()["data"]["permanent"] is True
        assert fake_db.deleted == [doc]  # DB row removed
        deleted_keys = [c.args[0] for c in services.delete_file.call_args_list]
        assert v1_key in deleted_keys
        assert v2_key in deleted_keys
        assert doc.thumbnail_path in deleted_keys
        # Active document → quota freed once
        services.update_storage_usage.assert_awaited_once_with(
            TEST_USER_ID, -1024, delta_documents=-1
        )

    def test_permanent_delete_of_trashed_doc_does_not_free_quota_twice(
        self, client, fake_db, services
    ):
        doc = _make_doc(is_deleted=True, deleted_at=datetime.now(UTC))
        fake_db._results = [
            FakeResult(scalar=doc),
            FakeResult(rows=[]),
        ]

        resp = client.delete(
            f"/api/v1/storage/documents/{DOC_ID}", params={"permanent": "true"}
        )

        assert resp.status_code == 200
        assert fake_db.deleted == [doc]
        # Quota was already freed at soft-delete time
        services.update_storage_usage.assert_not_awaited()

    def test_soft_delete_of_already_trashed_doc_returns_404(self, client, fake_db, services):
        # The soft-delete query filters out trashed documents → scripted None
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.delete(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

class TestRestoreDocument:
    def test_restore_success(self, client, fake_db, services):
        doc = _make_doc(is_deleted=True, deleted_at=datetime.now(UTC))
        fake_db._results = [FakeResult(scalar=doc)]

        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/restore")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["restored"] is True
        assert data["name"] == "Contrat.pdf"
        assert doc.is_deleted is False
        assert doc.deleted_at is None
        # Quota re-consumed after restore
        services.update_storage_usage.assert_awaited_once_with(
            TEST_USER_ID, 1024, delta_documents=1
        )

    def test_restore_of_non_trashed_doc_returns_404(self, client, fake_db, services):
        # The restore query only matches trashed docs → scripted None
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/restore")

        assert resp.status_code == 404
        services.update_storage_usage.assert_not_awaited()


# ---------------------------------------------------------------------------
# Trash listing
# ---------------------------------------------------------------------------

class TestTrashListing:
    def test_trashed_true_lists_only_trash_with_deleted_at(self, client, fake_db, services):
        trashed = _make_doc(is_deleted=True, deleted_at=datetime.now(UTC))
        fake_db._results = [
            FakeResult(scalar=1),                   # count
            FakeResult(scalars_list=[trashed]),     # page items
        ]

        resp = client.get("/api/v1/storage/documents", params={"trashed": "true"})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["pagination"]["total"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["deleted_at"] is not None

    def test_default_listing_serializes_deleted_at_null(self, client, fake_db, services):
        fake_db._results = [
            FakeResult(scalar=1),
            FakeResult(scalars_list=[_make_doc()]),
        ]

        resp = client.get("/api/v1/storage/documents")

        assert resp.status_code == 200
        item = resp.json()["data"]["items"][0]
        assert item["deleted_at"] is None


# ---------------------------------------------------------------------------
# PATCH document (tags / extracted_text)
# ---------------------------------------------------------------------------

class TestUpdateDocument:
    def test_patch_normalizes_tags(self, client, fake_db, services):
        doc = _make_doc()
        fake_db._results = [FakeResult(scalar=doc)]

        resp = client.patch(
            f"/api/v1/storage/documents/{DOC_ID}",
            json={"tags": ["  Facture ", "FACTURE", "Legal"]},
        )

        assert resp.status_code == 200
        assert resp.json()["data"]["tags"] == ["facture", "legal"]
        assert doc.tags == ["facture", "legal"]

    def test_patch_updates_extracted_text_and_name(self, client, fake_db, services):
        doc = _make_doc()
        fake_db._results = [FakeResult(scalar=doc)]

        resp = client.patch(
            f"/api/v1/storage/documents/{DOC_ID}",
            json={"name": "Renommé.pdf", "extracted_text": "nouveau contenu"},
        )

        assert resp.status_code == 200
        assert resp.json()["data"]["name"] == "Renommé.pdf"
        assert doc.extracted_text == "nouveau contenu"

    def test_patch_empty_body_returns_400(self, client, fake_db, services):
        resp = client.patch(f"/api/v1/storage/documents/{DOC_ID}", json={})

        assert resp.status_code == 400

    def test_patch_too_many_tags_returns_422(self, client, fake_db, services):
        resp = client.patch(
            f"/api/v1/storage/documents/{DOC_ID}",
            json={"tags": [f"t{i}" for i in range(25)]},
        )

        assert resp.status_code == 422  # pydantic validator rejection


# ---------------------------------------------------------------------------
# Folder rename
# ---------------------------------------------------------------------------

class TestRenameFolder:
    def test_rename_success(self, client, fake_db, services):
        folder = _make_folder()
        fake_db._results = [
            FakeResult(scalar=folder),  # ownership lookup
            FakeResult(scalar=0),       # sibling conflict count
        ]

        resp = client.patch(
            f"/api/v1/storage/folders/{FOLDER_ID}", json={"name": "Contrats 2024"}
        )

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["folder_id"] == FOLDER_ID
        assert data["name"] == "Contrats 2024"
        assert folder.name == "Contrats 2024"
        assert fake_db.commit_count == 1

    def test_rename_conflict_returns_409(self, client, fake_db, services):
        folder = _make_folder()
        fake_db._results = [
            FakeResult(scalar=folder),
            FakeResult(scalar=1),  # a sibling already uses the name
        ]

        resp = client.patch(
            f"/api/v1/storage/folders/{FOLDER_ID}", json={"name": "Déjà pris"}
        )

        assert resp.status_code == 409
        assert folder.name == "Dossier"  # unchanged
        assert fake_db.commit_count == 0

    def test_rename_unknown_folder_returns_404(self, client, fake_db, services):
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.patch(
            f"/api/v1/storage/folders/{FOLDER_ID}", json={"name": "Peu importe"}
        )

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Thumbnail upload
# ---------------------------------------------------------------------------

class TestUploadThumbnail:
    def test_png_upload_success(self, client, fake_db, services):
        doc = _make_doc()
        fake_db._results = [FakeResult(scalar=doc)]
        png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128

        resp = client.post(
            f"/api/v1/storage/documents/{DOC_ID}/thumbnail",
            files={"file": ("thumb.png", png_bytes, "image/png")},
        )

        assert resp.status_code == 200
        assert resp.json()["data"]["thumbnail_url"] == SIGNED_URL
        expected_key = f"thumbnails/{TEST_USER_ID}/{DOC_ID}.png"
        assert doc.thumbnail_path == expected_key
        assert services.upload_file.call_args.kwargs["key"] == expected_key
        assert services.upload_file.call_args.kwargs["content_type"] == "image/png"

    def test_invalid_magic_bytes_returns_400(self, client, fake_db, services):
        resp = client.post(
            f"/api/v1/storage/documents/{DOC_ID}/thumbnail",
            files={"file": ("thumb.png", b"%PDF-not-an-image", "image/png")},
        )

        assert resp.status_code == 400
        services.upload_file.assert_not_called()

    def test_oversized_thumbnail_returns_400(self, client, fake_db, services):
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024 + 1)

        resp = client.post(
            f"/api/v1/storage/documents/{DOC_ID}/thumbnail",
            files={"file": ("thumb.png", big, "image/png")},
        )

        assert resp.status_code == 400
        services.upload_file.assert_not_called()

    def test_extension_change_drops_old_s3_object(self, client, fake_db, services):
        old_key = f"thumbnails/{TEST_USER_ID}/{DOC_ID}.png"
        doc = _make_doc(thumbnail_path=old_key)
        fake_db._results = [FakeResult(scalar=doc)]
        webp = b"RIFF" + b"\x10\x00\x00\x00" + b"WEBP" + b"\x00" * 64

        resp = client.post(
            f"/api/v1/storage/documents/{DOC_ID}/thumbnail",
            files={"file": ("thumb.webp", webp, "image/webp")},
        )

        assert resp.status_code == 200
        assert doc.thumbnail_path == f"thumbnails/{TEST_USER_ID}/{DOC_ID}.webp"
        services.delete_file.assert_called_once_with(old_key)
