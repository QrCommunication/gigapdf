"""
Integration tests for the font extraction endpoints.

Routes under test:
  GET /api/v1/pdf/fonts/{document_id}           → list fonts (metadata)
  GET /api/v1/pdf/fonts/{document_id}/{font_id} → font binary (base64)

Strategy
--------
- ``get_current_user`` is overridden via app.dependency_overrides so that no
  real JWT is needed.
- ``get_document_session`` is overridden to inject a synthetic DocumentSession
  holding a real minimal embedded-font PDF.
- Redis is fully mocked: both get and set are no-ops so tests remain fast and
  isolated.
- The feature-flag is toggled per-test via Settings override.
"""

from __future__ import annotations

import io
import json
import struct
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pikepdf
import pytest
from fastapi.testclient import TestClient

from app.middleware.auth import CurrentUser, get_current_user

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

TEST_USER_ID = "test-user-fonts-00000000-0000-0000-0000-000000001234"
OWNER_USER_ID = "owner-fonts-00000000-0000-0000-0000-000000009999"
TEST_DOCUMENT_ID = "doc-fonts-00000000-0000-0000-0000-000000001234"

_FAKE_USER = CurrentUser(user_id=TEST_USER_ID, email="user@example.com")
_OWNER_USER = CurrentUser(user_id=OWNER_USER_ID, email="owner@example.com")

# Minimal TTF magic — enough for FontExtractionService.detect_format to return "ttf"
_FAKE_TTF = struct.pack(">IHHHH", 0x00010000, 0, 0, 0, 0) + b"\x00" * 500


def _build_embedded_font_pdf() -> bytes:
    """Return bytes of a minimal PDF with one embedded TrueType font."""
    pdf = pikepdf.Pdf.new()

    font_file_stream = pikepdf.Stream(pdf, _FAKE_TTF)
    font_file_stream.stream_dict["/Length1"] = len(_FAKE_TTF)

    font_descriptor = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name("/FontDescriptor"),
        FontName=pikepdf.Name("/ABCDEF+TestSans"),
        Flags=32,
        ItalicAngle=0,
        Ascent=900,
        Descent=-200,
        CapHeight=700,
        XHeight=500,
        StemV=80,
        FontBBox=[-100, -200, 1000, 900],
        FontFile2=font_file_stream,
    ))

    font_obj = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name("/Font"),
        Subtype=pikepdf.Name("/TrueType"),
        BaseFont=pikepdf.Name("/ABCDEF+TestSans"),
        Encoding=pikepdf.Name("/WinAnsiEncoding"),
        FontDescriptor=font_descriptor,
    ))

    resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font_obj))
    contents = pikepdf.Stream(pdf, b"BT /F1 12 Tf 100 700 Td (Test) Tj ET")

    page = pikepdf.Page(pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name("/Page"),
        MediaBox=[0, 0, 612, 792],
        Resources=resources,
        Contents=contents,
    )))
    pdf.pages.append(page)

    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def _make_fake_session(owner_id: str | None = TEST_USER_ID) -> MagicMock:
    """Return a DocumentSession mock that returns an embedded-font PDF."""
    pdf_bytes = _build_embedded_font_pdf()

    session = MagicMock()
    session.document_id = TEST_DOCUMENT_ID
    session.owner_id = owner_id
    session.pdf_doc.tobytes.return_value = pdf_bytes
    return session


# ---------------------------------------------------------------------------
# Redis mock — all cache reads miss, all writes are no-ops
# ---------------------------------------------------------------------------


def _mock_redis_miss() -> MagicMock:
    redis = AsyncMock()
    redis.get.return_value = None          # always cache miss
    redis.setex.return_value = True
    return redis


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


