"""Unit tests for the owner-or-shared access guards (RLS on open).

Covers ``authorize_document_access`` / ``authorize_folder_access``:
- owner is allowed,
- a user with an active (non-expired) share is allowed,
- anyone else gets 403 (not 404),
- expired / revoked shares do not grant access.

A tiny scripted fake AsyncSession returns pre-enqueued results in order, so the
guards can be exercised without a database.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.sharing.access_guard import (
    AccessDecision,
    authorize_document_access,
    authorize_folder_access,
)
from app.services.sharing.constants import ShareStatus

OWNER_ID = "owner-0000-0000-0000-000000000001"
SHARED_ID = "shared-0000-0000-0000-000000000002"
STRANGER_ID = "stranger-0000-0000-0000-000000000003"
DOC_ID = "770e8400-e29b-41d4-a716-446655440002"
FOLDER_ID = "660e8400-e29b-41d4-a716-446655440001"


class _FakeResult:
    def __init__(self, *, scalar=None, first=None):
        self._scalar = scalar
        self._first = first

    def scalar_one_or_none(self):
        return self._scalar

    def first(self):
        return self._first


class _FakeSession:
    """Returns scripted results in FIFO order for each execute()."""

    def __init__(self, results: list[_FakeResult] | None = None):
        self._results = list(results or [])

    async def execute(self, *_args, **_kwargs):
        assert self._results, "FakeSession: unexpected execute() call"
        return self._results.pop(0)


def _doc(owner_id=OWNER_ID):
    return SimpleNamespace(id=DOC_ID, owner_id=owner_id, is_deleted=False)


def _folder(owner_id=OWNER_ID):
    return SimpleNamespace(id=FOLDER_ID, owner_id=owner_id, path="/")


def _share(*, user_id=SHARED_ID, status=ShareStatus.ACTIVE, expires_at=None):
    return SimpleNamespace(
        id="share-1",
        document_id=DOC_ID,
        shared_with_user_id=user_id,
        status=status,
        permission="view",
        expires_at=expires_at,
    )


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

class TestAuthorizeDocumentAccess:
    @pytest.mark.asyncio
    async def test_owner_is_allowed_without_db_lookup(self):
        session = _FakeSession()  # no share lookup needed for the owner
        decision = await authorize_document_access(session, _doc(), OWNER_ID)
        assert isinstance(decision, AccessDecision)
        assert decision.is_owner is True
        assert decision.permission == "owner"
        assert decision.can_edit is True

    @pytest.mark.asyncio
    async def test_shared_user_is_allowed(self):
        session = _FakeSession([_FakeResult(scalar=_share())])
        decision = await authorize_document_access(session, _doc(), SHARED_ID)
        assert decision.is_owner is False
        assert decision.source == "direct_share"
        assert decision.permission == "view"
        assert decision.can_edit is False

    @pytest.mark.asyncio
    async def test_shared_edit_grant_can_edit(self):
        share = _share(user_id=SHARED_ID)
        share.permission = "edit"
        session = _FakeSession([_FakeResult(scalar=share)])
        decision = await authorize_document_access(session, _doc(), SHARED_ID)
        assert decision.can_edit is True

    @pytest.mark.asyncio
    async def test_stranger_is_forbidden_403(self):
        session = _FakeSession([_FakeResult(scalar=None)])  # no share
        with pytest.raises(HTTPException) as exc:
            await authorize_document_access(session, _doc(), STRANGER_ID)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_expired_share_is_forbidden_403(self):
        expired = _share(expires_at=datetime.now(UTC) - timedelta(days=1))
        session = _FakeSession([_FakeResult(scalar=expired)])
        with pytest.raises(HTTPException) as exc:
            await authorize_document_access(session, _doc(), SHARED_ID)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_none_document_is_forbidden_403(self):
        session = _FakeSession()
        with pytest.raises(HTTPException) as exc:
            await authorize_document_access(session, None, OWNER_ID)
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

class TestAuthorizeFolderAccess:
    @pytest.mark.asyncio
    async def test_owner_is_allowed(self):
        session = _FakeSession()
        is_owner = await authorize_folder_access(session, _folder(), OWNER_ID)
        assert is_owner is True

    @pytest.mark.asyncio
    async def test_shared_document_in_subtree_grants_access(self):
        # First (and only) query: subtree share lookup → returns a row.
        session = _FakeSession([_FakeResult(first=("share-1",))])
        is_owner = await authorize_folder_access(session, _folder(), SHARED_ID)
        assert is_owner is False  # access via share, not ownership

    @pytest.mark.asyncio
    async def test_stranger_is_forbidden_403(self):
        session = _FakeSession([_FakeResult(first=None)])  # no shared doc inside
        with pytest.raises(HTTPException) as exc:
            await authorize_folder_access(session, _folder(), STRANGER_ID)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_none_folder_is_forbidden_403(self):
        session = _FakeSession()
        with pytest.raises(HTTPException) as exc:
            await authorize_folder_access(session, None, OWNER_ID)
        assert exc.value.status_code == 403
