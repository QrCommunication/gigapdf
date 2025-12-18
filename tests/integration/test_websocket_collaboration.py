"""
Integration tests for WebSocket collaboration system.

Tests real-time collaboration features including:
- User presence tracking
- Element locking
- Cursor broadcasting
- Document updates
"""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import socketio
from sqlalchemy import select

from app.models.database import CollaborationSession, ElementLock
from app.services.collaboration_service import collaboration_manager


class TestCollaborationManager:
    """Test CollaborationManager service."""

    @pytest.mark.asyncio
    async def test_create_session(self, db_session):
        """Test creating a new collaboration session."""
        document_id = str(uuid4())
        user_id = "user-123"
        user_name = "John Doe"
        socket_id = "socket-abc"

        # Create session
        session = await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name=user_name,
            socket_id=socket_id,
        )

        assert session is not None
        assert session.document_id == document_id
        assert session.user_id == user_id
        assert session.user_name == user_name
        assert session.socket_id == socket_id
        assert session.is_active is True
        assert session.user_color.startswith("#")

    @pytest.mark.asyncio
    async def test_create_session_reactivates_existing(self, db_session):
        """Test that creating a session reactivates an existing one."""
        document_id = str(uuid4())
        user_id = "user-123"
        user_name = "John Doe"
        socket_id_1 = "socket-abc"
        socket_id_2 = "socket-xyz"

        # Create first session
        session1 = await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name=user_name,
            socket_id=socket_id_1,
        )

        # Create second session with same user
        session2 = await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name=user_name,
            socket_id=socket_id_2,
        )

        # Should reuse the same session
        assert session1.id == session2.id
        assert session2.socket_id == socket_id_2

    @pytest.mark.asyncio
    async def test_remove_session(self, db_session):
        """Test removing a collaboration session."""
        document_id = str(uuid4())
        user_id = "user-123"
        socket_id = "socket-abc"

        # Create session
        session = await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name="John Doe",
            socket_id=socket_id,
        )

        # Remove session
        removed = await collaboration_manager.remove_session(socket_id)

        assert removed is not None
        assert removed.id == session.id
        assert removed.is_active is False

    @pytest.mark.asyncio
    async def test_get_active_users(self, db_session):
        """Test getting active users for a document."""
        document_id = str(uuid4())

        # Create multiple sessions
        await collaboration_manager.create_session(
            document_id=document_id,
            user_id="user-1",
            user_name="User 1",
            socket_id="socket-1",
        )

        await collaboration_manager.create_session(
            document_id=document_id,
            user_id="user-2",
            user_name="User 2",
            socket_id="socket-2",
        )

        # Get active users
        users = await collaboration_manager.get_active_users(document_id)

        assert len(users) == 2
        assert all(u.is_active for u in users)
        assert {u.user_id for u in users} == {"user-1", "user-2"}

    @pytest.mark.asyncio
    async def test_acquire_lock_success(self, db_session):
        """Test acquiring a lock on an element."""
        document_id = str(uuid4())
        element_id = str(uuid4())
        user_id = "user-123"
        session_id = str(uuid4())

        # Acquire lock
        success, lock = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=session_id,
        )

        assert success is True
        assert lock is not None
        assert lock.element_id == element_id
        assert lock.locked_by_user_id == user_id

    @pytest.mark.asyncio
    async def test_acquire_lock_already_locked(self, db_session):
        """Test acquiring a lock when element is already locked."""
        document_id = str(uuid4())
        element_id = str(uuid4())
        user1_id = "user-1"
        user2_id = "user-2"
        session1_id = str(uuid4())
        session2_id = str(uuid4())

        # User 1 acquires lock
        success1, lock1 = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user1_id,
            session_id=session1_id,
        )

        # User 2 tries to acquire same lock
        success2, lock2 = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user2_id,
            session_id=session2_id,
        )

        assert success1 is True
        assert success2 is False
        assert lock2.locked_by_user_id == user1_id

    @pytest.mark.asyncio
    async def test_acquire_lock_extends_own_lock(self, db_session):
        """Test that acquiring an owned lock extends it."""
        document_id = str(uuid4())
        element_id = str(uuid4())
        user_id = "user-123"
        session_id = str(uuid4())

        # Acquire lock first time
        success1, lock1 = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=session_id,
            duration_seconds=60,
        )

        expires_at_1 = lock1.expires_at

        # Wait a bit
        await asyncio.sleep(1)

        # Acquire lock again (should extend)
        success2, lock2 = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=session_id,
            duration_seconds=60,
        )

        assert success2 is True
        assert lock2.expires_at > expires_at_1

    @pytest.mark.asyncio
    async def test_release_lock(self, db_session):
        """Test releasing a lock."""
        document_id = str(uuid4())
        element_id = str(uuid4())
        user_id = "user-123"
        session_id = str(uuid4())

        # Acquire lock
        await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=session_id,
        )

        # Release lock
        released = await collaboration_manager.release_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
        )

        assert released is True

    @pytest.mark.asyncio
    async def test_get_document_locks(self, db_session):
        """Test getting all locks for a document."""
        document_id = str(uuid4())
        element1_id = str(uuid4())
        element2_id = str(uuid4())
        user_id = "user-123"
        session_id = str(uuid4())

        # Create multiple locks
        await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element1_id,
            user_id=user_id,
            session_id=session_id,
        )

        await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element2_id,
            user_id=user_id,
            session_id=session_id,
        )

        # Get locks
        locks = await collaboration_manager.get_document_locks(document_id)

        assert len(locks) == 2
        assert {lock.element_id for lock in locks} == {element1_id, element2_id}

    @pytest.mark.asyncio
    async def test_cleanup_expired_locks(self, db_session):
        """Test cleaning up expired locks."""
        document_id = str(uuid4())
        element_id = str(uuid4())
        user_id = "user-123"
        session_id = str(uuid4())

        # Create lock with very short duration
        await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=session_id,
            duration_seconds=1,
        )

        # Wait for expiration
        await asyncio.sleep(2)

        # Cleanup
        count = await collaboration_manager.cleanup_expired_locks()

        assert count >= 1

        # Verify lock is gone
        locks = await collaboration_manager.get_document_locks(document_id)
        assert len(locks) == 0

    @pytest.mark.asyncio
    async def test_user_color_assignment(self, db_session):
        """Test that users get different colors."""
        document_id = str(uuid4())

        # Create multiple sessions
        sessions = []
        for i in range(5):
            session = await collaboration_manager.create_session(
                document_id=document_id,
                user_id=f"user-{i}",
                user_name=f"User {i}",
                socket_id=f"socket-{i}",
            )
            sessions.append(session)

        # All colors should be different (for the first 12 users)
        colors = [s.user_color for s in sessions]
        assert len(set(colors)) == len(colors)  # All unique

    @pytest.mark.asyncio
    async def test_update_cursor(self, db_session):
        """Test updating cursor position."""
        document_id = str(uuid4())
        user_id = "user-123"
        socket_id = "socket-abc"

        # Create session
        await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name="John Doe",
            socket_id=socket_id,
        )

        # Update cursor
        updated = await collaboration_manager.update_cursor(
            socket_id=socket_id,
            page=2,
            x=150.5,
            y=300.8,
        )

        assert updated is not None
        assert updated.cursor_page == 2
        assert updated.cursor_x == 150.5
        assert updated.cursor_y == 300.8


