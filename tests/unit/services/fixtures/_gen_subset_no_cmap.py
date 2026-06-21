"""
Regenerate the `subset_no_cmap_font.pdf` test fixture.

Builds a real Type0/CIDFontType2 PDF whose embedded subset TrueType program
deliberately LACKS a `cmap` table — the exact shape of the failing
"KWVFOU+TimesNewRoman,Bold" / "ECYBWA+TimesNewRoman" subset fonts that the
browser rejects with:

    OTS parsing error: cmap: missing required table

The PDF uses Identity-H encoding, /CIDToGIDMap /Identity and a /ToUnicode CMap
(CID == GID → Unicode) so FontExtractionService can synthesise a valid cmap.

Run from the repo root:
    python tests/unit/services/fixtures/_gen_subset_no_cmap.py

Requires a system DejaVuSans.ttf (Debian/Ubuntu: fonts-dejavu-core). The
committed fixture is tiny (~5 KB); regenerate only if the repair logic or the
fixture shape changes.
"""

from __future__ import annotations

import glob
import io
from pathlib import Path

import pikepdf
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

from app.services.font_extraction_service import FontExtractionService

OUT = Path(__file__).parent / "subset_no_cmap_font.pdf"
TEXT = "Hello World"
FONT_NAME = "/KWVFOU+TimesNewRoman,Bold"


def _find_source_ttf() -> str:
    matches = glob.glob("/usr/share/fonts/**/DejaVuSans.ttf", recursive=True)
    if not matches:
        matches = glob.glob("/usr/share/fonts/**/*.ttf", recursive=True)
    if not matches:
        raise SystemExit("No system TTF found to build the fixture.")
    return matches[0]


def main() -> None:
    src = _find_source_ttf()
    font = TTFont(src)
    opt = Options()
    opt.glyph_names = True
    opt.notdef_outline = True
    ss = Subsetter(options=opt)
    ss.populate(text=TEXT)
    ss.subset(font)
    # Strip cmap → simulate the broken subset the browser rejects.
    if "cmap" in font:
        del font["cmap"]
    buf = io.BytesIO()
    font.save(buf)
    font_program = buf.getvalue()

    glyph_order = font.getGlyphOrder()
    entries: list[tuple[int, int]] = []
    for gid, gname in enumerate(glyph_order):
        if gid == 0:
            continue
        cp = FontExtractionService._glyph_name_to_unicode(gname)
        if cp is not None:
            entries.append((gid, cp))

    bfchars = "".join(f"<{gid:04X}> <{cp:04X}>\n" for gid, cp in entries)
    to_unicode = (
        "/CIDInit /ProcSet findresource begin\n"
        "12 dict begin\nbegincmap\n"
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
        "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        f"{len(entries)} beginbfchar\n{bfchars}endbfchar\n"
        "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
    ).encode("latin-1")

    pdf = pikepdf.Pdf.new()
    font_file = pdf.make_stream(font_program)
    font_file.Length1 = len(font_program)

    descriptor = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.FontDescriptor,
            FontName=pikepdf.Name(FONT_NAME),
            Flags=4,
            FontBBox=[0, -200, 1000, 800],
            ItalicAngle=0,
            Ascent=800,
            Descent=-200,
            CapHeight=700,
            StemV=80,
            FontFile2=font_file,
        )
    )
    cid_font = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.CIDFontType2,
            BaseFont=pikepdf.Name(FONT_NAME),
            CIDSystemInfo=pikepdf.Dictionary(
                Registry="Adobe", Ordering="Identity", Supplement=0
            ),
            FontDescriptor=descriptor,
            CIDToGIDMap=pikepdf.Name.Identity,
            DW=500,
        )
    )
    type0 = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.Type0,
            BaseFont=pikepdf.Name(FONT_NAME),
            Encoding=pikepdf.Name("/Identity-H"),
            DescendantFonts=[cid_font],
            ToUnicode=pdf.make_stream(to_unicode),
        )
    )
    page = pdf.add_blank_page(page_size=(300, 200))
    page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=type0))
    page.Contents = pdf.make_stream(
        b"BT /F1 24 Tf 20 100 Td <0001000200030004> Tj ET"
    )
    pdf.save(OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(entries)} cmap entries)")


if __name__ == "__main__":
    main()
