"""
Embed session endpoints.

Handles the lifecycle of embedded editor sessions:
- Create a session by uploading a PDF file (via publishable key)
- Complete a session and retrieve the modified PDF
- Delete/cleanup a session
- Issue ephemeral JWT session tokens (replaces ?apiKey= in embed URLs)
- Validate ephemeral JWT session tokens
"""

import logging
import time
import uuid
from typing import Any

import jwt as pyjwt
from fastapi import APIRouter, Body, File, Request, UploadFile, status
from fastapi.responses import Response
from jwt.exceptions import InvalidTokenError as JWTError

from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# JWT helpers for ephemeral embed session tokens
# ---------------------------------------------------------------------------

_EMBED_JWT_ALGORITHM = "HS256"
_EMBED_JWT_ISSUER = "gigapdf-embed"


def _get_embed_jwt_secret() -> str:
    """
    Return the HMAC secret for embed session tokens.

    In development, falls back to a deterministic insecure secret and logs a
    warning.  In production, raises if the secret is not configured.
    """
    from app.config import get_settings

    settings = get_settings()
    secret = settings.embed_jwt_secret

    if not secret:
        if settings.is_production:
            raise RuntimeError(
                "EMBED_JWT_SECRET is not set. "
                "Generate a random 32+ character secret and set it in your environment."
            )
        # Development fallback — NOT safe for production
        logger.warning(
            "EMBED_JWT_SECRET is not set. Using insecure development fallback. "
            "Set EMBED_JWT_SECRET in .env before deploying to production."
        )
        return "dev-insecure-embed-secret-change-me-in-production"

    return secret


def _create_embed_token(
    *,
    pub_key_id: str,
    user_id: str,
    origin: str | None,
    allowed_domains: str | None,
    ttl_seconds: int,
) -> str:
    """
    Sign and return an ephemeral embed session JWT.

    Claims:
        sub       — publishable key ID (not the raw key)
        uid       — owner user ID
        origin    — caller origin at issuance time (informational)
        scope     — always "embed" (read/write)
        iss       — gigapdf-embed
        iat       — issued-at (Unix timestamp)
        exp       — expiry (Unix timestamp)
        aud       — allowed domains list (comma-separated, mirrors ApiKey.allowed_domains)
    """
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": pub_key_id,
        "uid": user_id,
        "origin": origin or "",
        "scope": "embed",
        "iss": _EMBED_JWT_ISSUER,
        "iat": now,
        "exp": now + ttl_seconds,
        # Store allowed domains in the token so validate-token can enforce
        # origin restrictions without a DB round-trip.
        "aud": allowed_domains or "",
    }
    return pyjwt.encode(payload, _get_embed_jwt_secret(), algorithm=_EMBED_JWT_ALGORITHM)


def _decode_embed_token(token: str) -> dict[str, Any]:
    """
    Verify and decode an embed session JWT.

    Raises:
        JWTError: When the token is invalid, expired, or tampered with.
    """
    return pyjwt.decode(
        token,
        _get_embed_jwt_secret(),
        algorithms=[_EMBED_JWT_ALGORITHM],
        # Bypass audience check here — we validate `aud` (allowed_domains) manually
        # below so that missing / empty audience doesn't cause a hard reject.
        options={"verify_aud": False},
    )


def _get_api_key_user_id(request: Request) -> str:
    """Extract the user_id injected by ApiKeyAuthMiddleware."""
    user_id = getattr(request.state, "api_key_user_id", None)
    if not user_id:
        from app.middleware.error_handler import AuthRequiredError

        raise AuthRequiredError("API key authentication required")
    return user_id


# ---------------------------------------------------------------------------
# POST /embed/session-token — Issue ephemeral JWT for embed URL
# ---------------------------------------------------------------------------


