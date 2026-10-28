"""Storage quota counters move in the same transaction as the document write.

Before: every route committed the document write (upload, duplicate, delete,
restore...) and only THEN updated ``user_quotas`` / ``tenants`` in a second,
separately committed session, with a read-modify-write. A failure between the
two commits left the counters out of sync for good (nothing reconciles them),
and two concurrent requests on the same quota overwrote each other.

Now ``quota_service.adjust_document_storage(session, ...)`` issues an atomic
``GREATEST(0, used + delta)`` in the CALLER's session, before its commit. What
only a real PostgreSQL can prove, and this module checks through the real route
code:

* a failing counter write rolls the document write back (and vice versa);
* on success the counters move exactly once: trash-then-permanent-delete frees
  once, restore charges once, concurrent restores/deletes are serialized;
* two concurrent increments of the same quota are both counted, whether the
  row exists or is created by the increment;
* the organisation counters are used for a member of an active organisation.

Failures are injected with PostgreSQL triggers on the target table, so the
error comes from the database itself at the exact statement that fails.
Runs against a throwaway database (``pg_schema_db``) through the ``factory``,
``boundaries`` and ``fail_writes`` fixtures of tests/integration/conftest.py.
"""

from __future__ import annotations

import asyncio
import io
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

USER_ID = "user-quota-1"
SIZE = 1000


USER = SimpleNamespace(user_id=USER_ID, email="owner@example.com")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_quota(factory, used: int, count: int, user_id: str = USER_ID) -> str:
    from app.models.database import UserQuota

    async with factory() as db:
        quota = UserQuota(user_id=user_id, storage_used_bytes=used, document_count=count)
        db.add(quota)
        await db.commit()
        return quota.id


async def _seed_doc(
    factory,
    size: int = SIZE,
    *,
    trashed: bool = False,
    folder_id: str | None = None,
    owner_id: str = USER_ID,
    quota_tenant_id=None,
) -> str:
    from app.models.database import DocumentVersion, StoredDocument

    async with factory() as db:
        doc = StoredDocument(
            name="contrat.pdf",
            owner_id=owner_id,
            folder_id=folder_id,
            quota_tenant_id=str(quota_tenant_id) if quota_tenant_id else None,
            file_size_bytes=size,
            is_deleted=trashed,
            deleted_at=datetime.now(UTC) - timedelta(days=40) if trashed else None,
        )
        db.add(doc)
        await db.flush()
        db.add(
            DocumentVersion(
                document_id=doc.id,
                version_number=1,
                file_path=f"documents/{owner_id}/{doc.id}/v1.pdf",
                file_size_bytes=size,
                file_hash="a" * 64,
                created_by=owner_id,
            )
        )
        await db.commit()
        return doc.id


async def _counters(factory, user_id: str = USER_ID) -> tuple[int, int] | None:
    from app.models.database import UserQuota

    async with factory() as db:
        row = (
            await db.execute(
                select(UserQuota.storage_used_bytes, UserQuota.document_count).where(
                    UserQuota.user_id == user_id
                )
            )
        ).one_or_none()
        return None if row is None else (row[0], row[1])


async def _tenant_counters(factory, tenant_id) -> tuple[int, int]:
    from app.models.tenant import Tenant

    async with factory() as db:
        row = (
            await db.execute(
                select(Tenant.storage_used_bytes, Tenant.document_count).where(
                    Tenant.id == tenant_id
                )
            )
        ).one()
        return row[0], row[1]


async def _doc_state(factory, doc_id: str):
    """``None`` when the row is gone, else ``(is_deleted, file_size_bytes, version)``."""
    from app.models.database import StoredDocument

    async with factory() as db:
        row = (
            await db.execute(
                select(
                    StoredDocument.is_deleted,
                    StoredDocument.file_size_bytes,
                    StoredDocument.current_version,
                ).where(StoredDocument.id == doc_id)
            )
        ).one_or_none()
        return None if row is None else tuple(row)


async def _document_count(factory) -> int:
    from app.models.database import StoredDocument

    async with factory() as db:
        return (await db.execute(select(func.count()).select_from(StoredDocument))).scalar_one()


async def _call(route, **kwargs):
    """Run a route with the request session of ``get_db`` (commit/rollback on exit)."""
    from app.core.database import get_db_session

    async with get_db_session() as db:
        return await route(db=db, **kwargs)


