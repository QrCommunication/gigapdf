"""
Font extraction service for PDF documents.

Extracts embedded font programs from PDF files using pikepdf,
computing stable identifiers and detecting binary formats.

Subset TTFs extracted directly from PDFs (Type0/CIDFontType2 wrappers)
preserve only the minimal tables needed by pdf.js (which uses CIDToGIDMap
to drive glyph selection). Chrome's OpenType Sanitiser (OTS) is stricter:
it rejects fonts with missing cmap/name/OS-2 tables or inconsistent hmtx
side-bearings, producing the runtime error
  "OTS parsing error: hmtx: Failed to read side bearing"
We round-trip every extracted TTF through fontTools so save() rebuilds
the internal checksums and produces a TTF file the browser will accept.
"""

import base64
import hashlib
import io
import logging
import re
import struct
from dataclasses import dataclass
from typing import TYPE_CHECKING

import pikepdf

try:
    from fontTools.ttLib import TTFont, TTLibError  # type: ignore[import-not-found]

    _FONTTOOLS_AVAILABLE = True
except ImportError:  # pragma: no cover — runtime detection
    TTFont = None  # type: ignore[assignment,misc]
    TTLibError = Exception  # type: ignore[assignment,misc]
    _FONTTOOLS_AVAILABLE = False

if TYPE_CHECKING:
    from app.schemas.fonts import ExtractedFontMetadata

logger = logging.getLogger(__name__)

# Regex to detect subset prefix: exactly 6 uppercase letters followed by '+'
_SUBSET_PREFIX_RE = re.compile(r"^[A-Z]{6}\+")

# MIME type mapping per format
_MIME_TYPES: dict[str, str] = {
    "ttf": "font/ttf",
    "otf": "font/otf",
    "cff": "font/otf",  # CFF data is wrapped in an OTF container for browser use
}


@dataclass
class ExtractedFont:
    """Container holding metadata and optional raw bytes for one embedded font."""

    metadata: "ExtractedFontMetadata"
    data: bytes | None  # None when font is referenced but not extractable


