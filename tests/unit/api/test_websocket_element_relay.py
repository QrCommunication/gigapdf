"""
Unit tests for the Socket.IO element collaboration relays.

Covers app.api.websocket element:create / element:update / element:delete:
- payload is rebroadcast UNTOUCHED to the document room (client_id preserved)
- emitter is excluded (skip_sid)
- light validation: required fields + emitter must have joined the room of
  the targeted document (same pattern as document_update)
- no persistence happens here (pure relay)
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.websocket import (
    _relay_element_event,
    element_create,
    element_delete,
    element_update,
)


class _FakeSessionCtx:
    """Mimic socketio.AsyncServer.session() async context manager."""

    def __init__(self, data: dict):
        self._data = data

    async def __aenter__(self) -> dict:
        return self._data

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


def _make_fake_sio(session_data: dict) -> MagicMock:
    fake_sio = MagicMock()
    fake_sio.session = MagicMock(return_value=_FakeSessionCtx(session_data))
    fake_sio.emit = AsyncMock()
    return fake_sio


SID = "socket-emitter"
JOINED_SESSION = {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}


class TestElementRelayBroadcast:
    """Happy path: relay to room, payload untouched, emitter excluded."""

    @pytest.mark.asyncio
    async def test_create_relays_full_payload_with_skip_sid(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        payload = {
            "document_id": "doc-1",
            "element": {"id": "el-1", "type": "text", "content": "Hello"},
            "user_id": "user-1",
            "page_number": 2,
            "client_id": "client-abc",  # anti-echo marker MUST survive the relay
        }

        with patch("app.api.websocket.sio", fake_sio):
            await element_create(SID, payload)

        fake_sio.emit.assert_awaited_once_with(
            "element:create",
            payload,
            room="document:doc-1",
            skip_sid=SID,
        )
        # Payload forwarded as-is — same object content, client_id included
        relayed = fake_sio.emit.await_args.args[1]
        assert relayed["client_id"] == "client-abc"
        assert relayed["element"] == {"id": "el-1", "type": "text", "content": "Hello"}

    @pytest.mark.asyncio
    async def test_update_relays_changes_and_client_id(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        payload = {
            "document_id": "doc-1",
            "element_id": "el-1",
            "changes": {"bounds": {"x": 10, "y": 20}},
            "user_id": "user-1",
            "client_id": "client-abc",
        }

        with patch("app.api.websocket.sio", fake_sio):
            await element_update(SID, payload)

        fake_sio.emit.assert_awaited_once_with(
            "element:update",
            payload,
            room="document:doc-1",
            skip_sid=SID,
        )

    @pytest.mark.asyncio
    async def test_delete_relays_element_id(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        payload = {
            "document_id": "doc-1",
            "element_id": "el-1",
            "user_id": "user-1",
            "client_id": "client-abc",
        }

        with patch("app.api.websocket.sio", fake_sio):
            await element_delete(SID, payload)

        fake_sio.emit.assert_awaited_once_with(
            "element:delete",
            payload,
            room="document:doc-1",
            skip_sid=SID,
        )


class TestElementRelayValidation:
    """Light validation: drop (no relay) instead of raising."""

    @pytest.mark.asyncio
    async def test_emitter_not_joined_any_document_is_dropped(self):
        fake_sio = _make_fake_sio({"user_id": "user-1", "document_id": None})
        payload = {"document_id": "doc-1", "element": {"id": "el-1"}, "user_id": "user-1"}

        with patch("app.api.websocket.sio", fake_sio):
            await element_create(SID, payload)

        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_document_mismatch_is_dropped(self):
        """Emitter joined doc-1 but targets doc-2 → must NOT relay cross-room."""
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))  # joined doc-1
        payload = {"document_id": "doc-2", "element": {"id": "el-1"}, "user_id": "user-1"}

        with patch("app.api.websocket.sio", fake_sio):
            await element_create(SID, payload)

        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_missing_document_id_is_dropped(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))

        with patch("app.api.websocket.sio", fake_sio):
            await element_create(SID, {"element": {"id": "el-1"}, "user_id": "user-1"})

        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_update_without_element_id_is_dropped(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))

        with patch("app.api.websocket.sio", fake_sio):
            await element_update(
                SID, {"document_id": "doc-1", "changes": {}, "user_id": "user-1"}
            )

        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_non_dict_payload_is_dropped_without_raising(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))

        with patch("app.api.websocket.sio", fake_sio):
            await _relay_element_event("element:create", SID, "not-a-dict")  # type: ignore[arg-type]

        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_internal_error_is_swallowed(self):
        """Relay must never crash the socket server (same pattern as document_update)."""
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        fake_sio.emit = AsyncMock(side_effect=RuntimeError("redis down"))
        payload = {"document_id": "doc-1", "element": {"id": "el-1"}, "user_id": "user-1"}

        with patch("app.api.websocket.sio", fake_sio):
            # Must not raise
            await element_create(SID, payload)
