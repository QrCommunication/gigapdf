"""Complete account erasure (GDPR art. 17, right to erasure).

One entry point, :meth:`AccountErasureService.erase`, removes everything a user
owns and strips their identity from what other users keep:

1. **Pre-checks (read-only).** Refuse when erasing would destroy or orphan
   someone else's data or keep billing a deleted account: the user owns an
   organisation that still has other members (409
   ``TENANT_OWNERSHIP_TRANSFER_REQUIRED``), or a live Stripe subscription would
   outlive the account (409 ``ACTIVE_SUBSCRIPTION_CANCELLATION_REQUIRED``).
2. **Object storage first.** Every object under ``documents/{user_id}/`` and
   ``thumbnails/{user_id}/`` (plus any version or thumbnail key recorded
   elsewhere) is deleted *before* the database is touched. A storage failure
   raises with the database unchanged, so the call can simply be retried —
   deleting a missing object is a no-op.
3. **One database transaction.** The user's own rows are deleted (documents
   — PostgreSQL cascades versions, layers, OCR blocks, shares, invitations,
   notifications and logs —, folders, jobs, API keys, notifications,
   collaboration sessions and locks, shares and invitations addressed to them,
   quota, organisation memberships, Better Auth identity). Their footprint on
   data that belongs to *other* users is anonymised with :data:`ERASED_USER`
   instead of deleted, so a colleague's document keeps its history.

Running it again on an erased user is a no-op that returns zero counts.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import Text, cast, delete, false, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.error_handler import GigaPDFException
from app.models.api_key import ApiKey
from app.models.database import (
    ActivityLog,
    AsyncJob,
    CollaborationSession,
    DocumentShare,
    DocumentShareInvitation,
    DocumentVersion,
    ElementLock,
    Folder,
    Plan,
    ShareNotification,
    StoredDocument,
    UserQuota,
)
from app.models.tenant import (
    Tenant,
    TenantDocument,
    TenantInvitation,
    TenantMember,
    TenantRole,
    TenantStatus,
)
from app.services.document_storage_cleanup import collect_document_object_keys
from app.services.quota_service import quota_service
from app.services.s3_service import s3_service

logger = logging.getLogger(__name__)

#: Replaces an erased user's id wherever another user's data must keep a value
#: (version author, share creator, audit log actor, mentions in notifications).
#: Not a valid Better Auth id (those are UUIDs), so it can never match a real
#: account, and it is greppable when auditing an erasure.
ERASED_USER = "erased-user"

#: Stripe statuses that keep charging (or retrying a charge on) the customer.
_BILLING_SUBSCRIPTION_STATUSES = frozenset(
    {"active", "trialing", "past_due", "unpaid", "incomplete"}
)

_STORAGE_PREFIX_TEMPLATES = ("documents/{user_id}/", "thumbnails/{user_id}/")


class TenantOwnershipTransferRequiredError(GigaPDFException):
    """The user owns an organisation that other members still use."""

    def __init__(self, tenant_ids: list[str]):
        super().__init__(
            "TENANT_OWNERSHIP_TRANSFER_REQUIRED",
            "Transfer the ownership of your organization(s) before deleting your account.",
            409,
            {"tenant_ids": tenant_ids},
        )


class ActiveSubscriptionError(GigaPDFException):
    """A Stripe subscription would keep billing after the account is gone."""

    def __init__(self) -> None:
        super().__init__(
            "ACTIVE_SUBSCRIPTION_CANCELLATION_REQUIRED",
            "Cancel your active subscription before deleting your account.",
            409,
        )


class InvalidErasureTargetError(GigaPDFException):
    """The user id cannot be turned into a bounded storage prefix."""

    def __init__(self) -> None:
        super().__init__("INVALID_USER_ID", "Invalid user id.", 400)


class ErasureStorage(Protocol):
    """Object-storage operations the erasure relies on; both raise on failure."""

    def delete_prefix(self, prefix: str) -> int: ...

    def delete_keys(self, keys: list[str]) -> int: ...


@dataclass
class AccountErasureReport:
    """What one erasure did. Counts only — never names or emails."""

    user_id: str
    storage_objects_deleted: int = 0
    deleted: dict[str, int] = field(default_factory=dict)
    anonymized: dict[str, int] = field(default_factory=dict)

    @property
    def is_noop(self) -> bool:
        return (
            self.storage_objects_deleted == 0
            and not any(self.deleted.values())
            and not any(self.anonymized.values())
        )


@dataclass(frozen=True)
class _Identity:
    user_id: str
    emails: tuple[str, ...]  # lower-cased, sorted
    quota_ids: tuple[str, ...]


@dataclass(frozen=True)
class _TenantPlan:
    """Organisations to delete with the user (they are the only member)."""

    tenant_ids_to_delete: tuple[Any, ...]


def _rowcount(result: Any) -> int:
    return max(result.rowcount or 0, 0)


def _in_ids(column: Any, ids: Sequence[str]) -> Any:
    """``column IN ids``, or a constant false for an empty list."""
    return column.in_(ids) if ids else false()


def _scrub(value: Any, pattern: re.Pattern[str]) -> Any:
    """Replace every mention matched by ``pattern`` in a JSON-like value."""
    if isinstance(value, str):
        return pattern.sub(ERASED_USER, value)
    if isinstance(value, dict):
        return {key: _scrub(item, pattern) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub(item, pattern) for item in value]
    return value


class AccountErasureService:
    """Erases a user account; see the module docstring for the guarantees."""

    def __init__(self, storage: ErasureStorage | None = None):
        self._storage = storage

    @property
    def storage(self) -> ErasureStorage:
        return self._storage if self._storage is not None else s3_service

    # -- public API ---------------------------------------------------------

    async def user_exists(self, db: AsyncSession, user_id: str) -> bool:
        """True while any identity, quota or document row remains for ``user_id``."""
        identity_row = await db.execute(
            text("SELECT 1 FROM users WHERE id = :user_id"), {"user_id": user_id}
        )
        if identity_row.first() is not None:
            return True
        quota = await db.execute(select(UserQuota.id).where(UserQuota.user_id == user_id))
        if quota.first() is not None:
            return True
        document = await db.execute(
            select(StoredDocument.id).where(StoredDocument.owner_id == user_id).limit(1)
        )
        return document.first() is not None

    async def erase(self, db: AsyncSession, user_id: str) -> AccountErasureReport:
        """Erase ``user_id``; idempotent, safe to retry after any failure.

        Raises:
            TenantOwnershipTransferRequiredError: owner of a shared organisation.
            ActiveSubscriptionError: a billing subscription is still running.
            StorageError / backend errors: object deletion failed; the
                database has not been modified.
        """
        if not user_id or "/" in user_id or user_id == ERASED_USER:
            raise InvalidErasureTargetError()

        # 1. Read-only pre-checks, then close the read transaction: no
        #    database transaction stays open across the storage calls.
        identity = await self._load_identity(db, user_id)
        await self._check_subscription(db, identity, await self._plan_tenants(db, identity))
        documents = (
            await db.execute(select(StoredDocument).where(StoredDocument.owner_id == user_id))
        ).scalars().all()
        recorded_keys = await collect_document_object_keys(db, documents)
        await db.rollback()

        # 2. Object storage. Raises on failure, before any row is touched.
        report = AccountErasureReport(user_id=user_id)
        report.storage_objects_deleted = await self._delete_objects(user_id, recorded_keys)

        # 3. Database, one transaction. The blockers are re-read inside it so
        #    a member who joined meanwhile still stops the erasure.
        try:
            tenant_plan = await self._plan_tenants(db, identity)
            await self._check_subscription(db, identity, tenant_plan)
            await self._erase_rows(db, identity, tenant_plan, report)
            await db.commit()
        except Exception:
            await db.rollback()
            raise

        # 4. Objects uploaded between steps 2 and 3 now belong to no row:
        #    sweep the prefixes again. Best effort — the account is gone.
        report.storage_objects_deleted += await self._sweep_prefixes(user_id)

        logger.info(
            "Account erased",
            extra={
                "user_id": user_id,
                "storage_objects_deleted": report.storage_objects_deleted,
                "deleted": report.deleted,
                "anonymized": report.anonymized,
            },
        )
        return report

    # -- pre-checks ---------------------------------------------------------

    async def _load_identity(self, db: AsyncSession, user_id: str) -> _Identity:
        emails: set[str] = set()
        identity_row = (
            await db.execute(
                text("SELECT email FROM users WHERE id = :user_id"), {"user_id": user_id}
            )
        ).first()
        if identity_row is not None and identity_row[0]:
            emails.add(identity_row[0].strip().lower())
        quota_rows = (
            await db.execute(
                select(UserQuota.id, UserQuota.email).where(UserQuota.user_id == user_id)
            )
        ).all()
        emails.update(row.email.strip().lower() for row in quota_rows if row.email)
        return _Identity(
            user_id=user_id,
            emails=tuple(sorted(emails)),
            quota_ids=tuple(row.id for row in quota_rows),
        )

    async def _plan_tenants(self, db: AsyncSession, identity: _Identity) -> _TenantPlan:
        """Refuse when an owned organisation has other members; list the rest."""
        if not identity.quota_ids:
            return _TenantPlan(tenant_ids_to_delete=())
        memberships = (
            await db.execute(
                select(TenantMember.tenant_id, TenantMember.role).where(
                    TenantMember.user_id.in_(identity.quota_ids)
                )
            )
        ).all()
        blocked: list[str] = []
        sole_member: list[Any] = []
        for tenant_id, role in memberships:
            other_members = (
                await db.execute(
                    select(func.count())
                    .select_from(TenantMember)
                    .where(
                        TenantMember.tenant_id == tenant_id,
                        TenantMember.user_id.not_in(identity.quota_ids),
                    )
                )
            ).scalar_one()
            if other_members == 0:
                sole_member.append(tenant_id)
            elif role == TenantRole.OWNER:
                blocked.append(str(tenant_id))
        if blocked:
            raise TenantOwnershipTransferRequiredError(sorted(blocked))
        return _TenantPlan(tenant_ids_to_delete=tuple(sole_member))

    async def _check_subscription(
        self, db: AsyncSession, identity: _Identity, tenant_plan: _TenantPlan
    ) -> None:
        """Refuse while a Stripe subscription would keep billing the account
        (its own, or one of an organisation deleted with it)."""
        personal = (
            await db.execute(
                select(UserQuota.id).where(
                    UserQuota.user_id == identity.user_id,
                    UserQuota.stripe_subscription_id.is_not(None),
                    UserQuota.subscription_status.in_(_BILLING_SUBSCRIPTION_STATUSES),
                    UserQuota.cancel_at_period_end.is_not(True),
                )
            )
        ).first()
        if personal is not None:
            raise ActiveSubscriptionError()
        if not tenant_plan.tenant_ids_to_delete:
            return
        billed_tenant = (
            await db.execute(
                select(Tenant.id).where(
                    Tenant.id.in_(tenant_plan.tenant_ids_to_delete),
                    Tenant.stripe_subscription_id.is_not(None),
                    Tenant.status != TenantStatus.CANCELLED,
                )
            )
        ).first()
        if billed_tenant is not None:
            raise ActiveSubscriptionError()

    # -- object storage -----------------------------------------------------

    @staticmethod
    def _prefixes(user_id: str) -> list[str]:
        return [template.format(user_id=user_id) for template in _STORAGE_PREFIX_TEMPLATES]

    async def _delete_objects(self, user_id: str, recorded_keys: list[str]) -> int:
        prefixes = self._prefixes(user_id)
        deleted = 0
        for prefix in prefixes:
            deleted += await asyncio.to_thread(self.storage.delete_prefix, prefix)
        # Keys recorded in the database outside the user's prefixes (legacy
        # layouts) are not covered by the prefix deletion.
        stray = [key for key in recorded_keys if not key.startswith(tuple(prefixes))]
        if stray:
            deleted += await asyncio.to_thread(self.storage.delete_keys, stray)
        return deleted

    async def _sweep_prefixes(self, user_id: str) -> int:
        deleted = 0
        for prefix in self._prefixes(user_id):
            try:
                deleted += await asyncio.to_thread(self.storage.delete_prefix, prefix)
            except Exception:
                logger.warning(
                    "Post-erasure storage sweep failed",
                    extra={"user_id": user_id, "prefix_kind": prefix.split("/", 1)[0]},
                    exc_info=True,
                )
        return deleted

    # -- database -----------------------------------------------------------

    async def _erase_rows(
        self,
        db: AsyncSession,
        identity: _Identity,
        tenant_plan: _TenantPlan,
        report: AccountErasureReport,
    ) -> None:
        user_id = identity.user_id
        deleted = report.deleted
        anonymized = report.anonymized

        # Row-locked (before the quota row, the order every document write
        # follows): a restore or delete still in flight cannot move the quota
        # behind the erasure's back.
        documents = (
            await db.execute(
                select(
                    StoredDocument.id,
                    StoredDocument.owner_id,
                    StoredDocument.quota_tenant_id,
                    StoredDocument.file_size_bytes,
                    StoredDocument.is_deleted,
                )
                .where(StoredDocument.owner_id == user_id)
                .with_for_update()
            )
        ).all()
        document_ids = [row.id for row in documents]

        # The active documents leave the counter that holds each of them
        # (recorded on the document). The personal quota row goes below, but
        # an organisation that survives the erasure would otherwise keep
        # counting documents that no longer exist.
        await quota_service.release_documents(
            db, [row for row in documents if not row.is_deleted]
        )

        # Activity tied to the user or to their documents. These tables carry
        # a document_id without a foreign key, so nothing cascades to them.
        deleted["collaboration_sessions"] = _rowcount(
            await db.execute(
                delete(CollaborationSession).where(
                    or_(
                        CollaborationSession.user_id == user_id,
                        _in_ids(CollaborationSession.document_id, document_ids),
                    )
                )
            )
        )
        deleted["element_locks"] = _rowcount(
            await db.execute(
                delete(ElementLock).where(
                    or_(
                        ElementLock.locked_by_user_id == user_id,
                        _in_ids(ElementLock.document_id, document_ids),
                    )
                )
            )
        )
        deleted["async_jobs"] = _rowcount(
            await db.execute(
                delete(AsyncJob).where(
                    or_(AsyncJob.owner_id == user_id, _in_ids(AsyncJob.document_id, document_ids))
                )
            )
        )
        deleted["api_keys"] = _rowcount(
            await db.execute(delete(ApiKey).where(ApiKey.user_id == user_id))
        )
        deleted["share_notifications"] = _rowcount(
            await db.execute(delete(ShareNotification).where(ShareNotification.user_id == user_id))
        )

        # Access granted TO the user on other people's documents, and every
        # invitation they sent or received (by id or by address).
        deleted["document_shares"] = _rowcount(
            await db.execute(
                delete(DocumentShare).where(DocumentShare.shared_with_user_id == user_id)
            )
        )
        invitation_filters = [
            DocumentShareInvitation.inviter_id == user_id,
            DocumentShareInvitation.invitee_user_id == user_id,
        ]
        if identity.emails:
            invitation_filters.append(
                func.lower(DocumentShareInvitation.invitee_email).in_(identity.emails)
            )
        deleted["document_share_invitations"] = _rowcount(
            await db.execute(delete(DocumentShareInvitation).where(or_(*invitation_filters)))
        )

        # The user's footprint on documents that stay (other owners).
        anonymized["document_versions"] = _rowcount(
            await db.execute(
                update(DocumentVersion)
                .where(DocumentVersion.created_by == user_id)
                .values(created_by=ERASED_USER)
            )
        )
        anonymized["document_shares"] = _rowcount(
            await db.execute(
                update(DocumentShare)
                .where(DocumentShare.created_by == user_id)
                .values(created_by=ERASED_USER)
            )
        ) + _rowcount(
            await db.execute(
                update(DocumentShare)
                .where(DocumentShare.revoked_by == user_id)
                .values(revoked_by=ERASED_USER)
            )
        )

        # Owned documents: PostgreSQL cascades versions, layers, OCR blocks,
        # shares, invitations, notifications, logs and tenant links.
        deleted["stored_documents"] = _rowcount(
            await db.execute(delete(StoredDocument).where(StoredDocument.owner_id == user_id))
        )
        deleted["folders"] = _rowcount(
            await db.execute(delete(Folder).where(Folder.owner_id == user_id))
        )

        # Audit trail: purely personal entries go; entries attached to a
        # document or an organisation that survives keep their action but lose
        # the actor's identity (including network identifiers).
        deleted["activity_logs"] = _rowcount(
            await db.execute(
                delete(ActivityLog).where(
                    ActivityLog.user_id == user_id,
                    ActivityLog.document_id.is_(None),
                    ActivityLog.tenant_id.is_(None),
                )
            )
        )
        anonymized["activity_logs"] = _rowcount(
            await db.execute(
                update(ActivityLog)
                .where(ActivityLog.user_id == user_id)
                .values(
                    user_id=ERASED_USER,
                    user_email=None,
                    user_name=None,
                    ip_address=None,
                    user_agent=None,
                )
            )
        )
        anonymized["mentions"] = await self._scrub_mentions(db, identity)

        await self._erase_tenancy(db, identity, tenant_plan, report)

        deleted["user_quotas"] = _rowcount(
            await db.execute(delete(UserQuota).where(UserQuota.user_id == user_id))
        )
        await self._erase_identity(db, identity, report)

    async def _scrub_mentions(self, db: AsyncSession, identity: _Identity) -> int:
        """Replace the user's id and addresses quoted in other users' rows.

        Notifications sent to someone else ("x@y accepted your invitation")
        and audit details ({"shared_with": "x@y"}) keep the event but no longer
        name the erased user.
        """
        needles = sorted({identity.user_id, *identity.emails}, key=len, reverse=True)
        pattern = re.compile("|".join(re.escape(needle) for needle in needles), re.IGNORECASE)

        def mentions(*columns: Any) -> Any:
            return or_(
                *(column.icontains(needle, autoescape=True) for column in columns for needle in needles)
            )

        scrubbed = 0
        notifications = (
            await db.execute(
                select(
                    ShareNotification.id,
                    ShareNotification.title,
                    ShareNotification.message,
                    ShareNotification.extra_data,
                ).where(
                    mentions(
                        ShareNotification.title,
                        ShareNotification.message,
                        cast(ShareNotification.extra_data, Text),
                    )
                )
            )
        ).all()
        for row in notifications:
            await db.execute(
                update(ShareNotification)
                .where(ShareNotification.id == row.id)
                .values(
                    title=_scrub(row.title, pattern),
                    message=_scrub(row.message, pattern),
                    extra_data=_scrub(row.extra_data, pattern),
                )
            )
            scrubbed += 1

        logs = (
            await db.execute(
                select(ActivityLog.id, ActivityLog.extra_data).where(
                    mentions(cast(ActivityLog.extra_data, Text))
                )
            )
        ).all()
        for row in logs:
            await db.execute(
                update(ActivityLog)
                .where(ActivityLog.id == row.id)
                .values(extra_data=_scrub(row.extra_data, pattern))
            )
            scrubbed += 1
        return scrubbed

    async def _erase_tenancy(
        self,
        db: AsyncSession,
        identity: _Identity,
        tenant_plan: _TenantPlan,
        report: AccountErasureReport,
    ) -> None:
        """Organisation rows: the FKs to user_quotas are NO ACTION in production.

        * Organisations where the user is the only member are deleted (their
          members, documents and invitations cascade); a private plan linked
          to one is deactivated rather than deleted, since Stripe objects and
          past tenants may still reference it.
        * Invitations sent by, addressed to or accepted by the user are
          deleted: a pending one is void without its inviter, and an accepted
          one is history already reflected in ``tenant_members``.
        * A document someone else owns but the user added to a surviving
          organisation stays shared: ``added_by`` (NOT NULL) moves to that
          organisation's owner. Without an owner the link is removed.
        """
        deleted = report.deleted
        quota_ids = identity.quota_ids

        tenant_ids = list(tenant_plan.tenant_ids_to_delete)
        if tenant_ids:
            await db.execute(
                update(Plan)
                .where(Plan.linked_tenant_id.in_([str(tenant_id) for tenant_id in tenant_ids]))
                .values(is_active=False)
            )
            # Former members' documents still counted on these organisations
            # move to their owners' personal quotas before the rows go.
            await quota_service.hand_over_tenant_documents(db, tenant_ids)
        deleted["tenants"] = (
            _rowcount(await db.execute(delete(Tenant).where(Tenant.id.in_(tenant_ids))))
            if tenant_ids
            else 0
        )

        invitation_filters = []
        if quota_ids:
            invitation_filters += [
                TenantInvitation.invited_by_id.in_(quota_ids),
                TenantInvitation.accepted_by_id.in_(quota_ids),
            ]
        if identity.emails:
            invitation_filters.append(func.lower(TenantInvitation.email).in_(identity.emails))
        deleted["tenant_invitations"] = (
            _rowcount(await db.execute(delete(TenantInvitation).where(or_(*invitation_filters))))
            if invitation_filters
            else 0
        )

        if not quota_ids:
            deleted["tenant_documents"] = 0
            deleted["tenant_members"] = 0
            return

        reassigned = removed = 0
        links = (
            await db.execute(
                select(TenantDocument.id, TenantDocument.tenant_id).where(
                    TenantDocument.added_by_id.in_(quota_ids)
                )
            )
        ).all()
        for link_id, tenant_id in links:
            owner_quota_id = (
                await db.execute(
                    select(TenantMember.user_id)
                    .where(
                        TenantMember.tenant_id == tenant_id,
                        TenantMember.role == TenantRole.OWNER,
                        TenantMember.user_id.not_in(quota_ids),
                    )
                    .order_by(TenantMember.joined_at)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if owner_quota_id is None:
                await db.execute(delete(TenantDocument).where(TenantDocument.id == link_id))
                removed += 1
            else:
                await db.execute(
                    update(TenantDocument)
                    .where(TenantDocument.id == link_id)
                    .values(added_by_id=owner_quota_id)
                )
                reassigned += 1
        deleted["tenant_documents"] = removed
        report.anonymized["tenant_documents"] = reassigned
        deleted["tenant_members"] = _rowcount(
            await db.execute(delete(TenantMember).where(TenantMember.user_id.in_(quota_ids)))
        )

    async def _erase_identity(
        self, db: AsyncSession, identity: _Identity, report: AccountErasureReport
    ) -> None:
        """Better Auth tables (Prisma-managed, no SQLAlchemy model)."""
        user_id = identity.user_id
        report.deleted["user_signatures"] = _rowcount(
            await db.execute(
                text("DELETE FROM user_signatures WHERE user_id = :user_id"),
                {"user_id": user_id},
            )
        )
        # Email verification rows are keyed by address; password-reset rows
        # carry the user id as their value.
        report.deleted["verification"] = _rowcount(
            await db.execute(
                text(
                    "DELETE FROM verification "
                    "WHERE lower(identifier) = ANY(:emails) OR value = :user_id"
                ),
                {"emails": list(identity.emails), "user_id": user_id},
            )
        )
        # sessions and accounts cascade (ON DELETE CASCADE on userId).
        report.deleted["users"] = _rowcount(
            await db.execute(
                text("DELETE FROM users WHERE id = :user_id"), {"user_id": user_id}
            )
        )


account_erasure_service = AccountErasureService()
