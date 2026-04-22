"""
Document Session Repository - Hybrid in-memory + Redis session management.

Manages active document editing sessions with PDF byte blobs
and their parsed scene graph representations. Uses Redis for
cross-worker persistence.

# NOTE: PyMuPDF (fitz) has been removed. The `pdf_doc` field now accepts any
# object that exposes `.tobytes() -> bytes`, `.page_count: int`, and
# `.is_encrypted: bool`. Use `LegacyDocumentProxy` from app.core.pdf_engine
# or pass raw bytes wrapped in a simple object.
#
# All real PDF operations are handled by @giga-pdf/pdf-engine (TypeScript).
"""

import asyncio
import json
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

# fitz (PyMuPDF) removed — replaced by LegacyDocumentProxy / pikepdf

from app.models.document import DocumentObject
from app.models.history import DocumentSnapshot, HistoryEntry, HistoryState
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


@dataclass
class DocumentSession:
    """
    Active document editing session.

    Holds a PDF document handle (LegacyDocumentProxy or any object with
    .tobytes()/.page_count/.is_encrypted), the parsed scene graph,
    and editing history.

    NOTE: `pdf_doc` is typed as Any to avoid importing fitz. During the
    migration period it holds a LegacyDocumentProxy instance from
    app.core.pdf_engine. After full migration it will hold raw bytes or
    a pikepdf.Pdf handle.
    """

    document_id: str
    pdf_doc: Any  # LegacyDocumentProxy | pikepdf.Pdf | bytes-wrapper
    scene_graph: DocumentObject
    history: HistoryState = field(default_factory=HistoryState)
    locks: dict[str, str] = field(default_factory=dict)  # element_id -> user_id
    created_at: datetime = field(default_factory=now_utc)
    last_accessed: datetime = field(default_factory=now_utc)
    owner_id: Optional[str] = None
    original_filename: Optional[str] = None
    file_size_bytes: int = 0
    _pdf_bytes: Optional[bytes] = field(default=None, repr=False)

    def touch(self) -> None:
        """Update last accessed timestamp."""
        self.last_accessed = now_utc()

    def lock_element(self, element_id: str, user_id: str) -> bool:
        """
        Lock an element for editing.

        Args:
            element_id: Element to lock.
            user_id: User requesting the lock.

        Returns:
            bool: True if lock acquired, False if already locked.
        """
        if element_id in self.locks and self.locks[element_id] != user_id:
            return False
        self.locks[element_id] = user_id
        return True

    def unlock_element(self, element_id: str, user_id: str) -> bool:
        """
        Unlock an element.

        Args:
            element_id: Element to unlock.
            user_id: User releasing the lock.

        Returns:
            bool: True if unlocked, False if not locked by this user.
        """
        if element_id not in self.locks:
            return True
        if self.locks[element_id] != user_id:
            return False
        del self.locks[element_id]
        return True

    def is_locked(self, element_id: str) -> Optional[str]:
        """
        Check if element is locked.

        Args:
            element_id: Element to check.

        Returns:
            Optional[str]: User ID holding the lock, or None.
        """
        return self.locks.get(element_id)


