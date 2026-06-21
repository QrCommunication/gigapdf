"""
Font extraction service for PDF documents.

Extracts embedded font programs from PDF files using pikepdf,
computing stable identifiers and detecting binary formats.

Subset TTFs extracted directly from PDFs (Type0/CIDFontType2 wrappers)
preserve only the minimal tables needed by pdf.js (which uses CIDToGIDMap
to drive glyph selection). Chrome's OpenType Sanitiser (OTS) is stricter:
it rejects fonts with missing cmap/name/OS-2 tables or inconsistent hmtx
side-bearings, producing runtime errors such as
  "OTS parsing error: hmtx: Failed to read side bearing"
  "OTS parsing error: cmap: missing required table"

To guarantee a browser-loadable (OTS-valid) sfnt that draws the ORIGINAL
embedded glyph outlines, every extracted font is repaired so that all
OTS-required tables are present (cmap, head, hhea, hmtx, maxp, name, OS/2,
post; glyf+loca for TrueType, CFF for CFF-OTF). The CRITICAL step is
synthesising a `cmap` when the embedded one is missing/broken, built from
the best available source on the PDF font dict — in priority order:

  1. the font's own valid cmap (kept verbatim);
  2. the simple-font /Encoding /Differences (glyph name → Unicode via the
     Adobe Glyph List), with the code used as the glyph id of the subset;
  3. the base /Encoding (WinAnsi/MacRoman/Standard) code → Unicode table;
  4. the /ToUnicode CMap (char code → Unicode), with CIDToGIDMap driving
     the glyph id for composite (Type0/CID) fonts.

The emitted cmap maps those Unicode codepoints to the correct glyph ids
(format 4 for the BMP, plus format 12 when supplementary-plane codepoints
exist) so the browser, given the run's Unicode text, selects the right
outline — making on-screen text 1:1 even when the PDF's cmap was absent.
When no Unicode mapping is recoverable we fall back to a literal
glyph-index → codepoint identity cmap (still OTS-valid and non-empty);
the editor's background bitmap then carries the visually-correct render.
"""

import base64
import hashlib
import io
import logging
import re
import struct
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import pikepdf

try:
    from fontTools.ttLib import TTFont, TTLibError  # type: ignore[import-not-found]

    _FONTTOOLS_AVAILABLE = True
except ImportError:  # pragma: no cover — runtime detection
    TTFont = None  # type: ignore[assignment,misc]
    TTLibError = Exception  # type: ignore[assignment,misc]
    _FONTTOOLS_AVAILABLE = False

try:
    # fontTools.agl maps PostScript glyph names → Unicode (named glyphs,
    # "uniXXXX", "uXXXXXX"). Used to recover a cmap from /Differences.
    from fontTools.agl import toUnicode as _agl_to_unicode  # type: ignore[import-not-found]

    _AGL_AVAILABLE = True
except ImportError:  # pragma: no cover — runtime detection
    _agl_to_unicode = None  # type: ignore[assignment,misc]
    _AGL_AVAILABLE = False

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