@router.post(
    "/session-token",
    response_model=APIResponse[dict],
    status_code=status.HTTP_200_OK,
    summary="Issue ephemeral embed session token",
    description="""
Issue a short-lived JWT that the embed SDK can use in the iframe URL as
`?token=<jwt>` instead of exposing the raw publishable key in the URL.

**Authentication**: Pass your publishable key (`giga_pub_*`) in the
`X-API-Key` header. This endpoint is callable from your server or directly
from the SDK (the key is sent as a header, never in the URL).

**Token lifetime**: Configurable via `EMBED_JWT_TOKEN_TTL_SECONDS`
(default: 1 800 s / 30 min).

**Security properties**:
- The raw publishable key **never appears in the iframe URL**, browser
  history, or server logs.
- The JWT is signed with `EMBED_JWT_SECRET` (different from `APP_SECRET_KEY`).
- Origin restrictions encoded in the token — `validate-token` enforces them
  without a DB round-trip.
""",
    responses={
        200: {"description": "Session token issued"},
        401: {"description": "API key required or invalid"},
    },
)
async def create_embed_session_token(
    request: Request,
) -> APIResponse[dict]:
    """
    Issue an ephemeral JWT from a publishable API key.

    The SDK calls this endpoint once on mount, then uses the returned token
    in the iframe URL.  The token expires after `embed_jwt_token_ttl_seconds`
    (default: 30 min) and is automatically refreshed by the SDK when needed.
    """
    start_time = time.time()

    user_id = _get_api_key_user_id(request)

    # Retrieve the key record so we can embed allowed_domains in the JWT.
    # `request.state.api_key_id` is injected by ApiKeyAuthMiddleware.
    from app.models.api_key import ApiKey
    from app.core.database import get_db_session
    from sqlalchemy import select

    api_key_id: str = getattr(request.state, "api_key_id", "")
    allowed_domains: str | None = None

    if api_key_id:
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    select(ApiKey.allowed_domains, ApiKey.id).where(ApiKey.id == api_key_id)
                )
                row = result.one_or_none()
                if row:
                    allowed_domains = row.allowed_domains
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to fetch allowed_domains for embed token",
                extra={"api_key_id": api_key_id, "error": str(exc)},
            )

    from app.config import get_settings

    settings = get_settings()
    ttl = settings.embed_jwt_token_ttl_seconds
    origin = request.headers.get("Origin") or request.headers.get("Referer") or ""

    token = _create_embed_token(
        pub_key_id=api_key_id,
        user_id=user_id,
        origin=origin,
        allowed_domains=allowed_domains,
        ttl_seconds=ttl,
    )

    processing_time = int((time.time() - start_time) * 1000)

    logger.info(
        "Embed session token issued",
        extra={
            "api_key_id": api_key_id,
            "user_id": user_id,
            "ttl_seconds": ttl,
        },
    )

    return APIResponse(
        success=True,
        data={
            "session_token": token,
            "expires_in": ttl,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


# ---------------------------------------------------------------------------
# POST /embed/validate-token — Validate ephemeral JWT (called by embed page)
# ---------------------------------------------------------------------------


@router.post(
    "/validate-token",
    response_model=APIResponse[dict],
    status_code=status.HTTP_200_OK,
    summary="Validate ephemeral embed session token",
    description="""
Validate a JWT previously issued by `/embed/session-token`.

Called by the embed page on mount to confirm the token is still valid and
to extract the embedded permissions (scope, allowed origins).

**No authentication required** — the token is self-verifying (HMAC signed).
The caller's `Origin` header is checked against the `aud` (allowed_domains)
claim embedded in the token.

Returns `{ valid: true, uid: "...", scope: "embed", expires_in: <seconds> }`
on success, or `{ valid: false, reason: "..." }` on failure.
""",
    responses={
        200: {"description": "Validation result (check `valid` field)"},
    },
)
async def validate_embed_token(
    request: Request,
    token: str = Body(..., embed=True, description="The JWT session token to validate"),
) -> APIResponse[dict]:
    """
    Validate an ephemeral embed JWT without requiring an API key.

    The embed page calls this on mount and whenever the token is about to expire.
    Origin enforcement is done here using the `aud` claim in the token.
    """
    start_time = time.time()

    def _fail(reason: str) -> APIResponse[dict]:
        return APIResponse(
            success=True,
            data={"valid": False, "reason": reason},
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=int((time.time() - start_time) * 1000),
            ),
        )

    if not token:
        return _fail("missing_token")

    try:
        payload = _decode_embed_token(token)
    except JWTError as exc:
        logger.info(
            "Invalid or expired embed token",
            extra={"error": str(exc)},
        )
        return _fail("invalid_or_expired")

    # Enforce origin restriction encoded in the token's `aud` claim
    allowed_domains: str = payload.get("aud", "") or ""
    if allowed_domains:
        from app.middleware.api_key_auth import _extract_origin, _is_domain_allowed

        caller_origin = _extract_origin(request)
        if not _is_domain_allowed(caller_origin, allowed_domains):
            logger.warning(
                "Embed token used from disallowed origin",
                extra={
                    "caller_origin": caller_origin,
                    "allowed_domains": allowed_domains,
                    "pub_key_id": payload.get("sub"),
                },
            )
            return _fail("origin_not_allowed")

    # Compute remaining TTL
    now = int(time.time())
    exp: int = payload.get("exp", 0)
    expires_in = max(0, exp - now)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "valid": True,
            "uid": payload.get("uid"),
            "scope": payload.get("scope", "embed"),
            "expires_in": expires_in,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


# ---------------------------------------------------------------------------
# POST /embed/sessions — Create embed session
# ---------------------------------------------------------------------------


@router.post(
    "/sessions",
    response_model=APIResponse[dict],
    status_code=status.HTTP_201_CREATED,
    summary="Create embed session",
    description="""
Create a new embed editing session by uploading a PDF file.

Requires a publishable API key (`giga_pub_*`) in the `X-API-Key` header.
The PDF is uploaded and parsed, returning a session ID and document ID
that can be used to load the document in the embed editor.
""",
    responses={
        201: {"description": "Session created — document ready for editing"},
        400: {"description": "Invalid PDF file"},
        401: {"description": "API key required"},
        413: {"description": "File too large"},
    },
)
async def create_embed_session(
    request: Request,
    file: UploadFile = File(..., description="PDF file to edit"),
) -> APIResponse[dict]:
    """Create a new embed session by uploading a PDF file."""
    start_time = time.time()

    user_id = _get_api_key_user_id(request)

    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        from app.middleware.error_handler import InvalidOperationError

        raise InvalidOperationError("Only PDF files are supported")

    # Read file content
    content = await file.read()
    if len(content) > 100 * 1024 * 1024:  # 100 MB limit
        from app.middleware.error_handler import InvalidOperationError

        raise InvalidOperationError("File size exceeds maximum allowed size of 100MB")

    # Upload via the document service
    from app.services.document_service import document_service

    result = await document_service.upload_document(
        content=content,
        filename=file.filename or "document.pdf",
        user_id=user_id,
    )

    session_id = str(uuid.uuid4())
    document_id = result.get("document_id", "")

    # Store session mapping (session_id → document_id) in Redis via document repo
    from app.repositories.document_repo import document_sessions

    await document_sessions.set_embed_session(session_id, document_id, user_id)

    processing_time = int((time.time() - start_time) * 1000)

    logger.info(
        "Embed session created",
        extra={
            "session_id": session_id,
            "document_id": document_id,
            "user_id": user_id,
            "file_size": len(content),
        },
    )

    return APIResponse(
        success=True,
        data={
            "session_id": session_id,
            "document_id": document_id,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


# ---------------------------------------------------------------------------
# POST /embed/sessions/{session_id}/complete — Get modified PDF
# ---------------------------------------------------------------------------


@router.post(
    "/sessions/{session_id}/complete",
    summary="Complete embed session and download modified PDF",
    description="""
Complete an embed editing session and retrieve the final modified PDF.

Returns the PDF binary with all modifications applied.
""",
    responses={
        200: {
            "description": "Modified PDF binary",
            "content": {"application/pdf": {}},
        },
        404: {"description": "Session not found"},
    },
)
async def complete_embed_session(
    session_id: str,
    request: Request,
) -> Response:
    """Complete session and return the modified PDF."""
    start_time = time.time()

    user_id = _get_api_key_user_id(request)

    from app.repositories.document_repo import document_sessions

    session_info = await document_sessions.get_embed_session(session_id)
    if not session_info or session_info.get("user_id") != user_id:
        from app.middleware.error_handler import DocumentNotFoundError

        raise DocumentNotFoundError(session_id)

    document_id = session_info["document_id"]

    # Get the document session from local cache or Redis
    doc_session = await document_sessions.get_session(document_id)
    if not doc_session:
        from app.middleware.error_handler import DocumentNotFoundError

        raise DocumentNotFoundError(document_id)

    # Export the current state of the PDF
    pdf_bytes = doc_session.pdf_doc.tobytes()

    processing_time = int((time.time() - start_time) * 1000)

    logger.info(
        "Embed session completed",
        extra={
            "session_id": session_id,
            "document_id": document_id,
            "pdf_size": len(pdf_bytes),
            "processing_time_ms": processing_time,
        },
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="modified.pdf"',
            "X-Processing-Time-Ms": str(processing_time),
        },
    )


# ---------------------------------------------------------------------------
# DELETE /embed/sessions/{session_id} — Cleanup session
# ---------------------------------------------------------------------------


@router.delete(
    "/sessions/{session_id}",
    response_model=APIResponse[dict],
    status_code=status.HTTP_200_OK,
    summary="Delete embed session",
    description="Clean up an embed editing session and free resources.",
    responses={
        200: {"description": "Session deleted"},
        404: {"description": "Session not found"},
    },
)
async def delete_embed_session(
    session_id: str,
    request: Request,
) -> APIResponse[dict]:
    """Delete an embed session and clean up resources."""
    user_id = _get_api_key_user_id(request)

    from app.repositories.document_repo import document_sessions

    session_info = await document_sessions.get_embed_session(session_id)
    if not session_info or session_info.get("user_id") != user_id:
        from app.middleware.error_handler import DocumentNotFoundError

        raise DocumentNotFoundError(session_id)

    document_id = session_info["document_id"]

    # Clean up the document session from local cache and Redis
    await document_sessions.remove_session(document_id)
    await document_sessions.remove_embed_session(session_id)

    logger.info(
        "Embed session deleted",
        extra={"session_id": session_id, "document_id": document_id},
    )

    return APIResponse(
        success=True,
        data={"deleted_session_id": session_id},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
        ),
    )
