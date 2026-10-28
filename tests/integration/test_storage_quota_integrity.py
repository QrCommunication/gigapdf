"""Storage integrity beyond the atomic counter moves: object order, folders,
attribution, reconciliation.

Each class pins a defect that the atomic counter work left in place, checked
through the real route code on a real PostgreSQL (``pg_schema_db`` +
``factory``/``boundaries`` fixtures, tests/integration/conftest.py):

* ``TestObjectBeforeRows`` — upload, new version, restore-to-v1 and duplicate
  used to COMMIT the document rows (and their quota) before the object
  existed: an object-storage failure left a counted document pointing at
  nothing. The object now goes first; rows that do not land (failing
  statement, failing COMMIT) take it away, and an ambiguous COMMIT that did
  land keeps it.
* ``TestFolderSubtree`` — deleting a folder only looked at its DIRECT
  documents: the documents of its sub-folders stayed active and were moved
  to the root by the ``folder_id ON DELETE SET NULL`` foreign key.
* ``TestQuotaAttribution`` — the counter to free was the owner's membership
  at delete time, so a document charged to an organization and freed after
  its owner left it hit the personal quota (and the organization counted it
  forever). The counter is now recorded on the document.
* ``TestReconciliation`` — counters that drifted before all this are
  recomputed from the documents (dry run, apply, idempotent second run).
"""

from __future__ import annotations

import importlib.util
import io
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.integration.test_storage_quota_atomicity import (
    SIZE,
    USER,
    USER_ID,
    _call,
    _counters,
    _doc_state,
    _document_count,
    _pdf_bytes,
    _seed_doc,
    _seed_quota,
    _tenant_counters,
    _upload,
)

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_tenant(factory, used: int = 0, count: int = 0) -> str:
    from app.models.tenant import Tenant, TenantStatus

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
        await db.commit()
        return str(tenant.id)


async def _join(factory, tenant_id: str, quota_id: str) -> None:
    from app.models.tenant import TenantMember, TenantRole

    async with factory() as db:
        db.add(TenantMember(tenant_id=tenant_id, user_id=quota_id, role=TenantRole.MEMBER))
        await db.commit()