class FontExtractionService:
    """
    Extracts embedded font programs from a PDF via pikepdf.

    Traverses all font descriptors across all pages, collecting unique
    fonts keyed by font_id (stable sha256 hash). Each font is returned
    with its metadata; embedded binary data is separately retrievable
    by font_id.
    """

    # PDF dict keys that may contain embedded font bytes
    FONT_FILE_KEYS = ("/FontFile", "/FontFile2", "/FontFile3")

    def extract_fonts(self, pdf_bytes: bytes) -> list[ExtractedFont]:
        """
        Parse a PDF and extract metadata (and bytes) for every font.

        Non-embedded fonts (Base14, referenced only) are included with
        is_embedded=False and data=None.

        Type0 composite fonts whose inner CIDFont cannot be unwrapped are
        logged as warnings and returned with is_embedded=True / data=None.

        Args:
            pdf_bytes: Raw PDF file content.

        Returns:
            Deduplicated list of ExtractedFont (data may be None).

        Raises:
            ValueError: If pdf_bytes is not a valid PDF.
        """
        try:
            pdf = pikepdf.Pdf.open(io.BytesIO(pdf_bytes))
        except pikepdf.PdfError as exc:
            raise ValueError(f"Cannot open PDF: {exc}") from exc

        # Collect by font_id to deduplicate across pages
        seen: dict[str, ExtractedFont] = {}

        for page in pdf.pages:
            resources = page.get("/Resources")
            if not resources:
                continue

            font_dict = resources.get("/Font")
            if not font_dict:
                continue

            for font_ref_name, font_obj in font_dict.items():
                try:
                    extracted = self._process_font_object(font_obj)
                    if extracted is None:
                        continue
                    fid = extracted.metadata.font_id
                    if fid not in seen:
                        seen[fid] = extracted
                except Exception as exc:
                    logger.warning(
                        "Font extraction failed for ref '%s': %s",
                        font_ref_name,
                        exc,
                        exc_info=False,
                    )

        return list(seen.values())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _process_font_object(
        self, font_obj: pikepdf.Object
    ) -> ExtractedFont | None:
        """
        Extract metadata and bytes from a single PDF font dictionary.

        Returns None if the object is not a usable font dict.
        """
        # Unwrap indirect references
        font_dict = dict(font_obj)

        subtype_obj = font_dict.get("/Subtype")
        subtype = str(subtype_obj).lstrip("/") if subtype_obj else "Unknown"

        # Base font name (used as original_name / postscript_name)
        base_font_obj = font_dict.get("/BaseFont")
        original_name = (
            str(base_font_obj).lstrip("/") if base_font_obj else "Unknown"
        )

        postscript_name: str | None = original_name if original_name != "Unknown" else None
        font_family = self._extract_family(postscript_name)
        is_subset = bool(
            postscript_name and _SUBSET_PREFIX_RE.match(postscript_name)
        )

        font_id = self.compute_font_id(postscript_name, subtype)

        # Attempt to find descriptor
        descriptor = font_dict.get("/FontDescriptor")

        # For Type0 (composite) fonts, inspect the DescendantFonts array
        if subtype == "Type0" and not descriptor:
            descendants = font_dict.get("/DescendantFonts")
            if descendants:
                try:
                    inner = descendants[0]
                    descriptor = dict(inner).get("/FontDescriptor")
                    inner_subtype = dict(inner).get("/Subtype")
                    if inner_subtype:
                        subtype = str(inner_subtype).lstrip("/")
                except Exception as exc:
                    logger.warning(
                        "Cannot unwrap Type0 DescendantFonts for '%s': %s",
                        original_name,
                        exc,
                    )

        font_bytes, font_file_key = self._extract_font_bytes(descriptor)
        is_embedded = font_bytes is not None
        detected_format = self.detect_format(font_bytes, subtype) if font_bytes else None

        if is_embedded and font_bytes and not detected_format:
            logger.warning(
                "Could not determine format for embedded font '%s' (subtype=%s). "
                "Returning data=None to avoid serving corrupted bytes.",
                original_name,
                subtype,
            )
            font_bytes = None

        # Round-trip through fontTools to fix subset TTFs that Chrome OTS
        # rejects ("hmtx: Failed to read side bearing"). This must run AFTER
        # detect_format because the format determines whether we attempt
        # repair (TTF/OTF) or pass through (CFF wrapped, raw bytes).
        if font_bytes and detected_format:
            repaired = self._repair_ttf_for_browser(
                font_bytes, detected_format, postscript_name
            )
            if repaired is not None:
                font_bytes = repaired

        size_bytes = len(font_bytes) if font_bytes else None

        from app.schemas.fonts import ExtractedFontMetadata

        metadata = ExtractedFontMetadata(
            font_id=font_id,
            original_name=original_name,
            postscript_name=postscript_name,
            font_family=font_family,
            subtype=subtype,
            is_embedded=is_embedded,
            is_subset=is_subset,
            format=detected_format,
            size_bytes=size_bytes,
        )
        return ExtractedFont(metadata=metadata, data=font_bytes)

    @staticmethod
    def _pad_hmtx_table(font_bytes: bytes) -> bytes | None:
        """
        Pad the hmtx table with trailing zero leftSideBearings.

        PDF subset TTFs often store only the first `numberOfHMetrics`
        longHorMetric entries (4 bytes each) and omit the trailing array of
        `numGlyphs - numberOfHMetrics` 2-byte LSBs. PDF readers don't need
        them — they read each glyph by GID and apply the last advance — but
        Chrome OTS, fontTools, and harfbuzz all reject the truncated table:

            OTS parsing error: hmtx: Failed to read side bearing N
            fontTools.TTLibError: not enough 'hmtx' table data: expected X bytes, got Y

        Padding with zeros is safe: a zero LSB shifts no glyphs, and the
        advanceWidth from the last longHorMetric still applies to all
        trailing glyphs (per the OpenType spec).

        Returns None when the binary is too small/malformed to safely patch.
        Returns the original bytes when no padding is needed (already
        well-formed) so callers can chain unconditionally.
        """
        if len(font_bytes) < 12:
            return None

        sfnt_version = font_bytes[:4]
        if sfnt_version not in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
            # Not a TTF/OTF — pass through unchanged.
            return font_bytes

        try:
            num_tables = struct.unpack(">H", font_bytes[4:6])[0]
        except struct.error:
            return None

        # Parse the table directory: each entry is 16 bytes
        # [tag(4) checksum(4) offset(4) length(4)]
        tables: dict[bytes, tuple[int, int, int]] = {}
        for i in range(num_tables):
            dir_off = 12 + i * 16
            if dir_off + 16 > len(font_bytes):
                return None
            tag = font_bytes[dir_off : dir_off + 4]
            try:
                offset, length = struct.unpack(
                    ">II", font_bytes[dir_off + 8 : dir_off + 16]
                )
            except struct.error:
                return None
            tables[tag] = (offset, length, dir_off)

        # All three are required to compute the expected hmtx length.
        if (
            b"hmtx" not in tables
            or b"maxp" not in tables
            or b"hhea" not in tables
        ):
            return font_bytes

        maxp_off, maxp_len, _ = tables[b"maxp"]
        hhea_off, hhea_len, _ = tables[b"hhea"]
        # maxp.numGlyphs is at offset 4 (uint16);
        # hhea.numberOfHMetrics is at offset 34 (uint16).
        if maxp_len < 6 or hhea_len < 36:
            return None
        try:
            num_glyphs = struct.unpack(
                ">H", font_bytes[maxp_off + 4 : maxp_off + 6]
            )[0]
            num_h_metrics = struct.unpack(
                ">H", font_bytes[hhea_off + 34 : hhea_off + 36]
            )[0]
        except struct.error:
            return None

        if num_h_metrics == 0 or num_h_metrics > num_glyphs:
            # Defensive: malformed hhea/maxp pair.
            return font_bytes

        expected_hmtx = num_h_metrics * 4 + (num_glyphs - num_h_metrics) * 2
        hmtx_off, hmtx_len, hmtx_dir_off = tables[b"hmtx"]

        if hmtx_len >= expected_hmtx:
            # Already well-formed (rare for PDF subsets, common for raw TTFs).
            return font_bytes

        missing = expected_hmtx - hmtx_len
        insert_at = hmtx_off + hmtx_len

        # Splice zero bytes into the binary, then update offsets in the
        # table directory for every table that comes physically after hmtx.
        new_bytes = (
            bytearray(font_bytes[:insert_at])
            + bytearray(missing)
            + bytearray(font_bytes[insert_at:])
        )
        new_bytes[hmtx_dir_off + 12 : hmtx_dir_off + 16] = struct.pack(
            ">I", expected_hmtx
        )
        for _tag, (off, _len, dir_off) in tables.items():
            if off > hmtx_off:
                new_bytes[dir_off + 8 : dir_off + 12] = struct.pack(
                    ">I", off + missing
                )

        return bytes(new_bytes)

    @staticmethod
    def _repair_ttf_for_browser(
        font_bytes: bytes, font_format: str | None, postscript_name: str | None
    ) -> bytes | None:
        """
        Round-trip a font through fontTools to make it browser-OTS-compliant.

        Chrome's OpenType Sanitiser (OTS) is stricter than pdf.js. PDF subset
        TTFs typically:
        1. Truncate hmtx to skip trailing leftSideBearings (we pad with zeros)
        2. Have inconsistent table checksums (fontTools.save() regenerates)
        3. Sometimes lack OS-2/name (fontTools.save() preserves whatever
           was there, but the round-trip normalises layout)

        Returns None when the font cannot be loaded or saved; callers should
        treat None as "not embeddable in browser" (the metadata stays
        is_embedded=True so the editor can fall back to the family name).

        Args:
            font_bytes: Raw font program from the PDF FontFile* stream.
            font_format: Detected format ("ttf", "otf", "cff") — only TTF/OTF
                are repaired. CFF data needs separate handling.
            postscript_name: Used only for logging.

        Returns:
            Repaired font bytes (typically larger than input due to padded
            tables and regenerated checksums), or the original bytes when
            repair was not possible (fail-open: serving the raw subset gives
            Firefox/Safari a chance and Chrome will fall back gracefully).
        """
        if not _FONTTOOLS_AVAILABLE:
            return font_bytes

        if font_format not in ("ttf", "otf"):
            return font_bytes

        # Step 1: pad hmtx in the binary so fontTools can parse it.
        padded = FontExtractionService._pad_hmtx_table(font_bytes)
        if padded is None:
            logger.info(
                "Cannot patch hmtx for font '%s' — serving raw bytes",
                postscript_name or "unknown",
            )
            return font_bytes
        if padded is not font_bytes and len(padded) != len(font_bytes):
            logger.debug(
                "Padded hmtx for '%s': %d -> %d bytes",
                postscript_name or "unknown",
                len(font_bytes),
                len(padded),
            )

        # Step 2: round-trip via fontTools to regenerate checksums and
        # normalise table layout. lazy=False catches malformed-table errors
        # here rather than at write-time, giving us a clean failure path.
        try:
            font = TTFont(io.BytesIO(padded), lazy=False, recalcBBoxes=False)
        except TTLibError as exc:
            logger.info(
                "fontTools cannot parse font '%s' (%s) even after hmtx pad: %s",
                postscript_name or "unknown",
                font_format,
                exc,
            )
            return padded  # padded TTF is still better than the truncated original
        except Exception as exc:  # noqa: BLE001 — third-party deserialiser
            logger.warning(
                "fontTools parse failed for font '%s': %s",
                postscript_name or "unknown",
                exc,
            )
            return padded

        try:
            buf = io.BytesIO()
            # reorderTables=False keeps the table physical order stable so
            # the binary diff is minimised — easier to debug if a downstream
            # consumer breaks.
            font.save(buf, reorderTables=False)
            return buf.getvalue()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "fontTools save failed for font '%s': %s — serving padded bytes",
                postscript_name or "unknown",
                exc,
            )
            return padded

    def _extract_font_bytes(
        self, descriptor: pikepdf.Object | None
    ) -> tuple[bytes | None, str | None]:
        """
        Read the raw bytes from the first FontFile* key found in a descriptor.

        Returns:
            (bytes, key_name) or (None, None) when no embedded program exists.
        """
        if not descriptor:
            return None, None

        desc_dict = dict(descriptor)
        for key in self.FONT_FILE_KEYS:
            font_stream = desc_dict.get(key)
            if font_stream is None:
                continue
            try:
                raw: bytes = font_stream.read_raw_bytes()
                if raw:
                    # Decode compressed stream automatically
                    decoded: bytes = font_stream.read_bytes()
                    return decoded, key
            except Exception as exc:
                logger.warning("Could not read font stream '%s': %s", key, exc)

        return None, None

    @staticmethod
    def _extract_family(postscript_name: str | None) -> str | None:
        """
        Derive the font family name by stripping the subset prefix if present.

        Example: "ABCDEF+DejaVuSans-Bold" → "DejaVuSans-Bold"
                 "Helvetica"              → "Helvetica"

        Args:
            postscript_name: Full PostScript name, may include subset prefix.

        Returns:
            Family name string, or None if postscript_name is None.
        """
        if not postscript_name:
            return None
        # Strip six-uppercase-letter subset prefix followed by '+'
        return _SUBSET_PREFIX_RE.sub("", postscript_name) or postscript_name

    @staticmethod
    def compute_font_id(postscript_name: str | None, subtype: str) -> str:
        """
        Compute a stable 16-character font identifier.

        Args:
            postscript_name: PostScript name (may include subset prefix).
            subtype: PDF font subtype string.

        Returns:
            16-character lowercase hex string derived from sha256.
        """
        payload = f"{postscript_name or 'unknown'}|{subtype}".encode()
        return hashlib.sha256(payload).hexdigest()[:16]

    @staticmethod
    def detect_format(font_file_bytes: bytes | None, subtype: str) -> str | None:
        """
        Detect the binary format of a font program.

        Detection priority:
        1. Magic bytes (reliable for TTF/OTF)
        2. Subtype hint (for CFF data stored in FontFile3)

        Args:
            font_file_bytes: Raw bytes of the embedded font program.
            subtype: PDF font subtype (Type1C, CIDFontType0C, etc.).

        Returns:
            "ttf", "otf", "cff", or None when format cannot be determined.
        """
        if not font_file_bytes:
            return None

        # TTF: magic 0x00010000 or "true"
        if font_file_bytes[:4] in (b"\x00\x01\x00\x00", b"true"):
            return "ttf"

        # OTF (CFF-based): "OTTO"
        if font_file_bytes[:4] == b"OTTO":
            return "otf"

        # CFF (raw Compact Font Format, not wrapped in OTF)
        if subtype in ("Type1C", "CIDFontType0C"):
            return "cff"

        return None

    @staticmethod
    def get_mime_type(format: str) -> str:
        """
        Return the MIME type for a given font format string.

        Args:
            format: One of "ttf", "otf", "cff".

        Returns:
            MIME type string.
        """
        return _MIME_TYPES.get(format, "application/octet-stream")

    @staticmethod
    def encode_base64(data: bytes) -> str:
        """Encode font bytes to a base64 string."""
        return base64.b64encode(data).decode("ascii")


# Module-level singleton — import and use directly
font_extraction_service = FontExtractionService()
