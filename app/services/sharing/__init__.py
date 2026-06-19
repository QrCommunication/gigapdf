"""
Sharing sub-package — decomposed from the original share_service.py God Class.

Public API re-exported here so that internal consumers can import from
``app.services.sharing`` directly without coupling to individual module paths.
"""

from .access_guard import (
    AccessDecision,
    authorize_document_access,
    authorize_folder_access,
    user_has_share_in_folder_subtree,
)
from .constants import InvitationStatus, SharePermission, ShareStatus
from .invitation_service import InvitationService, invitation_service
from .permission_service import PermissionService, permission_service
from .share_crud_service import ShareCrudService, share_crud_service

__all__ = [
    # Constants
    "InvitationStatus",
    "SharePermission",
    "ShareStatus",
    # Access guards (owner-or-shared, raise 403 on open)
    "AccessDecision",
    "authorize_document_access",
    "authorize_folder_access",
    "user_has_share_in_folder_subtree",
    # Services (class + singleton)
    "InvitationService",
    "invitation_service",
    "PermissionService",
    "permission_service",
    "ShareCrudService",
    "share_crud_service",
]
