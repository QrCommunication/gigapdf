"""
API Key management endpoints.

Allows authenticated users to create, list, update, and revoke their
programmatic API keys.  These endpoints require JWT authentication — the
API keys themselves are used by *external* integrations to call other API
endpoints without a JWT.

Key creation returns the plaintext key exactly once; subsequent requests
only expose the ``key_prefix`` for identification purposes.
"""

import hashlib
import logging
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.models.api_key import ApiKey
from app.schemas.api_keys import (
    ApiKeyResponse,
    CreateApiKeyRequest,
    CreateApiKeyResponse,
    UpdateApiKeyRequest,
)
from app.schemas.responses.common import APIResponse, MetaInfo, SuccessResponse
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SCOPES_SEPARATOR = ","


def _generate_raw_key() -> str:
    """
    Generate a new cryptographically random API key.

    Format: ``giga_pk_<43 URL-safe chars>``

    Returns:
        str: The full plaintext key.
    """
    return f"giga_pk_{secrets.token_urlsafe(32)}"


def _hash_key(raw_key: str) -> str:
    """Return the SHA-256 hex-digest of *raw_key*."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _key_prefix(raw_key: str) -> str:
    """Return the first 16 characters of *raw_key* for display purposes."""
    return raw_key[:16]


def _orm_to_response(api_key: ApiKey) -> ApiKeyResponse:
    """
    Convert an ``ApiKey`` ORM instance to the public ``ApiKeyResponse`` schema.

    The comma-separated ``scopes`` and ``allowed_domains`` strings stored in
    the database are split into lists for the response.

    Args:
        api_key: SQLAlchemy ``ApiKey`` instance.

    Returns:
        ApiKeyResponse: Serialisable response model.
    """
    scopes: List[str] = (
        [s.strip() for s in api_key.scopes.split(_SCOPES_SEPARATOR) if s.strip()]
        if api_key.scopes
        else []
    )
    allowed_domains = (
        [d.strip() for d in api_key.allowed_domains.split(_SCOPES_SEPARATOR) if d.strip()]
        if api_key.allowed_domains
        else None
    )

    return ApiKeyResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        scopes=scopes,
        allowed_domains=allowed_domains,
        rate_limit=api_key.rate_limit,
        is_active=api_key.is_active,
        last_used_at=api_key.last_used_at,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
    )


# ---------------------------------------------------------------------------
# POST /api-keys — Create
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=APIResponse[CreateApiKeyResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Create API key",
    description="""
Create a new programmatic API key for the authenticated user.

The full plaintext key is returned **once** in the ``data.key`` field.
**Store it securely** — it cannot be retrieved again after this response.

## Scopes

| Scope | Access |
|-------|--------|
| `read` | Read-only access to documents and metadata |
| `write` | Create, update, and delete documents |
| `admin` | Full access including billing and tenant management |

## Domain Restrictions

Setting ``allowed_domains`` restricts the key to requests originating from
the listed domains (checked via the ``Origin`` or ``Referer`` header).
Leave null to allow requests from any origin.

## Rate Limiting

The ``rate_limit`` field (requests per minute) is independent of the
plan-level quota. It defaults to 60 req/min.
""",
    responses={
        201: {
            "description": "API key created — plaintext key returned once",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "key": "giga_pk_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
                            "api_key": {
                                "id": "550e8400-e29b-41d4-a716-446655440000",
                                "name": "My mobile app",
                                "key_prefix": "giga_pk_AbCdEfGh",
                                "scopes": ["read", "write"],
                                "allowed_domains": None,
                                "rate_limit": 60,
                                "is_active": True,
                                "last_used_at": None,
                                "expires_at": None,
                                "created_at": "2026-01-01T12:00:00Z",
                            },
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2026-01-01T12:00:00Z",
                        },
                    }
                }
            },
        },
        401: {"description": "Authentication required"},
        422: {"description": "Validation error"},
    },
)
async def create_api_key(
    body: CreateApiKeyRequest,
    current_user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[CreateApiKeyResponse]:
    """
    Create a new API key for the authenticated user.

    Args:
        body: Validated creation payload.
        current_user: The JWT-authenticated caller.
        db: Async database session.

    Returns:
        APIResponse[CreateApiKeyResponse]: The new key metadata plus the
        plaintext key (shown only once).
    """
    raw_key = _generate_raw_key()
    key_hash = _hash_key(raw_key)
    prefix = _key_prefix(raw_key)

    api_key = ApiKey(
        user_id=current_user.user_id,
        name=body.name,
        key_prefix=prefix,
        key_hash=key_hash,
        scopes=body.scopes or "read,write",
        allowed_domains=body.allowed_domains or None,
        rate_limit=body.rate_limit if body.rate_limit is not None else 60,
        is_active=True,
        expires_at=body.expires_at,
    )

    db.add(api_key)
    await db.flush()  # populate server-side defaults (e.g. created_at)
    await db.refresh(api_key)

    logger.info(
        "API key created",
        extra={"key_id": api_key.id, "user_id": current_user.user_id},
    )

    response_data = CreateApiKeyResponse(
        key=raw_key,
        api_key=_orm_to_response(api_key),
    )

    return APIResponse(
        success=True,
        data=response_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
        ),
    )


# ---------------------------------------------------------------------------
# GET /api-keys — List
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=APIResponse[List[ApiKeyResponse]],
    status_code=status.HTTP_200_OK,
    summary="List API keys",
    description="""
