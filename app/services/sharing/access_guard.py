"""Owner-or-shared access guards for opening documents and folders.

These helpers centralise the authorisation rule applied when a user *opens*
a resource (read access): access is granted to the **owner** or to a user who
has been **granted a share** on the resource, and **403 Forbidden** is raised
otherwise.

Design notes
------------
- The document rule mirrors :meth:`PermissionService.check_access` (owner →
  active direct share → organisation share) but is packaged as a guard that
  loads and returns the row, so endpoints get both the authorisation decision
  and the object in one call (no double query, no IDOR gap).
- Folders have **no dedicated share table**: a folder is considered shared
  with a user when at least one document the user has an active share on lives
  inside that folder *or any of its descendants* (matched via the materialised
  ``Folder.path`` prefix). This makes "open a shared folder" mean "you can see
  this folder because something inside it was shared with you".
- ``403`` is returned for the unauthorised case (not ``404``). This is a
  deliberate trade-off requested by the product: it confirms the existence of
  the resource to an authenticated, non-authorised user, in exchange for a
  clearer client behaviour (distinguish "missing" from "forbidden").
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import DocumentShare, Folder, StoredDocument
from app.utils.helpers import now_utc

from .constants import ShareStatus

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AccessDecision:
    """Result of an access check on a document.

    Attributes:
        permission: Effective permission — ``"owner"``, ``"view"`` or
            ``"edit"``.
        source: Where access comes from — ``"ownership"`` or
            ``"direct_share"``.
        is_owner: True when the requesting user owns the document.
    """

    permission: str
    source: str
    is_owner: bool

    @property
    def can_edit(self) -> bool:
        """True when the access level allows mutating the document."""
        return self.is_owner or self.permission == "edit"


async def _active_share_for_user(
    db: AsyncSession, document_id: str, user_id: str
) -> DocumentShare | None:
    """Return the user's active, non-expired share on a document, if any."""
    result = await db.execute(
        select(DocumentShare).where(
            DocumentShare.document_id == document_id,
            DocumentShare.shared_with_user_id == user_id,
            DocumentShare.status == ShareStatus.ACTIVE,
        )
    )
    share = result.scalar_one_or_none()
    if share is None:
        return None
    if share.expires_at is not None and share.expires_at < now_utc():
        return None
    return share


async def authorize_document_access(
    db: AsyncSession,
    document: StoredDocument | None,
    user_id: str,
) -> AccessDecision:
    """Authorise *user_id* to open *document*; raise 403 if not allowed.

    Access is granted when the user owns the document **or** holds an active
    (non-expired) share on it. Any other case — including a ``None`` document
    (already filtered out by the caller's query) — raises ``403 Forbidden``.

    Args:
        db: Active async session (used to look up a share grant).
        document: The already-loaded document row (or ``None``).
        user_id: The requesting user.

    Returns:
        AccessDecision: ownership/share details for the authorised user.

    Raises:
        HTTPException: ``403`` when the user is neither owner nor a grantee.
    """
    if document is not None and document.owner_id == user_id:
        return AccessDecision(permission="owner", source="ownership", is_owner=True)

    if document is not None:
        share = await _active_share_for_user(db, document.id, user_id)
        if share is not None:
            return AccessDecision(
                permission=share.permission,
                source="direct_share",
                is_owner=False,
            )

    raise HTTPException(
        status_code=403,
        detail="You do not have access to this document",
    )


async def user_has_share_in_folder_subtree(
    db: AsyncSession,
    folder: Folder,
    user_id: str,
) -> bool:
    """True if the user has an active share on any document in the subtree.

    The subtree is the folder itself plus every descendant folder, matched via
    the materialised path prefix (``{path}{id}/``). A single active, non-expired
    share owned by *user_id* on a document located anywhere in that subtree is
    enough to grant folder access.
    """
    descendant_prefix = f"{folder.path}{folder.id}/"
    subtree_ids = select(Folder.id).where(
        (Folder.id == folder.id) | (Folder.path.startswith(descendant_prefix))
    )

    result = await db.execute(
        select(DocumentShare.id)
        .join(StoredDocument, StoredDocument.id == DocumentShare.document_id)
        .where(
            DocumentShare.shared_with_user_id == user_id,
            DocumentShare.status == ShareStatus.ACTIVE,
            (DocumentShare.expires_at.is_(None))
            | (DocumentShare.expires_at >= now_utc()),
            StoredDocument.folder_id.in_(subtree_ids),
            ~StoredDocument.is_deleted,
        )
        .limit(1)
    )
    return result.first() is not None


async def authorize_folder_access(
    db: AsyncSession,
    folder: Folder | None,
    user_id: str,
) -> bool:
    """Authorise *user_id* to open *folder*; raise 403 if not allowed.

    Access is granted when the user owns the folder **or** holds an active
    share on at least one document inside the folder subtree. Any other case —
    including a ``None`` folder — raises ``403 Forbidden``.

    Returns:
        bool: ``True`` when the user owns the folder, ``False`` when access is
        granted only through a shared document inside it. (Useful to scope
        what the caller exposes.)

    Raises:
        HTTPException: ``403`` when the user has no access path to the folder.
    """
    if folder is not None and folder.owner_id == user_id:
        return True

    if folder is not None and await user_has_share_in_folder_subtree(
        db, folder, user_id
    ):
        return False

    raise HTTPException(
        status_code=403,
        detail="You do not have access to this folder",
    )
