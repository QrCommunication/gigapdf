"""Recompute the storage counters from the documents they count.

``user_quotas`` and ``tenants`` carry running counters (``storage_used_bytes``,
``document_count``) moved by every document write through
``quota_service.adjust_document_storage``. Counters that drifted before those
moves were made atomic and attributed (see migration 024) are never corrected
by later writes — they only move by deltas. This module recomputes them from
the source of truth:

* a personal quota counts its user's ACTIVE documents with no organization
  attribution (``quota_tenant_id IS NULL``);
* an organization counts the ACTIVE documents attributed to it, whoever owns
  them now.

Idempotent: a second run finds nothing to correct. Used by
``scripts/reconcile_quota_counters.py`` (dry run by default).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import StoredDocument, UserQuota
from app.models.tenant import Tenant
from app.services.quota_service import quota_service

PERSONAL = "personal"
TENANT = "tenant"

# Writers wait while the documents table is locked: give up rather than
# queue behind a long transaction and block every document write meanwhile.
_LOCK_TIMEOUT = "5s"


@dataclass(frozen=True)
class CounterDrift:
    """A counter whose stored value differs from its documents."""

    kind: str  # PERSONAL (key = user id) or TENANT (key = organization id)
    key: str
    stored_bytes: int
    stored_documents: int
    actual_bytes: int
    actual_documents: int
    row_missing: bool = False  # personal only: no quota row yet

    def describe(self) -> str:
        missing = " (no quota row)" if self.row_missing else ""
        return (
            f"{self.kind:<8} {self.key}{missing}: "
            f"bytes {self.stored_bytes} -> {self.actual_bytes} "
            f"({self.actual_bytes - self.stored_bytes:+d}), "
            f"documents {self.stored_documents} -> {self.actual_documents} "
            f"({self.actual_documents - self.stored_documents:+d})"
        )


async def reconcile_storage_counters(
    session: AsyncSession, *, apply: bool
) -> list[CounterDrift]:
    """Compare every storage counter with its documents; fix them when ``apply``.

    Runs in ``session``'s transaction, which the caller commits (apply) or
    rolls back (dry run). ``stored_documents`` is locked in SHARE mode for
    the duration: every counter move happens in the same transaction as a
    write to that table, so no move can slip between the recount and the
    correction. Reads (and the application's reads) are not blocked.
    """
    await session.execute(text(f"SET LOCAL lock_timeout = '{_LOCK_TIMEOUT}'"))
    await session.execute(text("LOCK TABLE stored_documents IN SHARE MODE"))

    drifts = await _personal_drifts(session) + await _tenant_drifts(session)
    if apply:
        for drift in drifts:
            await _correct(session, drift)
    return drifts


async def _personal_drifts(session: AsyncSession) -> list[CounterDrift]:
    actual = {
        owner_id: (int(size), int(count))
        for owner_id, size, count in (
            await session.execute(
                select(
                    StoredDocument.owner_id,
                    func.coalesce(func.sum(StoredDocument.file_size_bytes), 0),
                    func.count(),
                )
                .where(~StoredDocument.is_deleted, StoredDocument.quota_tenant_id.is_(None))
                .group_by(StoredDocument.owner_id)
            )
        ).all()
    }
    stored = {
        user_id: (size or 0, count or 0)
        for user_id, size, count in (
            await session.execute(
                select(
                    UserQuota.user_id, UserQuota.storage_used_bytes, UserQuota.document_count
                ).with_for_update()
            )
        ).all()
    }
    drifts = []
    for user_id in sorted(stored.keys() | actual.keys()):
        stored_value = stored.get(user_id, (0, 0))
        actual_value = actual.get(user_id, (0, 0))
        if stored_value != actual_value:
            drifts.append(
                CounterDrift(
                    PERSONAL, user_id, *stored_value, *actual_value,
                    row_missing=user_id not in stored,
                )
            )
    return drifts


async def _tenant_drifts(session: AsyncSession) -> list[CounterDrift]:
    actual = {
        str(tenant_id): (int(size), int(count))
        for tenant_id, size, count in (
            await session.execute(
                select(
                    StoredDocument.quota_tenant_id,
                    func.coalesce(func.sum(StoredDocument.file_size_bytes), 0),
                    func.count(),
                )
                .where(~StoredDocument.is_deleted, StoredDocument.quota_tenant_id.is_not(None))
                .group_by(StoredDocument.quota_tenant_id)
            )
        ).all()
    }
    stored = {
        str(tenant_id): (size or 0, count or 0)
        for tenant_id, size, count in (
            await session.execute(
                select(
                    Tenant.id, Tenant.storage_used_bytes, Tenant.document_count
                ).with_for_update()
            )
        ).all()
    }
    # Every attributed organization has a row: the foreign key is RESTRICT.
    return [
        CounterDrift(TENANT, tenant_id, *stored[tenant_id], *actual.get(tenant_id, (0, 0)))
        for tenant_id in sorted(stored)
        if stored[tenant_id] != actual.get(tenant_id, (0, 0))
    ]


async def _correct(session: AsyncSession, drift: CounterDrift) -> None:
    """Set the counter to its recounted value (absolute: re-running is a no-op)."""
    if drift.kind == TENANT:
        await session.execute(
            update(Tenant)
            .where(Tenant.id == drift.key)
            .values(
                storage_used_bytes=drift.actual_bytes,
                document_count=drift.actual_documents,
            )
            .execution_options(synchronize_session=False)
        )
        return
    values = quota_service.free_quota_values(drift.key)
    values["storage_used_bytes"] = drift.actual_bytes
    values["document_count"] = drift.actual_documents
    await session.execute(
        pg_insert(UserQuota)
        .values(id=str(uuid4()), **values)
        .on_conflict_do_update(
            index_elements=[UserQuota.user_id],
            set_={
                "storage_used_bytes": drift.actual_bytes,
                "document_count": drift.actual_documents,
            },
        )
    )
