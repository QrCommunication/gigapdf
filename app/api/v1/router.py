"""
Main API router for v1 endpoints.

Aggregates all sub-routers for the v1 API.
"""

from fastapi import APIRouter

from app.api.v1 import (
    activity,
    annotations,
    api_keys,
    billing,
    bookmarks,
    documents,
    elements,
    embed,
    export,
    fonts,
    forms,
    history,
    jobs,
    layers,
    merge_split,
    modify,
    pages,
    plans,
    public_billing,
    quota,
    security,
    sharing,
    storage,
    tenant_documents,
    text,
)
from app.api.v1.admin import admin_router

api_router = APIRouter()

# Include sub-routers
api_router.include_router(
    documents.router,
    prefix="/documents",
    tags=["Documents"],
)

api_router.include_router(
    pages.router,
    prefix="/documents/{document_id}/pages",
    tags=["Pages"],
)

api_router.include_router(
    elements.router,
    prefix="/documents/{document_id}",
    tags=["Elements"],
)

api_router.include_router(
    history.router,
    prefix="/documents/{document_id}/history",
    tags=["History"],
)

api_router.include_router(
    text.router,
    prefix="/documents",
    tags=["Text Operations"],
)

api_router.include_router(
    forms.router,
    prefix="/documents",
    tags=["Forms"],
)

api_router.include_router(
    annotations.router,
    prefix="/documents",
    tags=["Annotations"],
)

api_router.include_router(
    layers.router,
    prefix="/documents",
    tags=["Layers"],
)

api_router.include_router(
    bookmarks.router,
    prefix="/documents",
    tags=["Bookmarks"],
)

api_router.include_router(
    export.router,
    prefix="/documents",
    tags=["Export"],
)

api_router.include_router(
    security.router,
    prefix="/documents",
    tags=["Security"],
)

api_router.include_router(
    merge_split.router,
    prefix="/documents",
    tags=["Merge & Split"],
)

api_router.include_router(
    modify.router,
    prefix="/documents",
    tags=["PDF Modification"],
)

api_router.include_router(
    jobs.router,
    prefix="/jobs",
    tags=["Jobs"],
)

api_router.include_router(
    storage.router,
    prefix="/storage",
    tags=["Storage"],
)

api_router.include_router(
    quota.router,
    prefix="/quota",
    tags=["Quota"],
)

api_router.include_router(
    plans.router,
    prefix="/plans",
    tags=["Plans"],
)

api_router.include_router(
    billing.router,
    prefix="/billing",
    tags=["Billing"],
)

api_router.include_router(
    public_billing.router,
    prefix="/public/billing",
    tags=["Public Billing"],
)

api_router.include_router(
    tenant_documents.router,
    prefix="/tenant-documents",
    tags=["Tenant Documents"],
)

api_router.include_router(
    activity.router,
    prefix="/activity",
    tags=["Activity"],
)

api_router.include_router(
    sharing.router,
    prefix="/sharing",
    tags=["Sharing"],
)

api_router.include_router(
    api_keys.router,
    prefix="/api-keys",
    tags=["API Keys"],
)

api_router.include_router(
    embed.router,
    prefix="/embed",
    tags=["Embed"],
)

api_router.include_router(
    fonts.router,
    prefix="/pdf/fonts",
    tags=["Fonts"],
)

# Admin endpoints
api_router.include_router(
    admin_router,
    prefix="/admin",
    tags=["Admin"],
)
