"""Unit tests for the best-effort content extraction service.

Verifies the MIME dispatch (PDF text layer / image OCR / skip) and the
"never raises" contract — extraction is an enhancement, not a precondition for
a successful import.
"""

from __future__ import annotations

from app.services import content_extraction_service as ce

# A minimal one-page PDF with a visible text run ("Hello World") in its
# content stream (mirrors tests/conftest.py::sample_pdf_bytes).
_PDF_BYTES = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R
   /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF"""


class TestFormatPredicates:
    def test_is_pdf_by_mime(self):
        assert ce.is_pdf("application/pdf") is True

    def test_is_pdf_by_magic(self):
        assert ce.is_pdf(None, b"%PDF-1.7 ...") is True

    def test_is_pdf_false_for_image(self):
        assert ce.is_pdf("image/png", b"\x89PNG") is False

    def test_is_image(self):
        assert ce.is_image("image/png") is True
        assert ce.is_image("image/webp") is True
        assert ce.is_image("application/pdf") is False
        assert ce.is_image(None) is False


class TestExtractText:
    def test_empty_bytes_returns_empty(self):
        assert ce.extract_text(b"", "application/pdf") == ""

    def test_office_mime_is_skipped(self):
        # Office is converted to PDF upstream; not handled here → empty.
        docx_mime = (
            "application/vnd.openxmlformats-officedocument."
            "wordprocessingml.document"
        )
        assert ce.extract_text(b"PK\x03\x04stuff", docx_mime) == ""

    def test_pdf_text_layer_is_extracted(self):
        text = ce.extract_text(_PDF_BYTES, "application/pdf")
        assert "Hello World" in text

    def test_pdf_dispatch_by_magic_without_mime(self):
        text = ce.extract_text(_PDF_BYTES, None)
        assert "Hello World" in text

    def test_corrupt_pdf_never_raises(self):
        # Not a real PDF body → pdfplumber fails internally → empty string.
        assert ce.extract_text(b"%PDF-1.4\nnot-a-real-pdf", "application/pdf") == ""

    def test_corrupt_image_never_raises(self):
        assert ce.extract_text(b"\x89PNGnot-a-real-image", "image/png") == ""
