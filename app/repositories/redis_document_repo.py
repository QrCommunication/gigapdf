"""
Redis-based Document Session Repository.

Stores document sessions in Redis for multi-worker support.
Uses a local LRU cache to avoid constant Redis roundtrips.

# NOTE: PyMuPDF (fitz) has been removed. PDF bytes are now stored directly
# in Redis and wrapped in LegacyDocumentProxy on retrieval.
# All real PDF operations are handled by @giga-pdf/pdf-engine (TypeScript).

# ARCHITECTURE — Cross-worker session persistence
# ────────────────────────────────────────────────
# With N Uvicorn workers and nginx round-robin (no affinity), every request
# can land on a different worker.  The local OrderedDict cache is worker-local.
# Redis is the single source of truth shared by all workers.
#
# Key schema:
#   doc:pdf:{document_id}        → raw PDF bytes              TTL 120 min
#   doc:graph:{document_id}      → scene graph JSON           TTL 120 min
#   doc:meta:{document_id}       → metadata + history JSON    TTL 120 min
#   doc:embed:{session_id}       → embed mapping JSON         TTL 120 min
#
# TTL is renewed on every read (touch) so active sessions never expire
# while the user is editing.
"""

import asyncio
import io
import json
import logging
import threading
from collections import OrderedDict
from datetime import datetime
from typing import Any, Optional

import pikepdf  # MIT-licensed replacement for PyMuPDF
import redis.asyncio as redis

