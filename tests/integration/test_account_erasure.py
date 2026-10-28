"""Account erasure (GDPR art. 17) against a real PostgreSQL.

What must hold, and what only PostgreSQL can prove (FK cascades, NO ACTION
constraints from user_quotas, JSON casts, the Better Auth tables that have no
SQLAlchemy model):

* every row of the erased user is gone, including the Better Auth identity
  (sessions and accounts through their ON DELETE CASCADE);
* another user's document keeps its rows, with the erased user replaced by the
  ``ERASED_USER`` sentinel wherever it was recorded or quoted;
* erasing again is a no-op;
* owning an organisation that other members still use refuses the erasure and
  changes nothing;
* a storage failure raises before the database is touched, and a retry
  completes the erasure.

Runs against a throwaway PostgreSQL database (``pg_schema_db``, see
tests/integration/conftest.py).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

# Minimal DDL of the Prisma-managed Better Auth tables (apps/web/prisma/
# schema.prisma): same names, same columns the erasure reads, same cascades.
_BETTER_AUTH_DDL = """
CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL DEFAULT false,
    name text,
    "createdAt" timestamp(3) NOT NULL DEFAULT now(),
    "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
    id text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    token text NOT NULL UNIQUE,
    "expiresAt" timestamp(3) NOT NULL,
    "ipAddress" text,
    "userAgent" text
);
CREATE TABLE accounts (
    id text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    password text
);
CREATE TABLE verification (
    id text PRIMARY KEY,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp(3) NOT NULL
);
CREATE TABLE user_signatures (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'signature',
    data_url text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL
);
"""


class FakeStorage:
    """The object-storage boundary: records what the erasure deletes."""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.prefixes: list[str] = []
        self.keys: list[str] = []

    def delete_prefix(self, prefix: str) -> int:
        if self.fail:
            raise ConnectionError("object storage unreachable")
        self.prefixes.append(prefix)
        return 1

    def delete_keys(self, keys: list[str]) -> int:
        if self.fail:
            raise ConnectionError("object storage unreachable")
        self.keys.extend(keys)
        return len(keys)


@pytest.fixture
def database(pg_schema_db) -> str:
    """Throwaway database with the full SQLAlchemy schema + Better Auth tables."""
    created = pg_schema_db.psql(_BETTER_AUTH_DDL)
    assert created.returncode == 0, created.stderr
    return pg_schema_db.async_url


@pytest.fixture
async def session_factory(database):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine(database)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


def _uid() -> str:
    return str(uuid.uuid4())


async def _sql(db, statement: str, **params):
    from sqlalchemy import text

    return await db.execute(text(statement), params)


async def _scalar(session_factory, statement: str, **params):
    async with session_factory() as db:
        return (await _sql(db, statement, **params)).scalar_one()


async def _add_identity(db, user_id: str, email: str, name: str) -> None:
    await _sql(db, "INSERT INTO users (id, email, name) VALUES (:id, :email, :name)",
               id=user_id, email=email, name=name)
    await _sql(db, 'INSERT INTO sessions (id, "userId", token, "expiresAt") '
                   "VALUES (:id, :user_id, :token, now() + interval '1 day')",
               id=_uid(), user_id=user_id, token=_uid())
    await _sql(db, 'INSERT INTO accounts (id, "userId", "accountId", "providerId") '
                   "VALUES (:id, :user_id, :user_id, 'credential')",
               id=_uid(), user_id=user_id)
    await _sql(db, 'INSERT INTO verification (id, identifier, value, "expiresAt") '
                   "VALUES (:id, :email, '123456', now())", id=_uid(), email=email)
    await _sql(db, "INSERT INTO user_signatures (id, user_id, data_url, width, height) "
                   "VALUES (:id, :user_id, 'data:image/png;base64,AA', 10, 10)",
               id=_uid(), user_id=user_id)


async def _seed(session_factory) -> dict:
    """Two users who worked on each other's documents, plus organisations."""
    from app.models.api_key import ApiKey
    from app.models.database import (
        ActivityLog,
        AsyncJob,
        CollaborationSession,
        DocumentLayers,
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
    )

    a, b = _uid(), _uid()
    a_email, b_email = "Alice.Erased@Example.com", "bob@example.com"
    ids = {"a": a, "b": b, "a_email": a_email}
    expires = datetime.now(UTC) + timedelta(days=7)

    async with session_factory() as db:
        await _add_identity(db, a, a_email, "Alice Erased")
        await _add_identity(db, b, b_email, "Bob Kept")
        # Password-reset rows carry the user id as their value.
        await _sql(db, 'INSERT INTO verification (id, identifier, value, "expiresAt") '
                       "VALUES (:id, 'reset-password:tok', :user_id, now())", id=_uid(), user_id=a)

        quota_a = UserQuota(user_id=a, email=a_email.lower())
        quota_b = UserQuota(user_id=b, email=b_email)
        db.add_all([quota_a, quota_b])
        await db.flush()

        # --- Alice's own data -------------------------------------------
        folder_a = Folder(name="Perso", owner_id=a)
        db.add(folder_a)
        await db.flush()
        doc_a = StoredDocument(
            name="alice.pdf", owner_id=a, folder_id=folder_a.id,
            thumbnail_path="legacy/thumbs/alice.png",
        )
        doc_b = StoredDocument(name="bob.pdf", owner_id=b)
        db.add_all([doc_a, doc_b])
        await db.flush()
        ids.update(doc_a=doc_a.id, doc_b=doc_b.id)

        db.add_all([
            DocumentVersion(document_id=doc_a.id, version_number=1, file_hash="a" * 64,
                            file_path=f"documents/{a}/{doc_a.id}/v1.pdf", created_by=a),
            DocumentLayers(stored_document_id=doc_a.id, data={"layers": []}),
            DocumentShare(document_id=doc_a.id, shared_with_user_id=b, created_by=a),
            DocumentShareInvitation(document_id=doc_a.id, inviter_id=a,
                                    invitee_email="carol@example.com",
                                    token=_uid(), expires_at=expires),
            ShareNotification(user_id=b, notification_type="share_invitation",
                              title="Document shared with you", document_id=doc_a.id,
                              extra_data={"inviter_id": a}),
            ShareNotification(user_id=a, notification_type="share_invitation",
                              title="Shared", document_id=doc_b.id),
            AsyncJob(job_type="ocr", status="pending", owner_id=a),
            ApiKey(user_id=a, name="cli", key_prefix="giga_pk_xx", key_hash=_uid()),
            CollaborationSession(document_id=doc_b.id, user_id=a, user_name="Alice Erased"),
            ElementLock(document_id=doc_b.id, element_id=_uid(), locked_by_user_id=a,
                        locked_by_session_id=_uid(), expires_at=expires),
            ActivityLog(user_id=a, user_email=a_email, action="login",
                        resource_type="user", ip_address="203.0.113.7"),
        ])

        # --- Bob's document, which Alice contributed to ------------------
        db.add_all([
            DocumentVersion(document_id=doc_b.id, version_number=1, file_hash="b" * 64,
                            file_path=f"documents/{b}/{doc_b.id}/v1.pdf", created_by=b),
            DocumentVersion(document_id=doc_b.id, version_number=2, file_hash="c" * 64,
                            file_path=f"documents/{b}/{doc_b.id}/v2.pdf", created_by=a),
            DocumentShare(document_id=doc_b.id, shared_with_user_id=a, created_by=b),
            DocumentShare(document_id=doc_b.id, share_token=_uid()[:32], created_by=a,
                          revoked_by=a, status="revoked"),
            DocumentShareInvitation(document_id=doc_b.id, inviter_id=b,
                                    invitee_email=a_email.upper(), token=_uid(),
                                    expires_at=expires),
            ShareNotification(user_id=b, notification_type="share_accepted",
                              title="Invitation accepted", document_id=doc_b.id,
                              message=f"{a_email.lower()} accepted your invitation",
                              extra_data={"accepter_email": a_email, "accepter_id": a,
                                          "document_name": "bob.pdf"}),
            ActivityLog(user_id=a, user_email=a_email, user_name="Alice Erased",
                        action="edit", document_id=doc_b.id, ip_address="203.0.113.7",
                        user_agent="Firefox"),
            ActivityLog(user_id=b, user_email=b_email, action="share", document_id=doc_b.id,
                        extra_data={"shared_with": a_email, "permission": "edit"}),
        ])

        # --- Organisations -------------------------------------------------
        solo = Tenant(name="Alice SARL", slug=f"solo-{a[:8]}", email=a_email)
        team = Tenant(name="Bob & Co", slug=f"team-{b[:8]}", email=b_email)
        db.add_all([solo, team])
        await db.flush()
        ids.update(solo=solo.id, team=team.id, quota_b=quota_b.id)
        db.add_all([
            TenantMember(tenant_id=solo.id, user_id=quota_a.id, role=TenantRole.OWNER),
            TenantDocument(tenant_id=solo.id, document_id=doc_a.id, added_by_id=quota_a.id),
            Plan(slug=f"private-{a[:8]}", name="Private", linked_tenant_id=str(solo.id)),
            TenantMember(tenant_id=team.id, user_id=quota_b.id, role=TenantRole.OWNER),
            TenantMember(tenant_id=team.id, user_id=quota_a.id, role=TenantRole.MEMBER),
            # Alice shared Bob's document with the team: the link must survive.
            TenantDocument(tenant_id=team.id, document_id=doc_b.id, added_by_id=quota_a.id),
            TenantInvitation(tenant_id=team.id, email="dave@example.com", token=_uid(),
                             invited_by_id=quota_a.id, expires_at=expires),
            TenantInvitation(tenant_id=team.id, email=a_email.lower(), token=_uid(),
                             invited_by_id=quota_b.id, is_accepted=True,
                             accepted_by_id=quota_a.id, expires_at=expires),
        ])
        await db.commit()
    return ids


