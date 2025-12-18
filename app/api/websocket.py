"""
WebSocket collaboration endpoints for Giga-PDF.

Provides real-time collaboration features including:
- User presence tracking
- Element locking/unlocking
- Cursor position broadcasting
- Document update notifications
"""

import logging
from typing import Any, Optional

import socketio
from fastapi import HTTPException

from app.config import get_settings
from app.middleware.auth import decode_jwt_token
from app.services.collaboration_service import collaboration_manager

logger = logging.getLogger(__name__)

# Create Socket.IO server
settings = get_settings()

# Configure Redis client manager with TLS support if needed
def get_redis_manager():
    """Create Redis manager with proper TLS configuration.

    Follows redis-py SSL connection pattern:
    https://redis.readthedocs.io/en/stable/examples/ssl_connection_examples.html
    """
    redis_url = settings.socketio_message_queue

    # Check if URL has ssl_ca_certs parameter (needs special handling)
    if "ssl_ca_certs=" in redis_url:
        from urllib.parse import urlparse, parse_qs

        # Parse URL and extract ssl_ca_certs
        parsed = urlparse(redis_url)
        query_params = parse_qs(parsed.query)
        ca_certs = query_params.get("ssl_ca_certs", [None])[0]

        # Rebuild URL without query params
        clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

        # Pass SSL options via redis_options as per python-socketio docs
        # https://github.com/miguelgrinberg/python-socketio/issues/318
        return socketio.AsyncRedisManager(
            clean_url,
            redis_options={
                "ssl_cert_reqs": "required",
                "ssl_ca_certs": ca_certs,
            }
        )
    else:
        return socketio.AsyncRedisManager(redis_url)

try:
    client_manager = get_redis_manager()
    logger.info("Socket.IO Redis manager initialized")
except Exception as e:
    logger.warning(f"Failed to create Redis manager: {e}. Using in-memory mode.")
    client_manager = None

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*" if settings.is_development else [],
    logger=settings.app_debug,
    engineio_logger=settings.app_debug,
    client_manager=client_manager,
)

# Create ASGI app
# Mounted at "/" in FastAPI with socketio_path="/socket.io"
# See: https://github.com/fastapi/fastapi/issues/3666
sio_app = socketio.ASGIApp(
    socketio_server=sio,
    socketio_path="/socket.io",
)


# Helper functions
async def get_user_from_auth(auth_data: dict) -> Optional[dict]:
    """
    Extract and validate user from authentication data.

    Args:
        auth_data: Authentication data from client.

    Returns:
        dict: User information with user_id and user_name.

    Raises:
        HTTPException: If authentication fails.
    """
    token = auth_data.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    try:
        # Verify JWT token
        payload = await decode_jwt_token(token)
        return {
            "user_id": payload.get("sub", payload.get("user_id", "anonymous")),
            "user_name": payload.get("name", payload.get("email", "Unknown User")),
        }
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication token")


async def get_document_room(document_id: str) -> str:
    """
    Get Socket.IO room name for a document.

    Args:
        document_id: Document identifier.

    Returns:
        str: Room name.
    """
    return f"document:{document_id}"


# Event handlers
@sio.event
async def connect(sid: str, environ: dict, auth: dict) -> bool:
    """
    Handle client connection.

    Args:
        sid: Socket ID.
        environ: ASGI environment.
        auth: Authentication data.

    Returns:
        bool: True to accept connection, False to reject.
    """
    try:
        # Validate authentication
        user = await get_user_from_auth(auth)

        logger.info(
            f"WebSocket connection from user {user['user_id']} (socket: {sid})"
        )

        # Store user info in session
        async with sio.session(sid) as session:
            session["user_id"] = user["user_id"]
            session["user_name"] = user["user_name"]

        return True

    except Exception as e:
        logger.error(f"Connection rejected for {sid}: {e}")
        return False


@sio.event
async def disconnect(sid: str):
    """
    Handle client disconnection.

    Cleans up collaboration session and releases locks.

    Args:
        sid: Socket ID.
    """
    try:
        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            document_id = session.get("document_id")

        if not document_id:
            logger.info(f"Socket {sid} disconnected (no active document)")
            return

        # Remove collaboration session
        collab_session = await collaboration_manager.remove_session(sid)

        if collab_session:
            # Notify other users
            room = await get_document_room(document_id)
            await sio.emit(
                "user:left",
                {
                    "user_id": collab_session.user_id,
                    "user_name": collab_session.user_name,
                    "timestamp": collab_session.last_seen_at.isoformat(),
                },
                room=room,
                skip_sid=sid,
            )

            logger.info(
                f"User {user_id} left document {document_id} (socket: {sid})"
            )

    except Exception as e:
        logger.error(f"Error handling disconnect for {sid}: {e}")


