"""
Pytest configuration and fixtures.

Provides shared fixtures for testing the Giga-PDF API.
"""

import io
import os
from typing import Generator

import pytest
from fastapi.testclient import TestClient

# Set test environment before importing app
os.environ["APP_ENV"] = "testing"
os.environ["APP_DEBUG"] = "true"
os.environ["APP_SECRET_KEY"] = "test-secret-key-minimum-32-characters-long"


@pytest.fixture(scope="session")
def app():
    """Create application for testing."""
    from app.main import create_application
    return create_application()


@pytest.fixture(scope="function")
def client(app) -> Generator[TestClient, None, None]:
    """Create test client."""
    with TestClient(app) as client:
        yield client


@pytest.fixture
def sample_pdf_bytes() -> bytes:
    """Create a minimal valid PDF for testing."""
    # Minimal PDF structure
    pdf_content = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
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
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000206 00000 n
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF"""
    return pdf_content


@pytest.fixture
def sample_pdf_file(sample_pdf_bytes) -> io.BytesIO:
    """Create a file-like object from sample PDF."""
    return io.BytesIO(sample_pdf_bytes)


@pytest.fixture
def auth_headers() -> dict:
    """Create mock authorization headers."""
    # In a real test, this would be a valid JWT
    return {"Authorization": "Bearer test-token"}


@pytest.fixture(autouse=True)
def cleanup_sessions():
    """Clean up document sessions after each test."""
    yield
    # Cleanup
    from app.repositories.document_repo import document_sessions
    document_sessions.clear_all()
