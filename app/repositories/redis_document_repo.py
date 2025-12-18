"""
Redis-based Document Session Repository.

Stores document sessions in Redis for multi-worker support.
Uses a local LRU cache to avoid constant Redis roundtrips.
"""

import asyncio
import base64
import json
import logging
import threading
from collections import OrderedDict
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any, Optional

import fitz  # PyMuPDF
import redis.asyncio as redis

from app.core.cache import get_redis
from app.core.parser import parse_document
from app.models.document import DocumentObject
from app.models.history import HistoryEntry, HistoryState
from app.repositories.document_repo import DocumentSession
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)


class RedisDocumentSessionManager:
    """
    Redis-backed document session manager with local LRU cache.

    Stores session data in Redis for cross-worker access while
    maintaining a local cache for performance.
    """

    # Redis key prefixes
    PDF_PREFIX = "doc:pdf"
    GRAPH_PREFIX = "doc:graph"
    META_PREFIX = "doc:meta"

    # Default TTL: 2 hours
    DEFAULT_TTL = 7200

    def __init__(
        self,
        max_local_sessions: int = 50,
        session_timeout_minutes: int = 120,
    ):
        """
        Initialize Redis session manager.

        Args:
            max_local_sessions: Max sessions in local LRU cache.
            session_timeout_minutes: Session timeout in minutes.
        """
        self._local_cache: OrderedDict[str, DocumentSession] = OrderedDict()
        self._lock = threading.RLock()
        self.max_local_sessions = max_local_sessions
        self.session_timeout_minutes = session_timeout_minutes
        self._redis: Optional[redis.Redis] = None

    async def _get_redis(self) -> redis.Redis:
        """Get Redis client."""
        if self._redis is None:
            self._redis = await get_redis()
        return self._redis

    def _pdf_key(self, document_id: str) -> str:
        """Generate Redis key for PDF data."""
        return f"{self.PDF_PREFIX}:{document_id}"

    def _graph_key(self, document_id: str) -> str:
        """Generate Redis key for scene graph."""
        return f"{self.GRAPH_PREFIX}:{document_id}"

    def _meta_key(self, document_id: str) -> str:
        """Generate Redis key for metadata."""
        return f"{self.META_PREFIX}:{document_id}"

    def _serialize_history(self, history: HistoryState) -> dict:
        """Serialize history state to dict."""
        return {
            "current_index": history.current_index,
            "max_history_size": history.max_history_size,
            "history": [
                {
                    "index": e.index,
                    "action": e.action,
                    "timestamp": e.timestamp.isoformat(),
                    "can_undo": e.can_undo,
                    "can_redo": e.can_redo,
                    "affected_elements": e.affected_elements,
                    "affected_pages": e.affected_pages,
                }
                for e in history.history
            ],
        }

    def _deserialize_history(self, data: dict) -> HistoryState:
        """Deserialize history state from dict."""
        history = HistoryState(
            current_index=data.get("current_index", -1),
            max_history_size=data.get("max_history_size", 100),
        )
        for e in data.get("history", []):
            history.history.append(
                HistoryEntry(
                    index=e["index"],
                    action=e["action"],
                    timestamp=datetime.fromisoformat(e["timestamp"]),
                    can_undo=e.get("can_undo", True),
                    can_redo=e.get("can_redo", False),
                    affected_elements=e.get("affected_elements", []),
                    affected_pages=e.get("affected_pages", []),
                )
            )
        return history

    async def create_session(
        self,
        document_id: str,
        pdf_doc: fitz.Document,
        scene_graph: DocumentObject,
        owner_id: Optional[str] = None,
        filename: Optional[str] = None,
        file_size: int = 0,
        pdf_bytes: Optional[bytes] = None,
    ) -> DocumentSession:
        """
        Create a new document session and store in Redis.

        Args:
            document_id: Unique document identifier.
            pdf_doc: PyMuPDF document.
            scene_graph: Parsed document representation.
            owner_id: Owner user ID.
            filename: Original filename.
            file_size: File size in bytes.
            pdf_bytes: Raw PDF bytes (required for Redis storage).

        Returns:
            DocumentSession: Created session.
        """
        redis_client = await self._get_redis()
        ttl = self.session_timeout_minutes * 60

        # Get PDF bytes if not provided
        if pdf_bytes is None:
            # Save current document to bytes
            pdf_bytes = pdf_doc.tobytes()

        # Create session object
        session = DocumentSession(
            document_id=document_id,
            pdf_doc=pdf_doc,
            scene_graph=scene_graph,
            owner_id=owner_id,
            original_filename=filename,
            file_size_bytes=file_size,
        )

        # Add initial history entry
        session.history.history.append(
            HistoryEntry(
                index=0,
                action="Document opened",
                timestamp=now_utc(),
                can_undo=False,
                can_redo=False,
            )
        )
        session.history.current_index = 0

        # Store in Redis
        try:
            pipe = redis_client.pipeline()

            # Store PDF bytes
            pipe.setex(self._pdf_key(document_id), ttl, pdf_bytes)

            # Store scene graph as JSON
            graph_json = scene_graph.model_dump_json()
            pipe.setex(self._graph_key(document_id), ttl, graph_json)

            # Store metadata
            meta = {
                "owner_id": owner_id,
                "filename": filename,
                "file_size": file_size,
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed.isoformat(),
                "locks": session.locks,
                "history": self._serialize_history(session.history),
            }
            pipe.setex(self._meta_key(document_id), ttl, json.dumps(meta))

            await pipe.execute()
            logger.info(f"Created Redis session for document {document_id}")

        except Exception as e:
            logger.error(f"Failed to store session in Redis: {e}")
            raise

        # Add to local cache
        with self._lock:
            self._add_to_local_cache(document_id, session)

        return session

    def _add_to_local_cache(self, document_id: str, session: DocumentSession) -> None:
        """Add session to local LRU cache."""
        # Remove oldest if at capacity
        while len(self._local_cache) >= self.max_local_sessions:
            oldest_id, oldest_session = self._local_cache.popitem(last=False)
            try:
                oldest_session.pdf_doc.close()
            except Exception:
                pass
            logger.debug(f"Evicted session {oldest_id} from local cache")

        self._local_cache[document_id] = session
        # Move to end (most recently used)
        self._local_cache.move_to_end(document_id)

    async def get_session(self, document_id: str) -> Optional[DocumentSession]:
        """
        Get session, checking local cache first then Redis.

        Args:
            document_id: Document identifier.

        Returns:
            Optional[DocumentSession]: Session if found.
        """
        # Check local cache first
        with self._lock:
            if document_id in self._local_cache:
                session = self._local_cache[document_id]
                session.touch()
                self._local_cache.move_to_end(document_id)
                logger.debug(f"Local cache hit for {document_id}")
                return session

        # Load from Redis
        return await self._load_from_redis(document_id)

    async def _load_from_redis(self, document_id: str) -> Optional[DocumentSession]:
        """Load session from Redis and cache locally."""
        redis_client = await self._get_redis()

        try:
            # Get all data from Redis
            pipe = redis_client.pipeline()
            pipe.get(self._pdf_key(document_id))
            pipe.get(self._graph_key(document_id))
            pipe.get(self._meta_key(document_id))
            results = await pipe.execute()

            pdf_bytes, graph_json, meta_json = results

            if not pdf_bytes or not graph_json:
                logger.debug(f"Session {document_id} not found in Redis")
                return None

            # Rebuild session
            # Open PDF from bytes
            pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")

            # Parse scene graph
            scene_graph = DocumentObject.model_validate_json(graph_json)

            # Parse metadata
            meta = json.loads(meta_json) if meta_json else {}

            # Create session
            session = DocumentSession(
                document_id=document_id,
                pdf_doc=pdf_doc,
                scene_graph=scene_graph,
                owner_id=meta.get("owner_id"),
                original_filename=meta.get("filename"),
                file_size_bytes=meta.get("file_size", 0),
                locks=meta.get("locks", {}),
            )

            # Restore history
            if "history" in meta:
                session.history = self._deserialize_history(meta["history"])

            # Restore timestamps
            if "created_at" in meta:
                session.created_at = datetime.fromisoformat(meta["created_at"])
            if "last_accessed" in meta:
                session.last_accessed = datetime.fromisoformat(meta["last_accessed"])

            session.touch()

            # Update last_accessed in Redis
            await self._update_metadata(document_id, session)

            # Add to local cache
            with self._lock:
                self._add_to_local_cache(document_id, session)

            logger.info(f"Loaded session {document_id} from Redis")
            return session

        except Exception as e:
            logger.error(f"Error loading session from Redis: {e}")
            return None

    async def _update_metadata(self, document_id: str, session: DocumentSession) -> None:
        """Update session metadata in Redis."""
        redis_client = await self._get_redis()
        ttl = self.session_timeout_minutes * 60

        try:
            meta = {
                "owner_id": session.owner_id,
                "filename": session.original_filename,
                "file_size": session.file_size_bytes,
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed.isoformat(),
                "locks": session.locks,
                "history": self._serialize_history(session.history),
            }
            await redis_client.setex(
                self._meta_key(document_id),
                ttl,
                json.dumps(meta),
            )
        except Exception as e:
            logger.warning(f"Failed to update metadata in Redis: {e}")

    async def save_session(self, document_id: str) -> bool:
        """
        Save current session state to Redis.

        Call this after modifications to persist changes.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if saved successfully.
        """
        with self._lock:
            session = self._local_cache.get(document_id)
            if not session:
                return False

        redis_client = await self._get_redis()
        ttl = self.session_timeout_minutes * 60

        try:
            pipe = redis_client.pipeline()

            # Save PDF bytes (in case of modifications)
            pdf_bytes = session.pdf_doc.tobytes()
            pipe.setex(self._pdf_key(document_id), ttl, pdf_bytes)

            # Save scene graph
            graph_json = session.scene_graph.model_dump_json()
            pipe.setex(self._graph_key(document_id), ttl, graph_json)

            # Save metadata
            meta = {
                "owner_id": session.owner_id,
                "filename": session.original_filename,
                "file_size": session.file_size_bytes,
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed.isoformat(),
                "locks": session.locks,
                "history": self._serialize_history(session.history),
            }
            pipe.setex(self._meta_key(document_id), ttl, json.dumps(meta))

            await pipe.execute()
            logger.debug(f"Saved session {document_id} to Redis")
            return True

        except Exception as e:
            logger.error(f"Failed to save session to Redis: {e}")
            return False

    def get_session_required(self, document_id: str) -> DocumentSession:
        """
        Get session synchronously or raise error.

        Note: This only checks local cache. For full support,
        use async get_session().

        Args:
            document_id: Document identifier.

        Returns:
            DocumentSession: The session.

        Raises:
            KeyError: If session not found in local cache.
        """
        with self._lock:
            if document_id in self._local_cache:
                session = self._local_cache[document_id]
                session.touch()
                self._local_cache.move_to_end(document_id)
                return session

        raise KeyError(f"Document session not found: {document_id}")

    async def get_session_required_async(self, document_id: str) -> DocumentSession:
        """
        Get session asynchronously or raise error.

        Args:
            document_id: Document identifier.

        Returns:
            DocumentSession: The session.

        Raises:
            KeyError: If session not found.
        """
        session = await self.get_session(document_id)
        if not session:
            raise KeyError(f"Document session not found: {document_id}")
        return session

    async def delete_session(self, document_id: str) -> bool:
        """
        Delete a session from Redis and local cache.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if deleted.
        """
        # Remove from local cache
        with self._lock:
            session = self._local_cache.pop(document_id, None)
            if session:
                try:
                    session.pdf_doc.close()
                except Exception:
                    pass

        # Remove from Redis
        redis_client = await self._get_redis()
        try:
            await redis_client.delete(
                self._pdf_key(document_id),
                self._graph_key(document_id),
                self._meta_key(document_id),
            )
            logger.info(f"Deleted session {document_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete session from Redis: {e}")
            return False

    async def session_exists(self, document_id: str) -> bool:
        """Check if session exists in local cache or Redis."""
        with self._lock:
            if document_id in self._local_cache:
                return True

        redis_client = await self._get_redis()
        try:
            exists = await redis_client.exists(self._pdf_key(document_id))
            return bool(exists)
        except Exception:
            return False

    def list_sessions(self, owner_id: Optional[str] = None) -> list[dict[str, Any]]:
        """
        List sessions from local cache.

        Note: This only returns locally cached sessions.
        For complete list, scan Redis.

        Args:
            owner_id: Filter by owner (None for all).

        Returns:
            list: Session summaries.
        """
        with self._lock:
            sessions = []
            for doc_id, session in self._local_cache.items():
                if owner_id and session.owner_id != owner_id:
                    continue
                sessions.append({
                    "document_id": doc_id,
                    "filename": session.original_filename,
                    "page_count": session.scene_graph.metadata.page_count,
                    "created_at": session.created_at.isoformat(),
                    "last_accessed": session.last_accessed.isoformat(),
                    "owner_id": session.owner_id,
                })
            return sessions

    def push_history(
        self,
        document_id: str,
        action: str,
        affected_elements: Optional[list[str]] = None,
        affected_pages: Optional[list[int]] = None,
    ) -> None:
        """
        Push a new history entry.

        Args:
            document_id: Document identifier.
            action: Action description.
            affected_elements: List of affected element IDs.
            affected_pages: List of affected page numbers.
        """
        session = self.get_session_required(document_id)

        with self._lock:
            history = session.history

            # Truncate redo history
            history.history = history.history[: history.current_index + 1]

            # Add new entry
            entry = HistoryEntry(
                index=len(history.history),
                action=action,
                timestamp=now_utc(),
                can_undo=True,
                can_redo=False,
                affected_elements=affected_elements or [],
                affected_pages=affected_pages or [],
            )
            history.history.append(entry)
            history.current_index = len(history.history) - 1

            # Update previous entry's can_redo
            if len(history.history) > 1:
                history.history[-2].can_redo = True

            # Trim history if too long
            if len(history.history) > history.max_history_size:
                history.history.pop(0)
                history.current_index -= 1

    async def clear_all(self) -> None:
        """Close all local sessions and optionally clear Redis."""
        with self._lock:
            for doc_id in list(self._local_cache.keys()):
                session = self._local_cache.pop(doc_id, None)
                if session:
                    try:
                        session.pdf_doc.close()
                    except Exception:
                        pass

        logger.info("Cleared all local document sessions")

    async def extend_session_ttl(self, document_id: str) -> bool:
        """Extend the TTL of a session in Redis."""
        redis_client = await self._get_redis()
        ttl = self.session_timeout_minutes * 60

        try:
            pipe = redis_client.pipeline()
            pipe.expire(self._pdf_key(document_id), ttl)
            pipe.expire(self._graph_key(document_id), ttl)
            pipe.expire(self._meta_key(document_id), ttl)
            await pipe.execute()
            return True
        except Exception as e:
            logger.warning(f"Failed to extend session TTL: {e}")
            return False


# Global Redis session manager instance
redis_document_sessions: Optional[RedisDocumentSessionManager] = None


def get_redis_document_sessions() -> RedisDocumentSessionManager:
    """Get or create the global Redis session manager."""
    global redis_document_sessions
    if redis_document_sessions is None:
        redis_document_sessions = RedisDocumentSessionManager()
    return redis_document_sessions