@dataclass
class FontDictContext:
    """
    Code→glyph mapping context recovered from the PDF font dictionary.

    Used to synthesise a browser-loadable cmap when the embedded font program
    itself lacks a usable one. All fields are optional; the cmap builder uses
    the best available source in priority order:

        1. Differences (code → glyph name)         — exact, simple fonts
        2. base_encoding (WinAnsi/MacRoman/Std)     — standard simple fonts
        3. to_unicode (char code → unicode str)     — fallback / composite
        4. cid_to_gid ("Identity" | bytes)          — Type0/CID GID resolution
    """

    is_composite: bool = False
    # Simple-font /Encoding /Differences: code (int) → glyph name (str)
    differences: dict[int, str] = field(default_factory=dict)
    # Base encoding name: "WinAnsiEncoding" | "MacRomanEncoding" |
    # "StandardEncoding" | "MacExpertEncoding" | None
    base_encoding: str | None = None
    # /ToUnicode CMap parsed: char code (int) → unicode string (str)
    to_unicode: dict[int, str] = field(default_factory=dict)
    # Type0/CID: "Identity" or a parsed CIDToGIDMap (cid:int → gid:int)
    cid_to_gid: object | None = None

    def has_mapping(self) -> bool:
        return bool(
            self.differences
            or self.base_encoding
            or self.to_unicode
            or self.cid_to_gid is not None
        )


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

        # Composite (Type0) fonts carry their encoding/glyph data in the inner
        # CIDFont; simple fonts carry it on the top-level dict.
        is_composite = subtype == "Type0"
        inner_dict: dict | None = None

        # For Type0 (composite) fonts, inspect the DescendantFonts array
        if subtype == "Type0" and not descriptor:
            descendants = font_dict.get("/DescendantFonts")
            if descendants:
                try:
                    inner = descendants[0]
                    inner_dict = dict(inner)
                    descriptor = inner_dict.get("/FontDescriptor")
                    inner_subtype = inner_dict.get("/Subtype")
                    if inner_subtype:
                        subtype = str(inner_subtype).lstrip("/")
                except Exception as exc:
                    logger.warning(
                        "Cannot unwrap Type0 DescendantFonts for '%s': %s",
                        original_name,
                        exc,
                    )

        # Recover the code→glyph mapping context from the PDF font dict so the
        # cmap can be synthesised when the embedded program lacks one.
        ctx = self._build_font_dict_context(
            font_dict, inner_dict, is_composite, original_name
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
                font_bytes, detected_format, postscript_name, ctx
            )
            if repaired is not None:
                font_bytes = repaired
        elif font_bytes and detected_format == "cff":
            # Wrap raw CFF in an OTF (sfnt) container so the browser can
            # load it as a FontFace. PDFs embed Type1C/CIDFontType0C
            # fonts as bare CFF streams in FontFile3 — Chrome OTS only
            # accepts CFF inside an OTF wrapper.
            wrapped = self._wrap_cff_as_otf(
                font_bytes, postscript_name, font_family, ctx
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

    # ------------------------------------------------------------------
    # cmap-synthesis context extraction
    # ------------------------------------------------------------------

    def _build_font_dict_context(
        self,
        font_dict: dict,
        inner_dict: dict | None,
        is_composite: bool,
        original_name: str,
    ) -> FontDictContext:
        """
        Extract the code→glyph mapping context from a PDF font dictionary.

        For simple fonts this reads /Encoding (base name + /Differences).
        For composite (Type0) fonts this reads the inner CIDFont's
        /CIDToGIDMap. In all cases it attempts to parse /ToUnicode.

        Never raises — best-effort recovery, returns a (possibly empty)
        context on any failure.
        """
        ctx = FontDictContext(is_composite=is_composite)

        try:
            # ── /Encoding (simple fonts) ──────────────────────────────
            encoding = font_dict.get("/Encoding")
            if encoding is not None:
                if isinstance(encoding, pikepdf.Name):
                    ctx.base_encoding = str(encoding).lstrip("/")
                else:
                    # Encoding dictionary: base + Differences
                    try:
                        enc_dict = dict(encoding)
                    except Exception:
                        enc_dict = {}
                    base = enc_dict.get("/BaseEncoding")
                    if base is not None:
                        ctx.base_encoding = str(base).lstrip("/")
                    diffs = enc_dict.get("/Differences")
                    if diffs is not None:
                        ctx.differences = self._parse_differences(diffs)
        except Exception as exc:  # noqa: BLE001 — best-effort recovery
            logger.debug(
                "Could not parse /Encoding for '%s': %s", original_name, exc
            )

        try:
            # ── /CIDToGIDMap (composite fonts) ────────────────────────
            if inner_dict is not None:
                c2g = inner_dict.get("/CIDToGIDMap")
                if c2g is not None:
                    if isinstance(c2g, pikepdf.Name):
                        # "/Identity" — CID == GID
                        ctx.cid_to_gid = "Identity"
                    else:
                        try:
                            raw = bytes(c2g.read_bytes())
                            ctx.cid_to_gid = self._parse_cid_to_gid(raw)
                        except Exception:
                            ctx.cid_to_gid = "Identity"
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "Could not parse /CIDToGIDMap for '%s': %s", original_name, exc
            )

        try:
            # ── /ToUnicode CMap ───────────────────────────────────────
            to_unicode = font_dict.get("/ToUnicode")
            if to_unicode is not None:
                try:
                    cmap_bytes = bytes(to_unicode.read_bytes())
                    ctx.to_unicode = self._parse_to_unicode_cmap(cmap_bytes)
                except Exception as exc:  # noqa: BLE001
                    logger.debug(
                        "Could not parse /ToUnicode for '%s': %s",
                        original_name,
                        exc,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "Could not access /ToUnicode for '%s': %s", original_name, exc
            )

        return ctx

    @staticmethod
    def _parse_differences(diffs: pikepdf.Object) -> dict[int, str]:
        """
        Parse a PDF /Differences array into {code: glyph_name}.

        The array is [int name name ... int name ...]: each integer resets
        the current code, and each subsequent name assigns the glyph at the
        current code, incrementing it. Example:
            [65 /A /B 97 /a]  →  {65:'A', 66:'B', 97:'a'}
        """
        mapping: dict[int, str] = {}
        current = 0
        try:
            for item in diffs:
                if isinstance(item, int):
                    current = item
                elif isinstance(item, pikepdf.Name):
                    mapping[current] = str(item).lstrip("/")
                    current += 1
                else:
                    # pikepdf may surface ints as Object; coerce defensively
                    try:
                        current = int(item)
                    except (TypeError, ValueError):
                        name = str(item).lstrip("/")
                        if name:
                            mapping[current] = name
                            current += 1
        except Exception:  # noqa: BLE001
            return mapping
        return mapping

    @staticmethod
    def _parse_cid_to_gid(raw: bytes) -> dict[int, int]:
        """
        Parse a binary /CIDToGIDMap stream into {cid: gid}.

        The stream is a packed array of big-endian uint16: byte pair 2*cid
        holds the GID for that CID. Zero GIDs (.notdef) are skipped.
        """
        mapping: dict[int, int] = {}
        n = len(raw) // 2
        for cid in range(n):
            gid = struct.unpack(">H", raw[cid * 2 : cid * 2 + 2])[0]
            if gid != 0:
                mapping[cid] = gid
        return mapping

    @staticmethod
    def _parse_to_unicode_cmap(cmap_bytes: bytes) -> dict[int, str]:
        """
        Parse a /ToUnicode CMap stream into {char_code: unicode_string}.

        ToUnicode CMaps are a restricted PostScript dialect with two relevant
        constructs:
            beginbfchar ... endbfchar     — <src> <dst> pairs
            beginbfrange ... endbfrange   — <lo> <hi> <dst>  (or [array])

        We parse the hex-string forms (the common case for PDF producers).
        Returns char code → decoded UTF-16BE unicode string.
        """
        text = cmap_bytes.decode("latin-1", errors="replace")
        result: dict[int, str] = {}

        def _hex_to_int(h: str) -> int:
            return int(h, 16)

        def _utf16be_hex_to_str(h: str) -> str:
            try:
                data = bytes.fromhex(h if len(h) % 2 == 0 else "0" + h)
                return data.decode("utf-16-be", errors="replace")
            except Exception:
                return ""

        # bfchar: <src> <dst>
        for block in re.findall(
            r"beginbfchar(.*?)endbfchar", text, re.DOTALL
        ):
            for src, dst in re.findall(
                r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block
            ):
                code = _hex_to_int(src)
                result[code] = _utf16be_hex_to_str(dst)

        # bfrange: <lo> <hi> <dst>  OR  <lo> <hi> [<d0> <d1> ...]
        for block in re.findall(
            r"beginbfrange(.*?)endbfrange", text, re.DOTALL
        ):
            # Array form: <lo> <hi> [ <d> <d> ... ]
            for lo, _hi, arr in re.findall(
                r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]",
                block,
                re.DOTALL,
            ):
                lo_i = _hex_to_int(lo)
                dsts = re.findall(r"<([0-9A-Fa-f]+)>", arr)
                for offset, dst in enumerate(dsts):
                    result[lo_i + offset] = _utf16be_hex_to_str(dst)
            # Scalar form: <lo> <hi> <dst>
            for lo, hi, dst in re.findall(
                r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>",
                block,
            ):
                lo_i = _hex_to_int(lo)
                hi_i = _hex_to_int(hi)
                base = _hex_to_int(dst)
                # Each successive code increments the final UTF-16 code unit.
                for offset in range(hi_i - lo_i + 1):
                    cp = base + offset
                    try:
                        result[lo_i + offset] = chr(cp)
                    except (ValueError, OverflowError):
                        continue

        return result

    @staticmethod
    def _glyph_name_to_unicode(name: str) -> int | None:
        """
        Resolve a PostScript glyph name to a Unicode codepoint.

        Uses fontTools' AGL (named glyphs, "uniXXXX", "uXXXXXX"). Returns the
        first codepoint of the mapped string, or None when unresolvable.
        """
        if not name or name == ".notdef":
            return None
        if _AGL_AVAILABLE and _agl_to_unicode is not None:
            try:
                s = _agl_to_unicode(name)
                if s:
                    return ord(s[0])
            except Exception:  # noqa: BLE001
                pass
        return None

    @staticmethod
    def _base_encoding_table(name: str | None) -> dict[int, int] | None:
        """
        Return a {code: unicode_codepoint} table for a named base encoding.

        Supports WinAnsiEncoding (cp1252), MacRomanEncoding (mac_roman) and
        StandardEncoding (Adobe). Returns None for unknown encodings.
        """
        if not name:
            return None
        table: dict[int, int] = {}
        try:
            if name == "WinAnsiEncoding":
                for code in range(256):
                    try:
                        ch = bytes([code]).decode("cp1252")
                        table[code] = ord(ch)
                    except UnicodeDecodeError:
                        continue
                return table
            if name == "MacRomanEncoding":
                for code in range(256):
                    try:
                        ch = bytes([code]).decode("mac_roman")
                        table[code] = ord(ch)
                    except UnicodeDecodeError:
                        continue
                return table
            if name == "StandardEncoding":
                try:
                    from fontTools.encodings.StandardEncoding import (
                        StandardEncoding,
                    )
                except ImportError:
                    return None
                for code, gname in enumerate(StandardEncoding):
                    if not gname or gname == ".notdef":
                        continue
                    cp = FontExtractionService._glyph_name_to_unicode(gname)
                    if cp is not None:
                        table[code] = cp
                return table
        except Exception:  # noqa: BLE001
            return None
        return None

    @classmethod
    def _build_unicode_to_glyphname(
        cls,
        ctx: "FontDictContext | None",
        glyph_order: list[str],
        existing_cmap: dict[int, str] | None,
    ) -> dict[int, str]:
        """
        Synthesise a {unicode_codepoint: glyph_name} mapping for a cmap.

        Strategy (best source first), all keyed for SIMPLE fonts by the
        single-byte code being equal to the glyph index in PDF subset
        TrueType (the embedded font's glyph order is dense and code-ordered):

          S1. existing_cmap — keep what the font already had (highest fidelity)
          S2. /Differences  — code→glyph name; code is the GID → unicode→GID
          S3. base_encoding — code→unicode; code is the GID → unicode→GID
          S4. /ToUnicode    — code→unicode; code is the GID (or via CIDToGIDMap
                              for composite fonts) → unicode→GID

        For composite (Type0) fonts the run text is Unicode and the browser
        resolves via this cmap, so we map unicode→gid using CIDToGIDMap when
        present (CID==code for Identity-H), else assume code==gid.

        The resulting glyph NAME is taken from glyph_order[gid] so fontTools
        emits a cmap that points at the real outline.
        """
        num_glyphs = len(glyph_order)

        def gid_to_name(gid: int) -> str | None:
            if 0 <= gid < num_glyphs:
                return glyph_order[gid]
            return None

        def resolve_gid(code: int) -> int | None:
            """Map a character code to a glyph id."""
            if ctx is not None and ctx.is_composite and ctx.cid_to_gid is not None:
                if isinstance(ctx.cid_to_gid, dict):
                    return ctx.cid_to_gid.get(code)
                # "Identity": CID == GID == code
                return code
            # Simple font subset: the embedded program's glyph order is the
            # subset's selection; pdf.js drives selection by code==gid for
            # these subset TTFs.
            return code

        result: dict[int, str] = {}

        # S1 — preserve the font's own valid cmap.
        if existing_cmap:
            for cp, gname in existing_cmap.items():
                if 0 <= cp < 0x110000:
                    result[cp] = gname

        # S2 — /Differences: code → glyph name → unicode, GID from code.
        if ctx is not None and ctx.differences:
            for code, gname in ctx.differences.items():
                cp = cls._glyph_name_to_unicode(gname)
                if cp is None:
                    continue
                gid = resolve_gid(code)
                if gid is None:
                    continue
                name = gid_to_name(gid)
                if name is not None:
                    result.setdefault(cp, name)

        # S3 — base encoding table: code → unicode, GID from code.
        if ctx is not None and ctx.base_encoding:
            base_tbl = cls._base_encoding_table(ctx.base_encoding)
            if base_tbl:
                for code, cp in base_tbl.items():
                    gid = resolve_gid(code)
                    if gid is None:
                        continue
                    name = gid_to_name(gid)
                    if name is not None:
                        result.setdefault(cp, name)

        # S4 — /ToUnicode: code → unicode string, GID from code/CIDToGIDMap.
        if ctx is not None and ctx.to_unicode:
            for code, ustr in ctx.to_unicode.items():
                if not ustr:
                    continue
                cp = ord(ustr[0])
                gid = resolve_gid(code)
                if gid is None:
                    continue
                name = gid_to_name(gid)
                if name is not None:
                    result.setdefault(cp, name)

        return result

    @staticmethod
    def _make_cmap_table(unicode_to_name: dict[int, str]):  # noqa: ANN205
        """
        Build a fontTools cmap table object with format 4 (BMP) plus
        format 12 (full Unicode) when supplementary-plane codepoints exist.

        Returns a newTable('cmap') ready to assign to font['cmap'], or None
        when the mapping is empty.
        """
        if not unicode_to_name:
            return None
        from fontTools.ttLib import newTable
        from fontTools.ttLib.tables import _c_m_a_p as cmap_mod

        bmp = {cp: gn for cp, gn in unicode_to_name.items() if cp <= 0xFFFF}
        has_supplementary = any(cp > 0xFFFF for cp in unicode_to_name)

        cmap = newTable("cmap")
        cmap.tableVersion = 0
        subtables = []

        # Format 4 — Windows BMP (platform 3, enc 1). Required by OTS.
        sub4 = cmap_mod.cmap_format_4(4)
        sub4.platformID = 3
        sub4.platEncID = 1
        sub4.format = 4
        sub4.language = 0
        sub4.cmap = dict(bmp)
        subtables.append(sub4)

        # Format 12 — Windows full repertoire (platform 3, enc 10).
        if has_supplementary:
            sub12 = cmap_mod.cmap_format_12(12)
            sub12.platformID = 3
            sub12.platEncID = 10
            sub12.format = 12
            sub12.reserved = 0
            sub12.language = 0
            sub12.nGroups = 0
            sub12.length = 0
            sub12.cmap = dict(unicode_to_name)
            subtables.append(sub12)

        cmap.tables = subtables
        return cmap

    # (platformID, platEncID) combos that Chrome's OpenType Sanitiser treats as
    # Unicode-capable cmap subtables. A font whose ONLY subtable is e.g. (1,0)
    # Macintosh is NOT browser-loadable for Unicode text — OTS reports
    # "cmap: no supported subtables were found" — so we must synthesise a
    # Windows-Unicode (3,1) from the PDF font dict even when a Mac subtable
    # already maps glyphs.
    _UNICODE_CMAP_KEYS = frozenset(
        {(0, 3), (0, 4), (0, 5), (0, 6), (0, 0), (3, 0), (3, 1), (3, 10)}
    )

    @staticmethod
    def _cmap_is_valid(font) -> bool:  # noqa: ANN001
        """
        Return True only when the font already has a NON-EMPTY, UNICODE-capable
        cmap subtable ((3,1)/(3,10)/(0,*)).

        A non-empty but Mac-only (1,0) subtable is treated as BROKEN so we
        synthesise a Windows-Unicode (3,1): Chrome's OTS rejects a font whose
        only cmap is (1,0) with "cmap: no supported subtables were found",
        which makes every glyph render as tofu (□ / ?) in the editor text
        overlay. A degenerate (zero-mapping) subtable is likewise rejected.
        """
        try:
            cmap = font.get("cmap")
            if cmap is None or not cmap.tables:
                return False
            for sub in cmap.tables:
                key = (
                    getattr(sub, "platformID", -1),
                    getattr(sub, "platEncID", -1),
                )
                mapping = getattr(sub, "cmap", None)
                if (
                    key in FontExtractionService._UNICODE_CMAP_KEYS
                    and mapping
                    and len(mapping) > 0
                ):
                    return True
            return False
        except Exception:  # noqa: BLE001
            return False

    @staticmethod
    def _existing_cmap_dict(font) -> dict[int, str] | None:  # noqa: ANN001
        """
        Return the merged {codepoint: glyphname} from a font's UNICODE cmap
        subtables ((3,1)/(3,10)/(0,*)), or None.

        Non-Unicode subtables (e.g. (1,0) Macintosh, which maps single-byte
        codes — NOT Unicode codepoints — to glyphs) are SKIPPED: feeding their
        byte keys to the cmap builder as if they were codepoints would mis-map
        every char >= 0x80. For a Mac-only font this returns None, so the
        builder falls back to the PDF /ToUnicode + /Differences sources (true
        Unicode) to synthesise a correct (3,1).
        """
        try:
            cmap = font.get("cmap")
            if cmap is None or not cmap.tables:
                return None
            merged: dict[int, str] = {}
            for sub in cmap.tables:
                key = (
                    getattr(sub, "platformID", -1),
                    getattr(sub, "platEncID", -1),
                )
                if key not in FontExtractionService._UNICODE_CMAP_KEYS:
                    continue
                mapping = getattr(sub, "cmap", None)
                if mapping:
                    merged.update(mapping)
            return merged or None
        except Exception:  # noqa: BLE001
            return None

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
        ctx: "FontDictContext | None" = None,
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
            hmtx.metrics = dict.fromkeys(glyph_order, (default_width, 0))
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
            # fontTools' OS2 expects a Panose object with named attributes,
            # not a duck-typed shim. Import the proper class.
            try:
                from fontTools.ttLib.tables.O_S_2f_2 import Panose
                panose = Panose()
                panose.bFamilyType = 0
                panose.bSerifStyle = 0
                panose.bWeight = 0
                panose.bProportion = 0
                panose.bContrast = 0
                panose.bStrokeVariation = 0
                panose.bArmStyle = 0
                panose.bLetterform = 0
                panose.bMidline = 0
                panose.bXHeight = 0
                os2.panose = panose
            except ImportError:
                # Old fontTools — raw bytes work as a fallback.
                os2.panose = b"\x00" * 10
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

            # ── cmap (synthesised from the PDF font dict) ───────────
            # Build a unicode→glyph cmap from the PDF font dict context
            # (/Differences, base encoding, /ToUnicode, CIDToGIDMap) so the
            # browser, given the run's Unicode text, resolves the correct
            # CFF outline. Falls back to a literal code→glyph identity map
            # (glyph index N → codepoint N) only when no Unicode mapping is
            # recoverable — that still yields an OTS-valid, non-empty cmap.
            unicode_to_name = FontExtractionService._build_unicode_to_glyphname(
                ctx, glyph_order, existing_cmap=None
            )
            cmap = FontExtractionService._make_cmap_table(unicode_to_name)
            if cmap is None:
                # Last resort: identity glyph-index → codepoint. Non-empty so
                # OTS accepts the font; the editor's bg bitmap still carries
                # the visually-correct rendering.
                identity = {
                    i: gn
                    for i, gn in enumerate(glyph_order)
                    if 0 < i < 0xFFFF
                }
                cmap = FontExtractionService._make_cmap_table(identity)
            if cmap is not None:
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
        font_bytes: bytes,
        font_format: str | None,
        postscript_name: str | None,
        ctx: "FontDictContext | None" = None,
    ) -> bytes | None:
        """
        Round-trip a font through fontTools to make it browser-OTS-compliant.

        Chrome's OpenType Sanitiser (OTS) is stricter than pdf.js. PDF subset
        TTFs typically:
        1. Truncate hmtx to skip trailing leftSideBearings (we pad with zeros)
        2. Have inconsistent table checksums (fontTools.save() regenerates)
        3. **Lack a usable cmap** (subset TrueType driven by CIDToGIDMap) —
           OTS rejects "cmap: missing required table". We SYNTHESISE one from
           the PDF font dict (/Differences, base encoding, /ToUnicode,
           CIDToGIDMap) so the browser resolves the run's Unicode text to the
           correct glyph outline.
        4. Sometimes lack OS/2, name, or post — we synthesise minimal versions
           so every OTS-required table is present.

        Returns None when the font cannot be loaded or saved; callers should
        treat None as "not embeddable in browser" (the metadata stays
        is_embedded=True so the editor can fall back to the family name).

        Args:
            font_bytes: Raw font program from the PDF FontFile* stream.
            font_format: Detected format ("ttf", "otf", "cff") — only TTF/OTF
                are repaired. CFF data needs separate handling.
            postscript_name: Used for logging and the synthesised name table.
            ctx: Code→glyph mapping context recovered from the PDF font dict,
                used to synthesise the cmap when missing.

        Returns:
            Repaired font bytes (typically larger than input due to padded
            tables, a synthesised cmap and regenerated checksums), or the
            original/padded bytes when full repair was not possible.
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

        # Step 3: guarantee all OTS-required tables, synthesising the cmap
        # from the PDF font dict context when the embedded one is missing or
        # broken.
        try:
            FontExtractionService._ensure_ots_required_tables(
                font, postscript_name, ctx
            )
        except Exception as exc:  # noqa: BLE001 — repair is best-effort
            logger.warning(
                "OTS table repair failed for font '%s': %s — "
                "saving with whatever tables exist",
                postscript_name or "unknown",
                exc,
            )

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

    @staticmethod
    def _ensure_ots_required_tables(
        font,  # noqa: ANN001 — fontTools.ttLib.TTFont
        postscript_name: str | None,
        ctx: "FontDictContext | None",
    ) -> None:
        """
        Mutate a loaded TTFont in place so every OTS-required table exists.

        OTS requires: cmap, head, hhea, hmtx, maxp, name, OS/2, post
        (TrueType also needs glyf+loca, CFF needs the CFF table — both are
        preserved untouched from the parsed font). This method focuses on the
        metadata tables that PDF subsetters routinely omit, and CRITICALLY
        synthesises a cmap when it is missing or empty.
        """
        from fontTools.ttLib import newTable

        try:
            glyph_order = list(font.getGlyphOrder())
        except Exception:  # noqa: BLE001
            glyph_order = []

        units_per_em = 1000
        try:
            if "head" in font and getattr(font["head"], "unitsPerEm", None):
                units_per_em = int(font["head"].unitsPerEm)
        except Exception:  # noqa: BLE001
            pass

        # ── cmap — the critical OTS-required table ────────────────────
        if not FontExtractionService._cmap_is_valid(font):
            existing = FontExtractionService._existing_cmap_dict(font)
            unicode_to_name = FontExtractionService._build_unicode_to_glyphname(
                ctx, glyph_order, existing_cmap=existing
            )
            new_cmap = FontExtractionService._make_cmap_table(unicode_to_name)
            if new_cmap is None and glyph_order:
                # No Unicode mapping recoverable: map literal glyph index N to
                # codepoint N (skipping .notdef). This produces an OTS-valid,
                # non-empty cmap; the editor still relies on the bg bitmap for
                # the visually-correct positioned rendering.
                identity = {
                    i: gn
                    for i, gn in enumerate(glyph_order)
                    if 0 < i < 0xFFFF
                }
                new_cmap = FontExtractionService._make_cmap_table(identity)
                logger.info(
                    "Font '%s': no Unicode mapping recoverable — emitted "
                    "identity glyph-index cmap (run text must be raw codes)",
                    postscript_name or "unknown",
                )
            else:
                logger.debug(
                    "Font '%s': synthesised cmap with %d entries",
                    postscript_name or "unknown",
                    len(unicode_to_name),
                )
            if new_cmap is not None:
                font["cmap"] = new_cmap

        # ── post — version 3.0 is OTS-acceptable and tiny ─────────────
        if "post" not in font:
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

        # ── name — minimal family/subfamily/full/PS records ───────────
        if "name" not in font:
            name_tbl = newTable("name")
            name_tbl.names = []
            display = postscript_name or "Embedded"
            name_tbl.setName(display, 1, 3, 1, 0x409)  # Family
            name_tbl.setName("Regular", 2, 3, 1, 0x409)  # Subfamily
            name_tbl.setName(display, 4, 3, 1, 0x409)  # Full name
            name_tbl.setName(display, 6, 3, 1, 0x409)  # PostScript name
            font["name"] = name_tbl

        # ── OS/2 — synthesise a minimal version 4 table if absent ─────
        if "OS/2" not in font:
            os2 = newTable("OS/2")
            os2.version = 4
            os2.xAvgCharWidth = 500
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
            try:
                from fontTools.ttLib.tables.O_S_2f_2 import Panose

                panose = Panose()
                for attr in (
                    "bFamilyType",
                    "bSerifStyle",
                    "bWeight",
                    "bProportion",
                    "bContrast",
                    "bStrokeVariation",
                    "bArmStyle",
                    "bLetterform",
                    "bMidline",
                    "bXHeight",
                ):
                    setattr(panose, attr, 0)
                os2.panose = panose
            except ImportError:  # pragma: no cover
                os2.panose = b"\x00" * 10
            os2.ulUnicodeRange1 = 0xFFFFFFFF
            os2.ulUnicodeRange2 = 0xFFFFFFFF
            os2.ulUnicodeRange3 = 0xFFFFFFFF
            os2.ulUnicodeRange4 = 0xFFFFFFFF
            os2.achVendID = "    "
            os2.fsSelection = 0x40  # Regular
            os2.usFirstCharIndex = 0x20
            os2.usLastCharIndex = 0xFFFF
            os2.sTypoAscender = int(0.8 * units_per_em)
            os2.sTypoDescender = int(-0.2 * units_per_em)
            os2.sTypoLineGap = 0
            os2.usWinAscent = int(0.8 * units_per_em)
            os2.usWinDescent = int(0.2 * units_per_em)
            os2.ulCodePageRange1 = 0xFFFFFFFF
            os2.ulCodePageRange2 = 0xFFFFFFFF
            os2.sxHeight = int(0.5 * units_per_em)
            os2.sCapHeight = int(0.7 * units_per_em)
            os2.usDefaultChar = 0
            os2.usBreakChar = 0x20
            os2.usMaxContext = 0
            font["OS/2"] = os2

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
