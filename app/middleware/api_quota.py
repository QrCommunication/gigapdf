"""
API Quota Middleware - Tracks and limits API calls per user.

Free tier: 1000 calls/month
"""

import logging

from fastapi import Request, status
from fastapi.responses import JSONResponse

from app.core.i18n import get_translation, parse_accept_language
from app.middleware.request_id import get_request_id
from app.services.quota_service import quota_service
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)


# Paths exempt from API quota tracking
EXEMPT_PATHS = {
    "/health",
    "/api/docs",
    "/api/redoc",
    "/api/v1/openapi.json",
    "/ws",
}


class APIQuotaMiddleware:
    """
    Middleware to track and enforce API call quotas.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        path = request.url.path

        # Skip exempt paths
        if any(path.startswith(exempt) for exempt in EXEMPT_PATHS):
            await self.app(scope, receive, send)
            return

        # Get user ID from request state.
        # Populated by JWTAuthMiddleware (JWT flow) or ApiKeyAuthMiddleware
        # (API key flow, stored as api_key_user_id).
        user_id: str | None = getattr(request.state, "user_id", None)

        # Fallback: API key auth sets a separate attribute; unify here so quota
        # tracking works regardless of the authentication method used.
        if not user_id:
            user_id = getattr(request.state, "api_key_user_id", None)

        if not user_id:
            # No authenticated user found at quota-check time.  This is expected
            # for truly public routes (already exempted above) and unexpected for
            # authenticated routes — log a warning to surface future bugs.
            logger.warning(
                "APIQuotaMiddleware: user_id absent on non-exempt path — quota not enforced",
                extra={"path": path, "method": scope.get("method", "?")},
            )

        if user_id:
            # Check API quota
            is_allowed, info = await quota_service.check_api_quota(user_id)

            if not is_allowed:
                accept_lang = request.headers.get("Accept-Language", "en")
                language = parse_accept_language(accept_lang)

                response = JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={
                        "success": False,
                        "error": {
                            "code": "API_QUOTA_EXCEEDED",
                            "message": get_translation("API_QUOTA_EXCEEDED", language),
                            "details": info,
                        },
                        "meta": {
                            "request_id": get_request_id(),
                            "timestamp": now_utc().isoformat(),
                        },
                    },
                    headers={
                        "X-API-Quota-Limit": str(info["api_calls_limit"]),
                        "X-API-Quota-Remaining": "0",
                        "X-API-Quota-Reset": info["reset_at"],
                    },
                )
                await response(scope, receive, send)
                return

            # Increment API call count
            updated = await quota_service.increment_api_calls(user_id)

            # Add quota headers to response
            async def send_with_headers(message):
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    headers.extend([
                        (b"X-API-Quota-Limit", str(updated["api_calls_limit"]).encode()),
                        (b"X-API-Quota-Remaining", str(updated["api_calls_remaining"]).encode()),
                        (b"X-API-Quota-Reset", updated["reset_at"].encode()),
                    ])
                    message["headers"] = headers
                await send(message)

            await self.app(scope, receive, send_with_headers)
        else:
            await self.app(scope, receive, send)
