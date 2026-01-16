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


def is_jwt_token(token: str) -> bool:
    """Check if a token looks like a JWT (3 base64 parts separated by dots)."""
    parts = token.split(".")
    return len(parts) == 3 and all(len(p) > 10 for p in parts)


# Cache for JWKS to avoid fetching on every request
_jwks_cache: dict = {}
_jwks_cache_time: float = 0


async def get_jwks_keys(jwks_url: str) -> dict:
    """
    Fetch and cache JWKS keys from URL.

    Args:
        jwks_url: URL to fetch JWKS from.

    Returns:
        dict: JWKS data with keys.
    """
    import time

    global _jwks_cache, _jwks_cache_time

    # Cache for 5 minutes
    if _jwks_cache and (time.time() - _jwks_cache_time) < 300:
        return _jwks_cache

    # In development, disable SSL verification for self-signed certificates
    settings = get_settings()
    verify_ssl = not settings.is_development

    async with httpx.AsyncClient(verify=verify_ssl) as client:
        response = await client.get(jwks_url, timeout=10.0)
        response.raise_for_status()
        _jwks_cache = response.json()
        _jwks_cache_time = time.time()
        return _jwks_cache


async def decode_jwt_token(token: str) -> dict:
    """
    Decode and validate a JWT token using JWKS.

    Args:
        token: The JWT token to decode.

    Returns:
        dict: Decoded token claims.

    Raises:
        AuthInvalidError: If token is invalid or expired.
    """
    from jose import jwk
    from jose.constants import ALGORITHMS

    settings = get_settings()

    try:
        public_key_config = settings.auth_jwt_public_key

        # Check if public key is a JWKS URL
        if public_key_config.startswith("http"):
            # Fetch JWKS and find the right key
            jwks_data = await get_jwks_keys(public_key_config)
            keys = jwks_data.get("keys", [])

            if not keys:
                raise AuthInvalidError("No keys found in JWKS")

            # Get the key ID from token header to match the right key
            unverified_header = jwt.get_unverified_header(token)
            token_kid = unverified_header.get("kid")

            # Find matching key or use first key
            key_data = None
            for key in keys:
                if token_kid and key.get("kid") == token_kid:
                    key_data = key
                    break
            if not key_data:
                key_data = keys[0]

            # Convert JWK to PEM format for jose
            rsa_key = jwk.construct(key_data, algorithm=ALGORITHMS.RS256)
            public_key = rsa_key.to_pem().decode("utf-8")
        else:
            public_key = public_key_config

        # Build verification options
        verify_options = {
            "verify_aud": bool(settings.auth_jwt_audience),
            "verify_iss": bool(settings.auth_jwt_issuer),
        }

        # Decode token - Better Auth JWT uses 'sub' for user ID
        claims = jwt.decode(
            token,
            public_key,
            algorithms=[settings.auth_jwt_algorithm],
            audience=settings.auth_jwt_audience if settings.auth_jwt_audience else None,
            issuer=settings.auth_jwt_issuer if settings.auth_jwt_issuer else None,
            options=verify_options,
        )

        logger.debug(f"JWT decoded successfully, claims: {claims}")
        return claims

    except JWTError as e:
        logger.warning(f"JWT validation failed: {e}")
        raise AuthInvalidError(f"Token validation failed: {str(e)}")
    except Exception as e:
        logger.warning(f"JWT decoding error: {e}")
        raise AuthInvalidError(f"Token decoding failed: {str(e)}")


async def validate_session_with_better_auth(token: str, session_url: str) -> dict:
    """
    Validate a session token by calling Better Auth's session endpoint.

    Args:
        token: The session token to validate.
        session_url: The Better Auth session validation URL.

    Returns:
        dict: Session data including user info.

    Raises:
        AuthInvalidError: If session is invalid.
    """
    try:
        # In development, disable SSL verification for self-signed certificates
        settings = get_settings()
        verify_ssl = not settings.is_development

        async with httpx.AsyncClient(verify=verify_ssl) as client:
            # Better Auth expects the session token in a cookie or Authorization header
            response = await client.get(
                session_url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )

            if response.status_code != 200:
                logger.warning(f"Better Auth session validation failed: {response.status_code}")
                raise AuthInvalidError("Session validation failed")

            data = response.json()
            if not data or not data.get("user"):
                raise AuthInvalidError("Invalid session")

            return data

    except httpx.RequestError as e:
        logger.error(f"Better Auth request failed: {e}")
        raise AuthInvalidError("Session validation service unavailable")


async def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> CurrentUser:
    """
    Dependency to get the current authenticated user.

    Supports both JWT tokens (from mobile app) and session tokens (from web).

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

    # Dev mode: Decode JWT without validation to extract user ID
    if settings.is_development and settings.auth_jwt_public_key == "dev-mode-no-jwt-required":
        # Try to decode JWT without verification to get claims
        if is_jwt_token(token):
            try:
                # Decode without verification (dev mode only!)
                unverified_claims = jwt.get_unverified_claims(token)
                user_id = unverified_claims.get("sub", unverified_claims.get("user_id", ""))
                if user_id:
                    logger.debug(f"Dev mode: Extracted user ID from JWT: {user_id}")
                    return CurrentUser(
                        user_id=user_id,
                        email=unverified_claims.get("email"),
                        name=unverified_claims.get("name"),
                        roles=["user"],
                    )
            except Exception as e:
                logger.warning(f"Dev mode: Failed to decode JWT, using token as user ID: {e}")

        # Fallback: use token directly (for simple tokens)
        logger.debug(f"Dev mode: Using token as user ID: {token[:50]}...")
        return CurrentUser(
            user_id=token[:255],  # Truncate to prevent DB errors
            email=None,
            name=None,
            roles=["user"],
        )

    # Check if JWT is configured
    jwt_configured = (
        settings.auth_jwt_public_key
        and settings.auth_jwt_public_key != "CONFIGURE_YOUR_JWT_PUBLIC_KEY"
    )

    # If token looks like a JWT and JWKS is configured, try JWT validation first
    if jwt_configured and is_jwt_token(token):
        try:
            logger.debug("Token looks like JWT, validating with JWKS...")
            claims = await decode_jwt_token(token)
            logger.info(f"JWT validated successfully for user: {claims.get('sub')}")
            return CurrentUser.from_claims(claims)
        except AuthInvalidError as e:
            logger.warning(f"JWT validation failed, will try session: {e}")
            # Fall through to session validation

    # Session validation with Better Auth
    if settings.auth_session_url:
        logger.debug("Trying Better Auth session validation...")
        try:
            session_data = await validate_session_with_better_auth(token, settings.auth_session_url)
            user = session_data.get("user", {})
            if user.get("id"):
                logger.info(f"Session validated for user: {user.get('id')}")
                return CurrentUser(
                    user_id=user.get("id", ""),
                    email=user.get("email"),
                    name=user.get("name"),
                    roles=["user"],
                )
        except AuthInvalidError:
            pass  # Fall through to error

    # If we get here, authentication failed
    raise AuthInvalidError("Could not validate token")


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
