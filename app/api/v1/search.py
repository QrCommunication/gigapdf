"""Semantic search over OCR text (#85).

``POST /api/v1/search/semantic`` embeds the query (e5 ``query:`` prefix) and
ranks the authenticated user's OCR blocks by pgvector cosine distance,
returning the best matches with their document, page and bounding box.

Ownership is enforced in SQL (JOIN on ``stored_documents.owner_id`` +
exclude trashed) so a user can never reach another user's blocks (IDOR).
"""

import logging
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth import AuthenticatedUser
from app.middleware.rate_limiter import RateLimitDep
from app.middleware.request_id import get_request_id
from app.models.database import OcrBlock, StoredDocument
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.embeddings import embedding_service
from app.utils.helpers import now_utc

_logger = logging.getLogger(__name__)

router = APIRouter()

# Snippet length returned to the client (the block text can be long).
_SNIPPET_MAX_CHARS = 280
# Hard cap on the requested result count.
_MAX_LIMIT = 100


class SemanticSearchRequest(BaseModel):
    """Request body for semantic search."""

    query: str = Field(
        min_length=1,
        max_length=1000,
        description="Natural-language search query",
    )
    limit: int = Field(
        default=20,
        ge=1,
        le=_MAX_LIMIT,
        description="Maximum number of matches to return (1-100)",
    )


@router.post(
    "/semantic",
    response_model=APIResponse[dict],
    summary="Semantic search over document OCR text",
    description="""
Search the authenticated user's documents by **meaning** rather than exact
keywords. The query is embedded (384-d multilingual model, FR + EN) and
matched against the per-block embeddings produced when a document's
OCR blocks were indexed (`POST /api/v1/storage/documents/{id}/ocr-blocks`).

Results are ranked by cosine similarity and scoped to documents **owned** by the
caller (trashed documents excluded). Each match carries the document, page and
bounding box so the UI can jump straight to the location.

If the embedding model is unavailable, an empty result set is returned (HTTP 200).

## Request Body
| Field | Type | Description |
|-------|------|-------------|
| query | string | Natural-language query (1-1000 chars) |
| limit | int | Max matches to return (1-100, default 20) |

## Result Item
`{ document_id, document_name, page, bbox: {x,y,w,h}, snippet, score }`
""",
)
async def semantic_search(
    request: SemanticSearchRequest,
    user: AuthenticatedUser,
    _rl: RateLimitDep,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Embed the query and return the user's best-matching OCR blocks."""
    start_time = time.time()

    query_vector = await _embed_query(request.query)

    results: list[dict] = []
    if query_vector is not None:
        # cosine distance in [0, 2]; similarity score = 1 - distance.
        distance = OcrBlock.embedding.cosine_distance(query_vector)
        stmt = (
            select(
                OcrBlock.document_id,
                StoredDocument.name,
                OcrBlock.page,
                OcrBlock.bbox_x,
                OcrBlock.bbox_y,
                OcrBlock.bbox_w,
                OcrBlock.bbox_h,
                OcrBlock.text,
                distance.label("distance"),
            )
            .join(StoredDocument, StoredDocument.id == OcrBlock.document_id)
            .where(
                StoredDocument.owner_id == user.user_id,  # IDOR guard
                ~StoredDocument.is_deleted,
                OcrBlock.embedding.is_not(None),
            )
            .order_by(distance)
            .limit(request.limit)
        )
        rows = (await db.execute(stmt)).all()
        results = [
            {
                "document_id": row.document_id,
                "document_name": row.name,
                "page": row.page,
                "bbox": {
                    "x": row.bbox_x,
                    "y": row.bbox_y,
                    "w": row.bbox_w,
                    "h": row.bbox_h,
                },
                "snippet": row.text[:_SNIPPET_MAX_CHARS],
                "score": round(1.0 - float(row.distance), 6),
            }
            for row in rows
        ]

    processing_time = int((time.time() - start_time) * 1000)
    return APIResponse(
        success=True,
        data={
            "query": request.query,
            "results": results,
            "count": len(results),
            "semantic_search_available": query_vector is not None,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


async def _embed_query(query: str) -> list[float] | None:
    """Embed the query off the event loop (fastembed is CPU-bound, sync)."""
    import asyncio

    return await asyncio.to_thread(embedding_service.embed_query, query)
