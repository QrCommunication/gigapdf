"""
Font extraction endpoints.

Exposes embedded font metadata and binary data for PDF documents.
Fonts are extracted via pikepdf and cached in Redis with a 24-hour TTL.

Routes:
  GET /api/v1/pdf/fonts/{document_id}           → FontsListResponse
  GET /api/v1/pdf/fonts/{document_id}/{font_id} → FontDataResponse
"""

import json
import logging
import time

from fastapi import APIRouter, HTTPException, status

from app.config import get_settings
from app.core.cache import get_redis
from app.dependencies import DocumentSessionDep
from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.repositories.document_repo import DocumentSession
from app.schemas.fonts import ExtractedFontMetadata, FontDataResponse, FontsListResponse
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.font_extraction_service import (
    ExtractedFont,
    font_extraction_service,
)
from app.utils.helpers import now_utc

router = APIRouter()
logger = logging.getLogger(__name__)

# Redis TTL for font caches: 24 hours
_CACHE_TTL = 86_400


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------


def _list_cache_key(document_id: str) -> str:
    return f"fonts:list:{document_id}"


def _data_cache_key(document_id: str, font_id: str) -> str:
    return f"fonts:data:{document_id}:{font_id}"


async def _get_cached_list(document_id: str) -> list[dict] | None:
    try:
        redis = await get_redis()
        raw = await redis.get(_list_cache_key(document_id))
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning(
            "Font list cache read failed document_id=%s: %s", document_id, exc
        )
    return None


async def _set_cached_list(document_id: str, fonts: list[dict]) -> None:
    try:
        redis = await get_redis()
        await redis.setex(
            _list_cache_key(document_id), _CACHE_TTL, json.dumps(fonts)
        )
    except Exception as exc:
        logger.warning(
            "Font list cache write failed document_id=%s: %s", document_id, exc
        )


async def _get_cached_font_data(document_id: str, font_id: str) -> dict | None:
    try:
        redis = await get_redis()
        raw = await redis.get(_data_cache_key(document_id, font_id))
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning(
            "Font data cache read failed document_id=%s font_id=%s: %s",
            document_id,
            font_id,
            exc,
        )
    return None


async def _set_cached_font_data(
    document_id: str, font_id: str, payload: dict
) -> None:
    try:
        redis = await get_redis()
        await redis.setex(
            _data_cache_key(document_id, font_id), _CACHE_TTL, json.dumps(payload)
        )
    except Exception as exc:
        logger.warning(
            "Font data cache write failed document_id=%s font_id=%s: %s",
            document_id,
            font_id,
            exc,
        )


# ---------------------------------------------------------------------------
# Ownership guard
# ---------------------------------------------------------------------------


def _assert_owner(session: DocumentSession, user: "AuthenticatedUser") -> None:
    """
    Raise 403 Forbidden if the authenticated user is not the document owner.

    Args:
        session: Active document session.
        user: Authenticated user from JWT/session.

    Raises:
        HTTPException: 403 if ownership check fails.
    """
    if session.owner_id and session.owner_id != user.user_id:
        logger.warning(
            "Unauthorized font access: user=%s owner=%s document_id=%s",
            user.user_id,
            session.owner_id,
            session.document_id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this document.",
        )


# ---------------------------------------------------------------------------
# Extraction helper (shared by both endpoints)
# ---------------------------------------------------------------------------


