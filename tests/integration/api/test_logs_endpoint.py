"""
Integration tests for POST /api/v1/logs (frontend log ingestion).

The endpoint mirrors the payload produced by @giga-pdf/logger RemoteTransport
(packages/logger/src/transports/remote.ts):

    { "logs": [LogEntry...], "clientInfo": {userAgent, url, timestamp} }

Covered:
- nominal anonymous batch (the transport sends no Authorization header)
- envelope validation (empty batch, batch > 100, unknown level)
- message truncation to 2000 chars (anti-PII / anti-flood)
- re-emission under the Python "frontend" logger with mapped levels
"""

import logging

import pytest
from fastapi.testclient import TestClient

from app.api.v1.logs import MAX_BATCH_SIZE, MAX_MESSAGE_LENGTH


def _entry(level: str = "error", message: str = "Something broke", **overrides) -> dict:
    """Build a LogEntry payload as RemoteTransport would send it."""
    entry = {
        "timestamp": "2026-06-13T10:30:00.000Z",
        "level": level,
        "message": message,
    }
    entry.update(overrides)
    return entry


def _payload(entries: list[dict], with_client_info: bool = True) -> dict:
    payload: dict = {"logs": entries}
    if with_client_info:
        payload["clientInfo"] = {
            "userAgent": "Mozilla/5.0 (X11; Linux x86_64) TestRunner",
            "url": "https://giga-pdf.com/editor/doc-test",
            "timestamp": "2026-06-13T10:30:01.000Z",
        }
    return payload


@pytest.fixture(scope="module")
def api_client():
    """TestClient scoped to module to avoid re-creating the app per test."""
    import os
    os.environ.setdefault("APP_ENV", "testing")
    os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-minimum-32-characters-long")

    from app.main import create_application
    application = create_application()
    with TestClient(application, raise_server_exceptions=False) as c:
        yield c


class TestLogsIngestNominal:
    """Nominal ingestion paths."""

    def test_anonymous_batch_is_accepted(self, api_client):
        """The RemoteTransport sends no auth header — anonymous must be accepted."""
        response = api_client.post(
            "/api/v1/logs",
            json=_payload([_entry(), _entry(level="warn", message="Slow render")]),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["success"] is True
        assert body["data"]["accepted"] == 2
        assert body["meta"]["request_id"] is not None

    def test_client_info_is_optional(self, api_client):
        """clientInfo is best-effort browser metadata — absence must not fail."""
        response = api_client.post(
            "/api/v1/logs",
            json=_payload([_entry()], with_client_info=False),
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"]["accepted"] == 1

    def test_full_log_entry_shape_is_accepted(self, api_client):
        """All optional LogEntry fields (context/data/error/performance) parse."""
        entry = _entry(
            context={"requestId": "req-1", "userId": "user-1", "documentId": "doc-1"},
            data={"page": 3, "tool": "highlight"},
            error={"name": "RenderError", "message": "Canvas lost", "stack": "at x"},
            performance={
                "operation": "render-page",
                "duration": 123.4,
                "startTime": 1.0,
                "endTime": 124.4,
            },
        )

        response = api_client.post("/api/v1/logs", json=_payload([entry]))

        assert response.status_code == 200, response.text
        assert response.json()["data"]["accepted"] == 1


class TestLogsIngestValidation:
    """Envelope validation (Pydantic, strict)."""

    def test_empty_batch_is_rejected(self, api_client):
        response = api_client.post("/api/v1/logs", json={"logs": []})
        assert response.status_code == 422

    def test_batch_over_limit_is_rejected(self, api_client):
        entries = [_entry(message=f"entry {i}") for i in range(MAX_BATCH_SIZE + 1)]
        response = api_client.post("/api/v1/logs", json=_payload(entries))
        assert response.status_code == 422

    def test_unknown_level_is_rejected(self, api_client):
        response = api_client.post(
            "/api/v1/logs",
            json=_payload([_entry(level="critical")]),  # not a frontend LogLevel
        )
        assert response.status_code == 422

    def test_missing_message_is_rejected(self, api_client):
        entry = {"timestamp": "2026-06-13T10:30:00.000Z", "level": "info"}
        response = api_client.post("/api/v1/logs", json={"logs": [entry]})
        assert response.status_code == 422


class TestLogsReemission:
    """Entries must be re-emitted under the 'frontend' Python logger."""

    def test_entries_reach_frontend_logger_with_mapped_level(self, api_client, caplog):
        with caplog.at_level(logging.DEBUG, logger="frontend"):
            response = api_client.post(
                "/api/v1/logs",
                json=_payload([
                    _entry(level="warn", message="warn-marker-xyz"),
                    _entry(level="fatal", message="fatal-marker-xyz"),
                ]),
            )

        assert response.status_code == 200, response.text

        frontend_records = [r for r in caplog.records if r.name == "frontend"]
        messages = [r.getMessage() for r in frontend_records]
        assert any("warn-marker-xyz" in m for m in messages)
        assert any("fatal-marker-xyz" in m for m in messages)

        # Level mapping: warn → WARNING, fatal → CRITICAL
        by_marker = {
            "warn-marker-xyz": logging.WARNING,
            "fatal-marker-xyz": logging.CRITICAL,
        }
        for record in frontend_records:
            for marker, expected_level in by_marker.items():
                if marker in record.getMessage():
                    assert record.levelno == expected_level

    def test_long_message_is_truncated(self, api_client, caplog):
        """Anti-PII / anti-flood: messages are capped at 2000 chars."""
        long_message = "A" * (MAX_MESSAGE_LENGTH * 3)

        with caplog.at_level(logging.DEBUG, logger="frontend"):
            response = api_client.post(
                "/api/v1/logs",
                json=_payload([_entry(level="error", message=long_message)]),
            )

        assert response.status_code == 200, response.text

        frontend_records = [r for r in caplog.records if r.name == "frontend"]
        assert frontend_records, "Expected at least one re-emitted frontend record"
        emitted = frontend_records[-1].getMessage()
        # "[frontend] " prefix + truncated message (+ possible suffix) stays bounded
        assert len(emitted) < MAX_MESSAGE_LENGTH + 600
        assert "…" in emitted  # truncation marker