Return all API keys belonging to the authenticated user.

The secret key hash is **never** included in responses.  Each entry exposes
the ``key_prefix`` (first 16 characters) so users can identify which key is
which.
""",
    responses={
        200: {"description": "List of API keys (without secrets)"},
        401: {"description": "Authentication required"},
    },
)
async def list_api_keys(
    current_user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[List[ApiKeyResponse]]:
    """
    List all API keys for the authenticated user.

    Args:
        current_user: The JWT-authenticated caller.
        db: Async database session.

    Returns:
        APIResponse[List[ApiKeyResponse]]: Ordered list of API key metadata.
    """
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == current_user.user_id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()

    return APIResponse(
        success=True,
        data=[_orm_to_response(k) for k in keys],
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
        ),
    )


# ---------------------------------------------------------------------------
# DELETE /api-keys/{key_id} — Revoke
# ---------------------------------------------------------------------------


@router.delete(
    "/{key_id}",
    response_model=APIResponse[dict],
    status_code=status.HTTP_200_OK,
    summary="Revoke API key",
    description="""
Permanently delete an API key.

Once deleted the key can no longer be used to authenticate requests.
This action is irreversible — there is no way to recover the key.
""",
    responses={
        200: {"description": "API key deleted"},
        401: {"description": "Authentication required"},
        404: {"description": "API key not found"},
    },
)
async def delete_api_key(
    key_id: str,
    current_user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """
    Permanently revoke and delete an API key.

    Args:
        key_id: UUID of the API key to delete.
        current_user: The JWT-authenticated caller.
        db: Async database session.

    Returns:
        APIResponse[dict]: Confirmation with the deleted key's id.

    Raises:
        HTTPException: 404 if the key does not exist or belongs to another user.
    """
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == current_user.user_id,
        )
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "API_KEY_NOT_FOUND",
                "message": f"API key not found: {key_id}",
            },
        )

    await db.delete(api_key)

    logger.info(
        "API key deleted",
        extra={"key_id": key_id, "user_id": current_user.user_id},
    )

    return APIResponse(
        success=True,
        data={"deleted_key_id": key_id},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
        ),
    )


# ---------------------------------------------------------------------------
# PATCH /api-keys/{key_id} — Update
# ---------------------------------------------------------------------------


@router.patch(
    "/{key_id}",
    response_model=APIResponse[ApiKeyResponse],
    status_code=status.HTTP_200_OK,
    summary="Update API key",
    description="""
Partially update an API key's metadata.

Only the fields provided in the request body are updated; omitted fields
remain unchanged.  All fields are optional.

You can deactivate a key without deleting it by setting ``is_active`` to
``false``.
""",
    responses={
        200: {"description": "Updated API key metadata"},
        401: {"description": "Authentication required"},
        404: {"description": "API key not found"},
        422: {"description": "Validation error"},
    },
)
async def update_api_key(
    key_id: str,
    body: UpdateApiKeyRequest,
    current_user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[ApiKeyResponse]:
    """
    Partially update an API key.

    Args:
        key_id: UUID of the API key to update.
        body: Partial update payload (all fields optional).
        current_user: The JWT-authenticated caller.
        db: Async database session.

    Returns:
        APIResponse[ApiKeyResponse]: The updated API key metadata.

    Raises:
        HTTPException: 404 if the key does not exist or belongs to another user.
    """
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == current_user.user_id,
        )
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "API_KEY_NOT_FOUND",
                "message": f"API key not found: {key_id}",
            },
        )

    # Apply only the fields that were explicitly provided
    if body.name is not None:
        api_key.name = body.name

    if body.scopes is not None:
        api_key.scopes = body.scopes

    if body.allowed_domains is not None:
        # Empty string → remove restriction (set to None)
        api_key.allowed_domains = body.allowed_domains.strip() or None

    if body.rate_limit is not None:
        api_key.rate_limit = body.rate_limit

    if body.is_active is not None:
        api_key.is_active = body.is_active

    await db.flush()
    await db.refresh(api_key)

    logger.info(
        "API key updated",
        extra={"key_id": key_id, "user_id": current_user.user_id},
    )

    return APIResponse(
        success=True,
        data=_orm_to_response(api_key),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
        ),
    )
