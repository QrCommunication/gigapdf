"""
Embed session endpoints.

Handles the lifecycle of embedded editor sessions:
- Create a session by uploading a PDF file (via publishable key)
- Complete a session and retrieve the modified PDF
- Delete/cleanup a session
"""

import logging
import time
import uuid

from fastapi import APIRouter, File, Request, UploadFile, status
from fastapi.responses import Response

from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_api_key_user_id(request: Request) -> str:
    """Extract the user_id injected by ApiKeyAuthMiddleware."""
    user_id = getattr(request.state, "api_key_user_id", None)
    if not user_id:
        from app.middleware.error_handler import AuthRequiredError

        raise AuthRequiredError("API key authentication required")
    return user_id


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

    # Store session mapping (session_id → document_id) in the document repo
    from app.repositories.document_repo import document_sessions

    document_sessions.set_embed_session(session_id, document_id, user_id)

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

    session_info = document_sessions.get_embed_session(session_id)
    if not session_info or session_info.get("user_id") != user_id:
        from app.middleware.error_handler import DocumentNotFoundError

        raise DocumentNotFoundError(session_id)

    document_id = session_info["document_id"]

    # Get the document session and export the PDF
    doc_session = document_sessions.get_session(document_id)
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

    session_info = document_sessions.get_embed_session(session_id)
    if not session_info or session_info.get("user_id") != user_id:
        from app.middleware.error_handler import DocumentNotFoundError

        raise DocumentNotFoundError(session_id)

    document_id = session_info["document_id"]

    # Clean up the document session
    document_sessions.remove_session(document_id)
    document_sessions.remove_embed_session(session_id)

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
