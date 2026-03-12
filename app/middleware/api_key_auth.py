"""
API Key authentication middleware.

Validates requests that carry an ``X-API-Key`` header against the ``api_keys``
table. When a valid key is found the authenticated user-id is injected into
``request.state`` so that downstream handlers can identify the caller without
a JWT token.  If no ``X-API-Key`` header is present the middleware is a no-op
and the existing JWT auth flow takes over.
"""

import hashlib
import logging
from typing import Optional

from fastapi import Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.cache import get_rate_limiter
from app.core.database import get_db_session
from app.middleware.request_id import get_request_id
from app.models.api_key import ApiKey
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)


def _hash_key(raw_key: str) -> str:
    """Return the SHA-256 hex-digest of *raw_key*."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _extract_origin(request: Request) -> Optional[str]:
    """
    Return the caller's origin from the ``Origin`` or ``Referer`` header.

    ``Origin`` is preferred; ``Referer`` is used as a fallback for contexts
    where browsers send a full URL instead of a bare origin.

    Args:
        request: The incoming FastAPI request.

    Returns:
        Optional[str]: The origin string, or None if no header is present.
    """
    origin = request.headers.get("Origin")
    if origin:
        return origin.rstrip("/")

    referer = request.headers.get("Referer")
    if referer:
        # Keep only scheme + host (strip path)
        from urllib.parse import urlparse

        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"

    return None


def _is_domain_allowed(origin: Optional[str], allowed_domains: Optional[str]) -> bool:
    """
    Verify that *origin* is in the comma-separated *allowed_domains* list.

    When *allowed_domains* is ``None`` or empty the key is unrestricted and
    any origin (including no origin at all) is accepted.

    Args:
        origin: Caller origin extracted from the request headers.
        allowed_domains: Comma-separated list stored on the ``ApiKey`` row.

    Returns:
        bool: True when the origin is permitted.
    """
    if not allowed_domains:
        return True

    allowed = {d.strip().rstrip("/") for d in allowed_domains.split(",") if d.strip()}
    if not allowed:
        return True

    # Server-to-server calls carry no origin — block them when a domain
    # restriction is configured.
    if not origin:
        return False

    return origin in allowed


def _build_error_response(
    status_code: int,
    code: str,
    message: str,
) -> JSONResponse:
    """
    Build a standardised JSON error response consistent with the rest of the API.

    Args:
        status_code: HTTP status code.
        code: Machine-readable error code (e.g. ``API_KEY_INVALID``).
        message: Human-readable error message.

    Returns:
        JSONResponse: Serialised error envelope.
    """
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": code,
                "message": message,
                "details": None,
            },
            "meta": {
                "request_id": get_request_id(),
                "timestamp": now_utc().isoformat(),
            },
        },
    )


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware that authenticates requests bearing an ``X-API-Key`` header.

    Flow
    ----
    1. If the header is absent → pass through (JWT auth takes over).
    2. Hash the raw key and look it up in the database.
    3. Validate ``is_active``, ``expires_at``, and ``allowed_domains``.
    4. Apply a per-key sliding-window rate limit (``rate_limit`` req/min).
    5. Update ``last_used_at`` asynchronously.
    6. Inject ``request.state.api_key_user_id`` for downstream handlers.
    """

    # Paths that bypass API key auth entirely
    EXEMPT_PATHS = {
        "/health",
        "/api/docs",
        "/api/redoc",
        "/api/v1/openapi.json",
    }

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """
        Intercept the request and run API key validation when applicable.

        Args:
            request: The incoming HTTP request.
            call_next: The next middleware or route handler.

        Returns:
            Response: Either an error response or the result from the next handler.
        """
        # Skip exempt paths
        path = request.url.path
        if any(path.startswith(exempt) for exempt in self.EXEMPT_PATHS):
            return await call_next(request)

        # Skip CORS preflight
        if request.method == "OPTIONS":
            return await call_next(request)

        raw_key = request.headers.get("X-API-Key")

        # No API key header → let JWT middleware decide
        if not raw_key:
            return await call_next(request)

        # Validate key against the database
        key_record = await self._lookup_key(raw_key)

        if key_record is None:
            logger.warning(
                "API key not found or inactive",
                extra={"path": path, "method": request.method},
            )
            return _build_error_response(
                status.HTTP_401_UNAUTHORIZED,
                "API_KEY_INVALID",
                "API key is invalid or has been revoked.",
            )

        # Check expiration
        if key_record.expires_at is not None:
            if now_utc() > key_record.expires_at:
                logger.warning(
                    "Expired API key used",
                    extra={"key_id": key_record.id, "path": path},
                )
                return _build_error_response(
                    status.HTTP_401_UNAUTHORIZED,
                    "API_KEY_EXPIRED",
                    "API key has expired.",
                )

        # Check allowed domains
        origin = _extract_origin(request)
        if not _is_domain_allowed(origin, key_record.allowed_domains):
            logger.warning(
                "API key used from disallowed origin",
                extra={"key_id": key_record.id, "origin": origin, "path": path},
            )
            return _build_error_response(
                status.HTTP_403_FORBIDDEN,
                "API_KEY_DOMAIN_NOT_ALLOWED",
                "Request origin is not permitted for this API key.",
            )

        # Per-key rate limiting
        rate_limited, rl_info = await self._check_rate_limit(key_record)
        if rate_limited:
            logger.warning(
                "Per-key rate limit exceeded",
                extra={"key_id": key_record.id, "path": path},
            )
            response = _build_error_response(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                f"Rate limit exceeded. Try again in {rl_info.get('reset_in', 60)} seconds.",
            )
            response.headers["X-RateLimit-Limit"] = str(rl_info.get("limit", key_record.rate_limit))
            response.headers["X-RateLimit-Remaining"] = str(rl_info.get("remaining", 0))
            response.headers["X-RateLimit-Reset"] = str(rl_info.get("reset_in", 60))
            response.headers["Retry-After"] = str(rl_info.get("reset_in", 60))
            return response

        # Inject user identity into request state
        request.state.api_key_user_id = key_record.user_id
        request.state.api_key_id = key_record.id
        request.state.api_key_scopes = key_record.scopes

        logger.debug(
            "Request authenticated via API key",
            extra={"key_id": key_record.id, "user_id": key_record.user_id, "path": path},
        )

        # Call next handler
        response = await call_next(request)

        # Fire-and-forget: update last_used_at (do not block the response)
        try:
            await self._update_last_used(key_record.id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to update last_used_at for API key",
                extra={"key_id": key_record.id, "error": str(exc)},
            )

        # Attach rate-limit headers to the response
        if rl_info:
            response.headers["X-RateLimit-Limit"] = str(rl_info.get("limit", key_record.rate_limit))
            response.headers["X-RateLimit-Remaining"] = str(rl_info.get("remaining", 0))
            response.headers["X-RateLimit-Reset"] = str(rl_info.get("reset_in", 60))

        return response

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _lookup_key(self, raw_key: str) -> Optional[ApiKey]:
        """
        Hash *raw_key* and return the matching active ``ApiKey`` row.

        Args:
            raw_key: The plaintext API key from the request header.

        Returns:
            Optional[ApiKey]: The database record, or ``None`` when not found
            or inactive.
        """
        key_hash = _hash_key(raw_key)

        try:
            async with get_db_session() as session:
                result = await session.execute(
                    select(ApiKey).where(
                        ApiKey.key_hash == key_hash,
                        ApiKey.is_active.is_(True),
                    )
                )
                return result.scalar_one_or_none()
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Database error during API key lookup",
                extra={"error": str(exc)},
            )
            return None

    async def _check_rate_limit(self, key_record: ApiKey) -> tuple[bool, dict]:
        """
        Apply a sliding-window rate limit scoped to the API key.

        The bucket key is ``api_key:<key_id>`` so each key has its own
        independent counter regardless of the user or IP behind it.

        Args:
            key_record: The authenticated ``ApiKey`` ORM instance.

        Returns:
            tuple[bool, dict]: (limit_exceeded, rate_limit_info)
        """
        try:
            rate_limiter = await get_rate_limiter()
            bucket_key = f"api_key:{key_record.id}"
            limit = key_record.rate_limit  # req/min
            window = 60  # 1-minute sliding window

            is_allowed, remaining, reset_in = await rate_limiter.is_allowed(
                bucket_key, limit, window
            )

            info = {
                "limit": limit,
                "remaining": remaining,
                "reset_in": reset_in,
            }
            return not is_allowed, info
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Rate limiter unavailable for API key check; allowing request",
                extra={"key_id": key_record.id, "error": str(exc)},
            )
            return False, {}

    async def _update_last_used(self, key_id: str) -> None:
        """
        Update ``last_used_at`` for the given key in the database.

        Args:
            key_id: Primary key of the ``ApiKey`` row to update.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ApiKey).where(ApiKey.id == key_id)
            )
            key_record = result.scalar_one_or_none()
            if key_record is not None:
                key_record.last_used_at = now_utc()
                await session.flush()
