"""
JWT Authentication middleware for external auth validation.

This module handles JWT token validation for requests authenticated
by an external service (Node.js BetterAuth or Laravel).
"""

import logging
from dataclasses import dataclass
from typing import Annotated, Optional

import httpx
from fastapi import Depends, Header, Request
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.config import get_settings
from app.middleware.error_handler import AuthInvalidError, AuthRequiredError

logger = logging.getLogger(__name__)


@dataclass
class CurrentUser:
    """Represents the authenticated user from JWT claims."""

    user_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    roles: list[str] | None = None

    @classmethod
    def from_claims(cls, claims: dict) -> "CurrentUser":
        """
        Create CurrentUser from JWT claims.

        Args:
            claims: Decoded JWT claims.

        Returns:
            CurrentUser: User instance from claims.
        """
        return cls(
            user_id=claims.get("sub", claims.get("user_id", "")),
            email=claims.get("email"),
            name=claims.get("name"),
            roles=claims.get("roles", []),
        )


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware for validating JWT tokens on protected routes.

    Tokens are validated against a public key or JWKS endpoint.
    """

    # Routes that don't require authentication
    PUBLIC_ROUTES = {
        "/health",
        "/api/docs",
        "/api/redoc",
        "/api/v1/openapi.json",
    }

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """
        Process the request and validate JWT if required.

        Args:
            request: The incoming request.
            call_next: The next middleware/endpoint to call.

        Returns:
            Response: The response from the endpoint.
        """
        # Skip auth for public routes
        path = request.url.path
        if any(path.startswith(route) for route in self.PUBLIC_ROUTES):
            return await call_next(request)

        # Skip OPTIONS requests (CORS preflight)
        if request.method == "OPTIONS":
            return await call_next(request)

        return await call_next(request)


async def decode_jwt_token(token: str) -> dict:
    """
    Decode and validate a JWT token.

    Args:
        token: The JWT token to decode.

    Returns:
        dict: Decoded token claims.

    Raises:
        AuthInvalidError: If token is invalid or expired.
    """
    settings = get_settings()

    try:
        # Check if public key is a JWKS URL
        public_key = settings.auth_jwt_public_key
        if public_key.startswith("http"):
            # Fetch JWKS from URL
            async with httpx.AsyncClient() as client:
                response = await client.get(public_key)
                jwks = response.json()
                # Extract the key (simplified - in production, match kid)
                public_key = jwks.get("keys", [{}])[0]

        # Decode token
        claims = jwt.decode(
            token,
            public_key,
            algorithms=[settings.auth_jwt_algorithm],
            audience=settings.auth_jwt_audience,
            issuer=settings.auth_jwt_issuer if settings.auth_jwt_issuer else None,
            options={
                "verify_aud": bool(settings.auth_jwt_audience),
                "verify_iss": bool(settings.auth_jwt_issuer),
            },
        )

        return claims

    except JWTError as e:
        logger.warning(f"JWT validation failed: {e}")
        raise AuthInvalidError(f"Token validation failed: {str(e)}")


async def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> CurrentUser:
    """
    Dependency to get the current authenticated user.

    Args:
        authorization: Authorization header value.

    Returns:
        CurrentUser: The authenticated user.

    Raises:
        AuthRequiredError: If no token is provided.
        AuthInvalidError: If token is invalid.
    """
    settings = get_settings()

    if not authorization:
        raise AuthRequiredError("Authorization header required")

    # Extract Bearer token
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthInvalidError("Invalid authorization header format")

    token = parts[1]

    # Dev mode: Accept user ID directly as token (skip JWT validation)
    if settings.is_development and settings.auth_jwt_public_key == "dev-mode-no-jwt-required":
        logger.debug(f"Dev mode: Using token as user ID: {token}")
        return CurrentUser(
            user_id=token,
            email=None,
            name=None,
            roles=["user"],
        )

    # Production: Validate JWT token
    claims = await decode_jwt_token(token)

    return CurrentUser.from_claims(claims)


async def get_optional_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> Optional[CurrentUser]:
    """
    Dependency to optionally get the current user.

    Returns None if no token is provided, raises error if token is invalid.

    Args:
        authorization: Authorization header value.

    Returns:
        Optional[CurrentUser]: The user if authenticated, None otherwise.
    """
    if not authorization:
        return None

    return await get_current_user(authorization)


# Type alias for dependency injection
AuthenticatedUser = Annotated[CurrentUser, Depends(get_current_user)]
OptionalUser = Annotated[Optional[CurrentUser], Depends(get_optional_user)]
