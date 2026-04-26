"""
Rate limiting middleware.

Implements sliding window rate limiting using Redis
to protect API endpoints from abuse.

Rate limit key strategy:
  - Authenticated requests  → keyed by (user_id + endpoint_category)
  - Anonymous requests      → keyed by (authoritative_ip + endpoint_category)

IP resolution strategy:
  X-Forwarded-For is only trusted when the direct peer is a declared trusted
  proxy (TRUSTED_PROXIES env var, comma-separated CIDRs or IPs).  Otherwise
  the raw connection IP is used, preventing header-spoofing attacks.
"""

import ipaddress
import logging
import os
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.core.cache import get_rate_limiter
from app.core.i18n import get_translation, parse_accept_language
from app.middleware.request_id import get_request_id
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)


def _parse_trusted_proxies() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """
    Parse TRUSTED_PROXIES environment variable into network objects.

    Expected format: comma-separated IPs or CIDRs, e.g.
      TRUSTED_PROXIES=10.0.0.1,172.16.0.0/12,::1

    Returns an empty list when the variable is absent or empty,
    which disables X-Forwarded-For trust entirely.
    """
    raw = os.environ.get("TRUSTED_PROXIES", "").strip()
    if not raw:
        return []

    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            # strict=False allows host bits set in CIDR notation
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            logger.warning(f"TRUSTED_PROXIES: invalid entry ignored — {entry!r}")
    return networks


# Computed once at import time; restart the process to pick up env changes.
_TRUSTED_PROXY_NETWORKS: list[
    ipaddress.IPv4Network | ipaddress.IPv6Network
] = _parse_trusted_proxies()


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


def _is_trusted_proxy(ip_str: str) -> bool:
    """
    Return True when *ip_str* belongs to a declared trusted-proxy network.

    An empty TRUSTED_PROXIES list means no proxy is trusted.
    """
    if not _TRUSTED_PROXY_NETWORKS:
        return False
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED_PROXY_NETWORKS)


def _resolve_client_ip(request: Request) -> str:
    """
    Resolve the authoritative client IP.

    Strategy:
    1. If the direct peer (request.client.host) is a trusted proxy,
       walk X-Forwarded-For right-to-left and return the first IP that
       is NOT itself a trusted proxy — this is the real originating IP.
    2. Otherwise, return request.client.host directly, ignoring any
       X-Forwarded-For header (prevents spoofing when there is no
       trusted proxy in front of the application).

    Returns:
        str: The authoritative client IP address.
    """
    peer_ip = request.client.host if request.client else ""

    if not _is_trusted_proxy(peer_ip):
        # Direct connection or un-declared proxy — use the raw peer IP.
        return peer_ip or "unknown"

    # The direct peer is a trusted proxy; parse X-Forwarded-For.
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        # Header may contain a comma-separated chain from left (client) to
        # right (last proxy). Walk right-to-left and skip trusted proxies.
        ips = [ip.strip() for ip in forwarded_for.split(",")]
        for ip in reversed(ips):
            if ip and not _is_trusted_proxy(ip):
                return ip

    # Fallback: all IPs in the chain are trusted proxies — return the
    # leftmost (closest to the real client) entry, or the peer IP.
    if forwarded_for:
        leftmost = forwarded_for.split(",")[0].strip()
        if leftmost:
            return leftmost

    return peer_ip or "unknown"


def get_rate_limit_key(request: Request, user_id: str | None = None) -> str:
    """
    Generate rate limit key from request.

    Authenticated requests are keyed by user_id to prevent bypass via
    IP rotation.  Anonymous requests are keyed by the authoritative
    client IP resolved through the trusted-proxy chain.

    Args:
        request: FastAPI request.
        user_id: Authenticated user ID (from request.state, populated by
                 the auth middleware).  When present, IP is not used.

    Returns:
        str: Rate limit key prefix (without endpoint category suffix).
    """
    if user_id:
        return f"user:{user_id}"

    client_ip = _resolve_client_ip(request)
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
    user_id: str | None = None,
    category: str | None = None,
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

        # Extract user_id populated by the auth middleware (BACK-01).
        # getattr with None default makes this safe even when the auth
        # middleware hasn't run yet (e.g., public endpoints).
        user_id: str | None = getattr(request.state, "user_id", None)

        # Check rate limit
        is_allowed, info = await check_rate_limit(request, user_id=user_id)

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
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> None:
    """
    FastAPI dependency for rate limiting.

    Reads the user_id set by the auth middleware on request.state so that
    authenticated users are rate-limited by identity rather than IP.

    Raises 429 if rate limit exceeded.
    """
    user_id: str | None = getattr(request.state, "user_id", None)
    is_allowed, info = await check_rate_limit(request, user_id=user_id)

    if not is_allowed:
        language = parse_accept_language(accept_language)
        # `create_rate_limit_response` returns a JSONResponse, which is NOT an
        # exception — `raise`-ing it crashed the dependency at runtime
        # (TypeError: exceptions must derive from BaseException). Use the
        # FastAPI-native HTTPException so the framework formats the 429.
        message = get_translation(
            "RATE_LIMIT_EXCEEDED",
            language,
            seconds=info["reset_in"],
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMIT_EXCEEDED",
                "message": message,
                "details": {
                    "limit": info["limit"],
                    "reset_in_seconds": info["reset_in"],
                },
            },
            headers={
                "X-RateLimit-Limit": str(info["limit"]),
                "X-RateLimit-Remaining": str(info["remaining"]),
                "X-RateLimit-Reset": str(info["reset_in"]),
                "Retry-After": str(info["reset_in"]),
            },
        )


RateLimitDep = Annotated[None, Depends(rate_limit_dependency)]