class DocumentSessionManager:
    """
    Manages document editing sessions with Redis persistence.

    Uses a local LRU cache for fast access and Redis for
    cross-worker persistence.
    """

    # Redis key prefixes
    PDF_PREFIX = "doc:pdf"
    GRAPH_PREFIX = "doc:graph"
    META_PREFIX = "doc:meta"

    def __init__(
        self,
        max_sessions: int = 100,
        session_timeout_minutes: int = 120,
        use_redis: bool = True,
    ):
        """
        Initialize session manager.

        Args:
            max_sessions: Maximum concurrent local sessions.
            session_timeout_minutes: Session timeout in minutes.
            use_redis: Whether to use Redis persistence.
        """
        self._sessions: OrderedDict[str, DocumentSession] = OrderedDict()
        self._lock = threading.RLock()
        self.max_sessions = max_sessions
        self.session_timeout_minutes = session_timeout_minutes
        self.use_redis = use_redis
        self._redis_available = False

    async def _get_redis(self):
        """Get Redis client if available."""
        if not self.use_redis:
            return None
        try:
            from app.core.cache import get_redis
            redis_client = await get_redis()
            await redis_client.ping()
            self._redis_available = True
            return redis_client
        except Exception as e:
            logger.warning(f"Redis not available: {e}")
            self._redis_available = False
            return None

    def _pdf_key(self, document_id: str) -> str:
        return f"{self.PDF_PREFIX}:{document_id}"

    def _graph_key(self, document_id: str) -> str:
        return f"{self.GRAPH_PREFIX}:{document_id}"

    def _meta_key(self, document_id: str) -> str:
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

    def create_session(
        self,
        document_id: str,
        pdf_doc: Any,  # LegacyDocumentProxy | pikepdf.Pdf | bytes-wrapper
        scene_graph: DocumentObject,
        owner_id: Optional[str] = None,
        filename: Optional[str] = None,
        file_size: int = 0,
        pdf_bytes: Optional[bytes] = None,
    ) -> DocumentSession:
        """
        Create a new document session.

        Args:
            document_id: Unique document identifier.
            pdf_doc: PyMuPDF document.
            scene_graph: Parsed document representation.
            owner_id: Owner user ID.
            filename: Original filename.
            file_size: File size in bytes.
            pdf_bytes: Optional PDF bytes for Redis storage.

        Returns:
            DocumentSession: Created session.
        """
        with self._lock:
            # Clean up old sessions if at capacity
            if len(self._sessions) >= self.max_sessions:
                self._cleanup_old_sessions()

            session = DocumentSession(
                document_id=document_id,
                pdf_doc=pdf_doc,
                scene_graph=scene_graph,
                owner_id=owner_id,
                original_filename=filename,
                file_size_bytes=file_size,
                _pdf_bytes=pdf_bytes,
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

            self._sessions[document_id] = session
            # Move to end (most recently used)
            self._sessions.move_to_end(document_id)

            logger.info(f"Created session for document {document_id}")

            # Store in Redis asynchronously
            if self.use_redis and pdf_bytes:
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(self._save_to_redis(document_id, session, pdf_bytes))
                    else:
                        asyncio.run(self._save_to_redis(document_id, session, pdf_bytes))
                except Exception as e:
                    logger.warning(f"Could not save to Redis: {e}")

            return session

    async def _save_to_redis(
        self,
        document_id: str,
        session: DocumentSession,
        pdf_bytes: bytes,
    ) -> bool:
        """Save session data to Redis."""
        redis_client = await self._get_redis()
        if not redis_client:
            return False

        ttl = self.session_timeout_minutes * 60

        try:
            pipe = redis_client.pipeline()

            # Store PDF bytes
            pipe.setex(self._pdf_key(document_id), ttl, pdf_bytes)

            # Store scene graph as JSON
            graph_json = session.scene_graph.model_dump_json()
            pipe.setex(self._graph_key(document_id), ttl, graph_json)

            # Store metadata
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

    async def _renew_redis_ttl(self, document_id: str) -> bool:
        """
        Renew Redis TTL for all keys of a session (sliding expiration).

        Called fire-and-forget on every get_session() hit so that active
        sessions never expire while a user is editing.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if all keys were renewed successfully.
        """
        redis_client = await self._get_redis()
        if not redis_client:
            return False

        ttl = self.session_timeout_minutes * 60
        try:
            pipe = redis_client.pipeline()
            pipe.expire(self._pdf_key(document_id), ttl)
            pipe.expire(self._graph_key(document_id), ttl)
            pipe.expire(self._meta_key(document_id), ttl)
            results = await pipe.execute()
            renewed = all(results)
            if renewed:
                logger.debug("Renewed Redis TTL for session %s (%ds)", document_id, ttl)
            else:
                logger.debug(
                    "Redis TTL renewal partial for session %s (results=%s)",
                    document_id,
                    results,
                )
            return renewed
        except Exception as exc:
            logger.warning("Failed to renew Redis TTL for session %s: %s", document_id, exc)
            return False

    def get_session(self, document_id: str) -> Optional["DocumentSession"]:
        """
        Get an existing session from local cache.

        Renews the Redis TTL asynchronously (sliding expiration) each time
        the session is accessed so that active editing sessions never expire
        mid-work.  The renewal is fire-and-forget; a failure only means the
        TTL is not refreshed for this access, which is non-fatal.

        For Redis loading when a session is not in local cache, use
        get_session_async().

        Args:
            document_id: Document identifier.

        Returns:
            Optional[DocumentSession]: Session if found locally.
        """
        with self._lock:
            session = self._sessions.get(document_id)
            if session:
                session.touch()
                self._sessions.move_to_end(document_id)
                # Renew Redis TTL (sliding expiration) — fire-and-forget
                if self.use_redis:
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            asyncio.create_task(
                                self._renew_redis_ttl(document_id)
                            )
                    except Exception:
                        pass  # Non-fatal: TTL renewal is best-effort
            return session

    async def get_session_async(self, document_id: str) -> Optional[DocumentSession]:
        """
        Get session, checking local cache first then Redis.

        Args:
            document_id: Document identifier.

        Returns:
            Optional[DocumentSession]: Session if found.
        """
        # Check local cache first
        session = self.get_session(document_id)
        if session:
            return session

        # Try loading from Redis
        return await self._load_from_redis(document_id)

    async def _load_from_redis(self, document_id: str) -> Optional[DocumentSession]:
        """Load session from Redis and cache locally."""
        redis_client = await self._get_redis()
        if not redis_client:
            return None

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

            # Rebuild session — wrap bytes in LegacyDocumentProxy instead of fitz.Document
            # TODO: after full TS-engine migration, store/retrieve doc_id only
            from app.core.pdf_engine import LegacyDocumentProxy
            import pikepdf
            import io as _io
            with pikepdf.open(_io.BytesIO(pdf_bytes)) as _pdf:
                _page_count = len(_pdf.pages)
                _is_encrypted = _pdf.is_encrypted
            pdf_doc = LegacyDocumentProxy(document_id, pdf_bytes, _page_count, _is_encrypted)
            scene_graph = DocumentObject.model_validate_json(graph_json)

            # Register raw bytes with pdf_engine (save_document returns this directly)
            from app.core.pdf_engine import pdf_engine
            pdf_engine._documents[document_id] = pdf_bytes
            meta = json.loads(meta_json) if meta_json else {}

            session = DocumentSession(
                document_id=document_id,
                pdf_doc=pdf_doc,
                scene_graph=scene_graph,
                owner_id=meta.get("owner_id"),
                original_filename=meta.get("filename"),
                file_size_bytes=meta.get("file_size", 0),
                locks=meta.get("locks", {}),
                _pdf_bytes=pdf_bytes,
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

            # Add to local cache
            with self._lock:
                # Evict oldest if needed
                while len(self._sessions) >= self.max_sessions:
                    oldest_id, oldest_session = self._sessions.popitem(last=False)
                    try:
                        oldest_session.pdf_doc.close()
                    except Exception:
                        pass
                    logger.debug(f"Evicted session {oldest_id} from local cache")

                self._sessions[document_id] = session
                self._sessions.move_to_end(document_id)

            # Renew TTL on load: the keys were read but their TTL kept ticking.
            # Reset it now to give the session a fresh 120-min window.
            await self._renew_redis_ttl(document_id)

            logger.info(f"Loaded session {document_id} from Redis")
            return session

        except Exception as e:
            logger.error(f"Error loading session from Redis: {e}")
            return None

    def get_session_required(self, document_id: str) -> DocumentSession:
        """
        Get session or raise error.

        Note: Only checks local cache. Use preload_session() first
        for Redis-backed sessions.

        Args:
            document_id: Document identifier.

        Returns:
            DocumentSession: The session.

        Raises:
            KeyError: If session not found.
        """
        session = self.get_session(document_id)
        if not session:
            raise KeyError(f"Document session not found: {document_id}")
        return session

    async def preload_session(self, document_id: str) -> bool:
        """
        Ensure session is loaded into local cache.

        Call this before using sync methods if Redis is enabled.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if session is available.
        """
        session = await self.get_session_async(document_id)
        return session is not None

    def delete_session(self, document_id: str) -> bool:
        """
        Delete a session and close the document.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if deleted, False if not found.
        """
        with self._lock:
            session = self._sessions.pop(document_id, None)
            if session:
                try:
                    session.pdf_doc.close()
                except Exception as e:
                    logger.warning(f"Error closing document: {e}")
                logger.info(f"Deleted session for document {document_id}")

        # Also delete from Redis
        if self.use_redis:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(self._delete_from_redis(document_id))
            except Exception:
                pass

        return session is not None

    async def _delete_from_redis(self, document_id: str) -> None:
        """Delete session from Redis."""
        redis_client = await self._get_redis()
        if redis_client:
            try:
                await redis_client.delete(
                    self._pdf_key(document_id),
                    self._graph_key(document_id),
                    self._meta_key(document_id),
                )
            except Exception as e:
                logger.warning(f"Failed to delete from Redis: {e}")

    def list_sessions(self, owner_id: Optional[str] = None) -> list[dict[str, Any]]:
        """
        List active sessions from local cache.

        Args:
            owner_id: Filter by owner (None for all).

        Returns:
            list: Session summaries.
        """
        with self._lock:
            sessions = []
            for doc_id, session in self._sessions.items():
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
            history.history = history.history[:history.current_index + 1]

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

    async def save_session_to_redis(self, document_id: str) -> bool:
        """
        Save current session state to Redis.

        Call after document modifications to persist changes.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if saved.
        """
        session = self.get_session(document_id)
        if not session:
            return False

        # Get current PDF bytes
        pdf_bytes = session.pdf_doc.tobytes()

        return await self._save_to_redis(document_id, session, pdf_bytes)

    def clear_all(self) -> None:
        """Close all sessions and clear memory."""
        with self._lock:
            for doc_id in list(self._sessions.keys()):
                self.delete_session(doc_id)
            logger.info("Cleared all document sessions")

    def _cleanup_old_sessions(self) -> None:
        """Remove sessions older than timeout or LRU eviction."""
        cutoff = now_utc() - timedelta(minutes=self.session_timeout_minutes)

        # First try to remove expired sessions
        old_sessions = [
            doc_id
            for doc_id, session in self._sessions.items()
            if session.last_accessed < cutoff
        ]

        for doc_id in old_sessions:
            session = self._sessions.pop(doc_id, None)
            if session:
                try:
                    session.pdf_doc.close()
                except Exception:
                    pass

        if old_sessions:
            logger.info(f"Cleaned up {len(old_sessions)} old sessions")

        # If still at capacity, remove oldest (LRU)
        while len(self._sessions) >= self.max_sessions:
            oldest_id, oldest_session = self._sessions.popitem(last=False)
            try:
                oldest_session.pdf_doc.close()
            except Exception:
                pass
            logger.debug(f"Evicted LRU session {oldest_id}")


    # ------------------------------------------------------------------
    # Embed session mapping (session_id → document_id + user_id)
    # ------------------------------------------------------------------

    def set_embed_session(
        self, session_id: str, document_id: str, user_id: str
    ) -> None:
        """Store an embed session mapping."""
        if not hasattr(self, "_embed_sessions"):
            self._embed_sessions: dict[str, dict[str, str]] = {}
        self._embed_sessions[session_id] = {
            "document_id": document_id,
            "user_id": user_id,
        }

    def get_embed_session(self, session_id: str) -> Optional[dict[str, str]]:
        """Retrieve an embed session mapping."""
        if not hasattr(self, "_embed_sessions"):
            return None
        return self._embed_sessions.get(session_id)

    def remove_embed_session(self, session_id: str) -> bool:
        """Remove an embed session mapping."""
        if not hasattr(self, "_embed_sessions"):
            return False
        return self._embed_sessions.pop(session_id, None) is not None

    def remove_session(self, document_id: str) -> bool:
        """Alias for delete_session for backward compat."""
        return self.delete_session(document_id)


# ---------------------------------------------------------------------------
# Global session manager — Redis-backed for cross-worker consistency
# ---------------------------------------------------------------------------
# The legacy DocumentSessionManager (above) is kept for reference but the
# active singleton is now RedisDocumentSessionManager so that sessions are
# shared across all Uvicorn workers via Redis.
#
# Import is deferred to avoid a circular import: redis_document_repo imports
# DocumentSession from this module.

def _build_document_sessions():
    from app.repositories.redis_document_repo import RedisDocumentSessionManager
    return RedisDocumentSessionManager(
        max_local_sessions=50,
        session_timeout_minutes=120,
    )


document_sessions = _build_document_sessions()
