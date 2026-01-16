"""
Main FastAPI application entry point.

This module initializes the FastAPI application with all routes,
middleware, and event handlers.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.api.v1.webhooks import router as webhooks_router
from app.api.websocket import cleanup_task, get_socketio_app
from app.config import get_settings
from app.core.cache import close_redis, get_redis
from app.core.database import close_database, init_database
from app.middleware.api_quota import APIQuotaMiddleware
from app.middleware.error_handler import setup_exception_handlers
from app.middleware.rate_limiter import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if get_settings().app_debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager.

    Handles startup and shutdown events for the application.

    Args:
        app: FastAPI application instance.

    Yields:
        None during application runtime.
    """
    # Startup
    logger.info("Starting Giga-PDF API...")
    settings = get_settings()

    # Ensure storage directory exists
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    logger.info(f"Storage path: {settings.storage_path}")

    # Initialize database
    try:
        await init_database()
        logger.info("Database initialized")
    except Exception as e:
        logger.warning(f"Database initialization skipped (may not be configured): {e}")

    # Initialize Redis cache
    try:
        redis = await get_redis()
        await redis.ping()
        logger.info("Redis cache connected")
    except Exception as e:
        logger.warning(f"Redis connection failed (may not be configured): {e}")

    # Initialize document session manager
    from app.repositories.document_repo import document_sessions

    logger.info("Document session manager initialized")

    # Start WebSocket cleanup task
    cleanup_task_handle = asyncio.create_task(cleanup_task())
    logger.info("WebSocket cleanup task started")

    yield

    # Shutdown
    logger.info("Shutting down Giga-PDF API...")

    # Cancel cleanup task
    cleanup_task_handle.cancel()
    try:
        await cleanup_task_handle
    except asyncio.CancelledError:
        pass

    # Clean up document sessions
    document_sessions.clear_all()
    logger.info("All document sessions cleared")

    # Close Redis connection
    try:
        await close_redis()
        logger.info("Redis connection closed")
    except Exception as e:
        logger.warning(f"Error closing Redis: {e}")

    # Close database connections
    try:
        await close_database()
        logger.info("Database connections closed")
    except Exception as e:
        logger.warning(f"Error closing database: {e}")


def create_application() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        FastAPI: Configured application instance.
    """
    settings = get_settings()

    # OpenAPI tag metadata for better documentation organization
    tags_metadata = [
        {
            "name": "Documents",
            "description": "Upload, manage, and manipulate PDF documents. Create sessions, preview pages, and download files.",
        },
        {
            "name": "Pages",
            "description": "Page-level operations: add, remove, reorder, rotate, resize, and extract pages.",
        },
        {
            "name": "Elements",
            "description": "Manipulate document elements: text blocks, images, shapes, and annotations.",
        },
        {
            "name": "Text Operations",
            "description": "Extract, search, and modify text content within PDF documents.",
        },
        {
            "name": "Forms",
            "description": "Work with PDF forms: fill fields, create form elements, and flatten forms.",
        },
        {
            "name": "Annotations",
            "description": "Add and manage PDF annotations: comments, highlights, stamps, and drawings.",
        },
        {
            "name": "Security",
            "description": "PDF security operations: encryption, decryption, password protection, and permissions.",
        },
        {
            "name": "Export",
            "description": "Export PDFs to various formats: PNG, JPEG, DOCX, HTML, and more.",
        },
        {
            "name": "Merge & Split",
            "description": "Combine multiple PDFs or split documents into separate files.",
        },
        {
            "name": "Storage",
            "description": "Persistent document storage: save, organize with folders, and manage document versions.",
        },
        {
            "name": "Quota",
            "description": "User quota management: storage limits, API call tracking, and plan information.",
        },
        {
            "name": "Plans",
            "description": "Subscription plan management: view plans, pricing, and features.",
        },
        {
            "name": "Billing",
            "description": "Billing and subscription management: checkout, portal, invoices, and payment methods. **Requires authentication.**",
        },
        {
            "name": "Public Billing",
            "description": "**Public endpoints** for landing page: view plans, create checkout sessions, start trials. Some endpoints allow guest access.",
        },
        {
            "name": "Tenant Documents",
            "description": "**Organization document sharing**. Share documents with team members, manage access levels (read/write).",
        },
        {
            "name": "Sharing",
            "description": "**Document sharing**. Share documents by email, manage invitations, create public links, and handle notifications.",
        },
        {
            "name": "Admin",
            "description": "**Admin endpoints** for system management: users, documents, jobs, tenants, and settings.",
        },
        {
            "name": "Jobs",
            "description": "Async job tracking for long-running operations like OCR, export, and merge.",
        },
        {
            "name": "Health",
            "description": "System health check endpoints.",
        },
        {
            "name": "Webhooks",
            "description": "**Webhook endpoints** for external service integrations (Stripe payments).",
        },
    ]

    app = FastAPI(
        title="Giga-PDF API",
        description="""
