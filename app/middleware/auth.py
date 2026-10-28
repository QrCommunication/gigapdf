"""
JWT Authentication middleware for external auth validation.

This module handles JWT token validation for requests authenticated
by an external service (Node.js BetterAuth or Laravel).
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Annotated, Literal

import httpx
import jwt as pyjwt
from fastapi import Depends, Header, Request
from jwt.exceptions import InvalidTokenError as JWTError
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.config import get_settings
from app.core.cache import get_redis
from app.core.database import get_db_session
from app.middleware.error_handler import AuthInvalidError, AuthRequiredError

logger = logging.getLogger(__name__)


AuthMethod = Literal["session", "api_key"]


@dataclass
class CurrentUser:
    """
    Represents the authenticated caller.

    ``auth_method`` tells how the identity was established: ``"session"`` for a
    Bearer token (JWT or Better Auth session), ``"api_key"`` for a secret
    ``X-API-Key``. ``api_key_id`` is the ``ApiKey`` primary key in the latter
    case, ``None`` otherwise.
    """

    user_id: str
    email: str | None = None
    name: str | None = None
    roles: list[str] | None = None
    auth_method: AuthMethod = "session"
    api_key_id: str | None = None

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

    Decodes the Bearer token from the Authorization header and populates
    ``request.state.user_id`` so downstream middleware (e.g. quota tracking)
    can identify the caller without waiting for route-level dependencies.

    This is best-effort: if decoding fails the request still proceeds and the
    route-level ``get_current_user`` dependency will reject it with a proper
    error. We never block here to avoid double-error responses.
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
        Decode the JWT (best-effort) and inject ``request.state.user_id``.

        On success: ``request.state.user_id`` and ``request.state.current_user``
        are populated so middleware executed earlier in the chain (lower
        ``add_middleware`` position = runs later in Starlette's LIFO order) can
        read them.

        On failure: the state attributes are left unset; route handlers will
        produce the appropriate 401 response via ``get_current_user``.

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

        # Best-effort JWT decode — never block the request here
        authorization = request.headers.get("Authorization")
        if authorization:
            parts = authorization.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                try:
                    user = await authenticate_bearer(authorization)
                    request.state.user_id = user.user_id
                    request.state.current_user = user
                    logger.debug(
                        "JWT middleware: user_id set",
                        extra={"user_id": user.user_id, "path": path},
                    )
                    # Attach user context to the active Sentry scope.
                    # send_default_pii=False is set globally; we only forward
                    # the opaque user_id — never email or name.
                    try:
                        import sentry_sdk

                        sentry_sdk.set_user({"id": user.user_id})
                    except ImportError:
                        pass
                except Exception as exc:
                    # Auth failure is handled at the route level; log for
                    # observability but do not block the request.
                    logger.debug(
                        "JWT middleware: could not decode token (will be enforced at route level)",
                        extra={"path": path, "reason": str(exc)},
                    )
        else:
            logger.debug(
                "JWT middleware: no Authorization header on protected path",
                extra={"path": path},
            )

        return await call_next(request)


def is_jwt_token(token: str) -> bool:
    """Check if a token looks like a JWT (3 base64 parts separated by dots)."""
    parts = token.split(".")
    return len(parts) == 3 and all(len(p) > 10 for p in parts)


# L1 Cache: In-memory, shared across request handlers in the same worker
# Stores JWKS data briefly (5 min TTL) to reduce Redis hits
_jwks_l1_cache: dict[str, dict] = {}  # issuer_url -> {"data": dict, "expires_at": float}


@dataclass
class CacheEntry:
    """Represents a cached JWKS entry with TTL."""

    data: dict
    expires_at: float

    def is_expired(self) -> bool:
        """Check if cache entry has expired."""
        return time.time() >= self.expires_at


async def get_jwks_keys(jwks_url: str) -> dict:
    """
    Fetch and cache JWKS keys from URL using L1 (local) + L2 (Redis) cache.

    Implements:
    - L1 cache: In-memory, 5 min TTL, per-worker
    - L2 cache: Redis, 1h TTL, shared across all workers
    - Thundering herd protection: SETNX lock to ensure only one worker refreshes

    Args:
        jwks_url: URL to fetch JWKS from.

    Returns:
        dict: JWKS data with keys.

    Raises:
        AuthInvalidError: If JWKS fetch fails.
    """
    # ── L1 Cache Check ──────────────────────────────────────────────────────
    if jwks_url in _jwks_l1_cache:
        entry = _jwks_l1_cache[jwks_url]
        if not entry.is_expired():
            logger.debug(f"JWKS cache L1 hit for {jwks_url}")
            return entry.data

    # ── L2 Cache Check (Redis) ─────────────────────────────────────────────
    try:
        redis_client = await get_redis()
        redis_key = f"jwks:{jwks_url}"

        cached = await redis_client.get(redis_key)
        if cached:
            jwks_data = json.loads(cached)
            # Populate L1 cache from L2
            _jwks_l1_cache[jwks_url] = CacheEntry(
                data=jwks_data,
                expires_at=time.time() + 300,  # 5 min L1 TTL
            )
            logger.debug(f"JWKS cache L2 hit for {jwks_url}")
            return jwks_data
    except Exception as e:
        logger.warning(f"L2 JWKS cache check failed: {e}")
        # Continue to fetch from provider

    # ── Cache Miss: Fetch from Provider with Thundering Herd Protection ────
    settings = get_settings()
    verify_ssl = not settings.is_development
    redis_key = f"jwks:{jwks_url}"
    lock_key = f"jwks:lock:{jwks_url}"
    lock_acquired = False
    redis_client = None

    try:
        redis_client = await get_redis()

        # Try to acquire lock using SETNX (atomic test-and-set)
        lock_acquired = await redis_client.set(
            lock_key,
            "1",
            nx=True,  # Only set if key doesn't exist
            ex=10,    # Auto-expire lock after 10s to prevent deadlock
        )

        if lock_acquired:
            # We acquired the lock — fetch from provider
            logger.debug(f"Fetching JWKS from {jwks_url}")
            async with httpx.AsyncClient(verify=verify_ssl) as client:
                response = await client.get(jwks_url, timeout=10.0)
                response.raise_for_status()
                jwks_data = response.json()

            # Store in L2 cache (Redis, 1h TTL)
            try:
                await redis_client.setex(
                    redis_key,
                    3600,  # 1 hour TTL
                    json.dumps(jwks_data),
                )
                logger.debug(f"Stored JWKS in L2 cache: {redis_key}")
            except Exception as e:
                logger.warning(f"Failed to store JWKS in L2 cache: {e}")

            # Populate L1 cache
            _jwks_l1_cache[jwks_url] = CacheEntry(
                data=jwks_data,
                expires_at=time.time() + 300,  # 5 min L1 TTL
            )

            return jwks_data
        else:
            # Another worker is refreshing — wait briefly and retry from L2
            logger.debug(f"Another worker is refreshing JWKS for {jwks_url}, waiting...")
            await asyncio.sleep(0.5)

            # Check L2 cache again
            cached = await redis_client.get(redis_key)
            if cached:
                jwks_data = json.loads(cached)
                _jwks_l1_cache[jwks_url] = CacheEntry(
                    data=jwks_data,
                    expires_at=time.time() + 300,
                )
                logger.debug("JWKS retrieved from L2 after lock wait")
                return jwks_data

            # Fallback: direct fetch (safe, but may duplicate request if lock holder also fails)
            logger.debug(f"Lock timeout, fetching JWKS directly from {jwks_url}")
            async with httpx.AsyncClient(verify=verify_ssl) as client:
                response = await client.get(jwks_url, timeout=10.0)
                response.raise_for_status()
                return response.json()

    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch JWKS from {jwks_url}: {e}")
        raise AuthInvalidError(f"Could not fetch JWKS: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error fetching JWKS: {e}")
        raise AuthInvalidError(f"Unexpected error: {str(e)}")
    finally:
        # Release lock if we acquired it
        if lock_acquired and redis_client:
            try:
                await redis_client.delete(lock_key)
                logger.debug(f"Released JWKS lock: {lock_key}")
            except Exception as e:
                logger.warning(f"Failed to release JWKS lock: {e}")


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
            unverified_header = pyjwt.get_unverified_header(token)
            token_kid = unverified_header.get("kid")

            # Find matching key or use first key
            key_data = None
            for key in keys:
                if token_kid and key.get("kid") == token_kid:
                    key_data = key
                    break
            if not key_data:
                key_data = keys[0]

            # Convert JWK dict to a public key object using PyJWT's RSA helper
            import json as _json

            from jwt.algorithms import RSAAlgorithm

            public_key = RSAAlgorithm.from_jwk(_json.dumps(key_data))
        else:
            public_key = public_key_config

        # Build verification options — skip claims not configured (PyJWT option keys)
        verify_options: dict = {}
        if not settings.auth_jwt_audience:
            verify_options["verify_aud"] = False
        if not settings.auth_jwt_issuer:
            verify_options["verify_iss"] = False

        # Decode token - Better Auth JWT uses 'sub' for user ID
        claims = pyjwt.decode(
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


async def _load_account(user_id: str) -> tuple[str | None, str | None] | None:
    """
    Return ``(email, name)`` of a Better Auth user, or ``None`` if erased.

    Better Auth users live in the same PostgreSQL database, table ``users``
    (Prisma model ``User``). ``None`` means the account no longer exists: an
    API key or a JWT issued before the account was erased must not act as it.
    """
    async with get_db_session() as session:
        result = await session.execute(
            text("SELECT email, name FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        )
        row = result.first()
    if row is None:
        return None
    return row[0], row[1]


async def _authenticate_api_key(request: Request) -> CurrentUser | None:
    """
    Build the caller identity from a secret API key validated upstream.

    ``ApiKeyAuthMiddleware`` validates ``X-API-Key`` (existence, expiry,
    domains, rate limit, scopes) and stores the owner on ``request.state``.
    Publishable keys (``giga_pub_*``) never authenticate a user: they only
    serve the embed routes, which read ``request.state`` themselves.

    Roles are always ``["user"]``: an API key never grants platform-admin
    rights, even when it carries the ``admin`` scope (that scope only covers
    the owner's own API keys and billing).

    Returns:
        CurrentUser | None: The key owner, or ``None`` when no secret key
        was validated for this request.

    Raises:
        AuthInvalidError: If the key's owner account no longer exists.
    """
    user_id = getattr(request.state, "api_key_user_id", None)
    if not user_id or getattr(request.state, "api_key_is_publishable", False):
        return None

    owner = await _load_account(user_id)
    if owner is None:
        logger.warning("API key owner not found", extra={"user_id": user_id})
        raise AuthInvalidError("API key owner account no longer exists")

    email, name = owner
    return CurrentUser(
        user_id=user_id,
        email=email,
        name=name,
        roles=["user"],
        auth_method="api_key",
        api_key_id=getattr(request.state, "api_key_id", None),
    )


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """
    Dependency to get the current authenticated user.

    Precedence:
    1. ``Authorization`` header present → Bearer authentication (JWT from the
       mobile app, Better Auth session token from the web). Unchanged
       behaviour; an invalid header is rejected even if an API key is sent.
    2. Otherwise, a secret ``X-API-Key`` validated by ``ApiKeyAuthMiddleware``
       → the key owner, with ``auth_method="api_key"``.
    3. Neither → ``AuthRequiredError``.

    Args:
        request: The incoming request (carries the API-key state).
        authorization: Authorization header value.

    Returns:
        CurrentUser: The authenticated user.

    Raises:
        AuthRequiredError: If no credential is provided.
        AuthInvalidError: If the credential is invalid.
    """
    if authorization:
        return await _bearer_user(request, authorization)

    api_key_user = await _authenticate_api_key(request)
    if api_key_user is not None:
        return api_key_user

    raise AuthRequiredError("Authorization header required")


async def authenticate_bearer(authorization: str) -> CurrentUser:
    """
    Authenticate an ``Authorization: Bearer <token>`` header value.

    Supports both JWT tokens (from mobile app) and session tokens (from web).

    Args:
        authorization: Authorization header value (non-empty).

    Returns:
        CurrentUser: The authenticated user (``auth_method="session"``).

    Raises:
        AuthInvalidError: If the header or token is invalid.
    """
    settings = get_settings()

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
                unverified_claims = pyjwt.decode(
                    token,
                    options={"verify_signature": False},
                    algorithms=["RS256", "HS256", "RS384", "RS512", "HS384", "HS512"],
                )
                user_id = unverified_claims.get("sub", unverified_claims.get("user_id", ""))
                if user_id:
                    logger.debug(f"Dev mode: Extracted user ID from JWT: {user_id}")
                    # Respect roles/is_admin claim from the unverified JWT in dev mode too.
                    dev_claims_admin = (
                        unverified_claims.get("is_admin") is True
                        or unverified_claims.get("isAdmin") is True
                        or unverified_claims.get("role") == "admin"
                        or "admin" in (unverified_claims.get("roles") or [])
                    )
                    return CurrentUser(
                        user_id=user_id,
                        email=unverified_claims.get("email"),
                        name=unverified_claims.get("name"),
                        roles=["admin"] if dev_claims_admin else ["user"],
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
        except AuthInvalidError as e:
            logger.warning(f"JWT validation failed, will try session: {e}")
            # Fall through to session validation
        else:
            user = CurrentUser.from_claims(claims)
            # A JWT stays cryptographically valid until it expires, even after
            # the account is erased (DELETE /api/v1/account): without this
            # check an erased user could keep writing data for its lifetime.
            if await _load_account(user.user_id) is None:
                logger.warning("JWT of an erased account", extra={"user_id": user.user_id})
                raise AuthInvalidError("Account no longer exists")
            logger.info(f"JWT validated successfully for user: {user.user_id}")
            return user

    # Session validation with Better Auth
    if settings.auth_session_url:
        logger.debug("Trying Better Auth session validation...")
        try:
            session_data = await validate_session_with_better_auth(token, settings.auth_session_url)
            user = session_data.get("user", {})
            if user.get("id"):
                logger.info(f"Session validated for user: {user.get('id')}")
                # Derive role from Better Auth user data.
                # Better Auth exposes `role` (string) and `isAdmin` (camelCase since
                # the additionalFields fix); legacy payloads used `is_admin`.
                is_admin = (
                    user.get("is_admin") is True
                    or user.get("isAdmin") is True
                    or user.get("role") == "admin"
                )
                roles = ["admin"] if is_admin else ["user"]
                return CurrentUser(
                    user_id=user.get("id", ""),
                    email=user.get("email"),
                    name=user.get("name"),
                    roles=roles,
                )
        except AuthInvalidError:
            pass  # Fall through to error

    # If we get here, authentication failed
    raise AuthInvalidError("Could not validate token")


async def get_optional_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser | None:
    """
    Dependency to optionally get the current user.

    Same precedence as ``get_current_user`` (Bearer, then secret API key).
    Returns None if no credential is provided, raises error if one is invalid.

    Args:
        request: The incoming request (carries the API-key state).
        authorization: Authorization header value.

    Returns:
        Optional[CurrentUser]: The user if authenticated, None otherwise.
    """
    if authorization:
        return await _bearer_user(request, authorization)

    return await _authenticate_api_key(request)


async def _bearer_user(request: Request, authorization: str) -> CurrentUser:
    """
    The Bearer identity of this request, reusing the one ``JWTAuthMiddleware``
    already resolved from the same header (one JWKS check and one account
    lookup per request instead of two).
    """
    resolved = getattr(request.state, "current_user", None)
    if isinstance(resolved, CurrentUser):
        return resolved
    return await authenticate_bearer(authorization)


# Type alias for dependency injection
AuthenticatedUser = Annotated[CurrentUser, Depends(get_current_user)]
OptionalUser = Annotated[CurrentUser | None, Depends(get_optional_user)]