async def _extract_and_cache(
    session: DocumentSession, document_id: str
) -> list[ExtractedFont]:
    """
    Run font extraction and populate both list and data caches.

    Returns the list of ExtractedFont objects (may contain data=None entries).
    """
    pdf_bytes: bytes = session.pdf_doc.tobytes()

    try:
        fonts = font_extraction_service.extract_fonts(pdf_bytes)
    except ValueError as exc:
        logger.error(
            "Font extraction parse error document_id=%s: %s", document_id, exc
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not parse PDF for font extraction: {exc}",
        ) from exc

    logger.info(
        "Extracted %d fonts from document_id=%s", len(fonts), document_id
    )

    # Populate list cache (metadata only)
    list_payload = [f.metadata.model_dump() for f in fonts]
    await _set_cached_list(document_id, list_payload)

    # Populate per-font data cache for embedded fonts only
    for ef in fonts:
        if ef.data is not None and ef.metadata.format:
            data_payload = {
                "font_id": ef.metadata.font_id,
                "data_base64": font_extraction_service.encode_base64(ef.data),
                "format": ef.metadata.format,
                "mime_type": font_extraction_service.get_mime_type(ef.metadata.format),
                "original_name": ef.metadata.original_name,
            }
            await _set_cached_font_data(
                document_id, ef.metadata.font_id, data_payload
            )

    return fonts


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{document_id}",
    response_model=APIResponse[FontsListResponse],
    summary="List embedded fonts",
    description="""
Return the list of fonts found in a PDF document.

Each entry contains metadata only (no binary data). Use the
`GET /api/v1/pdf/fonts/{document_id}/{font_id}` endpoint to retrieve
the actual font binary for a specific embedded font.

Results are cached in Redis for 24 hours per document.
""",
    responses={
        200: {"description": "Font list returned successfully."},
        401: {"description": "Authentication required."},
        403: {"description": "Document belongs to another user."},
        404: {"description": "Document not found."},
        422: {"description": "PDF could not be parsed for font extraction."},
        503: {"description": "Font extraction feature is disabled."},
    },
)
async def list_fonts(
    document_id: str,
    user: AuthenticatedUser,
    session: DocumentSessionDep,
) -> APIResponse[FontsListResponse]:
    """List all fonts found in the document (metadata only, no binary data)."""
    settings = get_settings()
    if not settings.font_extraction_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Font extraction is currently disabled.",
        )

    start = time.time()

    _assert_owner(session, user)

    logger.info(
        "Listing fonts: user=%s document_id=%s", user.user_id, document_id
    )

    # Try cache first
    cached = await _get_cached_list(document_id)
    if cached is not None:
        logger.debug("Font list cache hit document_id=%s", document_id)
        metadata_list = [ExtractedFontMetadata(**f) for f in cached]
    else:
        fonts = await _extract_and_cache(session, document_id)
        metadata_list = [ef.metadata for ef in fonts]

    response_data = FontsListResponse(
        document_id=document_id,
        fonts=metadata_list,
        total=len(metadata_list),
    )

    return APIResponse(
        success=True,
        data=response_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=int((time.time() - start) * 1000),
        ),
    )


@router.get(
    "/{document_id}/{font_id}",
    response_model=APIResponse[FontDataResponse],
    summary="Get embedded font binary",
    description="""
Return the binary data of a specific embedded font, base64-encoded.

The `font_id` is the stable 16-character identifier returned by the list
endpoint. Only fonts with `is_embedded=true` have downloadable binary data.

Results are cached in Redis for 24 hours per (document, font) pair.
""",
    responses={
        200: {"description": "Font binary data returned successfully."},
        401: {"description": "Authentication required."},
        403: {"description": "Document belongs to another user."},
        404: {"description": "Document or font not found, or font is not embedded."},
        422: {"description": "PDF could not be parsed for font extraction."},
        503: {"description": "Font extraction feature is disabled."},
    },
)
async def get_font_data(
    document_id: str,
    font_id: str,
    user: AuthenticatedUser,
    session: DocumentSessionDep,
) -> APIResponse[FontDataResponse]:
    """Return base64-encoded binary for a specific embedded font."""
    settings = get_settings()
    if not settings.font_extraction_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Font extraction is currently disabled.",
        )

    start = time.time()

    _assert_owner(session, user)

    logger.info(
        "Getting font data: user=%s document_id=%s font_id=%s",
        user.user_id,
        document_id,
        font_id,
    )

    # Try per-font cache first
    cached = await _get_cached_font_data(document_id, font_id)
    if cached is not None:
        logger.debug(
            "Font data cache hit document_id=%s font_id=%s", document_id, font_id
        )
        response_data = FontDataResponse(**cached)
    else:
        # Run extraction (also populates data cache for all fonts)
        fonts = await _extract_and_cache(session, document_id)

        # Find the requested font
        match: ExtractedFont | None = next(
            (ef for ef in fonts if ef.metadata.font_id == font_id), None
        )

        if match is None:
            logger.info(
                "Font not found: document_id=%s font_id=%s", document_id, font_id
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Font '{font_id}' not found in document.",
            )

        if match.data is None or match.metadata.format is None:
            logger.info(
                "Font not extractable: document_id=%s font_id=%s is_embedded=%s",
                document_id,
                font_id,
                match.metadata.is_embedded,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"Font '{font_id}' is not embedded or could not be extracted."
                ),
            )

        response_data = FontDataResponse(
            font_id=match.metadata.font_id,
            data_base64=font_extraction_service.encode_base64(match.data),
            format=match.metadata.format,
            mime_type=font_extraction_service.get_mime_type(match.metadata.format),
            original_name=match.metadata.original_name,
        )

    return APIResponse(
        success=True,
        data=response_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=int((time.time() - start) * 1000),
        ),
    )
