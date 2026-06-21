"""Unit tests for the storage helper ``reindex_document_text``.

``reindex_document_text`` is the single point that turns a document's plain text
into both search indexes (full-text ``extracted_text`` + semantic ``ocr_blocks``)
on every create/mutate path (upload, version, PATCH, duplicate). These tests
exercise it directly against a scripted fake AsyncSession, with the embedding
service stubbed so the 470 MB fastembed model is never loaded.

Covered:
- non-empty text → ``extracted_text`` set + chunked OcrBlock rows added (with
  embeddings), previous index cleared first (REPLACE);
- empty / whitespace / None text → ``extracted_text`` cleared + index PURGED
  (DELETE issued, zero rows added);
- re-running replaces the previous index (idempotent);
- best-effort: an embedding failure inside is swallowed (no raise).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.api.v1 import storage as storage_module
from app.api.v1.storage import reindex_document_text
from app.models.database import OcrBlock, StoredDocument

DOC_ID = "770e8400-e29b-41d4-a716-446655440042"


class _FakeResult:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _FakeSession:
    """Scripted AsyncSession stand-in (subset used by reindex_document_text)."""

    def __init__(self, doc: StoredDocument | None):
        self._doc = doc
        self.added: list = []
        self.deleted_stmts: list = []

    async def execute(self, stmt, *args, **kwargs):
        # store_ocr_blocks clears the previous index with a DELETE that needs no
        # scripted result; the doc reload is a SELECT returning the doc.
        if str(stmt).lstrip().lower().startswith("delete"):
            self.deleted_stmts.append(stmt)
            return _FakeResult()
        return _FakeResult(scalar=self._doc)

    def add(self, obj):
        self.added.append(obj)


def _make_doc(**overrides) -> StoredDocument:
    doc = StoredDocument(
        id=DOC_ID,
        name="Bail.pdf",
        owner_id="owner-1",
        page_count=2,
        current_version=1,
        file_size_bytes=2048,
        is_deleted=False,
    )
    doc.extracted_text = overrides.get("extracted_text")
    return doc


@pytest.fixture
def fake_embeddings(monkeypatch):
    """Deterministic, model-free embeddings for the storage module."""
    passages = MagicMock(side_effect=lambda texts: [[0.1] * 384 for _ in texts])
    monkeypatch.setattr(
        storage_module.embedding_service, "embed_passages", passages
    )
    return passages


async def test_indexes_text_into_fulltext_and_semantic(fake_embeddings):
    doc = _make_doc()
    session = _FakeSession(doc)

    text = "Le loyer est payable mensuellement.\n\nDépôt de garantie deux mois."
    count = await reindex_document_text(session, DOC_ID, text)

    # Full-text material set on the row.
    assert doc.extracted_text == text
    # Previous semantic index cleared before insert (REPLACE).
    assert len(session.deleted_stmts) == 1
    # One or more OcrBlock rows added, each with a 384-d embedding.
    blocks = [o for o in session.added if isinstance(o, OcrBlock)]
    assert blocks
    assert count == len(blocks)
    assert all(b.embedding is not None and len(b.embedding) == 384 for b in blocks)
    # Doc-level text → page 0, empty bbox (no per-block geometry from the client).
    assert all(b.page == 0 for b in blocks)
    assert all(b.bbox_x == 0 and b.bbox_y == 0 for b in blocks)


async def test_strips_nul_bytes(fake_embeddings):
    # PDF text layers sometimes carry NUL (0x00), which PostgreSQL text columns
    # reject ("invalid byte sequence for encoding UTF8: 0x00"). Both the
    # extracted_text and every OcrBlock text must be NUL-free.
    doc = _make_doc()
    session = _FakeSession(doc)

    text = "Dossier\x00 d'inscription\x00\x00 complet."
    count = await reindex_document_text(session, DOC_ID, text)

    assert "\x00" not in (doc.extracted_text or "")
    assert doc.extracted_text == "Dossier d'inscription complet."
    blocks = [o for o in session.added if isinstance(o, OcrBlock)]
    assert count == len(blocks) and blocks
    assert all("\x00" not in b.text for b in blocks)


async def test_empty_text_purges_index(fake_embeddings):
    # Document already had searchable text; reindexing with "" must clear it.
    doc = _make_doc(extracted_text="ancien contenu")
    session = _FakeSession(doc)

    count = await reindex_document_text(session, DOC_ID, "   ")

    assert count == 0
    assert doc.extracted_text is None  # full-text cleared
    # DELETE still issued (purge), but nothing re-inserted.
    assert len(session.deleted_stmts) == 1
    assert [o for o in session.added if isinstance(o, OcrBlock)] == []
    # No embedding work for empty text.
    fake_embeddings.assert_not_called()


async def test_none_text_purges_index(fake_embeddings):
    doc = _make_doc(extracted_text="ancien contenu")
    session = _FakeSession(doc)

    count = await reindex_document_text(session, DOC_ID, None)

    assert count == 0
    assert doc.extracted_text is None
    assert len(session.deleted_stmts) == 1
    fake_embeddings.assert_not_called()


async def test_reindex_replaces_previous_index(fake_embeddings):
    doc = _make_doc(extracted_text="v1 text")
    session = _FakeSession(doc)

    await reindex_document_text(session, DOC_ID, "première version du texte")
    first_delete_count = len(session.deleted_stmts)
    await reindex_document_text(session, DOC_ID, "deuxième version du texte")

    # Each call clears the prior index first → two DELETEs total (REPLACE).
    assert first_delete_count == 1
    assert len(session.deleted_stmts) == 2
    assert doc.extracted_text == "deuxième version du texte"


async def test_best_effort_swallows_embedding_failure(monkeypatch):
    # embed_passages raising must NOT propagate (indexing is best-effort).
    boom = MagicMock(side_effect=RuntimeError("model exploded"))
    monkeypatch.setattr(storage_module.embedding_service, "embed_passages", boom)

    doc = _make_doc()
    session = _FakeSession(doc)

    # Should not raise; returns 0 on internal failure.
    count = await reindex_document_text(session, DOC_ID, "du texte à indexer")
    assert count == 0


async def test_missing_document_row_does_not_raise(fake_embeddings):
    # Doc reload returns None (row gone) → no crash, index still (re)built.
    session = _FakeSession(doc=None)

    count = await reindex_document_text(session, DOC_ID, "texte")
    # extracted_text can't be set (no row), but semantic indexing proceeds.
    assert count >= 0
    assert len(session.deleted_stmts) == 1