@pytest.fixture
async def db_session():
    """Provide a database session for tests."""
    from app.core.database import get_db_session

    async with get_db_session() as session:
        yield session


@pytest.fixture
def mock_socket_io():
    """Mock Socket.IO server for testing."""
    mock = MagicMock(spec=socketio.AsyncServer)
    mock.emit = AsyncMock()
    mock.enter_room = MagicMock()
    mock.leave_room = MagicMock()
    return mock


class TestWebSocketEvents:
    """Test WebSocket event handlers."""

    @pytest.mark.asyncio
    async def test_connect_with_valid_token(self, mock_socket_io):
        """Test connecting with a valid JWT token."""
        with patch("app.api.websocket.decode_jwt_token") as mock_decode:
            mock_decode.return_value = {
                "sub": "user-123",
                "name": "John Doe",
            }

            from app.api.websocket import sio

            # Mock connection
            auth = {"token": "valid-jwt-token"}
            result = await sio.handlers["/"]["connect"](
                "socket-123",
                {},
                auth,
            )

            assert result is True

    @pytest.mark.asyncio
    async def test_connect_with_invalid_token(self, mock_socket_io):
        """Test connecting with an invalid token."""
        with patch("app.api.websocket.decode_jwt_token") as mock_decode:
            mock_decode.side_effect = Exception("Invalid token")

            from app.api.websocket import sio

            # Mock connection
            auth = {"token": "invalid-token"}
            result = await sio.handlers["/"]["connect"](
                "socket-123",
                {},
                auth,
            )

            assert result is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