async def _rows_referencing(session_factory, user_id: str, email: str) -> dict[str, int]:
    """Every place an identity could survive, by user id or email."""
    checks = {
        "users": "SELECT count(*) FROM users WHERE id = :u",
        "sessions": 'SELECT count(*) FROM sessions WHERE "userId" = :u',
        "accounts": 'SELECT count(*) FROM accounts WHERE "userId" = :u',
        "verification": "SELECT count(*) FROM verification WHERE lower(identifier) = :e OR value = :u",
        "user_signatures": "SELECT count(*) FROM user_signatures WHERE user_id = :u",
        "user_quotas": "SELECT count(*) FROM user_quotas WHERE user_id = :u OR lower(email) = :e",
        "stored_documents": "SELECT count(*) FROM stored_documents WHERE owner_id = :u",
        "folders": "SELECT count(*) FROM folders WHERE owner_id = :u",
        "document_versions": "SELECT count(*) FROM document_versions WHERE created_by = :u",
        "document_shares": "SELECT count(*) FROM document_shares "
                           "WHERE :u IN (shared_with_user_id, created_by, revoked_by)",
        "invitations": "SELECT count(*) FROM document_share_invitations "
                       "WHERE inviter_id = :u OR invitee_user_id = :u OR lower(invitee_email) = :e",
        "notifications": "SELECT count(*) FROM share_notifications WHERE user_id = :u "
                         "OR (coalesce(message, '') || extra_data::text) ILIKE '%' || :u || '%' "
                         "OR (coalesce(message, '') || extra_data::text) ILIKE '%' || :e || '%'",
        "activity_logs": "SELECT count(*) FROM activity_logs WHERE user_id = :u "
                         "OR lower(user_email) = :e OR extra_data::text ILIKE '%' || :e || '%'",
        "async_jobs": "SELECT count(*) FROM async_jobs WHERE owner_id = :u",
        "api_keys": "SELECT count(*) FROM api_keys WHERE user_id = :u",
        "collaboration_sessions": "SELECT count(*) FROM collaboration_sessions WHERE user_id = :u",
        "element_locks": "SELECT count(*) FROM element_locks WHERE locked_by_user_id = :u",
        "tenant_invitations": "SELECT count(*) FROM tenant_invitations WHERE lower(email) = :e",
    }
    async with session_factory() as db:
        return {
            name: (await _sql(db, query, u=user_id, e=email.lower())).scalar_one()
            for name, query in checks.items()
        }


