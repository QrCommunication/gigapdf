"""Admin deletion endpoints share the owner-side erasure and storage cleanup.

* ``DELETE /admin/users/{id}`` used to delete only the quota row (and failed
  on the organisation foreign keys); it now runs the account erasure.
* ``DELETE /admin/documents/{id}?permanent=true`` used to drop the row and
  leave every stored object behind; it now deletes the versions and the
  thumbnail after the commit, like the owner's permanent delete.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.dependencies.admin import get_current_admin_user
from app.core.database import get_db
from app.models.database import StoredDocument
from app.services.account_erasure_service import AccountErasureReport

DOC_ID = "6f1c0d52-5b8e-4a59-9d1e-0c7a1f6a9b01"
OWNER_ID = "owner-1"


class _Result:
    def __init__(self, scalar=None, rows=None):
        self._scalar, self._rows = scalar, rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def all(self):
        return self._rows


class _Session:
    def __init__(self, results):
        self.results = list(results)
        self.events: list[str] = []

    async def execute(self, *args, **kwargs):
        return self.results.pop(0)

    async def delete(self, obj):
        self.events.append("delete")

    async def commit(self):
        self.events.append("commit")


@pytest.fixture(autouse=True)
def adjust(monkeypatch):
    """The quota boundary: records a ``quota`` event in the caller's session.

    The event order proves the counter moves inside the document's own
    transaction (before its commit), never in a separate one after it.
    """
    from app.services.quota_service import quota_service

    async def record(session, *_args, **_kwargs):
        session.events.append("quota")

    mock = AsyncMock(side_effect=record)
    monkeypatch.setattr(quota_service, "adjust_document_storage", mock)
    return mock


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


@pytest.fixture
def as_admin(app):
    def install(session):
        async def override():
            yield session

        app.dependency_overrides[get_db] = override

    app.dependency_overrides[get_current_admin_user] = lambda: SimpleNamespace(user_id="admin")
    yield install
    app.dependency_overrides.pop(get_current_admin_user, None)
    app.dependency_overrides.pop(get_db, None)


class TestAdminDeleteUser:
    def test_unknown_user_is_404_and_nothing_is_erased(self, client, as_admin, monkeypatch):
        as_admin(_Session([]))
        service = SimpleNamespace(user_exists=AsyncMock(return_value=False), erase=AsyncMock())
        monkeypatch.setattr("app.api.v1.admin.users.account_erasure_service", service)

        resp = client.delete("/api/v1/admin/users/ghost")

        assert resp.status_code == 404
        service.erase.assert_not_awaited()

    def test_existing_user_goes_through_the_account_erasure(self, client, as_admin, monkeypatch):
        as_admin(_Session([]))
        report = AccountErasureReport(
            user_id="u1", storage_objects_deleted=2, deleted={"users": 1}, anonymized={}
        )
        service = SimpleNamespace(
            user_exists=AsyncMock(return_value=True), erase=AsyncMock(return_value=report)
        )
        monkeypatch.setattr("app.api.v1.admin.users.account_erasure_service", service)

        resp = client.delete("/api/v1/admin/users/u1")

        assert resp.status_code == 200
        assert resp.json()["deleted"] == {"users": 1}
        assert resp.json()["storage_objects_deleted"] == 2
        assert service.erase.await_args.args[1] == "u1"


class TestAdminPermanentDocumentDelete:
    def test_deletes_every_object_after_the_commit(self, client, as_admin, monkeypatch):
        doc = StoredDocument(
            id=DOC_ID, name="a.pdf", owner_id=OWNER_ID,
            thumbnail_path=f"thumbnails/{OWNER_ID}/{DOC_ID}.png",
        )
        versions = [(f"documents/{OWNER_ID}/{DOC_ID}/v1.pdf",), (f"documents/{OWNER_ID}/{DOC_ID}/v2.pdf",)]
        session = _Session([_Result(scalar=doc), _Result(rows=versions)])
        as_admin(session)
        from app.services.s3_service import s3_service

        def record(key):
            session.events.append(f"s3:{key}")
            return True

        monkeypatch.setattr(s3_service, "delete_file", MagicMock(side_effect=record))

        resp = client.delete(f"/api/v1/admin/documents/{DOC_ID}", params={"permanent": "true"})

        assert resp.status_code == 200
        assert session.events == [
            "quota",
            "delete",
            "commit",
            f"s3:documents/{OWNER_ID}/{DOC_ID}/v1.pdf",
            f"s3:documents/{OWNER_ID}/{DOC_ID}/v2.pdf",
            f"s3:thumbnails/{OWNER_ID}/{DOC_ID}.png",
        ]

    def test_soft_delete_keeps_the_objects(self, client, as_admin, monkeypatch):
        doc = StoredDocument(id=DOC_ID, name="a.pdf", owner_id=OWNER_ID)
        session = _Session([_Result(scalar=doc)])
        as_admin(session)
        from app.services.s3_service import s3_service

        delete_file = MagicMock(return_value=True)
        monkeypatch.setattr(s3_service, "delete_file", delete_file)

        resp = client.delete(f"/api/v1/admin/documents/{DOC_ID}")

        assert resp.status_code == 200
        assert doc.is_deleted is True
        assert session.events == ["quota", "commit"]
        delete_file.assert_not_called()


class TestAdminDocumentQuota:
    """Admin delete/restore used to skip the quota: a document an admin deleted
    kept counting against its owner, and a restored one was never charged."""

    SIZE = 4096

    def test_soft_delete_frees_the_owner_quota(self, client, as_admin, adjust):
        doc = StoredDocument(id=DOC_ID, name="a.pdf", owner_id=OWNER_ID,
                             file_size_bytes=self.SIZE, is_deleted=False)
        session = _Session([_Result(scalar=doc)])
        as_admin(session)

        resp = client.delete(f"/api/v1/admin/documents/{DOC_ID}")

        assert resp.status_code == 200
        adjust.assert_awaited_once_with(session, _DocumentOwnedBy(OWNER_ID), -self.SIZE, -1)
        assert session.events == ["quota", "commit"]

    def test_permanent_delete_of_a_trashed_document_does_not_free_twice(
        self, client, as_admin, adjust, monkeypatch
    ):
        doc = StoredDocument(id=DOC_ID, name="a.pdf", owner_id=OWNER_ID,
                             file_size_bytes=self.SIZE, is_deleted=True)
        as_admin(_Session([_Result(scalar=doc), _Result(rows=[])]))
        from app.services.s3_service import s3_service

        monkeypatch.setattr(s3_service, "delete_file", MagicMock(return_value=True))

        resp = client.delete(f"/api/v1/admin/documents/{DOC_ID}", params={"permanent": "true"})

        assert resp.status_code == 200
        adjust.assert_not_awaited()

    def test_restore_charges_the_owner_quota_again(self, client, as_admin, adjust):
        doc = StoredDocument(id=DOC_ID, name="a.pdf", owner_id=OWNER_ID,
                             file_size_bytes=self.SIZE, is_deleted=True)
        session = _Session([_Result(scalar=doc)])
        as_admin(session)

        resp = client.post(f"/api/v1/admin/documents/{DOC_ID}/restore")

        assert resp.status_code == 200
        assert doc.is_deleted is False
        adjust.assert_awaited_once_with(session, _DocumentOwnedBy(OWNER_ID), self.SIZE, 1)
        assert session.events == ["quota", "commit"]


class _DocumentOwnedBy:
    """Matches the document passed to ``adjust_document_storage`` (by owner)."""

    def __init__(self, owner_id: str):
        self.owner_id = owner_id

    def __eq__(self, other) -> bool:
        return getattr(other, "owner_id", None) == self.owner_id

    def __repr__(self) -> str:
        return f"<document owned by {self.owner_id}>"
