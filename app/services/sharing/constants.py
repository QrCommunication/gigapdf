"""
Shared constants for the document sharing domain.

Centralises all permission levels, invitation statuses and share statuses
so every sub-service relies on a single source of truth.
"""


class SharePermission:
    """Share permission levels."""

    VIEW = "view"
    EDIT = "edit"


class InvitationStatus:
    """Invitation status values."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ShareStatus:
    """Share status values."""

    ACTIVE = "active"
    REVOKED = "revoked"