async def test_erasure_removes_the_user_and_anonymizes_their_footprint(session_factory):
    from app.services.account_erasure_service import ERASED_USER, AccountErasureService

    ids = await _seed(session_factory)
    a, b = ids["a"], ids["b"]
    storage = FakeStorage()
    service = AccountErasureService(storage=storage)

    async with session_factory() as db:
        report = await service.erase(db, a)

    # Storage: both prefixes (before the DB, then the post-commit sweep) and
    # the thumbnail recorded outside them.
    assert set(storage.prefixes) == {f"documents/{a}/", f"thumbnails/{a}/"}
    assert storage.keys == ["legacy/thumbs/alice.png"]
    assert report.deleted["users"] == 1 and report.deleted["stored_documents"] == 1

    survivors = await _rows_referencing(session_factory, a, ids["a_email"])
    assert survivors == dict.fromkeys(survivors, 0), survivors

    # Bob keeps everything, with Alice replaced by the sentinel.
    scalar = lambda q, **p: _scalar(session_factory, q, **p)  # noqa: E731
    assert await scalar("SELECT count(*) FROM users WHERE id = :b", b=b) == 1
    assert await scalar('SELECT count(*) FROM sessions WHERE "userId" = :b', b=b) == 1
    assert await scalar("SELECT count(*) FROM user_signatures WHERE user_id = :b", b=b) == 1
    assert await scalar("SELECT created_by FROM document_versions WHERE version_number = 2 "
                        "AND document_id = :d", d=ids["doc_b"]) == ERASED_USER
    assert await scalar("SELECT count(*) FROM document_versions WHERE document_id = :d",
                        d=ids["doc_b"]) == 2
    assert await scalar("SELECT count(*) FROM document_shares WHERE document_id = :d "
                        "AND created_by = :s AND revoked_by = :s",
                        d=ids["doc_b"], s=ERASED_USER) == 1
    async with session_factory() as db:
        log = (await _sql(db, "SELECT user_id, user_email, user_name, ip_address, user_agent "
                              "FROM activity_logs WHERE action = 'edit'")).one()
        assert tuple(log) == (ERASED_USER, None, None, None, None)
        shared = (await _sql(db, "SELECT extra_data FROM activity_logs WHERE action = 'share'"))
        assert shared.scalar_one() == {"shared_with": ERASED_USER, "permission": "edit"}
        note = (await _sql(db, "SELECT message, extra_data FROM share_notifications "
                               "WHERE notification_type = 'share_accepted'")).one()
        assert note.message == f"{ERASED_USER} accepted your invitation"
        assert note.extra_data == {"accepter_email": ERASED_USER, "accepter_id": ERASED_USER,
                                   "document_name": "bob.pdf"}
        # Notification about Alice's (deleted) document is gone with it.
        assert (await _sql(db, "SELECT count(*) FROM share_notifications "
                               "WHERE user_id = :b", b=b)).scalar_one() == 1

    # Organisations: Alice's solo one is gone, Bob's team survives and the
    # document Alice shared with it is now attributed to Bob (the owner).
    assert await scalar("SELECT count(*) FROM tenants WHERE id = :t", t=ids["solo"]) == 0
    assert await scalar("SELECT is_active FROM plans WHERE linked_tenant_id = :t",
                        t=str(ids["solo"])) is False
    assert await scalar("SELECT count(*) FROM tenant_members WHERE tenant_id = :t",
                        t=ids["team"]) == 1
    assert await scalar("SELECT added_by_id::text FROM tenant_documents WHERE tenant_id = :t",
                        t=ids["team"]) == ids["quota_b"]
    assert await scalar("SELECT count(*) FROM tenant_invitations") == 0

    # Erasing again changes nothing (storage is still swept: nothing left).
    before = await _rows_referencing(session_factory, b, "bob@example.com")
    async with session_factory() as db:
        again = await AccountErasureService(storage=FakeStorage()).erase(db, a)
    assert not any(again.deleted.values()) and not any(again.anonymized.values())
    assert await _rows_referencing(session_factory, b, "bob@example.com") == before


