"""
Document Session Repository - In-memory document session management.

Manages active document editing sessions with PyMuPDF documents
and their parsed scene graph representations.
"""

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import fitz  # PyMuPDF

from app.models.document import DocumentObject
from app.models.history import DocumentSnapshot, HistoryEntry, HistoryState
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


@dataclass
class DocumentSession:
    """
    Active document editing session.

    Holds the PyMuPDF document, parsed scene graph,
    and editing history.
    """

    document_id: str
    pdf_doc: fitz.Document
    scene_graph: DocumentObject
    history: HistoryState = field(default_factory=HistoryState)
    locks: dict[str, str] = field(default_factory=dict)  # element_id -> user_id
    created_at: datetime = field(default_factory=now_utc)
    last_accessed: datetime = field(default_factory=now_utc)
    owner_id: Optional[str] = None
    original_filename: Optional[str] = None
    file_size_bytes: int = 0

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
    Manages document editing sessions.

    Thread-safe manager for active document sessions,
    handling creation, retrieval, and cleanup.
    """

    def __init__(self, max_sessions: int = 1000, session_timeout_minutes: int = 60):
        """
        Initialize session manager.

        Args:
            max_sessions: Maximum concurrent sessions.
            session_timeout_minutes: Session timeout in minutes.
        """
        self._sessions: dict[str, DocumentSession] = {}
        self._lock = threading.RLock()
        self.max_sessions = max_sessions
        self.session_timeout_minutes = session_timeout_minutes

    def create_session(
        self,
        document_id: str,
        pdf_doc: fitz.Document,
        scene_graph: DocumentObject,
        owner_id: Optional[str] = None,
        filename: Optional[str] = None,
        file_size: int = 0,
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
            logger.info(f"Created session for document {document_id}")

            return session

    def get_session(self, document_id: str) -> Optional[DocumentSession]:
        """
        Get an existing session.

        Args:
            document_id: Document identifier.

        Returns:
            Optional[DocumentSession]: Session if found.
        """
        with self._lock:
            session = self._sessions.get(document_id)
            if session:
                session.touch()
            return session

    def get_session_required(self, document_id: str) -> DocumentSession:
        """
        Get session or raise error.

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
                return True
            return False

    def list_sessions(self, owner_id: Optional[str] = None) -> list[dict[str, Any]]:
        """
        List active sessions.

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

    def clear_all(self) -> None:
        """Close all sessions and clear memory."""
        with self._lock:
            for doc_id in list(self._sessions.keys()):
                self.delete_session(doc_id)
            logger.info("Cleared all document sessions")

    def _cleanup_old_sessions(self) -> None:
        """Remove sessions older than timeout."""
        cutoff = now_utc()
        from datetime import timedelta
        cutoff = cutoff - timedelta(minutes=self.session_timeout_minutes)

        old_sessions = [
            doc_id
            for doc_id, session in self._sessions.items()
            if session.last_accessed < cutoff
        ]

        for doc_id in old_sessions:
            self.delete_session(doc_id)

        if old_sessions:
            logger.info(f"Cleaned up {len(old_sessions)} old sessions")


# Global session manager instance
document_sessions = DocumentSessionManager()
