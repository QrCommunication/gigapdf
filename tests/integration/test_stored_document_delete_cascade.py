"""Permanently deleting a StoredDocument must not fight the database cascades.

Regression (prod, 2026-10-27): ``DELETE /storage/documents/{id}?permanent=true``
answered 500 for every document ever opened in the editor. The ``layers``
backref kept SQLAlchemy's default cascade, so ``session.delete(document)``
first issued ``UPDATE document_layers SET stored_document_id = NULL`` — a NOT
NULL column — instead of letting ``ON DELETE CASCADE`` drop the row. The same
held for pending share invitations (NOT NULL too), while share notifications
and activity logs were left orphaned with a NULL document. The 30-day trash
purge goes through the same delete.

Runs against a throwaway PostgreSQL database (``pg_schema_db``, see
tests/integration/conftest.py). The mapper and FK behaviour is PostgreSQL's,
which the unit tests' fake sessions cannot reproduce.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest


@pytest.fixture
def session(pg_schema_db):
    """ORM session on a throwaway database with the full schema.

    The full schema matters: deleting a document also walks the ORM-cascaded
    versions and tenant shares. ocr_blocks needs pgvector.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    engine = create_engine(pg_schema_db.sync_url)
    try:
        with Session(engine) as db:
            yield db
    finally:
        engine.dispose()


def _count(db, model, **filters) -> int:
    from sqlalchemy import func, select

    query = select(func.count()).select_from(model)
    for column, value in filters.items():
        query = query.where(getattr(model, column) == value)
    return db.execute(query).scalar_one()


def test_permanent_delete_drops_every_dependent_row(session) -> None:
    from app.models.database import (
        ActivityLog,
        DocumentLayers,
        DocumentShareInvitation,
        ShareNotification,
        StoredDocument,
    )

    document = StoredDocument(name="scan", owner_id="owner-1")
    session.add(document)
    session.flush()
    invitation = DocumentShareInvitation(
        document_id=document.id,
        inviter_id="owner-1",
        invitee_email="guest@example.com",
        token=uuid.uuid4().hex,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    session.add_all(
        [
            DocumentLayers(stored_document_id=document.id, data={"layers": []}),
            invitation,
            ShareNotification(
                user_id="owner-1",
                notification_type="share_invitation",
                title="Invitation",
                document_id=document.id,
            ),
            ActivityLog(user_id="owner-1", action="view", document_id=document.id),
        ]
    )
    session.commit()

    # Load the backrefs first: the bug only fires when the ORM knows the children.
    assert document.layers and document.share_invitations
    session.delete(document)
    session.commit()

    for model in (DocumentLayers, DocumentShareInvitation, ShareNotification, ActivityLog):
        assert _count(session, model) == 0, f"{model.__tablename__} rows survived"
    assert _count(session, StoredDocument) == 0