async def test_owner_of_shared_tenant_is_refused_and_nothing_changes(session_factory):
    from app.models.tenant import TenantMember, TenantRole
    from app.services.account_erasure_service import (
        AccountErasureService,
        TenantOwnershipTransferRequiredError,
    )

    ids = await _seed(session_factory)
    async with session_factory() as db:
        # Bob joins Alice's organisation: it is no longer hers alone.
        quota_b = ids["quota_b"]
        db.add(TenantMember(tenant_id=ids["solo"], user_id=quota_b, role=TenantRole.MEMBER))
        await db.commit()
    before = await _rows_referencing(session_factory, ids["a"], ids["a_email"])
    storage = FakeStorage()

    async with session_factory() as db:
        with pytest.raises(TenantOwnershipTransferRequiredError) as refused:
            await AccountErasureService(storage=storage).erase(db, ids["a"])

    assert refused.value.status_code == 409
    assert refused.value.details == {"tenant_ids": [str(ids["solo"])]}
    assert storage.prefixes == [] and storage.keys == []
    assert await _rows_referencing(session_factory, ids["a"], ids["a_email"]) == before


async def test_active_subscription_is_refused(session_factory):
    from app.services.account_erasure_service import (
        AccountErasureService,
        ActiveSubscriptionError,
    )

    ids = await _seed(session_factory)
    async with session_factory() as db:
        await _sql(db, "UPDATE user_quotas SET stripe_subscription_id = 'sub_1', "
                       "subscription_status = 'active' WHERE user_id = :a", a=ids["a"])
        await db.commit()
    storage = FakeStorage()

    async with session_factory() as db:
        with pytest.raises(ActiveSubscriptionError):
            await AccountErasureService(storage=storage).erase(db, ids["a"])
    assert storage.prefixes == []
    assert await _scalar(session_factory, "SELECT count(*) FROM users WHERE id = :a",
                         a=ids["a"]) == 1


