"""Permanently deleting a StoredDocument must not fight the database cascades.

Regression (prod, 2026-10-27): ``DELETE /storage/documents/{id}?permanent=true``
answered 500 for every document ever opened in the editor. The ``layers``
backref kept SQLAlchemy's default cascade, so ``session.delete(document)``
first issued ``UPDATE document_layers SET stored_document_id = NULL`` — a NOT
NULL column — instead of letting ``ON DELETE CASCADE`` drop the row. The same
held for pending share invitations (NOT NULL too), while share notifications
and activity logs were left orphaned with a NULL document. The 30-day trash
purge goes through the same delete.

Runs against a throwaway database on the local PostgreSQL (socket peer auth);
skipped when none is reachable. The mapper and FK behaviour is PostgreSQL's,
which the unit tests' fake sessions cannot reproduce.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

_SOCKET_DIR = "/var/run/postgresql"


def _psql(dbname: str, sql: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["psql", "-d", dbname, "-h", _SOCKET_DIR, "-tAqc", sql],
        capture_output=True,
        text=True,
    )


def _local_postgres_available() -> bool:
    if not Path(_SOCKET_DIR).exists():
        return False
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        return False
    return _psql("postgres", "SELECT 1").returncode == 0


pytestmark = pytest.mark.skipif(
    not _local_postgres_available(),
    reason="local PostgreSQL not reachable (socket peer auth)",
)


@pytest.fixture
def session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.models.database import StoredDocument

    name = f"gigapdf_cascade_test_{uuid.uuid4().hex[:12]}"
    assert _psql("postgres", f'CREATE DATABASE "{name}"').returncode == 0
    user = os.environ.get("USER", "postgres")
    engine = create_engine(f"postgresql+psycopg2://{user}@/{name}?host={_SOCKET_DIR}")
    try:
        # The full schema: deleting a document also walks the ORM-cascaded
        # versions and tenant shares. ocr_blocks needs pgvector.
        assert _psql(name, "CREATE EXTENSION IF NOT EXISTS vector").returncode == 0
        StoredDocument.metadata.create_all(engine)
        with Session(engine) as db:
            yield db
    finally:
        engine.dispose()
        _psql(
            "postgres",
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname='{name}' AND pid<>pg_backend_pid()",
        )
        _psql("postgres", f'DROP DATABASE IF EXISTS "{name}"')


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
