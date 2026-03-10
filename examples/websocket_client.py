"""
Example WebSocket collaboration client for Giga-PDF.

This example demonstrates how to connect to the Giga-PDF collaboration
server and interact with other users in real-time.

Usage:
    python examples/websocket_client.py --document-id <uuid> --token <jwt>
"""

import argparse
import asyncio
import logging
from datetime import datetime

import socketio

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class CollaborationClient:
    """
    WebSocket collaboration client for Giga-PDF.

    Handles real-time collaboration including user presence,
    element locking, cursor tracking, and document updates.
    """

    def __init__(self, server_url: str, document_id: str, auth_token: str):
        """
        Initialize collaboration client.

        Args:
            server_url: WebSocket server URL (e.g., http://localhost:8000/ws).
            document_id: Document UUID to collaborate on.
            auth_token: JWT authentication token.
        """
        self.server_url = server_url
        self.document_id = document_id
        self.auth_token = auth_token
        self.sio = socketio.AsyncClient(logger=True, engineio_logger=True)
        self.session_id = None
        self.user_color = None
        self.active_users = {}
        self.locked_elements = set()

        self.setup_event_handlers()

    def setup_event_handlers(self):
        """Set up Socket.IO event handlers."""

        @self.sio.on("connect")
        async def on_connect():
            """Handle connection to server."""
            logger.info("Connected to collaboration server")
            await self.join_document()

        @self.sio.on("disconnect")
        async def on_disconnect():
            """Handle disconnection from server."""
            logger.info("Disconnected from collaboration server")
            self.active_users.clear()
            self.locked_elements.clear()

        @self.sio.on("user:joined")
        async def on_user_joined(data):
            """Handle user joining the document."""
            user_id = data["user_id"]
            user_name = data["user_name"]
            user_color = data["user_color"]

            self.active_users[user_id] = {
                "name": user_name,
                "color": user_color,
            }

            logger.info(
                f"User joined: {user_name} ({user_id}) with color {user_color}"
            )

        @self.sio.on("user:left")
        async def on_user_left(data):
            """Handle user leaving the document."""
            user_id = data["user_id"]
            user_name = data["user_name"]

            if user_id in self.active_users:
                del self.active_users[user_id]

            logger.info(f"User left: {user_name} ({user_id})")

        @self.sio.on("element:locked")
        async def on_element_locked(data):
            """Handle element being locked by another user."""
            element_id = data["element_id"]
            locked_by = data["locked_by_user_name"]
            expires_at = data["expires_at"]

            self.locked_elements.add(element_id)

            logger.info(
                f"Element {element_id} locked by {locked_by} until {expires_at}"
            )

        @self.sio.on("element:unlocked")
        async def on_element_unlocked(data):
            """Handle element being unlocked."""
            element_id = data["element_id"]

            self.locked_elements.discard(element_id)

            logger.info(f"Element {element_id} unlocked")

        @self.sio.on("cursor:moved")
        async def on_cursor_moved(data):
            """Handle cursor movement from another user."""
            user_id = data["user_id"]
            user_name = data["user_name"]
            page = data["page"]
            x = data["x"]
            y = data["y"]

            logger.debug(
                f"Cursor from {user_name}: page {page}, position ({x:.1f}, {y:.1f})"
            )

        @self.sio.on("document:updated")
        async def on_document_updated(data):
            """Handle document update from another user."""
            user_name = data["user_name"]
            update_type = data["update_type"]
            affected_elements = data.get("affected_elements", [])
            affected_pages = data.get("affected_pages", [])

            logger.info(
                f"Document updated by {user_name}: {update_type} "
                f"(elements: {len(affected_elements)}, pages: {affected_pages})"
            )

    async def connect(self):
        """Connect to the WebSocket server."""
        logger.info(f"Connecting to {self.server_url}...")

        await self.sio.connect(
            self.server_url,
            auth={"token": self.auth_token},
            transports=["websocket", "polling"],
        )

    async def join_document(self):
        """Join the document collaboration room."""
        logger.info(f"Joining document {self.document_id}...")

        response = await self.sio.call(
            "join_document",
            {"document_id": self.document_id},
            timeout=10,
        )

        if response.get("success"):
            self.session_id = response["session"]["session_id"]
            self.user_color = response["session"]["user_color"]

            logger.info(f"Joined document successfully!")
            logger.info(f"Session ID: {self.session_id}")
            logger.info(f"Your color: {self.user_color}")

            # Log active users
            active_users = response.get("active_users", [])
            if active_users:
                logger.info(f"Active users ({len(active_users)}):")
                for user in active_users:
                    logger.info(
                        f"  - {user['user_name']} ({user['user_id']}) "
                        f"with color {user['user_color']}"
                    )
                    self.active_users[user["user_id"]] = {
                        "name": user["user_name"],
                        "color": user["user_color"],
                    }
            else:
                logger.info("You are the first user in this document")

            # Log active locks
            active_locks = response.get("active_locks", [])
            if active_locks:
                logger.info(f"Active locks ({len(active_locks)}):")
                for lock in active_locks:
                    logger.info(
                        f"  - Element {lock['element_id']} "
                        f"locked by {lock['locked_by_user_id']}"
                    )
                    self.locked_elements.add(lock["element_id"])
        else:
            error = response.get("error", "Unknown error")
            logger.error(f"Failed to join document: {error}")

    async def leave_document(self):
        """Leave the document collaboration room."""
        logger.info("Leaving document...")

        response = await self.sio.call("leave_document", {}, timeout=5)

        if response.get("success"):
            logger.info("Left document successfully")
            self.active_users.clear()
            self.locked_elements.clear()
        else:
            error = response.get("error", "Unknown error")
            logger.error(f"Failed to leave document: {error}")

    async def lock_element(self, element_id: str) -> bool:
        """
        Lock an element for editing.

        Args:
            element_id: Element UUID to lock.

        Returns:
            bool: True if lock acquired, False otherwise.
        """
        logger.info(f"Locking element {element_id}...")

        response = await self.sio.call(
            "element:lock",
            {"element_id": element_id},
            timeout=5,
        )

        if response.get("success"):
            logger.info(
                f"Element locked until {response['lock']['expires_at']}"
            )
            self.locked_elements.add(element_id)
            return True
        else:
            error = response.get("error", "Unknown error")
            locked_by = response.get("locked_by")
            expires_at = response.get("expires_at")

            logger.warning(
                f"Failed to lock element: {error} "
                f"(locked by {locked_by} until {expires_at})"
            )
            return False

    async def unlock_element(self, element_id: str):
        """
        Unlock an element.

        Args:
            element_id: Element UUID to unlock.
        """
        logger.info(f"Unlocking element {element_id}...")

        response = await self.sio.call(
            "element:unlock",
            {"element_id": element_id},
            timeout=5,
        )

        if response.get("success"):
            logger.info("Element unlocked successfully")
            self.locked_elements.discard(element_id)
        else:
            error = response.get("error", "Unknown error")
            logger.warning(f"Failed to unlock element: {error}")

    async def move_cursor(self, page: int, x: float, y: float):
        """
        Broadcast cursor position.

        Args:
            page: Current page number.
            x: X coordinate.
            y: Y coordinate.
        """
        await self.sio.emit(
            "cursor:move",
            {"page": page, "x": x, "y": y},
        )

        logger.debug(f"Cursor moved to page {page}, position ({x}, {y})")

    async def broadcast_update(
        self,
        update_type: str,
        affected_elements: list[str],
        affected_pages: list[int],
        data: dict,
    ):
        """
        Broadcast a document update.

        Args:
            update_type: Type of update (e.g., 'element_modified').
            affected_elements: List of affected element UUIDs.
            affected_pages: List of affected page numbers.
            data: Additional update data.
        """
        await self.sio.emit(
            "document:update",
            {
                "update_type": update_type,
                "affected_elements": affected_elements,
                "affected_pages": affected_pages,
                "timestamp": datetime.utcnow().isoformat(),
                "data": data,
            },
        )

        logger.info(
            f"Broadcast update: {update_type} "
            f"(elements: {len(affected_elements)}, pages: {affected_pages})"
        )

    async def disconnect(self):
        """Disconnect from the server."""
        logger.info("Disconnecting...")
        await self.sio.disconnect()

    async def wait(self):
        """Wait for the client to disconnect."""
        await self.sio.wait()