async def test_storage_failure_leaves_the_database_untouched_and_retry_completes(
    session_factory,
):
    from app.services.account_erasure_service import AccountErasureService

    ids = await _seed(session_factory)
    before = await _rows_referencing(session_factory, ids["a"], ids["a_email"])
    # The seed exercises every check: a zero here would make the
    # "nothing survives" assertions vacuous.
    assert all(before.values()), before

    async with session_factory() as db:
        with pytest.raises(ConnectionError):
            await AccountErasureService(storage=FakeStorage(fail=True)).erase(db, ids["a"])
    assert await _rows_referencing(session_factory, ids["a"], ids["a_email"]) == before

    async with session_factory() as db:
        await AccountErasureService(storage=FakeStorage()).erase(db, ids["a"])
    survivors = await _rows_referencing(session_factory, ids["a"], ids["a_email"])
    assert survivors == dict.fromkeys(survivors, 0), survivors


async def test_erasing_a_member_frees_the_surviving_organisation_counters(session_factory):
    """The erased member's active documents leave the organisation's counters.

    The personal quota row is deleted with the account, but an organisation
    that survives the erasure used to keep counting documents that no longer
    exist (nothing reconciles the counters). A document already in the trash
    was freed when it was trashed and must not be freed again.
    """
    from app.models.database import StoredDocument, UserQuota
    from app.models.tenant import Tenant, TenantMember, TenantRole, TenantStatus
    from app.services.account_erasure_service import AccountErasureService

    member, owner = _uid(), _uid()
    async with session_factory() as db:
        await _add_identity(db, member, "member@example.com", "Member")
        await _add_identity(db, owner, "owner@example.com", "Owner")
        member_quota = UserQuota(user_id=member, email="member@example.com")
        owner_quota = UserQuota(user_id=owner, email="owner@example.com")
        db.add_all([member_quota, owner_quota])
        team = Tenant(name="Team", slug=f"team-{owner[:8]}", email="owner@example.com",
                      status=TenantStatus.ACTIVE, storage_used_bytes=10_000, document_count=6)
        db.add(team)
        await db.flush()
        db.add_all([
            TenantMember(tenant_id=team.id, user_id=owner_quota.id, role=TenantRole.OWNER),
            TenantMember(tenant_id=team.id, user_id=member_quota.id, role=TenantRole.MEMBER),
            # Charged to the organisation (recorded on each document).
            StoredDocument(name="a.pdf", owner_id=member, file_size_bytes=1_500,
                           quota_tenant_id=str(team.id)),
            StoredDocument(name="b.pdf", owner_id=member, file_size_bytes=500,
                           quota_tenant_id=str(team.id)),
            StoredDocument(name="old.pdf", owner_id=member, file_size_bytes=700,
                           quota_tenant_id=str(team.id),
                           is_deleted=True, deleted_at=datetime.now(UTC)),
        ])
        await db.commit()
        team_id = team.id

    async with session_factory() as db:
        await AccountErasureService(storage=FakeStorage()).erase(db, member)

    async with session_factory() as db:
        counters = (await _sql(db, "SELECT storage_used_bytes, document_count FROM tenants "
                                   "WHERE id = :t", t=team_id)).one()
    assert tuple(counters) == (10_000 - 2_000, 6 - 2)