class TestFontsEndpoints:
    """Integration tests for GET /api/v1/pdf/fonts/... endpoints."""

    @pytest.fixture(autouse=True)
    def _reset_overrides(self, app):
        """Ensure dependency overrides are cleaned after each test."""
        yield
        app.dependency_overrides.clear()

    @pytest.fixture()
    def client_as_owner(self, app) -> TestClient:
        """Client authenticated as the document owner (TEST_USER_ID)."""
        app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
        return TestClient(app)

    @pytest.fixture()
    def client_no_auth(self, app) -> TestClient:
        """Client with no authentication override (raw request)."""
        return TestClient(app, raise_server_exceptions=True)

    # -----------------------------------------------------------------------
    # Auth guard
    # -----------------------------------------------------------------------

    def test_list_fonts_requires_auth(self, client_no_auth: TestClient) -> None:
        """Endpoint must return 401 when no Authorization header is provided."""
        response = client_no_auth.get(
            f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}"
        )
        assert response.status_code == 401

    # -----------------------------------------------------------------------
    # Ownership guard
    # -----------------------------------------------------------------------

    def test_list_fonts_requires_ownership(self, app) -> None:
        """Returns 403 when authenticated user is not the document owner."""
        different_user = CurrentUser(user_id="intruder-000", email="evil@example.com")
        session = _make_fake_session(owner_id=OWNER_USER_ID)  # owner != intruder

        from app.dependencies import get_document_session

        app.dependency_overrides[get_current_user] = lambda: different_user
        app.dependency_overrides[get_document_session] = lambda: session

        with (
            patch("app.api.v1.fonts.get_redis", return_value=_mock_redis_miss()),
            patch("app.config.get_settings") as mock_settings,
        ):
            mock_settings.return_value.font_extraction_enabled = True
            client = TestClient(app)
            response = client.get(f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}")

        assert response.status_code == 403

    # -----------------------------------------------------------------------
    # List endpoint — happy path
    # -----------------------------------------------------------------------

    def test_list_fonts_returns_metadata(self, app) -> None:
        """GET list endpoint returns font metadata list with correct structure."""
        session = _make_fake_session()

        from app.dependencies import get_document_session

        app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
        app.dependency_overrides[get_document_session] = lambda: session

        redis_mock = _mock_redis_miss()

        with patch("app.api.v1.fonts.get_redis", new=AsyncMock(return_value=redis_mock)):
            client = TestClient(app)
            response = client.get(f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True

        data = body["data"]
        assert data["document_id"] == TEST_DOCUMENT_ID
        assert isinstance(data["fonts"], list)
        assert data["total"] == len(data["fonts"])
        assert data["total"] >= 1

        font = data["fonts"][0]
        required_keys = {
            "font_id", "original_name", "subtype",
            "is_embedded", "is_subset",
        }
        assert required_keys.issubset(font.keys()), (
            f"Missing keys in font metadata: {required_keys - font.keys()}"
        )

    # -----------------------------------------------------------------------
    # Font data endpoint — happy path
    # -----------------------------------------------------------------------

    def test_get_font_data_returns_base64(self, app) -> None:
        """GET data endpoint returns base64-encoded binary for an embedded font."""
        import base64

        session = _make_fake_session()

        from app.dependencies import get_document_session
        from app.services.font_extraction_service import font_extraction_service

        # Extract fonts to know the real font_id
        pdf_bytes = session.pdf_doc.tobytes()
        fonts = font_extraction_service.extract_fonts(pdf_bytes)
        embedded = [f for f in fonts if f.data is not None]
        assert embedded, "Test fixture must contain at least one embedded font"

        font_id = embedded[0].metadata.font_id

        app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
        app.dependency_overrides[get_document_session] = lambda: session

        redis_mock = _mock_redis_miss()

        with patch("app.api.v1.fonts.get_redis", new=AsyncMock(return_value=redis_mock)):
            client = TestClient(app)
            response = client.get(
                f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}/{font_id}"
            )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True

        data = body["data"]
        assert data["font_id"] == font_id
        assert data["format"] in ("ttf", "otf", "cff")
        assert data["mime_type"].startswith("font/")
        # Validate base64 is decodable and non-empty
        decoded = base64.b64decode(data["data_base64"])
        assert len(decoded) > 0

    # -----------------------------------------------------------------------
    # Font data endpoint — 404 for unknown font_id
    # -----------------------------------------------------------------------

    def test_get_font_data_404_if_not_found(self, app) -> None:
        """GET data endpoint returns 404 for a font_id not present in the PDF."""
        session = _make_fake_session()

        from app.dependencies import get_document_session

        app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
        app.dependency_overrides[get_document_session] = lambda: session

        redis_mock = _mock_redis_miss()

        with patch("app.api.v1.fonts.get_redis", new=AsyncMock(return_value=redis_mock)):
            client = TestClient(app)
            response = client.get(
                f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}/nonexistentfontid1234"
            )

        assert response.status_code == 404

    # -----------------------------------------------------------------------
    # Feature flag
    # -----------------------------------------------------------------------

    def test_feature_flag_disabled_returns_503(self, app) -> None:
        """Both endpoints return 503 when font_extraction_enabled=False."""
        session = _make_fake_session()

        from app.dependencies import get_document_session

        app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
        app.dependency_overrides[get_document_session] = lambda: session

        with patch("app.api.v1.fonts.get_settings") as mock_get_settings:
            fake_settings = MagicMock()
            fake_settings.font_extraction_enabled = False
            mock_get_settings.return_value = fake_settings

            client = TestClient(app)

            resp_list = client.get(f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}")
            assert resp_list.status_code == 503

            resp_data = client.get(
                f"/api/v1/pdf/fonts/{TEST_DOCUMENT_ID}/somefontid00000"
            )
            assert resp_data.status_code == 503