# Giga-PDF - WYSIWYG PDF Editing Engine

A comprehensive REST API for PDF manipulation, enabling visual editing
of PDF documents like a web canvas editor.

## Features

- **Document Management**: Upload, parse, download, and manage PDF documents
- **Page Operations**: Add, remove, reorder, rotate, and resize pages
- **Element Editing**: Manipulate text, images, shapes, and annotations
- **Form Handling**: Fill, create, and flatten PDF forms
- **OCR Integration**: Extract text from scanned documents
- **Collaboration**: Real-time multi-user editing via WebSocket
- **Export**: Convert PDFs to various formats (PNG, JPEG, DOCX, etc.)
- **Security**: Encrypt/decrypt PDFs, manage permissions

## Organizations / Tenants

Users can create or join organizations (tenants) to share documents and quotas:

- **Tenant Plans**: Enterprise plans provide shared storage and API limits for all members
- **Document Sharing**: Share documents with team members (read or write access)
- **Role-based Permissions**: Owner, Admin, Manager, Member, Viewer roles
- **Quota Inheritance**: Members inherit organization limits while keeping file ownership

## Billing & Subscriptions

GigaPDF uses Stripe for payment processing:

- **14-day Free Trial**: Try Starter or Pro plans without a credit card
- **Flexible Plans**: Free, Starter (€9/mo), Pro (€29/mo), Enterprise
- **Organization Billing**: Only owners can manage billing for organizations
- **Trial Freedom**: Change plans freely during trial with no charges

## Authentication

All endpoints require JWT authentication via the `Authorization: Bearer <token>` header.
The JWT is validated against an external authentication service.

## Async Operations

Large file operations (OCR, export, merge) are processed asynchronously.
Use the `/jobs/{job_id}` endpoint to track progress.

## API Responses

All responses follow a standard format:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO-8601"
  }
}
```
        """,
        version="1.0.0",
        openapi_url="/api/v1/openapi.json" if settings.is_development else None,
        docs_url="/api/docs" if settings.is_development else None,
        redoc_url="/api/redoc" if settings.is_development else None,
        lifespan=lifespan,
        openapi_tags=tags_metadata,
    )

    # CORS middleware
    # Note: When allow_credentials=True, we cannot use "*" for allow_origins
    # In development, we use allow_origin_regex to allow all localhost ports
    if settings.is_production:
        cors_origins = [
            "https://giga-pdf.com",
            "https://www.giga-pdf.com",
            "https://app.giga-pdf.com",
            "https://admin.giga-pdf.com",
        ]

        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=[
                "Authorization",
                "Content-Type",
                "Accept",
                "Accept-Language",
                "X-Request-ID",
                "X-Requested-With",
            ],
            expose_headers=[
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset",
                "X-API-Quota-Limit",
                "X-API-Quota-Remaining",
                "Content-Disposition",
            ],
            max_age=600,
        )
    else:
        # Development mode - more permissive
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Request ID middleware
    app.add_middleware(RequestIDMiddleware)

    # Rate limiting middleware
    app.add_middleware(RateLimitMiddleware)

    # API quota tracking middleware
    app.add_middleware(APIQuotaMiddleware)

    # Setup exception handlers
    setup_exception_handlers(app)

    # Include API router
    app.include_router(api_router, prefix="/api/v1")

    # Include Webhooks router (at root level for stable URLs)
    app.include_router(webhooks_router, prefix="/webhooks", tags=["Webhooks"])

    # Mount WebSocket server at /socket.io path
    sio_app = get_socketio_app()
    app.mount("/socket.io", sio_app)
    logger.info("WebSocket server mounted at /socket.io")

    # Health check endpoint
    @app.get("/health", tags=["Health"])
    async def health_check() -> JSONResponse:
        """
        Health check endpoint.

        Returns:
            JSONResponse: Health status of the API.
        """
        return JSONResponse(
            content={
                "status": "healthy",
                "version": "1.0.0",
                "service": "giga-pdf",
            }
        )

    return app


# Create application instance
app = create_application()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.is_development,
        workers=1 if settings.is_development else settings.app_workers,
    )