def _document(owner_id: str = USER_ID, quota_tenant_id: str | None = None) -> SimpleNamespace:
    """The document shape ``adjust_document_storage`` reads (owner + attribution)."""
    return SimpleNamespace(owner_id=owner_id, quota_tenant_id=quota_tenant_id, file_size_bytes=0)


def _pdf_bytes(pages: int = 1) -> bytes:
    import pikepdf

    pdf = pikepdf.new()
    for _ in range(pages):
        pdf.add_blank_page()
    buffer = io.BytesIO()
    pdf.save(buffer)
    return buffer.getvalue()


def _upload(data: bytes, name: str = "contrat.pdf"):
    from fastapi import UploadFile
    from starlette.datastructures import Headers

    return UploadFile(
        file=io.BytesIO(data),
        filename=name,
        headers=Headers({"content-type": "application/pdf"}),
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


class TestUpload:
    async def _save(self, data: bytes):
        from app.api.v1.storage import save_document

        return await save_document(
            user=USER,
            file=_upload(data),
            name="contrat.pdf",
            folder_id=None,
            tags=None,
            version_comment=None,
            extracted_text=None,
        )

    async def test_upload_charges_the_quota_once(self, factory, boundaries):
        await _seed_quota(factory, 0, 0)
        data = _pdf_bytes()

        await self._save(data)

        assert await _counters(factory) == (len(data), 1)
        assert await _document_count(factory) == 1

    async def test_a_failing_quota_write_rolls_the_upload_back(
        self, factory, boundaries, fail_writes
    ):
        await _seed_quota(factory, 0, 0)
        fail_writes("user_quotas", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on user_quotas"):
            await self._save(_pdf_bytes())

        # Before: the document was committed first, then the quota update
        # failed — a stored document that never counted.
        assert await _document_count(factory) == 0
        assert await _counters(factory) == (0, 0)
        # The object goes first now, and is removed when its rows do not land.
        key = boundaries.upload_file.call_args.kwargs["key"]
        boundaries.delete_file.assert_called_once_with(key)

    async def test_a_failing_document_write_leaves_the_quota_unchanged(
        self, factory, boundaries, fail_writes
    ):
        await _seed_quota(factory, 0, 0)
        fail_writes("document_versions", "INSERT")

        with pytest.raises(DBAPIError, match="injected failure on document_versions"):
            await self._save(_pdf_bytes())

        assert await _document_count(factory) == 0
        assert await _counters(factory) == (0, 0)


# ---------------------------------------------------------------------------
# Duplicate
# ---------------------------------------------------------------------------


class TestDuplicate:
    async def test_duplicate_charges_the_quota_once(self, factory, boundaries):
        from app.api.v1.storage import duplicate_stored_document

        await _seed_quota(factory, SIZE, 1)
        doc_id = await _seed_doc(factory)

        await _call(duplicate_stored_document, stored_document_id=doc_id, user=USER)

        assert await _counters(factory) == (2 * SIZE, 2)
        assert await _document_count(factory) == 2

    async def test_a_failing_quota_write_rolls_the_copy_back(
        self, factory, boundaries, fail_writes
    ):
        from app.api.v1.storage import duplicate_stored_document
        from app.middleware.error_handler import InvalidOperationError

        await _seed_quota(factory, SIZE, 1)
        doc_id = await _seed_doc(factory)
        fail_writes("user_quotas", "UPDATE")

        with pytest.raises(InvalidOperationError, match="injected failure"):
            await _call(duplicate_stored_document, stored_document_id=doc_id, user=USER)

        assert await _document_count(factory) == 1
        assert await _counters(factory) == (SIZE, 1)
        boundaries.delete_file.assert_called_once()  # the S3 copy is compensated


# ---------------------------------------------------------------------------
# Delete / permanent delete / restore (owner)
# ---------------------------------------------------------------------------


class TestOwnerDeleteAndRestore:
    # 5000 bytes / 3 documents: the counters never reach the zero clamp, so a
    # double free would show instead of being absorbed by GREATEST(0, ...).
    USED, COUNT = 5000, 3

    async def _delete(self, doc_id: str, permanent: bool = False):
        from app.api.v1.storage import delete_stored_document

        return await _call(
            delete_stored_document, stored_document_id=doc_id, user=USER, permanent=permanent
        )

    async def _restore(self, doc_id: str):
        from app.api.v1.storage import restore_stored_document

        return await _call(restore_stored_document, stored_document_id=doc_id, user=USER)

    async def test_trash_then_permanent_delete_frees_once(self, factory, boundaries):
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory)

        await self._delete(doc_id)
        assert await _counters(factory) == (self.USED - SIZE, self.COUNT - 1)
        assert await _doc_state(factory, doc_id) == (True, SIZE, 1)

        await self._delete(doc_id, permanent=True)
        assert await _counters(factory) == (self.USED - SIZE, self.COUNT - 1)
        assert await _doc_state(factory, doc_id) is None

    async def test_permanent_delete_of_an_active_document_frees_once(
        self, factory, boundaries
    ):
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory)

        await self._delete(doc_id, permanent=True)

        assert await _counters(factory) == (self.USED - SIZE, self.COUNT - 1)
        assert await _doc_state(factory, doc_id) is None
        boundaries.delete_file.assert_called()  # objects removed after the commit

    async def test_restore_charges_once(self, factory, boundaries):
        from app.middleware.error_handler import NotFoundError

        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory, trashed=True)

        await self._restore(doc_id)
        assert await _counters(factory) == (self.USED + SIZE, self.COUNT + 1)

        with pytest.raises(NotFoundError):
            await self._restore(doc_id)
        assert await _counters(factory) == (self.USED + SIZE, self.COUNT + 1)

    @pytest.mark.parametrize("permanent", [False, True])
    async def test_a_failing_quota_write_rolls_the_delete_back(
        self, factory, boundaries, fail_writes, permanent
    ):
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory)
        fail_writes("user_quotas", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on user_quotas"):
            await self._delete(doc_id, permanent=permanent)

        # Before: the delete was committed, then the quota update failed — a
        # document gone from the active set that still counted forever.
        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _counters(factory) == (self.USED, self.COUNT)
        boundaries.delete_file.assert_not_called()

    async def test_a_failing_document_write_leaves_the_quota_unchanged(
        self, factory, boundaries, fail_writes
    ):
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory)
        fail_writes("stored_documents", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on stored_documents"):
            await self._delete(doc_id)

        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _counters(factory) == (self.USED, self.COUNT)

    async def test_a_failing_quota_write_rolls_the_restore_back(
        self, factory, boundaries, fail_writes
    ):
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory, trashed=True)
        fail_writes("user_quotas", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on user_quotas"):
            await self._restore(doc_id)

        assert await _doc_state(factory, doc_id) == (True, SIZE, 1)
        assert await _counters(factory) == (self.USED, self.COUNT)

    async def test_concurrent_restores_charge_once(self, factory, boundaries):
        from app.middleware.error_handler import NotFoundError

        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory, trashed=True)

        results = await asyncio.gather(
            self._restore(doc_id), self._restore(doc_id), return_exceptions=True
        )

        # The row lock serializes them; the second re-reads a restored
        # document and no longer finds it in the trash.
        assert sorted(type(r).__name__ for r in results) == sorted(
            ["APIResponse", NotFoundError.__name__]
        )
        assert await _counters(factory) == (self.USED + SIZE, self.COUNT + 1)

    async def test_concurrent_deletes_free_once(self, factory, boundaries):
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory)

        results = await asyncio.gather(
            self._delete(doc_id), self._delete(doc_id, permanent=True), return_exceptions=True
        )

        assert not [r for r in results if isinstance(r, Exception)], results
        assert await _doc_state(factory, doc_id) is None
        assert await _counters(factory) == (self.USED - SIZE, self.COUNT - 1)

    async def test_trash_purge_does_not_free_again(self, factory, boundaries, monkeypatch):
        from app.services.s3_service import s3_service
        from app.tasks.storage_tasks import purge_trashed_documents

        monkeypatch.setattr(s3_service, "delete_file", MagicMock(return_value=True))
        await _seed_quota(factory, self.USED, self.COUNT)
        doc_id = await _seed_doc(factory)

        await self._delete(doc_id)
        async with factory() as db:  # trashed long ago: due for the purge
            await db.execute(
                text("UPDATE stored_documents SET deleted_at = now() - interval '40 days'")
            )
            await db.commit()
        stats = await asyncio.to_thread(purge_trashed_documents.run, retention_days=30)

        assert stats["purged_count"] == 1
        assert await _doc_state(factory, doc_id) is None
        assert await _counters(factory) == (self.USED - SIZE, self.COUNT - 1)


