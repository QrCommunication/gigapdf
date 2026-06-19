"""Deterministic text chunking for embedding-based semantic search.

A document's full extracted text is split into bounded, semantically coherent
chunks before being embedded as ``ocr_blocks`` (#85). Smaller chunks embed more
faithfully than one giant block (the embedding model truncates long inputs), so
chunking measurably improves semantic recall over the previous "one block = the
whole document" approach.

The single public entry point :func:`chunk_text_for_embedding` is **pure** and
**deterministic** (same input → same output) and uses the standard library
only — no third-party dependency (zero-binary policy, #61). Splitting is
hierarchical and *non-destructive of words when avoidable*:

1. Split on paragraph boundaries (blank lines, ``\\n\\n``).
2. Pack consecutive paragraphs into windows of at most ``max_chars``.
3. A paragraph that is itself longer than ``max_chars`` is split further on
   sentence boundaries (``". "`` / newlines), and only as a last resort
   hard-split mid-word.

The number of chunks is capped (``max_chunks``) to bound both the embedding
cost and the size of the index; truncation is **logged** (never silent — a
dropped tail of text would silently shrink search coverage).
"""

from __future__ import annotations

import logging
import re

_logger = logging.getLogger(__name__)

# Paragraph boundary: one or more blank lines (tolerating trailing spaces).
_PARAGRAPH_SPLIT = re.compile(r"\n[ \t]*\n+")

# Sentence-ish boundary used to break an over-long paragraph: keep the
# terminator with the preceding sentence. Matches end-of-sentence punctuation
# (``. ! ?``) followed by whitespace, or a single newline.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")

# Word boundary used to pack a long sentence without cutting a word.
_WORD_SPLIT = re.compile(r"\s+")


def _split_sentences(paragraph: str) -> list[str]:
    """Split a paragraph into sentence-like fragments (non-empty, stripped)."""
    return [s.strip() for s in _SENTENCE_SPLIT.split(paragraph) if s.strip()]


def _hard_split(text: str, max_chars: int) -> list[str]:
    """Last-resort split of a single token longer than ``max_chars``.

    Cuts on fixed-width windows (mid-word) — only reached for pathological
    input with no whitespace (e.g. a base64 blob in the text layer).
    """
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


def _pack_pieces(pieces: list[str], max_chars: int, sep: str) -> list[str]:
    """Greedily pack ``pieces`` into ≤ ``max_chars`` windows joined by ``sep``.

    Pieces are assumed to individually fit within ``max_chars`` (callers split
    over-long pieces first). Packing is deterministic and order-preserving.
    """
    windows: list[str] = []
    current = ""
    for piece in pieces:
        if not current:
            current = piece
            continue
        candidate = f"{current}{sep}{piece}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            windows.append(current)
            current = piece
    if current:
        windows.append(current)
    return windows


def _chunk_paragraph(paragraph: str, max_chars: int) -> list[str]:
    """Break a single (possibly over-long) paragraph into ≤ ``max_chars`` chunks."""
    if len(paragraph) <= max_chars:
        return [paragraph]

    # Over-long paragraph: break on sentence boundaries, then pack sentences.
    sentences = _split_sentences(paragraph)
    fitting: list[str] = []
    for sentence in sentences:
        if len(sentence) <= max_chars:
            fitting.append(sentence)
            continue
        # Over-long sentence: pack its words, hard-splitting any giant token.
        words = [w for w in _WORD_SPLIT.split(sentence) if w]
        safe_words: list[str] = []
        for word in words:
            if len(word) <= max_chars:
                safe_words.append(word)
            else:
                safe_words.extend(_hard_split(word, max_chars))
        fitting.extend(_pack_pieces(safe_words, max_chars, sep=" "))

    return _pack_pieces(fitting, max_chars, sep=" ")


def chunk_text_for_embedding(
    text: str,
    *,
    max_chars: int = 900,
    max_chunks: int = 400,
) -> list[str]:
    """Split *text* into bounded, embedding-friendly chunks (pure, deterministic).

    Splitting is hierarchical: paragraphs → packed paragraph windows →
    (for over-long paragraphs) sentences → words → hard-split. Each returned
    chunk is stripped, non-empty, and at most ``max_chars`` characters.

    Args:
        text: The full plain text to chunk (e.g. a document's extracted text).
        max_chars: Maximum length of any single chunk. Must be > 0.
        max_chunks: Hard cap on the number of chunks returned. Must be > 0.
            When the text yields more chunks, the extra tail is **dropped** and
            a warning is logged (bounding embedding cost + index size).

    Returns:
        An ordered list of chunk strings (possibly empty for blank input).
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be a positive integer")
    if max_chunks <= 0:
        raise ValueError("max_chunks must be a positive integer")

    if not text or not text.strip():
        return []

    # 1. Paragraphs (drop blank ones).
    paragraphs = [p.strip() for p in _PARAGRAPH_SPLIT.split(text) if p.strip()]

    # 2. Expand any over-long paragraph into fitting pieces, keeping short ones
    #    whole so they can be packed together next.
    pieces: list[str] = []
    for paragraph in paragraphs:
        pieces.extend(_chunk_paragraph(paragraph, max_chars))

    # 3. Pack consecutive fitting pieces into ≤ max_chars windows (paragraph
    #    separator) so short paragraphs share a chunk instead of one-each.
    chunks = _pack_pieces(pieces, max_chars, sep="\n\n")

    # 4. Cap the number of chunks (never silently — log the dropped count).
    if len(chunks) > max_chunks:
        dropped = len(chunks) - max_chunks
        _logger.warning(
            "chunk_text_for_embedding: capped at %d chunks, dropped %d "
            "(text length=%d chars). Tail of the document is not indexed.",
            max_chunks,
            dropped,
            len(text),
        )
        chunks = chunks[:max_chunks]

    return chunks