async def _leave(factory, tenant_id: str) -> None:
    async with factory() as db:
        await db.execute(
            text("UPDATE tenant_members SET is_active = false WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
        await db.commit()


async def _attribution(factory, doc_id: str) -> str | None:
    from app.models.database import StoredDocument

    async with factory() as db:
        value = (
            await db.execute(
                select(StoredDocument.quota_tenant_id).where(StoredDocument.id == doc_id)
            )
        ).scalar_one()
        return None if value is None else str(value)


async def _versions(factory, doc_id: str) -> list[int]:
    from app.models.database import DocumentVersion

    async with factory() as db:
        return sorted(
            (
                await db.execute(
                    select(DocumentVersion.version_number).where(
                        DocumentVersion.document_id == doc_id
                    )
                )
            ).scalars()
        )


async def _save(data: bytes, folder_id: str | None = None):
    from app.api.v1.storage import save_document

    return await save_document(
        user=USER,
        file=_upload(data),
        name="contrat.pdf",
        folder_id=folder_id,
        tags=None,
        version_comment=None,
        extracted_text=None,
    )


async def _new_version(doc_id: str, data: bytes):
    from app.api.v1.storage import create_version

    return await create_version(
        stored_document_id=doc_id, user=USER, file=_upload(data), comment=None,
        extracted_text=None,
    )


def _lose_the_next_commit_answer(monkeypatch, object_write) -> None:
    """Once ``object_write`` (an object-storage mock) ran, the next COMMIT
    reaches the server but its answer is lost: the rows ARE committed and the
    caller sees an error — the ambiguous outcome of a dropped connection."""
    from sqlalchemy.ext.asyncio import AsyncSession

    real_commit = AsyncSession.commit
    state = {"armed": False}
    object_write.side_effect = lambda **kwargs: state.update(armed=True)

    async def commit(self):
        await real_commit(self)
        if state["armed"]:
            state["armed"] = False
            raise ConnectionError("connection lost after COMMIT")

    monkeypatch.setattr(AsyncSession, "commit", commit)


def _rows(pg_schema_db, sql: str) -> str:
    result = pg_schema_db.psql(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# 1. The object exists before any row points at it
# ---------------------------------------------------------------------------


class TestObjectBeforeRows:
    async def test_upload_writes_the_object_before_the_rows(
        self, factory, boundaries, pg_schema_db
    ):
        await _seed_quota(factory, 0, 0)
        rows_at_upload = []
        boundaries.upload_file.side_effect = lambda **kw: rows_at_upload.append(
            _rows(pg_schema_db, "SELECT count(*) FROM stored_documents")
        )

        await _save(_pdf_bytes())

        # Before: the row was committed (and counted) first.
        assert rows_at_upload == ["0"]
        assert await _document_count(factory) == 1

    async def test_a_failed_upload_writes_nothing(self, factory, boundaries):
        from app.middleware.error_handler import InvalidOperationError

        await _seed_quota(factory, 0, 0)
        boundaries.upload_file.side_effect = ConnectionError("object storage down")

        with pytest.raises(InvalidOperationError, match="upload failed"):
            await _save(_pdf_bytes())

        # Before: a document counted on the quota, pointing at no object.
        assert await _document_count(factory) == 0
        assert await _counters(factory) == (0, 0)

    async def test_a_failing_commit_removes_the_uploaded_object(
        self, factory, boundaries, fail_commit
    ):
        await _seed_quota(factory, 0, 0)
        fail_commit("stored_documents")

        with pytest.raises(DBAPIError, match="injected commit failure"):
            await _save(_pdf_bytes())

        assert await _document_count(factory) == 0
        assert await _counters(factory) == (0, 0)
        key = boundaries.upload_file.call_args.kwargs["key"]
        boundaries.delete_file.assert_called_once_with(key)

    async def test_a_commit_that_landed_despite_the_error_keeps_the_object(
        self, factory, boundaries, monkeypatch
    ):
        """The connection drops after COMMIT reached the server: rows exist."""
        await _seed_quota(factory, 0, 0)
        _lose_the_next_commit_answer(monkeypatch, boundaries.upload_file)

        with pytest.raises(ConnectionError):
            await _save(_pdf_bytes())

        assert await _document_count(factory) == 1
        boundaries.delete_file.assert_not_called()

    async def test_a_new_version_is_committed_only_after_its_object(
        self, factory, boundaries, pg_schema_db
    ):
        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory)
        seen = []
        boundaries.upload_file.side_effect = lambda **kw: seen.append(
            _rows(
                pg_schema_db,
                f"SELECT current_version FROM stored_documents WHERE id = '{doc_id}'",
            )
        )

        await _new_version(doc_id, _pdf_bytes(pages=2))

        # Before: v2 was already committed when its upload started.
        assert seen == ["1"]
        assert await _versions(factory, doc_id) == [1, 2]

    async def test_a_failing_version_commit_removes_its_object(
        self, factory, boundaries, fail_commit
    ):
        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory)
        fail_commit("document_versions")

        with pytest.raises(DBAPIError, match="injected commit failure"):
            await _new_version(doc_id, _pdf_bytes(pages=2))

        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _versions(factory, doc_id) == [1]
        assert await _counters(factory) == (5000, 3)
        key = boundaries.upload_file.call_args.kwargs["key"]
        assert key.endswith("/v2.pdf")
        boundaries.delete_file.assert_called_once_with(key)

    async def test_restore_original_commits_only_after_its_object(
        self, factory, boundaries, pg_schema_db, monkeypatch
    ):
        from app.api.v1 import storage as storage_module
        from app.api.v1.storage import restore_original

        await _seed_quota(factory, 5000, 3)
        doc_id = await _seed_doc(factory)
        async with factory() as db:
            await db.execute(
                text("UPDATE stored_documents SET current_version = 2 WHERE id = :d"),
                {"d": doc_id},
            )
            await db.commit()
        original = _pdf_bytes()
        monkeypatch.setattr(storage_module.s3_service, "download_file", lambda key: original)
        seen = []

        def upload_fails(**kwargs):
            seen.append(
                _rows(
                    pg_schema_db,
                    f"SELECT current_version FROM stored_documents WHERE id = '{doc_id}'",
                )
            )
            raise ConnectionError("object storage down")

        boundaries.upload_file.side_effect = upload_fails

        with pytest.raises(Exception, match="upload failed"):
            await restore_original(stored_document_id=doc_id, user=USER)

        # Before: v3 was already committed while its upload ran (then
        # reverted by a second transaction, which may itself fail).
        assert seen == ["2"]
        assert await _doc_state(factory, doc_id) == (False, SIZE, 2)
        assert await _versions(factory, doc_id) == [1]
        assert await _counters(factory) == (5000, 3)

    async def test_a_duplicate_whose_commit_landed_keeps_its_copy(
        self, factory, boundaries, monkeypatch
    ):
        from app.api.v1.storage import duplicate_stored_document
        from app.middleware.error_handler import InvalidOperationError

        await _seed_quota(factory, SIZE, 1)
        doc_id = await _seed_doc(factory)
        _lose_the_next_commit_answer(monkeypatch, boundaries.copy_file)

        with pytest.raises(InvalidOperationError):
            await _call(duplicate_stored_document, stored_document_id=doc_id, user=USER)

        # Before: the copy was deleted on any error — the committed duplicate
        # then pointed at a missing object.
        assert await _document_count(factory) == 2
        boundaries.delete_file.assert_not_called()


# ---------------------------------------------------------------------------
# 2. Deleting a folder covers its whole sub-tree
# ---------------------------------------------------------------------------


class TestFolderSubtree:
    async def _tree(self, factory) -> tuple[str, str, str]:
        """root / child / grandchild, owned by USER."""
        from app.models.database import Folder

        async with factory() as db:
            root = Folder(name="Clients", owner_id=USER_ID)
            db.add(root)
            await db.flush()
            child = Folder(name="Acme", owner_id=USER_ID, parent_id=root.id)
            db.add(child)
            await db.flush()
            grandchild = Folder(name="2026", owner_id=USER_ID, parent_id=child.id)
            db.add(grandchild)
            await db.commit()
            return root.id, child.id, grandchild.id

    async def _folders(self, factory) -> int:
        from sqlalchemy import func

        from app.models.database import Folder

        async with factory() as db:
            return (await db.execute(select(func.count()).select_from(Folder))).scalar_one()

    async def _folder_of(self, factory, doc_id: str):
        from app.models.database import StoredDocument

        async with factory() as db:
            return (
                await db.execute(
                    select(StoredDocument.folder_id).where(StoredDocument.id == doc_id)
                )
            ).scalar_one()

    async def test_a_document_in_a_sub_folder_blocks_the_delete(self, factory, boundaries):
        from app.api.v1.storage import delete_folder
        from app.middleware.error_handler import InvalidOperationError

        await _seed_quota(factory, 5000, 3)
        root, _, grandchild = await self._tree(factory)
        doc_id = await _seed_doc(factory, folder_id=grandchild)

        with pytest.raises(InvalidOperationError, match="sub-folders included"):
            await _call(delete_folder, folder_id=root, user=USER, cascade=False)

        # Before: the folders went, and the document — still active — was
        # silently moved to the root.
        assert await self._folders(factory) == 3
        assert await self._folder_of(factory, doc_id) == grandchild
        assert await _doc_state(factory, doc_id) == (False, SIZE, 1)
        assert await _counters(factory) == (5000, 3)

    async def test_cascade_trashes_the_whole_sub_tree_and_frees_it_once(
        self, factory, boundaries
    ):
        from app.api.v1.storage import delete_folder, restore_stored_document

        await _seed_quota(factory, 5000, 3)
        root, child, grandchild = await self._tree(factory)
        in_child = await _seed_doc(factory, folder_id=child)
        in_grandchild = await _seed_doc(factory, 300, folder_id=grandchild)

        result = await _call(delete_folder, folder_id=root, user=USER, cascade=True)

        # Before: only the root's direct documents were trashed and freed.
        assert (await _doc_state(factory, in_child))[0] is True
        assert (await _doc_state(factory, in_grandchild))[0] is True
        assert await _counters(factory) == (5000 - SIZE - 300, 1)
        assert await self._folders(factory) == 0
        assert result.data["deleted_folders"] == 3
        assert result.data["trashed_documents"] == 2

        # Folders have no trash: a restored document comes back at the root,
        # counted again exactly once.
        await _call(restore_stored_document, stored_document_id=in_grandchild, user=USER)
        assert await self._folder_of(factory, in_grandchild) is None
        assert await _counters(factory) == (5000 - SIZE, 2)

    async def test_a_sub_tree_holding_only_trashed_documents_is_deleted(
        self, factory, boundaries
    ):
        from app.api.v1.storage import delete_folder

        await _seed_quota(factory, 5000, 3)
        root, _, grandchild = await self._tree(factory)
        trashed = await _seed_doc(factory, trashed=True, folder_id=grandchild)

        await _call(delete_folder, folder_id=root, user=USER, cascade=False)

        assert await self._folders(factory) == 0
        assert await self._folder_of(factory, trashed) is None
        assert await _counters(factory) == (5000, 3)  # already freed when trashed

    async def test_someone_elses_folder_is_not_found(self, factory, boundaries):
        from app.api.v1.storage import delete_folder
        from app.middleware.error_handler import NotFoundError
        from app.models.database import Folder

        async with factory() as db:
            other = Folder(name="Privé", owner_id="someone-else")
            db.add(other)
            await db.commit()
            other_id = other.id

        with pytest.raises(NotFoundError):
            await _call(delete_folder, folder_id=other_id, user=USER, cascade=True)
        assert await self._folders(factory) == 1


# ---------------------------------------------------------------------------
# 3. The counter holding a document is recorded on it
# ---------------------------------------------------------------------------


class TestQuotaAttribution:
    PERSONAL_USED, PERSONAL_COUNT = 5000, 3
    TENANT_USED, TENANT_COUNT = 8000, 4

    async def _member(self, factory) -> str:
        quota_id = await _seed_quota(factory, self.PERSONAL_USED, self.PERSONAL_COUNT)
        tenant_id = await _seed_tenant(factory, self.TENANT_USED, self.TENANT_COUNT)
        await _join(factory, tenant_id, quota_id)
        return tenant_id

    async def test_an_upload_records_the_counter_it_charged(self, factory, boundaries):
        tenant_id = await self._member(factory)
        data = _pdf_bytes()

        result = await _save(data)

        doc_id = result.data["stored_document_id"]
        assert await _attribution(factory, doc_id) == tenant_id
        assert await _tenant_counters(factory, tenant_id) == (
            self.TENANT_USED + len(data), self.TENANT_COUNT + 1,
        )
        assert await _counters(factory) == (self.PERSONAL_USED, self.PERSONAL_COUNT)

    async def test_leave_then_delete_frees_the_organisation(self, factory, boundaries):
        from app.api.v1.storage import delete_stored_document

        tenant_id = await self._member(factory)
        doc_id = await _seed_doc(factory, quota_tenant_id=tenant_id)
        await _leave(factory, tenant_id)

        await _call(delete_stored_document, stored_document_id=doc_id, user=USER, permanent=False)

        # Before: freed on the personal quota, which never counted it, while
        # the organization kept counting a document in the trash.
        assert await _tenant_counters(factory, tenant_id) == (
            self.TENANT_USED - SIZE, self.TENANT_COUNT - 1,
        )
        assert await _counters(factory) == (self.PERSONAL_USED, self.PERSONAL_COUNT)

    async def test_leave_then_restore_charges_the_personal_quota_and_records_it(
        self, factory, boundaries
    ):
        from app.api.v1.storage import delete_stored_document, restore_stored_document

        tenant_id = await self._member(factory)
        doc_id = await _seed_doc(factory, quota_tenant_id=tenant_id)
        await _leave(factory, tenant_id)

        await _call(delete_stored_document, stored_document_id=doc_id, user=USER, permanent=False)
        await _call(restore_stored_document, stored_document_id=doc_id, user=USER)

        # Trashed: freed from the organization; restored after leaving it:
        # charged to the personal quota, which now holds it.
        assert await _tenant_counters(factory, tenant_id) == (
            self.TENANT_USED - SIZE, self.TENANT_COUNT - 1,
        )
        assert await _counters(factory) == (
            self.PERSONAL_USED + SIZE, self.PERSONAL_COUNT + 1,
        )
        assert await _attribution(factory, doc_id) is None

        await _call(delete_stored_document, stored_document_id=doc_id, user=USER, permanent=True)
        assert await _counters(factory) == (self.PERSONAL_USED, self.PERSONAL_COUNT)
        assert await _tenant_counters(factory, tenant_id) == (
            self.TENANT_USED - SIZE, self.TENANT_COUNT - 1,
        )

    async def test_join_then_delete_frees_the_personal_quota(self, factory, boundaries):
        from app.api.v1.storage import delete_stored_document

        quota_id = await _seed_quota(factory, self.PERSONAL_USED, self.PERSONAL_COUNT)
        doc_id = await _seed_doc(factory)  # charged before joining: personal
        tenant_id = await _seed_tenant(factory, self.TENANT_USED, self.TENANT_COUNT)
        await _join(factory, tenant_id, quota_id)

        await _call(delete_stored_document, stored_document_id=doc_id, user=USER, permanent=False)

        assert await _counters(factory) == (self.PERSONAL_USED - SIZE, self.PERSONAL_COUNT - 1)
        assert await _tenant_counters(factory, tenant_id) == (self.TENANT_USED, self.TENANT_COUNT)

    async def test_a_new_version_after_leaving_resizes_the_organisation(
        self, factory, boundaries
    ):
        tenant_id = await self._member(factory)
        doc_id = await _seed_doc(factory, quota_tenant_id=tenant_id)
        await _leave(factory, tenant_id)
        data = _pdf_bytes(pages=3)

        await _new_version(doc_id, data)

        assert await _tenant_counters(factory, tenant_id) == (
            self.TENANT_USED - SIZE + len(data), self.TENANT_COUNT,
        )
        assert await _counters(factory) == (self.PERSONAL_USED, self.PERSONAL_COUNT)

    async def test_an_organisation_cannot_vanish_under_its_documents(self, factory):
        tenant_id = await self._member(factory)
        await _seed_doc(factory, quota_tenant_id=tenant_id)

        async with factory() as db:
            with pytest.raises(IntegrityError):
                await db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
                await db.commit()

    async def test_handing_over_moves_the_documents_to_their_owners(self, factory):
        from app.services.quota_service import quota_service

        tenant_id = await self._member(factory)
        active = await _seed_doc(factory, quota_tenant_id=tenant_id)
        trashed = await _seed_doc(factory, 400, trashed=True, quota_tenant_id=tenant_id)

        async with factory() as db:
            await quota_service.hand_over_tenant_documents(db, [tenant_id])
            await db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
            await db.commit()

        assert await _attribution(factory, active) is None
        assert await _attribution(factory, trashed) is None
        # Only the active document becomes counted on its owner.
        assert await _counters(factory) == (
            self.PERSONAL_USED + SIZE, self.PERSONAL_COUNT + 1,
        )


# ---------------------------------------------------------------------------
# 4. Reconciliation of historically drifted counters
# ---------------------------------------------------------------------------


def _load_script():
    path = _PROJECT_ROOT / "scripts" / "reconcile_quota_counters.py"
    spec = importlib.util.spec_from_file_location("reconcile_quota_counters", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestReconciliation:
    async def _drifted(self, factory) -> dict:
        """Counters that disagree with their documents in every possible way."""
        quota_id = await _seed_quota(factory, 999_999, 42)  # personal: too high
        await _seed_quota(factory, 70, 2, user_id="user-without-documents")
        tenant_id = await _seed_tenant(factory, 5, 9)  # organization: wrong
        await _join(factory, tenant_id, quota_id)
        await _seed_doc(factory, 100)  # personal
        await _seed_doc(factory, 200)  # personal
        await _seed_doc(factory, 999, trashed=True)  # counted nowhere
        await _seed_doc(factory, 300, quota_tenant_id=tenant_id)  # organization
        await _seed_doc(factory, 50, owner_id="user-without-quota-row")
        return {"tenant_id": tenant_id}

    async def _expected_state(self, factory, tenant_id) -> None:
        assert await _counters(factory) == (300, 2)
        assert await _counters(factory, "user-without-documents") == (0, 0)
        assert await _counters(factory, "user-without-quota-row") == (50, 1)
        assert await _tenant_counters(factory, tenant_id) == (300, 1)

    async def test_dry_run_reports_without_changing_anything(self, factory):
        from app.services.quota_reconciliation import reconcile_storage_counters

        seeded = await self._drifted(factory)
        async with factory() as db:
            drifts = await reconcile_storage_counters(db, apply=False)
            await db.rollback()

        assert {(d.kind, d.key) for d in drifts} == {
            ("personal", USER_ID),
            ("personal", "user-without-documents"),
            ("personal", "user-without-quota-row"),
            ("tenant", seeded["tenant_id"]),
        }
        assert await _counters(factory) == (999_999, 42)
        assert await _counters(factory, "user-without-quota-row") is None
        assert await _tenant_counters(factory, seeded["tenant_id"]) == (5, 9)

    async def test_apply_fixes_every_counter_and_a_second_run_is_a_no_op(self, factory):
        script = _load_script()
        seeded = await self._drifted(factory)

        first = io.StringIO()
        assert await script.run(apply=True, out=first) == 4
        await self._expected_state(factory, seeded["tenant_id"])

        second = io.StringIO()
        assert await script.run(apply=True, out=second) == 0
        assert second.getvalue().startswith("0 drifting counter(s)")
        await self._expected_state(factory, seeded["tenant_id"])

    async def test_the_command_reports_the_drifts_in_dry_run(self, factory):
        script = _load_script()
        await self._drifted(factory)

        out = io.StringIO()
        assert await script.run(apply=False, out=out) == 4

        report = out.getvalue()
        assert "4 drifting counter(s) (dry run — nothing changed)" in report
        assert f"personal {USER_ID}: bytes 999999 -> 300 (-999699)" in report
        assert "user-without-quota-row (no quota row)" in report
        assert "--apply" in report
        assert await _counters(factory) == (999_999, 42)