async def test_erasing_an_organisations_last_member_hands_its_documents_over(
    session_factory,
):
    """A former member's document still counted on an organisation deleted
    with the account moves to that former member's personal quota.

    Without the hand-over the organisation row could not go (the attribution
    foreign key is RESTRICT), and a ``SET NULL`` would have left the document
    counted nowhere — then freed from a personal quota that never held it.
    """
    from app.models.database import StoredDocument, UserQuota
    from app.models.tenant import Tenant, TenantMember, TenantRole, TenantStatus
    from app.services.account_erasure_service import AccountErasureService

    last_member, former = _uid(), _uid()
    async with session_factory() as db:
        await _add_identity(db, last_member, "last@example.com", "Last")
        await _add_identity(db, former, "former@example.com", "Former")
        last_quota = UserQuota(user_id=last_member, email="last@example.com")
        former_quota = UserQuota(
            user_id=former, email="former@example.com",
            storage_used_bytes=100, document_count=1,
        )
        db.add_all([last_quota, former_quota])
        team = Tenant(name="Solo", slug=f"solo-{last_member[:8]}", email="last@example.com",
                      status=TenantStatus.ACTIVE, storage_used_bytes=2_000, document_count=1)
        db.add(team)
        await db.flush()
        db.add_all([
            TenantMember(tenant_id=team.id, user_id=last_quota.id, role=TenantRole.OWNER),
            # Uploaded while ``former`` was a member (their membership is gone).
            StoredDocument(name="kept.pdf", owner_id=former, file_size_bytes=2_000,
                           quota_tenant_id=str(team.id)),
        ])
        await db.commit()
        team_id = team.id

    async with session_factory() as db:
        await AccountErasureService(storage=FakeStorage()).erase(db, last_member)

    async with session_factory() as db:
        assert (await _sql(db, "SELECT count(*) FROM tenants WHERE id = :t", t=team_id)
                ).scalar_one() == 0
        attribution = (await _sql(db, "SELECT quota_tenant_id FROM stored_documents "
                                      "WHERE owner_id = :o", o=former)).scalar_one()
        counters = (await _sql(db, "SELECT storage_used_bytes, document_count "
                                   "FROM user_quotas WHERE user_id = :u", u=former)).one()
    assert attribution is None
    assert tuple(counters) == (100 + 2_000, 1 + 1)
