"""Add semantic search: pgvector extension + ocr_blocks table (#85).

Backend foundation for semantic search over OCR text. The OCR text is
produced on the TypeScript engine side (``doc.ocr()`` / ``doc.ocrText()``);
the per-block text + bounding boxes are ingested into ``ocr_blocks`` where
each block carries a 384-d embedding (fastembed, ``intfloat/multilingual-e5-small``).
Queries are answered with pgvector cosine distance (``embedding <=> :qvec``).

Adds:
- ``vector`` extension (pgvector) — required for the ``vector`` column type
  and the cosine-distance operators / HNSW index.
- ``ocr_blocks`` table: one row per OCR text block (page + bbox in PDF
  user-space coordinates), with a 384-d ``embedding`` column. Rows are
  scoped to a document (``document_id`` FK ON DELETE CASCADE) so deleting a
  document drops its blocks.
- HNSW index (``vector_cosine_ops``) on ``embedding`` for fast ANN search.
- B-tree index on ``(document_id, page)`` for the per-document re-index
  delete + page filtering.

Revision ID: 019_semantic_search
Revises: 018_free_doc_limit
Create Date: 2026-06-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "019_semantic_search"
down_revision: Union[str, None] = "018_free_doc_limit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "ocr_blocks"
# Must match EmbeddingService.DIMENSION (intfloat/multilingual-e5-small = 384-d).
_EMBEDDING_DIM = 384


def _table_exists(conn, name: str) -> bool:
    return sa.inspect(conn).has_table(name)


def _existing_indexes(conn, table: str) -> list[str]:
    if not _table_exists(conn, table):
        return []
    return [i["name"] for i in sa.inspect(conn).get_indexes(table)]


def upgrade() -> None:
    """Create the vector extension + ocr_blocks table and indexes (idempotent)."""
    conn = op.get_bind()

    # 1. pgvector extension — provides the `vector` type + cosine operators.
    #    Requires the pgvector package installed on the server (PG 17:
    #    `postgresql-17-pgvector`). IF NOT EXISTS keeps this idempotent.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 2. ocr_blocks table. Created via raw SQL because the `vector` column
    #    type is provided by the extension (not a core SQLAlchemy type).
    if not _table_exists(conn, _TABLE):
        op.execute(
            f"""
            CREATE TABLE {_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID NOT NULL
                    REFERENCES stored_documents(id) ON DELETE CASCADE,
                page INTEGER NOT NULL,
                bbox_x DOUBLE PRECISION NOT NULL DEFAULT 0,
                bbox_y DOUBLE PRECISION NOT NULL DEFAULT 0,
                bbox_w DOUBLE PRECISION NOT NULL DEFAULT 0,
                bbox_h DOUBLE PRECISION NOT NULL DEFAULT 0,
                text TEXT NOT NULL,
                embedding vector({_EMBEDDING_DIM}),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )

    indexes = _existing_indexes(conn, _TABLE)

    # 3. HNSW index for approximate-nearest-neighbour cosine search.
    #    vector_cosine_ops pairs with the `<=>` operator used by the query.
    if "idx_ocr_blocks_embedding_hnsw" not in indexes:
        op.execute(
            f"CREATE INDEX idx_ocr_blocks_embedding_hnsw "
            f"ON {_TABLE} USING hnsw (embedding vector_cosine_ops)"
        )

    # 4. B-tree on (document_id, page) — drives the per-document re-index
    #    DELETE and page-scoped lookups.
    if "idx_ocr_blocks_document_page" not in indexes:
        op.create_index(
            "idx_ocr_blocks_document_page",
            _TABLE,
            ["document_id", "page"],
        )


def downgrade() -> None:
    """Drop ocr_blocks (and its indexes via CASCADE).

    The ``vector`` extension is dropped with prudence: only if no other
    object still depends on it. ``DROP EXTENSION`` (without CASCADE) fails
    loudly when another table still has a ``vector`` column, so a shared
    extension is never silently removed.
    """
    conn = op.get_bind()

    if _table_exists(conn, _TABLE):
        op.execute(f"DROP TABLE IF EXISTS {_TABLE} CASCADE")

    # Drop the extension only when nothing else depends on it. RESTRICT is the
    # default; it errors if a dependency remains. Guard on the absence of any
    # remaining `vector`-typed column so we don't break unrelated features.
    remaining = conn.execute(
        sa.text(
            """
            SELECT count(*) FROM information_schema.columns
            WHERE udt_name = 'vector'
            """
        )
    ).scalar()
    if not remaining:
        op.execute("DROP EXTENSION IF EXISTS vector")
