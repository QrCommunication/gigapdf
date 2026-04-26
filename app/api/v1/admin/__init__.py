"""
Admin API module.

Provides administrative endpoints for managing the GigaPDF platform.

All routes registered under ``admin_router`` are automatically protected by
the ``get_current_admin_user`` dependency, which verifies that the caller
holds the ``admin`` role.  No individual endpoint needs to add its own auth
check — the dependency is applied once at the router level via
``dependencies=[...]``.
"""

from fastapi import APIRouter, Depends

from app.api.dependencies.admin import get_current_admin_user
from app.api.v1.admin import documents, infrastructure, jobs, logs, settings, stats, tenants, users

# The Depends(get_current_admin_user) applied here runs before EVERY route
# registered on admin_router (including all sub-routers included below).
# Individual endpoints do not need to redeclare this dependency.
admin_router = APIRouter(
    dependencies=[Depends(get_current_admin_user)]
)

admin_router.include_router(
    stats.router,
    prefix="/stats",
    tags=["Admin - Statistics"],
)

admin_router.include_router(
    users.router,
    prefix="/users",
    tags=["Admin - Users"],
)

admin_router.include_router(
    documents.router,
    prefix="/documents",
    tags=["Admin - Documents"],
)

admin_router.include_router(
    jobs.router,
    prefix="/jobs",
    tags=["Admin - Jobs"],
)

admin_router.include_router(
    logs.router,
    prefix="/logs",
    tags=["Admin - Logs"],
)

admin_router.include_router(
    settings.router,
    prefix="/settings",
    tags=["Admin - Settings"],
)

admin_router.include_router(
    tenants.router,
    prefix="/tenants",
    tags=["Admin - Tenants"],
)

admin_router.include_router(
    infrastructure.router,
    prefix="/infrastructure",
    tags=["Admin - Infrastructure"],
)
