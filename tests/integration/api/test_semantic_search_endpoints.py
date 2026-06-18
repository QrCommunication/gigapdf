"""Integration tests for the semantic-search endpoints (#85).

Routes under test:
  POST /api/v1/storage/documents/{id}/ocr-blocks  → index OCR blocks (owner-only)
  POST /api/v1/search/semantic                     → semantic search (IDOR-scoped)

Strategy (mirrors test_storage_ged_endpoints.py)
------------------------------------------------
- ``get_current_user`` is overridden via app.dependency_overrides (no JWT).
- ``get_db`` is overridden with a scripted FakeSession.
- The Redis rate limiter is neutralized (autouse) so repeated runs don't 429.
- ``embedding_service`` is monkeypatched so tests never download the model
  and embeddings are deterministic.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.middleware.auth import CurrentUser, get_current_user
from app.models.database import OcrBlock, StoredDocument

TEST_USER_ID = "test-user-sem-00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "other-user-00000000-0000-0000-0000-000000000099"
DOC_ID = "770e8400-e29b-41d4-a716-446655440010"

_FAKE_USER = CurrentUser(user_id=TEST_USER_ID, email="sem@example.com")


# ---------------------------------------------------------------------------
# Scripted fake AsyncSession (subset used by these handlers)
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows if rows is not None else []

    def scalar_one_or_none(self):
        return self._scalar

    def all(self):
        return list(self._rows)


class FakeSession:
    """AsyncSession stand-in returning scripted results in order."""

    def __init__(self):
        self._results: list[FakeResult] = []
        self.added: list = []
        self.executed: list = []
        self.deleted_stmts: list = []
        self.commit_count = 0

    async def execute(self, stmt, *args, **kwargs):
        self.executed.append(stmt)
        # DELETE statements (store_ocr_blocks clears the previous index) do
        # not need a scripted result; return an empty one.
        compiled = str(stmt).lower().lstrip()
        if compiled.startswith("delete"):
            self.deleted_stmts.append(stmt)
            return FakeResult()
        if not self._results:
            raise AssertionError(f"FakeSession: unexpected execute() for: {stmt}")
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_count += 1

    async def rollback(self):
        pass

    async def close(self):
        pass


def _make_doc(**overrides) -> StoredDocument:
    defaults = dict(
        id=DOC_ID,
        name="Bail.pdf",
        owner_id=TEST_USER_ID,
        page_count=2,
        current_version=1,
        file_size_bytes=2048,
        is_deleted=False,
    )
    defaults.update(overrides)
    doc = StoredDocument(**{k: v for k, v in defaults.items() if k != "extracted_text"})
    doc.extracted_text = overrides.get("extracted_text")
    return doc


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_db(app):
    session = FakeSession()

    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
    yield session
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    """Neutralize the Redis-backed rate limiter (persists across pytest runs)."""
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


@pytest.fixture
def fake_embeddings(monkeypatch):
    """Deterministic, model-free embeddings for both routers.

    ``embed_passages`` returns a distinct unit-ish vector per text; the search
    handler is exercised against scripted DB rows, so the actual vector values
    only need to be a valid 384-float list.
    """
    from app.api.v1 import search as search_module
    from app.api.v1 import storage as storage_module

    def _vec(seed: float) -> list[float]:
        return [seed] * 384

    passages = MagicMock(side_effect=lambda texts: [_vec(0.1 + i) for i, _ in enumerate(texts)])
    query = MagicMock(return_value=_vec(0.1))
    available = SimpleNamespace(
        embed_passages=passages,
        embed_query=query,
        is_available=True,
    )
    monkeypatch.setattr(storage_module, "embedding_service", available)
    monkeypatch.setattr(search_module, "embedding_service", available)
    return available


# ---------------------------------------------------------------------------
# OCR-blocks ingestion
# ---------------------------------------------------------------------------

class TestIndexOcrBlocks:
    def test_owner_indexes_blocks_replaces_previous(self, client: TestClient, fake_db, fake_embeddings):
        doc = _make_doc()
        fake_db._results = [FakeResult(scalar=doc)]  # ownership lookup

        body = {
            "blocks": [
                {"page": 1, "text": "Le loyer est payable mensuellement.",
                 "bbox": {"x": 10, "y": 700, "w": 200, "h": 12}},
                {"page": 1, "text": "Dépôt de garantie deux mois."},
                {"page": 2, "text": "   "},  # blank → dropped
            ]
        }
        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/ocr-blocks", json=body)

        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["stored_document_id"] == DOC_ID
        assert data["blocks_indexed"] == 2  # blank dropped
        assert data["semantic_search_available"] is True

        # Previous index cleared (DELETE issued) before insert.
        assert len(fake_db.deleted_stmts) == 1
        # Two OcrBlock rows added, each with a 384-d embedding.
        blocks = [o for o in fake_db.added if isinstance(o, OcrBlock)]
        assert len(blocks) == 2
        assert all(b.embedding is not None and len(b.embedding) == 384 for b in blocks)
        assert blocks[0].bbox_y == 700
        # Doc-level extracted_text kept in sync.
        assert "loyer" in doc.extracted_text
        assert fake_db.commit_count == 1

    def test_blocks_stored_without_embedding_when_model_unavailable(
        self, client, fake_db, monkeypatch
    ):
        from app.api.v1 import storage as storage_module

        # Model unavailable → embed_passages returns None placeholders.
        degraded = SimpleNamespace(
            embed_passages=MagicMock(side_effect=lambda texts: [None] * len(texts)),
            is_available=False,
        )
        monkeypatch.setattr(storage_module, "embedding_service", degraded)

        doc = _make_doc()
        fake_db._results = [FakeResult(scalar=doc)]

        resp = client.post(
            f"/api/v1/storage/documents/{DOC_ID}/ocr-blocks",
            json={"blocks": [{"page": 1, "text": "contenu"}]},
        )

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["blocks_indexed"] == 1
        assert data["semantic_search_available"] is False
        block = next(o for o in fake_db.added if isinstance(o, OcrBlock))
        assert block.embedding is None  # stored, just not searchable
        assert fake_db.commit_count == 1

    def test_unknown_or_unowned_document_returns_404(self, client, fake_db, fake_embeddings):
        fake_db._results = [FakeResult(scalar=None)]  # ownership lookup misses

        resp = client.post(
            f"/api/v1/storage/documents/{DOC_ID}/ocr-blocks",
            json={"blocks": [{"page": 1, "text": "x"}]},
        )

        assert resp.status_code == 404
        assert fake_db.commit_count == 0
        # No embedding work and no DELETE when ownership fails.
        fake_embeddings.embed_passages.assert_not_called()
        assert fake_db.deleted_stmts == []

    def test_too_many_blocks_returns_400(self, client, fake_db, fake_embeddings):
        from app.api.v1.storage import _MAX_OCR_BLOCKS

        body = {"blocks": [{"page": 0, "text": "t"} for _ in range(_MAX_OCR_BLOCKS + 1)]}
        resp = client.post(f"/api/v1/storage/documents/{DOC_ID}/ocr-blocks", json=body)

        assert resp.status_code == 400
        assert fake_db.commit_count == 0


# ---------------------------------------------------------------------------
# Semantic search
# ---------------------------------------------------------------------------

class TestSemanticSearch:
    def test_returns_ranked_results_scoped_to_owner(self, client, fake_db, fake_embeddings):
        # Scripted rows mimic the JOIN(OcrBlock, StoredDocument) projection,
        # already ordered by ascending cosine distance.
        rows = [
            SimpleNamespace(
                document_id=DOC_ID, name="Bail.pdf", page=1,
                bbox_x=10.0, bbox_y=700.0, bbox_w=200.0, bbox_h=12.0,
                text="Le loyer est payable mensuellement.", distance=0.05,
            ),
            SimpleNamespace(
                document_id=DOC_ID, name="Bail.pdf", page=2,
                bbox_x=0.0, bbox_y=0.0, bbox_w=0.0, bbox_h=0.0,
                text="Recette de gâteau.", distance=0.80,
            ),
        ]
        fake_db._results = [FakeResult(rows=rows)]

        resp = client.post(
            "/api/v1/search/semantic", json={"query": "paiement du loyer", "limit": 10}
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["count"] == 2
        assert data["semantic_search_available"] is True
        first, second = data["results"]
        # Score = 1 - distance, so the closest block ranks first with higher score.
        assert first["score"] > second["score"]
        assert first["document_id"] == DOC_ID
        assert first["document_name"] == "Bail.pdf"
        assert first["page"] == 1
        assert first["bbox"] == {"x": 10.0, "y": 700.0, "w": 200.0, "h": 12.0}
        assert "loyer" in first["snippet"]
        # The query was embedded once.
        fake_embeddings.embed_query.assert_called_once_with("paiement du loyer")

    def test_empty_results_when_model_unavailable(self, client, fake_db, monkeypatch):
        from app.api.v1 import search as search_module

        degraded = SimpleNamespace(embed_query=MagicMock(return_value=None))
        monkeypatch.setattr(search_module, "embedding_service", degraded)

        resp = client.post("/api/v1/search/semantic", json={"query": "anything"})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["results"] == []
        assert data["count"] == 0
        assert data["semantic_search_available"] is False
        # No DB query issued when the query can't be embedded.
        assert fake_db.executed == []

    def test_blank_query_rejected_422(self, client, fake_db, fake_embeddings):
        resp = client.post("/api/v1/search/semantic", json={"query": ""})
        assert resp.status_code == 422  # pydantic min_length

    def test_limit_over_cap_rejected_422(self, client, fake_db, fake_embeddings):
        resp = client.post(
            "/api/v1/search/semantic", json={"query": "x", "limit": 1000}
        )
        assert resp.status_code == 422  # le=100