async def main():
    """Main entry point for the example client."""
    parser = argparse.ArgumentParser(
        description="Giga-PDF WebSocket Collaboration Client"
    )
    parser.add_argument(
        "--server-url",
        default="http://localhost:8000/ws",
        help="WebSocket server URL (default: http://localhost:8000/ws)",
    )
    parser.add_argument(
        "--document-id",
        required=True,
        help="Document UUID to collaborate on",
    )
    parser.add_argument(
        "--token",
        required=True,
        help="JWT authentication token",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run demo interactions (lock, move cursor, etc.)",
    )

    args = parser.parse_args()

    # Create client
    client = CollaborationClient(
        server_url=args.server_url,
        document_id=args.document_id,
        auth_token=args.token,
    )

    try:
        # Connect to server
        await client.connect()

        if args.demo:
            # Run demo interactions
            logger.info("\n=== Running demo interactions ===\n")

            # Move cursor around
            logger.info("Moving cursor...")
            for i in range(5):
                await client.move_cursor(1, 100 + i * 10, 200 + i * 10)
                await asyncio.sleep(1)

            # Try to lock an element
            logger.info("\nTrying to lock element...")
            test_element_id = "test-element-uuid"
            locked = await client.lock_element(test_element_id)

            if locked:
                # Broadcast an update
                logger.info("\nBroadcasting update...")
                await client.broadcast_update(
                    update_type="element_modified",
                    affected_elements=[test_element_id],
                    affected_pages=[1],
                    data={
                        "element_id": test_element_id,
                        "property": "text",
                        "value": "Updated text from demo",
                    },
                )

                await asyncio.sleep(2)

                # Unlock the element
                await client.unlock_element(test_element_id)

            logger.info("\n=== Demo complete ===\n")
            logger.info("Press Ctrl+C to exit")

        # Wait for disconnect
        await client.wait()

    except KeyboardInterrupt:
        logger.info("\nReceived interrupt, cleaning up...")
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
