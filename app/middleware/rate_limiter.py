"""
Rate limiting middleware.

Implements sliding window rate limiting using Redis
to protect API endpoints from abuse.
"""

import logging
from typing import Annotated, Optional

from fastapi import Depends, Header, Request, status
from fastapi.responses import JSONResponse

from app.core.cache import get_rate_limiter, RateLimiter
from app.core.i18n import get_translation, parse_accept_language
from app.middleware.request_id import get_request_id
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)


# Rate limit configurations per endpoint category
RATE_LIMITS = {
    # Category: (requests, window_seconds)
    "default": (100, 60),  # 100 requests per minute
    "upload": (10, 60),  # 10 uploads per minute
    "export": (20, 60),  # 20 exports per minute
    "ocr": (5, 60),  # 5 OCR requests per minute
    "auth": (20, 60),  # 20 auth attempts per minute
    "search": (30, 60),  # 30 searches per minute
}


def get_rate_limit_key(request: Request, user_id: Optional[str] = None) -> str:
    """
    Generate rate limit key from request.

    Uses user ID if authenticated, otherwise client IP.

    Args:
        request: FastAPI request.
        user_id: Authenticated user ID.

    Returns:
        str: Rate limit key.
    """
    if user_id:
        return f"user:{user_id}"

    # Get client IP from headers or connection
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"

    return f"ip:{client_ip}"


def get_endpoint_category(path: str, method: str) -> str:
    """
    Determine rate limit category from endpoint.

    Args:
        path: Request path.
        method: HTTP method.

    Returns:
        str: Rate limit category.
    """
    path_lower = path.lower()

    if "/upload" in path_lower and method == "POST":
        return "upload"
    elif "/export" in path_lower:
        return "export"
    elif "/ocr" in path_lower:
        return "ocr"
    elif "/text/search" in path_lower or "/text/replace" in path_lower:
        return "search"
    elif "/unlock" in path_lower or "/login" in path_lower:
        return "auth"

    return "default"


async def check_rate_limit(
    request: Request,
    user_id: Optional[str] = None,
    category: Optional[str] = None,
) -> tuple[bool, dict]:
    """
    Check if request is within rate limits.

    Args:
        request: FastAPI request.
        user_id: Authenticated user ID.
        category: Override rate limit category.

    Returns:
        tuple: (is_allowed, rate_limit_info)
    """
    # Determine category and limits
    if category is None:
        category = get_endpoint_category(request.url.path, request.method)

    limit, window = RATE_LIMITS.get(category, RATE_LIMITS["default"])

    # Get rate limiter
    rate_limiter = await get_rate_limiter()

    # Generate key
    base_key = get_rate_limit_key(request, user_id)
    full_key = f"{base_key}:{category}"

    # Check limit
    is_allowed, remaining, reset_in = await rate_limiter.is_allowed(
        full_key, limit, window
    )

    info = {
        "limit": limit,
        "remaining": remaining,
        "reset_in": reset_in,
        "category": category,
    }

    if not is_allowed:
        logger.warning(f"Rate limit exceeded for {base_key} ({category})")

    return is_allowed, info


def create_rate_limit_response(
    info: dict,
    language: str = "en",
) -> JSONResponse:
    """
    Create rate limit exceeded response.

    Args:
        info: Rate limit info dict.
        language: Response language.

    Returns:
        JSONResponse: 429 response.
    """
    message = get_translation(
        "RATE_LIMIT_EXCEEDED",
        language,
        seconds=info["reset_in"],
    )

    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": "RATE_LIMIT_EXCEEDED",
                "message": message,
                "details": {
                    "limit": info["limit"],
                    "reset_in_seconds": info["reset_in"],
                },
            },
            "meta": {
                "request_id": get_request_id(),
                "timestamp": now_utc().isoformat(),
            },
        },
        headers={
            "X-RateLimit-Limit": str(info["limit"]),
            "X-RateLimit-Remaining": str(info["remaining"]),
            "X-RateLimit-Reset": str(info["reset_in"]),
            "Retry-After": str(info["reset_in"]),
        },
    )


class RateLimitMiddleware:
    """
    Rate limiting middleware for FastAPI.

    Checks rate limits before processing requests.
    """

    # Paths that don't require rate limiting
    EXEMPT_PATHS = {
        "/health",
        "/api/docs",
        "/api/redoc",
        "/api/v1/openapi.json",
    }

    def __init__(self, app):
        """Initialize middleware."""
        self.app = app

    async def __call__(self, scope, receive, send):
        """Process request through middleware."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Create request object
        request = Request(scope, receive)
        path = request.url.path

        # Skip exempt paths
        if any(path.startswith(exempt) for exempt in self.EXEMPT_PATHS):
            await self.app(scope, receive, send)
            return

        # Check rate limit
        # Note: User ID would come from auth middleware in real implementation
        is_allowed, info = await check_rate_limit(request, user_id=None)

        if not is_allowed:
            # Get language from header
            accept_lang = request.headers.get("Accept-Language", "en")
            language = parse_accept_language(accept_lang)

            response = create_rate_limit_response(info, language)
            await response(scope, receive, send)
            return

        # Add rate limit headers to response
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend([
                    (b"X-RateLimit-Limit", str(info["limit"]).encode()),
                    (b"X-RateLimit-Remaining", str(info["remaining"]).encode()),
                    (b"X-RateLimit-Reset", str(info["reset_in"]).encode()),
                ])
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


# Dependency for per-endpoint rate limiting
async def rate_limit_dependency(
    request: Request,
    accept_language: Annotated[Optional[str], Header(alias="Accept-Language")] = None,
) -> None:
    """
    FastAPI dependency for rate limiting.

    Raises 429 if rate limit exceeded.
    """
    is_allowed, info = await check_rate_limit(request)

    if not is_allowed:
        language = parse_accept_language(accept_language)
        raise create_rate_limit_response(info, language)


RateLimitDep = Annotated[None, Depends(rate_limit_dependency)]
