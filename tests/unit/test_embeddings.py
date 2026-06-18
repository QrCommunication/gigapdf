"""Unit tests for the semantic-search embedding service (#85).

Two layers:
- **Always-on**: the pure helpers and the graceful-degradation contract
  (model unavailable → ``None`` placeholders, never raises). These mock out
  fastembed so they run in any environment.
- **Model-dependent**: real embeddings (dimensionality, determinism, L2
  normalization, semantic closeness). These are SKIPPED cleanly when the
  fastembed model cannot be loaded (e.g. offline CI), so the suite stays green.
"""

from __future__ import annotations

import math

import pytest

from app.services.embeddings import (
    DIMENSION,
    MODEL_NAME,
    EmbeddingService,
    _l2_normalize,
    embedding_service,
)


# ---------------------------------------------------------------------------
# Detect whether the real model can be loaded (gates the heavy tests)
# ---------------------------------------------------------------------------

def _model_available() -> bool:
    try:
        svc = EmbeddingService()
        return svc.embed_query("probe") is not None
    except Exception:  # noqa: BLE001
        return False


_MODEL_AVAILABLE = _model_available()
requires_model = pytest.mark.skipif(
    not _MODEL_AVAILABLE,
    reason="fastembed model not downloadable in this environment",
)


# ---------------------------------------------------------------------------
# Pure helpers (always run)
# ---------------------------------------------------------------------------

class TestL2Normalize:
    def test_unit_vector_unchanged_length(self):
        out = _l2_normalize([3.0, 4.0])
        assert math.isclose(math.sqrt(sum(x * x for x in out)), 1.0, rel_tol=1e-9)
        # direction preserved
        assert math.isclose(out[0] / out[1], 3.0 / 4.0, rel_tol=1e-9)

    def test_zero_vector_returned_unchanged(self):
        assert _l2_normalize([0.0, 0.0, 0.0]) == [0.0, 0.0, 0.0]


class TestConstants:
    def test_model_is_384d_and_multilingual(self):
        # 384-d to match the vector(384) schema, and a MULTILINGUAL model
        # (FR + EN) — NOT the English-only bge-small-en. fastembed doesn't ship
        # multilingual-e5-small, so we use the 384-d multilingual MiniLM (see
        # the embeddings module docstring).
        assert DIMENSION == 384
        assert "MiniLM" in MODEL_NAME or "e5" in MODEL_NAME.lower()
        assert "multilingual" in MODEL_NAME.lower()
        assert MODEL_NAME != "BAAI/bge-small-en"


# ---------------------------------------------------------------------------
# Graceful degradation (model load fails) — always run, mocks fastembed
# ---------------------------------------------------------------------------

class TestGracefulDegradation:
    def test_embed_passages_returns_none_placeholders_when_model_unavailable(self):
        svc = EmbeddingService()
        # Force the lazy loader to report a failed load.
        svc._load_failed = True

        out = svc.embed_passages(["a", "b", "c"])

        assert out == [None, None, None]  # same length, all None
        assert svc.is_available is False

    def test_embed_query_returns_none_when_model_unavailable(self):
        svc = EmbeddingService()
        svc._load_failed = True

        assert svc.embed_query("hello") is None

    def test_load_failure_is_not_retried_every_call(self, monkeypatch):
        """A failed load latches; the model factory must not be called twice."""
        import sys
        import types

        svc = EmbeddingService()
        calls = {"n": 0}

        def _boom(*_args, **_kwargs):
            calls["n"] += 1
            raise RuntimeError("no model on disk")

        # Inject a fake `fastembed` module so the in-function
        # ``from fastembed import TextEmbedding`` resolves to our boom factory,
        # whether or not fastembed is actually installed in this environment.
        fake = types.ModuleType("fastembed")
        fake.TextEmbedding = _boom
        monkeypatch.setitem(sys.modules, "fastembed", fake)

        assert svc.embed_query("x") is None
        assert svc.embed_query("y") is None
        assert calls["n"] == 1  # loaded once, then latched

    def test_empty_inputs_short_circuit(self):
        svc = EmbeddingService()
        assert svc.embed_passages([]) == []
        assert svc.embed_query("") is None
        assert svc.embed_query("   ") is None


# ---------------------------------------------------------------------------
# Real embeddings (skipped when the model is unavailable)
# ---------------------------------------------------------------------------

@requires_model
class TestRealEmbeddings:
    def test_passage_dimension_is_384(self):
        [vec] = embedding_service.embed_passages(["un contrat de location"])
        assert vec is not None
        assert len(vec) == DIMENSION

    def test_query_dimension_is_384(self):
        vec = embedding_service.embed_query("bail immobilier")
        assert vec is not None
        assert len(vec) == DIMENSION

    def test_output_is_l2_normalized(self):
        vec = embedding_service.embed_query("facture")
        norm = math.sqrt(sum(x * x for x in vec))
        assert math.isclose(norm, 1.0, rel_tol=1e-4)

    def test_deterministic(self):
        a = embedding_service.embed_query("résiliation de contrat")
        b = embedding_service.embed_query("résiliation de contrat")
        assert a is not None and b is not None
        # Identical input → identical vector.
        for x, y in zip(a, b, strict=True):
            assert math.isclose(x, y, rel_tol=1e-6, abs_tol=1e-6)

    def test_related_texts_more_similar_than_unrelated(self):
        # Index two passages; query close to one of them.
        passages = embedding_service.embed_passages(
            [
                "Le locataire doit payer le loyer chaque mois.",
                "Recette de gâteau au chocolat avec de la farine.",
            ]
        )
        query = embedding_service.embed_query("paiement du loyer mensuel")
        assert query is not None and all(p is not None for p in passages)

        def cosine(u, v):
            return sum(a * b for a, b in zip(u, v, strict=True))

        sim_rent = cosine(query, passages[0])
        sim_cake = cosine(query, passages[1])
        assert sim_rent > sim_cake
