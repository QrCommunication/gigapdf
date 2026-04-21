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
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.api.v1.webhooks import router as webhooks_router
from app.api.websocket import cleanup_task, get_socketio_app
from app.config import get_settings
from app.core.cache import close_redis, get_redis
from app.core.database import close_database, init_database
from app.middleware.api_key_auth import ApiKeyAuthMiddleware
from app.middleware.api_quota import APIQuotaMiddleware
from app.middleware.auth import JWTAuthMiddleware
from app.middleware.error_handler import setup_exception_handlers
from app.middleware.rate_limiter import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.sentry import init_sentry

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

    # Initialise Sentry (no-op when SENTRY_DSN is empty)
    init_sentry(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
    )

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

    # OpenAPI servers configuration
    openapi_servers = [
        {
            "url": "https://api.giga-pdf.com",
            "description": "Production server",
        },
    ]

    # Add development server in non-production environments
    if not settings.is_production:
        openapi_servers.append(
            {
                "url": "http://localhost:8000",
                "description": "Local development server",
            }
        )

    # OpenAPI tag metadata for better documentation organization
    tags_metadata = [
        {
            "name": "documents",
            "description": "Document upload, retrieval, and management",
        },
        {
            "name": "pages",
            "description": "Page operations including rotation, resizing, and reordering",
        },
        {
            "name": "elements",
            "description": "Create and manage page elements (text, images, shapes)",
        },
        {
            "name": "export",
            "description": "Export documents to various formats (PNG, JPEG, PDF, HTML)",
        },
        {
            "name": "merge-split",
            "description": "Merge multiple PDFs or split PDFs into separate files",
        },
        {
            "name": "text",
            "description": "Text search, replace, and extraction operations",
        },
        {
            "name": "sharing",
            "description": "Document sharing and collaboration",
        },
        {
            "name": "billing",
            "description": "Subscription and payment management",
        },
        {
            "name": "jobs",
            "description": "Async job tracking and management",
        },
        {
            "name": "annotations",
            "description": "Add highlights, notes, and link annotations",
        },
        {
            "name": "forms",
            "description": "Form field operations and filling",
        },
        {
            "name": "security",
            "description": "PDF encryption and decryption",
        },
        {
            "name": "layers",
            "description": "PDF layer management (OCG)",
        },
        {
            "name": "bookmarks",
            "description": "Bookmark/outline management",
        },
        {
            "name": "storage",
            "description": "Persistent document storage",
        },
        {
            "name": "quota",
            "description": "Usage quota information",
        },
        {
            "name": "history",
            "description": "Undo/redo history",
        },
        {
            "name": "activity",
            "description": "User activity logs",
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
- **Flexible Plans**: Free, Starter (9 EUR/mo), Pro (29 EUR/mo), Enterprise
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

## Rate Limits

API rate limits vary by plan:
- **Free**: 100 requests/hour
- **Starter**: 1,000 requests/hour
- **Pro**: 10,000 requests/hour
- **Enterprise**: Custom limits

Rate limit headers are included in all responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when the limit resets
        """,
        version="1.0.0",
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        terms_of_service="https://giga-pdf.com/terms",
        contact={
            "name": "Giga-PDF Support",
            "url": "https://giga-pdf.com/support",
            "email": "support@giga-pdf.com",
        },
        license_info={
            "name": "Proprietary",
            "url": "https://giga-pdf.com/license",
        },
        servers=openapi_servers,
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

    # GZip compression middleware (outermost layer, added last per LIFO order)
    # minimum_size=1024: skip compression for small payloads (< 1KB)
    # compresslevel=5: balance between CPU usage and compression ratio
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

    # Request ID middleware
    app.add_middleware(RequestIDMiddleware)

    # Rate limiting middleware
    app.add_middleware(RateLimitMiddleware)

    # API quota tracking middleware
    # Runs after both auth middlewares so request.state.user_id is already
    # populated by JWTAuthMiddleware or request.state.api_key_user_id by
    # ApiKeyAuthMiddleware before quota is checked.
    app.add_middleware(APIQuotaMiddleware)

    # JWT authentication middleware
    # Decodes the Bearer token (best-effort) and sets request.state.user_id
    # so that APIQuotaMiddleware (which runs later in the LIFO chain) can
    # enforce per-user quotas for JWT-authenticated requests.
    app.add_middleware(JWTAuthMiddleware)

    # API key authentication middleware
    # Outermost auth layer: runs first on every request.  Sets
    # request.state.api_key_user_id when an X-API-Key header is present.
    # If the header is absent the middleware is a no-op and JWT auth takes over.
    app.add_middleware(ApiKeyAuthMiddleware)

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
