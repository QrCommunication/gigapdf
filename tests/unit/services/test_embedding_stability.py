"""The installed fastembed must reproduce the vectors already stored in ocr_blocks.

fastembed is pinned because a release can change the model's pooling and
silently invalidate the semantic index (0.8.0 moved this model from CLS to mean
pooling). Any bump is accepted only if it reproduces the reference vectors in
fixtures/embedding_reference_vectors.json, produced with fastembed 0.8.1 — the
version that embedded the stored blocks. 0.9.1 was checked against them on
2026-10-28 (cosine 1.000000000, max abs diff 8e-08) before the bump that let
Pillow move to 13.0.0.

The model (~220 MB) must already be in FASTEMBED_CACHE_DIR: the test does not
download it and says so when it is missing.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import pytest

from app.services.embeddings import MODEL_NAME, EmbeddingService

REFERENCE = Path(__file__).parent / "fixtures" / "embedding_reference_vectors.json"
_CACHE_DIR = os.getenv("FASTEMBED_CACHE_DIR", "/tmp/fastembed_cache")


def _model_is_cached() -> bool:
    cache = Path(_CACHE_DIR)
    return cache.is_dir() and any("paraphrase-multilingual-MiniLM-L12-v2" in p.name for p in cache.iterdir())


def _normalized(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector))
    return [x / norm for x in vector]


@pytest.mark.skipif(
    not _model_is_cached(),
    reason=f"embedding model not cached in {_CACHE_DIR}; set FASTEMBED_CACHE_DIR to a cache holding it",
)
def test_installed_fastembed_reproduces_the_stored_vectors(monkeypatch) -> None:
    monkeypatch.setenv("FASTEMBED_CACHE_DIR", _CACHE_DIR)
    reference = json.loads(REFERENCE.read_text(encoding="utf-8"))
    assert reference["model"] == MODEL_NAME

    samples = reference["samples"]
    vectors = EmbeddingService().embed_passages([s["text"] for s in samples])

    # onnxruntime versions alone move components by ~1e-4 (cosine 0.9999998,
    # measured 1.19 vs 1.31); a pooling change moves the whole vector, cosine
    # far below 0.9999.
    for sample, vector in zip(samples, vectors, strict=True):
        assert vector is not None, sample["text"]
        expected = _normalized(sample["vector"])
        cosine = sum(a * b for a, b in zip(vector, expected, strict=True))
        assert cosine > 0.9999, (sample["text"], cosine)
        assert max(abs(a - b) for a, b in zip(vector, expected, strict=True)) < 1e-3