from app.core.cache import get_redis
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

    All mutating operations (create, delete, save) await the Redis
    pipeline synchronously so the data is durable before returning to
    the caller.  get_session() loads from Redis on local-cache miss
    so workers never serve stale 404s.
    """

    # Redis key prefixes
    PDF_PREFIX = "doc:pdf"
    GRAPH_PREFIX = "doc:graph"
    META_PREFIX = "doc:meta"
    EMBED_PREFIX = "doc:embed"

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

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_redis(self) -> Optional[redis.Redis]:
        """Get Redis client, returning None on failure (degraded mode)."""
        try:
            if self._redis is None:
                self._redis = await get_redis()
            await self._redis.ping()
            return self._redis
        except Exception as exc:
            logger.error("Redis unavailable — operating in degraded (local-only) mode: %s", exc)
            self._redis = None
            return None

    def _pdf_key(self, document_id: str) -> str:
        return f"{self.PDF_PREFIX}:{document_id}"

    def _graph_key(self, document_id: str) -> str:
        return f"{self.GRAPH_PREFIX}:{document_id}"

    def _meta_key(self, document_id: str) -> str:
        return f"{self.META_PREFIX}:{document_id}"

    def _embed_key(self, session_id: str) -> str:
        return f"{self.EMBED_PREFIX}:{session_id}"

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

    def _add_to_local_cache(self, document_id: str, session: DocumentSession) -> None:
        """Add session to local LRU cache (call with self._lock held)."""
        while len(self._local_cache) >= self.max_local_sessions:
            oldest_id, oldest_session = self._local_cache.popitem(last=False)
            try:
                oldest_session.pdf_doc.close()
            except Exception:
                pass
            logger.debug("Evicted session %s from local cache", oldest_id)

        self._local_cache[document_id] = session
        self._local_cache.move_to_end(document_id)

    # ------------------------------------------------------------------
    # Core CRUD
    # ------------------------------------------------------------------

    async def create_session(
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
        Create a new document session and persist to Redis immediately.

        The Redis pipeline is awaited before returning so the session is
        visible to all workers by the time the caller proceeds.

        Args:
            document_id: Unique document identifier.
            pdf_doc: Document handle (LegacyDocumentProxy or any object with .tobytes()).
            scene_graph: Parsed document representation.
            owner_id: Owner user ID.
            filename: Original filename.
            file_size: File size in bytes.
            pdf_bytes: Raw PDF bytes (required for Redis storage).

        Returns:
            DocumentSession: Created session.
        """
        # Get PDF bytes if not provided
        if pdf_bytes is None:
            try:
                pdf_bytes = pdf_doc.tobytes()
            except Exception as exc:
                logger.warning("Could not extract PDF bytes from document handle: %s", exc)
                pdf_bytes = b""

        session = DocumentSession(
            document_id=document_id,
            pdf_doc=pdf_doc,
            scene_graph=scene_graph,
            owner_id=owner_id,
            original_filename=filename,
            file_size_bytes=file_size,
            _pdf_bytes=pdf_bytes,
        )

        # Initial history entry
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

        # Persist to Redis (awaited — not fire-and-forget)
        redis_client = await self._get_redis()
        if redis_client and pdf_bytes:
            try:
                ttl = self.session_timeout_minutes * 60
                pipe = redis_client.pipeline()
                pipe.setex(self._pdf_key(document_id), ttl, pdf_bytes)
                pipe.setex(self._graph_key(document_id), ttl, scene_graph.model_dump_json())
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
                logger.info(
                    "Session %s created and persisted to Redis (%.1f KB)",
                    document_id,
                    len(pdf_bytes) / 1024,
                )
            except Exception as exc:
                logger.error("Failed to persist session %s to Redis: %s", document_id, exc)
                # Continue — local cache still works for this worker
        elif not redis_client:
            logger.warning(
                "Redis unavailable: session %s is local-only (cross-worker 404 risk)",
                document_id,
            )

        with self._lock:
            self._add_to_local_cache(document_id, session)

        return session

    async def get_session(self, document_id: str) -> Optional[DocumentSession]:
        """
        Get session, checking local cache first then Redis.

        This is the primary session accessor.  Always use this in async
        contexts — it transparently reconstructs the session from Redis
        when this worker has no local copy.

        Args:
            document_id: Document identifier.

        Returns:
            Optional[DocumentSession]: Session if found.
        """
        # Fast path: local cache hit
        with self._lock:
            if document_id in self._local_cache:
                session = self._local_cache[document_id]
                session.touch()
                self._local_cache.move_to_end(document_id)
                logger.debug("Local cache hit for %s", document_id)
                return session

        # Slow path: load from Redis
        return await self._load_from_redis(document_id)

    # Alias for backward compat with callers that use get_session_async()
    async def get_session_async(self, document_id: str) -> Optional[DocumentSession]:
        """Alias for get_session() — always async and Redis-aware."""
        return await self.get_session(document_id)

    def get_session_sync(self, document_id: str) -> Optional[DocumentSession]:
        """
        Synchronous local-cache-only lookup.

        Use ONLY in sync service methods that are called AFTER an async
        endpoint has already called preload_session() or get_session().
        This guarantees the session is in the local LRU cache.

        Never call this as the first access to a session — it will miss
        cross-worker sessions because it does not reach Redis.

        Args:
            document_id: Document identifier.

        Returns:
            Optional[DocumentSession]: Session if in local cache, else None.
        """
        with self._lock:
            if document_id in self._local_cache:
                session = self._local_cache[document_id]
                session.touch()
                self._local_cache.move_to_end(document_id)
                return session
        return None

    async def _load_from_redis(self, document_id: str) -> Optional[DocumentSession]:
        """Load session from Redis and populate local cache."""
        redis_client = await self._get_redis()
        if not redis_client:
            return None

        try:
            pipe = redis_client.pipeline()
            pipe.get(self._pdf_key(document_id))
            pipe.get(self._graph_key(document_id))
            pipe.get(self._meta_key(document_id))
            results = await pipe.execute()

            pdf_bytes, graph_json, meta_json = results

            if not pdf_bytes or not graph_json:
                logger.debug("Session %s not found in Redis", document_id)
                return None

            # Rebuild document handle
            from app.core.pdf_engine import LegacyDocumentProxy, pdf_engine
            with pikepdf.open(io.BytesIO(pdf_bytes)) as _pdf:
                _page_count = len(_pdf.pages)
                _is_encrypted = _pdf.is_encrypted

            pdf_doc = LegacyDocumentProxy(document_id, pdf_bytes, _page_count, _is_encrypted)
            # Register raw bytes with pdf_engine (NOT the proxy).
            # save_document() returns self._documents[document_id] directly and expects
            # it to be bytes — storing the proxy breaks download with 'no len()'.
            pdf_engine._documents[document_id] = pdf_bytes

            scene_graph = DocumentObject.model_validate_json(graph_json)
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

            if "history" in meta:
                session.history = self._deserialize_history(meta["history"])
            if "created_at" in meta:
                session.created_at = datetime.fromisoformat(meta["created_at"])

            session.touch()

            # Renew TTL on access
            ttl = self.session_timeout_minutes * 60
            try:
                pipe2 = redis_client.pipeline()
                pipe2.expire(self._pdf_key(document_id), ttl)
                pipe2.expire(self._graph_key(document_id), ttl)
                pipe2.expire(self._meta_key(document_id), ttl)
                await pipe2.execute()
            except Exception:
                pass

            with self._lock:
                self._add_to_local_cache(document_id, session)

            logger.info("Loaded session %s from Redis", document_id)
            return session

        except Exception as exc:
            logger.error("Error loading session %s from Redis: %s", document_id, exc)
            return None

    async def preload_session(self, document_id: str) -> bool:
        """
        Ensure session is loaded into local cache from Redis.

        Call this before using sync helpers that only check local cache.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if session is available.
        """
        session = await self.get_session(document_id)
        return session is not None

    def get_session_required(self, document_id: str) -> DocumentSession:
        """
        Get session synchronously from local cache only.

        Raises KeyError if not found.  Callers MUST have previously called
        await preload_session(document_id) or await get_session(document_id)
        to ensure the session is in the local cache.

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

        raise KeyError(
            f"Document session not found locally: {document_id}. "
            "Call await preload_session() first."
        )

    async def get_session_required_async(self, document_id: str) -> DocumentSession:
        """
        Get session asynchronously or raise KeyError.

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
        Delete a session from local cache and Redis.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if deleted.
        """
        with self._lock:
            session = self._local_cache.pop(document_id, None)
            if session:
                try:
                    session.pdf_doc.close()
                except Exception:
                    pass

        redis_client = await self._get_redis()
        if redis_client:
            try:
                await redis_client.delete(
                    self._pdf_key(document_id),
                    self._graph_key(document_id),
                    self._meta_key(document_id),
                )
                logger.info("Deleted session %s from Redis", document_id)
            except Exception as exc:
                logger.error("Failed to delete session %s from Redis: %s", document_id, exc)

        return True  # Always return True: local was cleared even if Redis failed

    async def remove_session(self, document_id: str) -> bool:
        """Alias for delete_session (backward compat)."""
        return await self.delete_session(document_id)

    async def save_session(self, document_id: str) -> bool:
        """
        Persist current session state (scene graph + metadata) to Redis.

        Call this after document modifications to keep all workers in sync.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if saved successfully.
        """
        with self._lock:
            session = self._local_cache.get(document_id)
            if not session:
                logger.warning("Cannot save session %s: not in local cache", document_id)
                return False

        redis_client = await self._get_redis()
        if not redis_client:
            return False

        ttl = self.session_timeout_minutes * 60

        try:
            pipe = redis_client.pipeline()

            # Refresh PDF bytes
            try:
                pdf_bytes = session.pdf_doc.tobytes()
                pipe.setex(self._pdf_key(document_id), ttl, pdf_bytes)
            except Exception as exc:
                logger.warning("Could not serialize PDF bytes for %s: %s", document_id, exc)

            # Refresh scene graph
            pipe.setex(self._graph_key(document_id), ttl, session.scene_graph.model_dump_json())

            # Refresh metadata
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
            logger.debug("Session %s saved to Redis", document_id)
            return True

        except Exception as exc:
            logger.error("Failed to save session %s to Redis: %s", document_id, exc)
            return False

    # Alias matching the name used in document_repo.DocumentSessionManager
    async def save_session_to_redis(self, document_id: str) -> bool:
        """Alias for save_session() (backward compat)."""
        return await self.save_session(document_id)

    async def session_exists(self, document_id: str) -> bool:
        """Check if session exists in local cache or Redis."""
        with self._lock:
            if document_id in self._local_cache:
                return True

        redis_client = await self._get_redis()
        if not redis_client:
            return False
        try:
            exists = await redis_client.exists(self._pdf_key(document_id))
            return bool(exists)
        except Exception:
            return False

    async def extend_session_ttl(self, document_id: str) -> bool:
        """Extend the TTL of all session keys in Redis."""
        redis_client = await self._get_redis()
        if not redis_client:
            return False

        ttl = self.session_timeout_minutes * 60
        try:
            pipe = redis_client.pipeline()
            pipe.expire(self._pdf_key(document_id), ttl)
            pipe.expire(self._graph_key(document_id), ttl)
            pipe.expire(self._meta_key(document_id), ttl)
            await pipe.execute()
            return True
        except Exception as exc:
            logger.warning("Failed to extend TTL for %s: %s", document_id, exc)
            return False

    # ------------------------------------------------------------------
    # History management
    # ------------------------------------------------------------------

    def push_history(
        self,
        document_id: str,
        action: str,
        affected_elements: Optional[list[str]] = None,
        affected_pages: Optional[list[int]] = None,
    ) -> None:
        """
        Push a new history entry into the local session.

        Note: This is intentionally sync (local mutation only).
        Call save_session() afterward to persist the updated history.

        Args:
            document_id: Document identifier.
            action: Action description.
            affected_elements: List of affected element IDs.
            affected_pages: List of affected page numbers.
        """
        session = self.get_session_required(document_id)

        with self._lock:
            history = session.history

            # Truncate redo branch
            history.history = history.history[: history.current_index + 1]

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

            if len(history.history) > 1:
                history.history[-2].can_redo = True

            if len(history.history) > history.max_history_size:
                history.history.pop(0)
                history.current_index -= 1

    # ------------------------------------------------------------------
    # Session listing
    # ------------------------------------------------------------------

    def list_sessions(self, owner_id: Optional[str] = None) -> list[dict[str, Any]]:
        """
        List sessions from local cache only.

        For a complete cross-worker view, scan Redis keys separately.

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

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def clear_all(self) -> None:
        """
        Close all local sessions.

        Called at shutdown — does not touch Redis (other workers keep
        their sessions until TTL expires or they explicitly delete them).
        """
        with self._lock:
            for doc_id in list(self._local_cache.keys()):
                session = self._local_cache.pop(doc_id, None)
                if session:
                    try:
                        session.pdf_doc.close()
                    except Exception:
                        pass
        logger.info("Cleared all local document sessions")

    # ------------------------------------------------------------------
    # Embed session mapping (session_id → document_id + user_id) via Redis
    # ------------------------------------------------------------------

    async def set_embed_session(
        self, session_id: str, document_id: str, user_id: str
    ) -> None:
        """
        Store an embed session mapping in Redis.

        Falls back to local in-process dict when Redis is unavailable.
        """
        payload = json.dumps({"document_id": document_id, "user_id": user_id})
        ttl = self.session_timeout_minutes * 60

        redis_client = await self._get_redis()
        if redis_client:
            try:
                await redis_client.setex(self._embed_key(session_id), ttl, payload)
                logger.debug("Embed session %s stored in Redis", session_id)
                return
            except Exception as exc:
                logger.error("Failed to store embed session in Redis: %s", exc)

        # Degraded mode: local fallback
        if not hasattr(self, "_embed_sessions_local"):
            self._embed_sessions_local: dict[str, dict[str, str]] = {}
        self._embed_sessions_local[session_id] = {"document_id": document_id, "user_id": user_id}

    async def get_embed_session(self, session_id: str) -> Optional[dict[str, str]]:
        """
        Retrieve an embed session mapping from Redis (or local fallback).
        """
        redis_client = await self._get_redis()
        if redis_client:
            try:
                raw = await redis_client.get(self._embed_key(session_id))
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                logger.error("Failed to get embed session from Redis: %s", exc)

        # Degraded mode: check local fallback
        if hasattr(self, "_embed_sessions_local"):
            return self._embed_sessions_local.get(session_id)
        return None

    async def remove_embed_session(self, session_id: str) -> bool:
        """
        Remove an embed session mapping from Redis (or local fallback).
        """
        redis_client = await self._get_redis()
        if redis_client:
            try:
                deleted = await redis_client.delete(self._embed_key(session_id))
                return bool(deleted)
            except Exception as exc:
                logger.error("Failed to remove embed session from Redis: %s", exc)

        # Degraded mode
        if hasattr(self, "_embed_sessions_local"):
            return self._embed_sessions_local.pop(session_id, None) is not None
        return False

    # ------------------------------------------------------------------
    # Metadata update helper
    # ------------------------------------------------------------------

    async def _update_metadata(self, document_id: str, session: DocumentSession) -> None:
        """Update session metadata in Redis (last_accessed, locks, history)."""
        redis_client = await self._get_redis()
        if not redis_client:
            return

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
        except Exception as exc:
            logger.warning("Failed to update metadata for %s in Redis: %s", document_id, exc)
