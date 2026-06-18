"""Text embedding service for semantic search (#85).

Wraps ``fastembed`` with a **384-d multilingual** model to turn OCR text into
vectors stored in the ``ocr_blocks.embedding`` pgvector column.

Model choice (deviation from the original #85 spec — documented):
    The spec asked for ``intfloat/multilingual-e5-small`` (384-d, multilingual).
    That model is **not** shipped by fastembed (any version): fastembed only
    offers the 1024-d ``intfloat/multilingual-e5-large``. To honour BOTH the
    384-d schema (``vector(384)``) AND the multilingual (FR + EN) requirement
    — the very reason e5-small was preferred over the English-only
    ``bge-small-en`` — we use fastembed's only 384-d multilingual model,
    ``sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`` (384-d,
    50+ languages incl. FR/EN). Semantic ranking is validated (a French query
    correctly ranks French passages). The prefix mechanism below is kept so a
    384-d e5 model can be dropped in with a one-line change if fastembed ever
    ships one.

Design:
- **Singleton + lazy load.** The model (~470 MB) is downloaded once on first
  use and cached on disk (``FASTEMBED_CACHE_DIR``); subsequent calls reuse the
  in-process instance. Importing this module never loads the model.
- **Model-aware prefixes.** The e5 family needs asymmetric prefixes
  (``"passage: "`` / ``"query: "``); MiniLM does not. The prefixes are model
  attributes (empty for MiniLM), so passages and queries are embedded with the
  convention the active model expects.
- **L2-normalized output.** We always re-normalize so cosine distance (pgvector
  ``<=>``) is well-behaved regardless of the model's default pooling/norm.
- **Never crashes the caller.** If the model can't be loaded (offline, disk,
  incompatible version) the service logs and degrades: ``embed_passages``
  returns ``None`` placeholders so OCR ingestion still succeeds (the block is
  stored without an embedding and is simply not semantically searchable),
  and ``embed_query`` returns ``None`` so the search endpoint can answer with
  an empty result set instead of a 500.
"""

from __future__ import annotations

import logging
import math
import os
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from fastembed import TextEmbedding

_logger = logging.getLogger(__name__)

# 384-d multilingual model (FR + EN + 50 languages). See the module docstring
# for why this is used instead of intfloat/multilingual-e5-small. Must match
# ocr_blocks.embedding vector(384) and app.models.database.EMBEDDING_DIMENSION.
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DIMENSION = 384

# Asymmetric prefixes the model expects for indexed passages vs. queries.
# MiniLM uses none; e5 would use "passage: " / "query: ". Centralised here so
# swapping MODEL_NAME to an e5 variant only needs these two strings updated.
_PASSAGE_PREFIX = ""
_QUERY_PREFIX = ""


def _l2_normalize(vector: list[float]) -> list[float]:
    """Return the L2-normalized copy of *vector* (unit length).

    A zero vector is returned unchanged (no division by zero).
    """
    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0.0:
        return vector
    return [component / norm for component in vector]


class EmbeddingService:
    """Lazy-loading singleton around the fastembed e5 model.

    Use the module-level :data:`embedding_service` instance rather than
    constructing this directly.
    """

    MODEL_NAME = MODEL_NAME
    DIMENSION = DIMENSION

    def __init__(self) -> None:
        self._model: TextEmbedding | None = None
        # Guards the lazy load against concurrent first-callers. Latches to
        # True once a load has been attempted and failed, so we don't retry
        # (and re-log) the failure on every request.
        self._load_lock = threading.Lock()
        self._load_failed = False

    # -- model lifecycle ---------------------------------------------------

    def _get_model(self) -> TextEmbedding | None:
        """Return the loaded model, loading it on first use.

        Returns ``None`` (without raising) if the model can't be loaded.
        """
        if self._model is not None:
            return self._model
        if self._load_failed:
            return None

        with self._load_lock:
            # Re-check inside the lock (another thread may have loaded it).
            if self._model is not None:
                return self._model
            if self._load_failed:
                return None
            try:
                from fastembed import TextEmbedding

                cache_dir = os.getenv("FASTEMBED_CACHE_DIR") or None
                _logger.info(
                    "EmbeddingService: loading model %s (cache_dir=%s)",
                    MODEL_NAME,
                    cache_dir or "<default>",
                )
                self._model = TextEmbedding(
                    model_name=MODEL_NAME,
                    cache_dir=cache_dir,
                )
                _logger.info("EmbeddingService: model %s ready", MODEL_NAME)
            except Exception:  # noqa: BLE001 - degrade, never crash the caller
                self._load_failed = True
                _logger.warning(
                    "EmbeddingService: could not load model %s — semantic "
                    "search disabled (OCR ingestion continues without "
                    "embeddings)",
                    MODEL_NAME,
                    exc_info=True,
                )
                return None
        return self._model

    @property
    def is_available(self) -> bool:
        """True if the model is (or can be) loaded. Triggers a lazy load."""
        return self._get_model() is not None

    def _embed(self, texts: list[str]) -> list[list[float]] | None:
        """Embed already-prefixed *texts*; return L2-normalized vectors.

        Returns ``None`` if the model is unavailable.
        """
        model = self._get_model()
        if model is None:
            return None
        try:
            # fastembed returns an iterable of numpy arrays.
            raw = list(model.embed(texts))
            return [_l2_normalize([float(x) for x in vector]) for vector in raw]
        except Exception:  # noqa: BLE001 - degrade, never crash the caller
            _logger.warning(
                "EmbeddingService: embedding failed for %d text(s)",
                len(texts),
                exc_info=True,
            )
            return None

    # -- public API --------------------------------------------------------

    def embed_passages(self, texts: list[str]) -> list[list[float] | None]:
        """Embed indexed passages (prefix ``"passage: "``).

        Always returns a list the same length as *texts*: each entry is a
        384-d unit vector, or ``None`` when the model is unavailable (so the
        caller can still persist the block without an embedding).
        """
        if not texts:
            return []
        prefixed = [f"{_PASSAGE_PREFIX}{text}" for text in texts]
        vectors = self._embed(prefixed)
        if vectors is None:
            return [None] * len(texts)
        return list(vectors)

    def embed_query(self, query: str) -> list[float] | None:
        """Embed a search query (prefix ``"query: "``).

        Returns a 384-d unit vector, or ``None`` when the model is
        unavailable (the search endpoint then returns an empty result set).
        """
        if not query or not query.strip():
            return None
        vectors = self._embed([f"{_QUERY_PREFIX}{query}"])
        if not vectors:
            return None
        return vectors[0]


# Module-level singleton — import this, don't instantiate EmbeddingService.
embedding_service = EmbeddingService()
