"""
Admin API module.

Provides administrative endpoints for managing the GigaPDF platform.
"""

from fastapi import APIRouter

from app.api.v1.admin import stats, users, documents, jobs, logs, settings, tenants

admin_router = APIRouter()

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
