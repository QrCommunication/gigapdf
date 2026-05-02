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
        font_present = font_bytes is not None
        detected_format = self.detect_format(font_bytes, subtype) if font_bytes else None

        if font_present and font_bytes and not detected_format:
            logger.info(
                "Font '%s' (subtype=%s) has embedded program in unsupported "
                "format — marking is_embedded=false so the frontend falls back "
                "to the family name without a 404 round-trip.",
                original_name,
                subtype,
            )
            font_bytes = None

        # Round-trip TTF/OTF through fontTools to fix subset truncation
        # that Chrome OTS rejects.
        if font_bytes and detected_format in ("ttf", "otf"):
            repaired = self._repair_ttf_for_browser(
                font_bytes, detected_format, postscript_name
            )
            if repaired is not None:
                font_bytes = repaired
        elif font_bytes and detected_format == "cff":
            # Wrap raw CFF in an OTF (sfnt) container so the browser can
            # load it as a FontFace. PDFs embed Type1C/CIDFontType0C
            # fonts as bare CFF streams in FontFile3 — Chrome OTS only
            # accepts CFF inside an OTF wrapper.
            wrapped = self._wrap_cff_as_otf(
                font_bytes, postscript_name, font_family
            )
            if wrapped is not None:
                font_bytes = wrapped
                detected_format = "otf"  # served as OTF now
            else:
                logger.info(
                    "Font '%s' could not be wrapped CFF→OTF — falling back to "
                    "is_embedded=false so the editor uses the CSS family.",
                    original_name,
                )
                font_bytes = None

        # is_embedded reflects whether we will actually serve binary data
        # to the browser. The metadata still carries the original family/
        # postscript names so the editor can map text runs to the right
        # CSS fallback even when the bytes themselves are unavailable.
        is_embedded = font_bytes is not None
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
    def _wrap_cff_as_otf(
        cff_bytes: bytes,
        postscript_name: str | None,
        font_family: str | None,
    ) -> bytes | None:
        """
        Wrap raw CFF font data in a minimal OTF (sfnt) container.

        PDFs store Type1C / CIDFontType0C fonts as bare CFF streams.
        Browsers' FontFace API rejects raw CFF — they need a full
        OpenType wrapper with the standard required tables. This builder
        creates a minimum-viable .otf:

            sfntVersion = "OTTO"
            tables: head, hhea, hmtx, maxp, name, OS/2, cmap, post, CFF

        We use fontTools' CFFFontSet to parse the CFF, then synthesise
        the wrapper tables from the CFF top DICT info (advanceWidth,
        bbox, FontName, etc). cmap is built as identity from the CFF
        charset so glyph N → unicode N (close enough for fallback
        rendering in the editor).

        Returns None when the CFF cannot be parsed or the wrapper
        cannot be assembled. Caller treats None as "give up, fall
        back to family name".
        """
        if not _FONTTOOLS_AVAILABLE:
            return None

        try:
            from fontTools.cffLib import CFFFontSet  # type: ignore[import-not-found]
            from fontTools.ttLib import newTable  # type: ignore[import-not-found]
        except ImportError:
            return None

        try:
            # Parse the CFF stream
            cff = CFFFontSet()
            cff.decompile(io.BytesIO(cff_bytes), None)
            if len(cff.fontNames) == 0:
                return None

            top_dict = cff[cff.fontNames[0]]
            # Glyph order is the CharStrings keys; size = number of glyphs.
            glyph_order = list(top_dict.charset)
            num_glyphs = len(glyph_order)
            if num_glyphs == 0:
                return None

            # Compute advance widths from CFF Private DICT default + glyph
            # widths. fontTools exposes hmtx-equivalent metrics via
            # CharString operands; for the wrapper we use a uniform
            # default width — the editor only uses these fonts for visual
            # rendering of pre-positioned glyphs, so exact metrics aren't
            # required (pdf.js rendered them with correct widths in the
            # background bitmap; FontFace just needs to display the
            # glyphs at the editor's positions).
            default_width = int(getattr(top_dict.Private, "defaultWidthX", 500))

            # Build the OTF wrapper using fontTools' empty TTFont.
            from fontTools.ttLib import TTFont as _TTFont  # type: ignore[import-not-found]
            font = _TTFont(sfntVersion="OTTO")
            font.setGlyphOrder(glyph_order)

            # ── head ────────────────────────────────────────────────
            head = newTable("head")
            head.tableVersion = 1.0
            head.fontRevision = 1.0
            head.checkSumAdjustment = 0
            head.magicNumber = 0x5F0F3CF5
            head.flags = 0
            head.unitsPerEm = 1000
            head.created = head.modified = 0
            # Default bbox — pdf.js used the real one for the bg bitmap;
            # the editor doesn't need it for glyph hit-testing.
            head.xMin = head.yMin = 0
            head.xMax = head.yMax = 1000
            head.macStyle = 0
            head.lowestRecPPEM = 6
            head.fontDirectionHint = 2
            head.indexToLocFormat = 0
            head.glyphDataFormat = 0
            font["head"] = head

            # ── hhea ────────────────────────────────────────────────
            hhea = newTable("hhea")
            hhea.tableVersion = 0x00010000
            hhea.ascent = 800
            hhea.descent = -200
            hhea.lineGap = 0
            hhea.advanceWidthMax = default_width
            hhea.minLeftSideBearing = 0
            hhea.minRightSideBearing = 0
            hhea.xMaxExtent = default_width
            hhea.caretSlopeRise = 1
            hhea.caretSlopeRun = 0
            hhea.caretOffset = 0
            hhea.reserved0 = 0
            hhea.reserved1 = 0
            hhea.reserved2 = 0
            hhea.reserved3 = 0
            hhea.metricDataFormat = 0
            hhea.numberOfHMetrics = num_glyphs
            font["hhea"] = hhea

            # ── hmtx (uniform widths) ───────────────────────────────
            hmtx = newTable("hmtx")
            hmtx.metrics = {gn: (default_width, 0) for gn in glyph_order}
            font["hmtx"] = hmtx

            # ── maxp ────────────────────────────────────────────────
            maxp = newTable("maxp")
            maxp.tableVersion = 0x00005000  # CFF maxp
            maxp.numGlyphs = num_glyphs
            font["maxp"] = maxp

            # ── name ────────────────────────────────────────────────
            name_tbl = newTable("name")
            name_tbl.names = []
            display = font_family or postscript_name or "Embedded"
            name_tbl.setName(display, 1, 3, 1, 0x409)  # Family
            name_tbl.setName("Regular", 2, 3, 1, 0x409)  # Subfamily
            name_tbl.setName(display, 4, 3, 1, 0x409)  # Full name
            name_tbl.setName(postscript_name or display, 6, 3, 1, 0x409)  # PS name
            font["name"] = name_tbl

            # ── OS/2 ────────────────────────────────────────────────
            os2 = newTable("OS/2")
            os2.version = 4
            os2.xAvgCharWidth = default_width
            os2.usWeightClass = 400
            os2.usWidthClass = 5
            os2.fsType = 0
            os2.ySubscriptXSize = 650
            os2.ySubscriptYSize = 600
            os2.ySubscriptXOffset = 0
            os2.ySubscriptYOffset = 75
            os2.ySuperscriptXSize = 650
            os2.ySuperscriptYSize = 600
            os2.ySuperscriptXOffset = 0
            os2.ySuperscriptYOffset = 350
            os2.yStrikeoutSize = 50
            os2.yStrikeoutPosition = 250
            os2.sFamilyClass = 0
            os2.panose = type("Panose", (), {
                "bFamilyType": 0, "bSerifStyle": 0, "bWeight": 0, "bProportion": 0,
                "bContrast": 0, "bStrokeVariation": 0, "bArmStyle": 0,
                "bLetterform": 0, "bMidline": 0, "bXHeight": 0,
            })()
            os2.ulUnicodeRange1 = 0xFFFFFFFF
            os2.ulUnicodeRange2 = 0xFFFFFFFF
            os2.ulUnicodeRange3 = 0xFFFFFFFF
            os2.ulUnicodeRange4 = 0xFFFFFFFF
            os2.achVendID = "    "
            os2.fsSelection = 0x40  # Regular
            os2.usFirstCharIndex = 0x20
            os2.usLastCharIndex = 0xFFFF
            os2.sTypoAscender = 800
            os2.sTypoDescender = -200
            os2.sTypoLineGap = 0
            os2.usWinAscent = 800
            os2.usWinDescent = 200
            os2.ulCodePageRange1 = 0xFFFFFFFF
            os2.ulCodePageRange2 = 0xFFFFFFFF
            os2.sxHeight = 500
            os2.sCapHeight = 700
            os2.usDefaultChar = 0
            os2.usBreakChar = 0x20
            os2.usMaxContext = 0
            font["OS/2"] = os2

            # ── cmap (identity glyph→unicode mapping) ───────────────
            # fontTools exposes CmapSubtable.getSubtableClass(format) in
            # current versions; older code used newSubtableClass which
            # was removed.
            from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
            cmap = newTable("cmap")
            cmap.tableVersion = 0
            try:
                sub_class = CmapSubtable.getSubtableClass(4)
            except AttributeError:
                # Fallback for very old fontTools — direct import.
                from fontTools.ttLib.tables import _c_m_a_p as cmap_mod
                sub_class = cmap_mod.cmap_format_4
            sub = sub_class()
            sub.platEncID = 1
            sub.platformID = 3
            sub.format = 4
            sub.length = 0
            sub.language = 0
            # Identity mapping: glyph index N → unicode N (skipping .notdef).
            # Sufficient for editor fallback rendering since pdf.js renders
            # the original glyphs in the bg bitmap.
            sub.cmap = {i: gn for i, gn in enumerate(glyph_order) if i > 0 and i < 0xFFFF}
            cmap.tables = [sub]
            font["cmap"] = cmap

            # ── post ────────────────────────────────────────────────
            post = newTable("post")
            post.formatType = 3.0
            post.italicAngle = 0
            post.underlinePosition = -100
            post.underlineThickness = 50
            post.isFixedPitch = 0
            post.minMemType42 = 0
            post.maxMemType42 = 0
            post.minMemType1 = 0
            post.maxMemType1 = 0
            font["post"] = post

            # ── CFF ─────────────────────────────────────────────────
            cff_table = newTable("CFF ")
            cff_table.cff = cff
            font["CFF "] = cff_table

            # Save and return
            buf = io.BytesIO()
            font.save(buf)
            return buf.getvalue()
        except Exception as exc:  # noqa: BLE001 — many possible failure points
            logger.info(
                "CFF→OTF wrap failed for '%s': %s",
                postscript_name or "unknown",
                exc,
            )
            return None

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
    def _is_cff_magic(font_file_bytes: bytes) -> bool:
        """
        CFF v1 streams start with header [versionMajor=1, versionMinor,
        hdrSize, offSize] where versionMajor must be 1 and hdrSize is
        typically 4. The first byte 0x01 alone is too loose, so we
        also require versionMinor < 16 and hdrSize >= 4.
        """
        if len(font_file_bytes) < 4:
            return False
        major = font_file_bytes[0]
        minor = font_file_bytes[1]
        hdr_size = font_file_bytes[2]
        off_size = font_file_bytes[3]
        return (
            major == 1
            and minor < 16
            and 4 <= hdr_size < 32
            and 1 <= off_size <= 4
        )

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

        # CFF: detect by magic bytes OR explicit subtype hint. Many PDFs
        # store CFF data under /Subtype /Type1 (not the spec-strict Type1C),
        # so we cannot rely on subtype alone.
        if FontExtractionService._is_cff_magic(font_file_bytes):
            return "cff"
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
