"""Unit tests for the pure text-chunking helper used before embedding.

``chunk_text_for_embedding`` is pure + deterministic + stdlib-only. These tests
pin its contract: paragraph packing, over-long paragraph/sentence/word
splitting, the ``max_chunks`` cap (with a logged warning, never silent), empty
input, no mid-word cuts on ordinary text, and determinism.
"""

from __future__ import annotations

import logging

import pytest

from app.services.text_chunking import chunk_text_for_embedding


class TestBasicShape:
    def test_empty_string_returns_empty_list(self):
        assert chunk_text_for_embedding("") == []

    def test_whitespace_only_returns_empty_list(self):
        assert chunk_text_for_embedding("   \n\n  \t ") == []

    def test_single_short_paragraph_is_one_chunk(self):
        assert chunk_text_for_embedding("Bonjour le monde.") == ["Bonjour le monde."]

    def test_every_chunk_is_stripped_and_non_empty(self):
        text = "  Alpha.  \n\n  Beta.  \n\n   \n\n  Gamma. "
        chunks = chunk_text_for_embedding(text, max_chars=10)
        assert chunks  # non-empty
        assert all(c == c.strip() and c for c in chunks)

    def test_invalid_max_chars_raises(self):
        with pytest.raises(ValueError, match="max_chars"):
            chunk_text_for_embedding("x", max_chars=0)

    def test_invalid_max_chunks_raises(self):
        with pytest.raises(ValueError, match="max_chunks"):
            chunk_text_for_embedding("x", max_chunks=0)


class TestParagraphPacking:
    def test_short_paragraphs_are_packed_together(self):
        # Three short paragraphs comfortably fit in one window.
        text = "Un.\n\nDeux.\n\nTrois."
        chunks = chunk_text_for_embedding(text, max_chars=100)
        assert len(chunks) == 1
        assert "Un." in chunks[0] and "Trois." in chunks[0]

    def test_paragraphs_split_across_windows_when_over_budget(self):
        # Each paragraph is ~20 chars; with max_chars=25 only one fits per window.
        p = "x" * 20
        text = f"{p}\n\n{p}\n\n{p}"
        chunks = chunk_text_for_embedding(text, max_chars=25)
        assert len(chunks) == 3
        assert all(len(c) <= 25 for c in chunks)

    def test_packing_preserves_order(self):
        text = "aaa\n\nbbb\n\nccc\n\nddd"
        chunks = chunk_text_for_embedding(text, max_chars=8)
        joined = " ".join(chunks)
        assert joined.index("aaa") < joined.index("bbb") < joined.index("ccc")


class TestOverLongSplitting:
    def test_long_paragraph_split_on_sentence_boundaries(self):
        # One paragraph, three sentences; max_chars forces a sentence-level split.
        text = "Phrase une est ici. Phrase deux est la. Phrase trois aussi."
        chunks = chunk_text_for_embedding(text, max_chars=25)
        assert len(chunks) >= 2
        assert all(len(c) <= 25 for c in chunks)
        # No sentence content is lost.
        joined = " ".join(chunks)
        assert "une" in joined and "deux" in joined and "trois" in joined

    def test_no_word_is_cut_on_ordinary_text(self):
        text = "alpha beta gamma delta epsilon zeta eta theta"
        max_chars = 15
        chunks = chunk_text_for_embedding(text, max_chars=max_chars)
        original_words = set(text.split())
        produced_words = {w for c in chunks for w in c.split()}
        # Every original word survives intact (none split mid-token).
        assert produced_words == original_words
        assert all(len(c) <= max_chars for c in chunks)

    def test_giant_token_without_whitespace_is_hard_split(self):
        # A 50-char token with no spaces must be hard-split to fit max_chars=20.
        token = "Z" * 50
        chunks = chunk_text_for_embedding(token, max_chars=20)
        assert all(len(c) <= 20 for c in chunks)
        # Reassembling the hard-split pieces yields the original token.
        assert "".join(chunks) == token


class TestMaxChunksCap:
    def test_caps_number_of_chunks(self):
        # 10 paragraphs that can't be packed (each == max_chars) → 10 chunks,
        # capped to 3.
        paragraph = "y" * 10
        text = "\n\n".join([paragraph] * 10)
        chunks = chunk_text_for_embedding(text, max_chars=10, max_chunks=3)
        assert len(chunks) == 3

    def test_cap_logs_a_warning_with_dropped_count(self, caplog):
        paragraph = "y" * 10
        text = "\n\n".join([paragraph] * 10)
        with caplog.at_level(logging.WARNING):
            chunk_text_for_embedding(text, max_chars=10, max_chunks=4)
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert warnings, "expected a truncation warning (never silent)"
        msg = warnings[0].getMessage()
        assert "capped" in msg and "dropped 6" in msg

    def test_no_warning_when_under_cap(self, caplog):
        with caplog.at_level(logging.WARNING):
            chunk_text_for_embedding("a\n\nb\n\nc", max_chars=100, max_chunks=10)
        assert not [r for r in caplog.records if r.levelno == logging.WARNING]


class TestDeterminism:
    def test_same_input_same_output(self):
        text = (
            "Premier paragraphe avec plusieurs phrases. Encore une phrase.\n\n"
            "Deuxième paragraphe un peu plus long pour forcer un découpage "
            "sur les frontières de phrase et de mot.\n\n"
            "Troisième."
        )
        first = chunk_text_for_embedding(text, max_chars=40)
        second = chunk_text_for_embedding(text, max_chars=40)
        assert first == second
