"""
Admin authentication dependency.

Provides a dependency that enforces admin-only access on protected routes.
Any valid JWT that does not carry the 'admin' role is rejected with HTTP 403.
"""

import logging
from typing import Annotated

from fastapi import Depends
from fastapi.exceptions import HTTPException
from starlette import status

from app.middleware.auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)


async def get_current_admin_user(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """
    Dependency that enforces admin access.

    Calls ``get_current_user`` to authenticate the request, then verifies
    that the resolved user holds the ``admin`` role.  Raises HTTP 403 if
    the check fails so that the caller never learns whether the resource
    exists or not (prevents probing).

    Args:
        user: The authenticated user injected by ``get_current_user``.

    Returns:
        CurrentUser: The same user object, confirmed to be an admin.

    Raises:
        HTTPException 401: Propagated from ``get_current_user`` when no
            valid token is present.
        HTTPException 403: When the authenticated user lacks admin role.
    """
    roles: list[str] = user.roles or []
    if "admin" not in roles:
        logger.warning(
            "Admin access denied for user=%s roles=%s",
            user.user_id,
            roles,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    logger.info("Admin access granted for user=%s", user.user_id)
    return user


# Convenience type alias for use in endpoint signatures
AdminUser = Annotated[CurrentUser, Depends(get_current_admin_user)]
