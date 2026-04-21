"""
Sharing sub-package — decomposed from the original share_service.py God Class.

Public API re-exported here so that internal consumers can import from
``app.services.sharing`` directly without coupling to individual module paths.
"""

from .constants import InvitationStatus, SharePermission, ShareStatus
from .invitation_service import InvitationService, invitation_service
from .permission_service import PermissionService, permission_service
from .share_crud_service import ShareCrudService, share_crud_service

__all__ = [
    # Constants
    "InvitationStatus",
    "SharePermission",
    "ShareStatus",
    # Services (class + singleton)
    "InvitationService",
    "invitation_service",
    "PermissionService",
    "permission_service",
    "ShareCrudService",
    "share_crud_service",
]