# ---------------------------------------------------------------------------
# New version / revert to v1: the size change follows the quota
# ---------------------------------------------------------------------------


class TestVersionSize:
    async def _new_version(self, doc_id: str, data: bytes):
        from app.api.v1.storage import create_version

        return await create_version(
            stored_document_id=doc_id,
            user=USER,
            file=_upload(data),
            comment=None,
            extracted_text=None,
        )

    async def test_a_new_version_moves_the_quota_by_the_size_difference(
        self, factory, boundaries
    ):
        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory)
        data = _pdf_bytes(pages=3)

        await self._new_version(doc_id, data)
        assert await _counters(factory) == (5000 - SIZE + len(data), 3)

        # Deleting the document now frees exactly what is counted.
        from app.api.v1.storage import delete_stored_document

        await _call(delete_stored_document, stored_document_id=doc_id, user=USER, permanent=False)
        assert await _counters(factory) == (5000 - SIZE, 2)

    async def test_a_failed_upload_reverts_the_size_and_the_quota(
        self, factory, boundaries
    ):
        from app.middleware.error_handler import InvalidOperationError

        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory)
        boundaries.upload_file.side_effect = ConnectionError("object storage down")

        with pytest.raises(InvalidOperationError):
            await self._new_version(doc_id, _pdf_bytes(pages=3))

        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _counters(factory) == (5000, 3)

    async def test_a_failing_quota_write_rolls_the_version_back(
        self, factory, boundaries, fail_writes
    ):
        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory)
        fail_writes("user_quotas", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on user_quotas"):
            await self._new_version(doc_id, _pdf_bytes(pages=3))

        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _counters(factory) == (5000, 3)
        key = boundaries.upload_file.call_args.kwargs["key"]
        boundaries.delete_file.assert_called_once_with(key)


# ---------------------------------------------------------------------------
# Folder cascade delete
# ---------------------------------------------------------------------------


class TestFolderCascade:
    async def test_cascade_frees_the_active_documents_once(self, factory, boundaries):
        from app.api.v1.storage import delete_folder
        from app.models.database import Folder

        async with factory() as db:
            folder = Folder(name="Contrats", owner_id=USER_ID)
            db.add(folder)
            await db.commit()
            folder_id = folder.id
        await _seed_quota(factory, 5000, 3)
        active_id = await _seed_doc(factory, folder_id=folder_id)
        trashed_id = await _seed_doc(factory, 400, trashed=True, folder_id=folder_id)
        trashed_at_before = await self._deleted_at(factory, trashed_id)

        await _call(delete_folder, folder_id=folder_id, user=USER, cascade=True)

        # Before: the documents went to the trash without freeing anything.
        assert await _counters(factory) == (5000 - SIZE, 2)
        assert (await _doc_state(factory, active_id))[0] is True
        # Already trashed (and freed): untouched, its purge date is kept.
        assert await self._deleted_at(factory, trashed_id) == trashed_at_before

    async def test_a_failing_quota_write_rolls_the_cascade_back(
        self, factory, boundaries, fail_writes
    ):
        from app.api.v1.storage import delete_folder
        from app.models.database import Folder

        async with factory() as db:
            folder = Folder(name="Contrats", owner_id=USER_ID)
            db.add(folder)
            await db.commit()
            folder_id = folder.id
        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory, folder_id=folder_id)
        fail_writes("user_quotas", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on user_quotas"):
            await _call(delete_folder, folder_id=folder_id, user=USER, cascade=True)

        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _counters(factory) == (5000, 3)

    @staticmethod
    async def _deleted_at(factory, doc_id):
        from app.models.database import StoredDocument

        async with factory() as db:
            return (
                await db.execute(
                    select(StoredDocument.deleted_at).where(StoredDocument.id == doc_id)
                )
            ).scalar_one()


# ---------------------------------------------------------------------------
# Admin delete / restore: the counting quota is resolved in-session
# ---------------------------------------------------------------------------


class TestAdminPathsAndOrganisations:
    async def _member_of_active_tenant(self, factory, used=8000, count=4):
        from app.models.tenant import Tenant, TenantMember, TenantRole, TenantStatus

        quota_id = await _seed_quota(factory, 100, 1)
        async with factory() as db:
            tenant = Tenant(
                name="Acme",
                slug=f"acme-{uuid.uuid4().hex[:8]}",
                email="acme@example.com",
                status=TenantStatus.ACTIVE,
                storage_used_bytes=used,
                document_count=count,
            )
            db.add(tenant)
            await db.flush()
            db.add(TenantMember(tenant_id=tenant.id, user_id=quota_id, role=TenantRole.MEMBER))
            await db.commit()
            return tenant.id

    async def test_admin_delete_and_restore_move_the_organisation_counters(
        self, factory, boundaries
    ):
        from app.api.v1.admin.documents import delete_document, restore_document

        tenant_id = await self._member_of_active_tenant(factory)
        doc_id = await _seed_doc(factory, quota_tenant_id=tenant_id)

        await _call(delete_document, document_id=doc_id, permanent=False)
        assert await _tenant_counters(factory, tenant_id) == (8000 - SIZE, 3)
        assert await _counters(factory) == (100, 1)  # personal quota untouched

        await _call(restore_document, document_id=doc_id)
        assert await _tenant_counters(factory, tenant_id) == (8000, 4)

        await _call(delete_document, document_id=doc_id, permanent=False)
        await _call(delete_document, document_id=doc_id, permanent=True)
        assert await _tenant_counters(factory, tenant_id) == (8000 - SIZE, 3)

    async def test_a_failing_organisation_write_rolls_the_admin_delete_back(
        self, factory, boundaries, fail_writes
    ):
        from app.api.v1.admin.documents import delete_document

        tenant_id = await self._member_of_active_tenant(factory)
        doc_id = await _seed_doc(factory, quota_tenant_id=tenant_id)
        fail_writes("tenants", "UPDATE")

        with pytest.raises(DBAPIError, match="injected failure on tenants"):
            await _call(delete_document, document_id=doc_id, permanent=False)

        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _tenant_counters(factory, tenant_id) == (8000, 4)


# ---------------------------------------------------------------------------
# The atomic increment itself
# ---------------------------------------------------------------------------


class TestAtomicIncrement:
    async def _two_concurrent_increments(self, factory, user_id: str) -> None:
        """B's increment waits on A's row lock, then adds to A's committed value."""
        from app.services.quota_service import quota_service

        async with factory() as first, factory() as second:
            await quota_service.adjust_document_storage(first, _document(user_id), 300, 1)
            blocked = asyncio.create_task(
                quota_service.adjust_document_storage(second, _document(user_id), 200, 1)
            )
            await asyncio.sleep(0.3)
            assert not blocked.done(), "the second increment should wait for the row lock"
            await first.commit()
            await blocked
            await second.commit()

    async def test_concurrent_increments_on_an_existing_quota_are_both_counted(self, factory):
        await _seed_quota(factory, 1000, 2)

        await self._two_concurrent_increments(factory, USER_ID)

        # A read-modify-write would have kept only one of them (1300 or 1200).
        assert await _counters(factory) == (1500, 4)

    async def test_concurrent_increments_create_the_missing_quota_once(self, factory):
        await self._two_concurrent_increments(factory, "user-without-quota")

        assert await _counters(factory, "user-without-quota") == (500, 2)

    async def test_counters_never_go_below_zero(self, factory):
        from app.services.quota_service import quota_service

        await _seed_quota(factory, 100, 1)
        async with factory() as db:
            await quota_service.adjust_document_storage(db, _document(), -1000, -5)
            await db.commit()

        assert await _counters(factory) == (0, 0)

    async def test_nothing_is_written_until_the_caller_commits(self, factory):
        from app.services.quota_service import quota_service

        await _seed_quota(factory, 100, 1)
        async with factory() as db:
            await quota_service.adjust_document_storage(db, _document(), 50, 1)
            await db.rollback()

        assert await _counters(factory) == (100, 1)

    async def test_a_vanished_organisation_fails_the_callers_transaction(self, factory):
        from app.services.quota_service import EffectiveLimits, quota_service

        limits = EffectiveLimits(
            storage_limit_bytes=-1, storage_used_bytes=0, api_calls_limit=-1,
            api_calls_used=0, document_limit=-1, document_count=0,
            plan_type="enterprise", is_tenant_based=True, tenant_id=str(uuid.uuid4()),
        )
        async with factory() as db:
            with pytest.raises(ValueError, match="Tenant not found"):
                await quota_service.adjust_document_storage(
                    db, _document(), 10, 1, limits=limits
                )