@sio.event
async def join_document(sid: str, data: dict) -> dict:
    """
    Join a document collaboration room.

    Args:
        sid: Socket ID.
        data: Event data containing document_id.

    Returns:
        dict: Response with session info and active users.
    """
    try:
        document_id = data.get("document_id")
        if not document_id:
            return {
                "success": False,
                "error": "Missing document_id",
            }

        # Get user from session
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")
            session["document_id"] = document_id

        if not user_id:
            return {
                "success": False,
                "error": "Not authenticated",
            }

        # Create collaboration session
        collab_session = await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name=user_name,
            socket_id=sid,
        )

        # Join Socket.IO room
        room = await get_document_room(document_id)
        sio.enter_room(sid, room)

        # Get other active users
        active_users = await collaboration_manager.get_active_users(document_id)

        # Get active locks
        active_locks = await collaboration_manager.get_document_locks(document_id)

        # Notify other users
        await sio.emit(
            "user:joined",
            {
                "user_id": collab_session.user_id,
                "user_name": collab_session.user_name,
                "user_color": collab_session.user_color,
                "timestamp": collab_session.joined_at.isoformat(),
            },
            room=room,
            skip_sid=sid,
        )

        logger.info(
            f"User {user_id} joined document {document_id} (socket: {sid})"
        )

        return {
            "success": True,
            "session": {
                "session_id": collab_session.id,
                "user_color": collab_session.user_color,
            },
            "active_users": [
                {
                    "user_id": u.user_id,
                    "user_name": u.user_name,
                    "user_color": u.user_color,
                    "cursor_page": u.cursor_page,
                    "cursor_x": u.cursor_x,
                    "cursor_y": u.cursor_y,
                }
                for u in active_users
                if u.socket_id != sid
            ],
            "active_locks": [
                {
                    "element_id": lock.element_id,
                    "locked_by_user_id": lock.locked_by_user_id,
                    "expires_at": lock.expires_at.isoformat(),
                }
                for lock in active_locks
            ],
        }

    except Exception as e:
        logger.error(f"Error joining document: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def leave_document(sid: str, data: dict) -> dict:
    """
    Leave a document collaboration room.

    Args:
        sid: Socket ID.
        data: Event data.

    Returns:
        dict: Response with success status.
    """
    try:
        async with sio.session(sid) as session:
            document_id = session.get("document_id")
            if not document_id:
                return {
                    "success": False,
                    "error": "Not in a document",
                }

            session["document_id"] = None

        # Remove collaboration session
        collab_session = await collaboration_manager.remove_session(sid)

        if collab_session:
            # Leave Socket.IO room
            room = await get_document_room(document_id)
            sio.leave_room(sid, room)

            # Notify other users
            await sio.emit(
                "user:left",
                {
                    "user_id": collab_session.user_id,
                    "user_name": collab_session.user_name,
                    "timestamp": collab_session.last_seen_at.isoformat(),
                },
                room=room,
            )

            logger.info(
                f"User {collab_session.user_id} left document {document_id}"
            )

        return {"success": True}

    except Exception as e:
        logger.error(f"Error leaving document: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def element_lock(sid: str, data: dict) -> dict:
    """
    Lock an element for editing.

    Args:
        sid: Socket ID.
        data: Event data containing element_id.

    Returns:
        dict: Response with lock status.
    """
    try:
        element_id = data.get("element_id")
        if not element_id:
            return {
                "success": False,
                "error": "Missing element_id",
            }

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            document_id = session.get("document_id")

        if not document_id or not user_id:
            return {
                "success": False,
                "error": "Not in a document",
            }

        # Get collaboration session ID
        active_users = await collaboration_manager.get_active_users(document_id)
        collab_session = next(
            (u for u in active_users if u.socket_id == sid),
            None,
        )

        if not collab_session:
            return {
                "success": False,
                "error": "No active collaboration session",
            }

        # Acquire lock
        success, lock = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=collab_session.id,
        )

        if success:
            # Notify other users
            room = await get_document_room(document_id)
            await sio.emit(
                "element:locked",
                {
                    "element_id": element_id,
                    "locked_by_user_id": user_id,
                    "locked_by_user_name": collab_session.user_name,
                    "expires_at": lock.expires_at.isoformat(),
                },
                room=room,
                skip_sid=sid,
            )

            return {
                "success": True,
                "lock": {
                    "element_id": element_id,
                    "expires_at": lock.expires_at.isoformat(),
                },
            }
        else:
            # Lock held by another user
            return {
                "success": False,
                "error": "Element locked by another user",
                "locked_by": lock.locked_by_user_id if lock else None,
                "expires_at": lock.expires_at.isoformat() if lock else None,
            }

    except Exception as e:
        logger.error(f"Error locking element: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def element_unlock(sid: str, data: dict) -> dict:
    """
    Unlock an element.

    Args:
        sid: Socket ID.
        data: Event data containing element_id.

    Returns:
        dict: Response with unlock status.
    """
    try:
        element_id = data.get("element_id")
        if not element_id:
            return {
                "success": False,
                "error": "Missing element_id",
            }

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            document_id = session.get("document_id")

        if not document_id or not user_id:
            return {
                "success": False,
                "error": "Not in a document",
            }

        # Release lock
        success = await collaboration_manager.release_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
        )

        if success:
            # Notify other users
            room = await get_document_room(document_id)
            await sio.emit(
                "element:unlocked",
                {
                    "element_id": element_id,
                },
                room=room,
                skip_sid=sid,
            )

            return {"success": True}
        else:
            return {
                "success": False,
                "error": "Lock not found or not owned by user",
            }

    except Exception as e:
        logger.error(f"Error unlocking element: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def cursor_move(sid: str, data: dict) -> None:
    """
    Broadcast cursor movement.

    Args:
        sid: Socket ID.
        data: Event data containing page, x, y coordinates.
    """
    try:
        page = data.get("page")
        x = data.get("x")
        y = data.get("y")

        if page is None or x is None or y is None:
            return

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")
            document_id = session.get("document_id")

        if not document_id:
            return

        # Update cursor position in database
        await collaboration_manager.update_cursor(
            socket_id=sid,
            page=page,
            x=x,
            y=y,
        )

        # Broadcast to other users in room
        room = await get_document_room(document_id)
        await sio.emit(
            "cursor:moved",
            {
                "user_id": user_id,
                "user_name": user_name,
                "page": page,
                "x": x,
                "y": y,
            },
            room=room,
            skip_sid=sid,
        )

    except Exception as e:
        logger.error(f"Error broadcasting cursor movement: {e}")


@sio.event
async def document_update(sid: str, data: dict) -> None:
    """
    Broadcast document updates.

    Args:
        sid: Socket ID.
        data: Event data containing update information.
    """
    try:
        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")
            document_id = session.get("document_id")

        if not document_id:
            return

        # Broadcast update to other users
        room = await get_document_room(document_id)
        await sio.emit(
            "document:updated",
            {
                "user_id": user_id,
                "user_name": user_name,
                "update_type": data.get("update_type", "unknown"),
                "affected_elements": data.get("affected_elements", []),
                "affected_pages": data.get("affected_pages", []),
                "timestamp": data.get("timestamp"),
                "data": data.get("data", {}),
            },
            room=room,
            skip_sid=sid,
        )

        logger.debug(
            f"Document update broadcast from user {user_id} "
            f"on document {document_id}"
        )

    except Exception as e:
        logger.error(f"Error broadcasting document update: {e}")


# Periodic cleanup tasks
async def cleanup_task():
    """
    Periodic cleanup of expired locks and inactive sessions.

    Should be run as a background task.
    """
    import asyncio

    while True:
        try:
            # Cleanup every 5 minutes
            await asyncio.sleep(300)

            # Clean expired locks
            await collaboration_manager.cleanup_expired_locks()

            # Clean inactive sessions (60 minute timeout)
            await collaboration_manager.cleanup_inactive_sessions(timeout_minutes=60)

        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")


def get_socketio_app() -> socketio.ASGIApp:
    """
    Get the Socket.IO ASGI application.

    Returns:
        socketio.ASGIApp: Socket.IO application for mounting.
    """
    return sio_app
