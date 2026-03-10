"""
History Service - Improved Undo/Redo with real snapshots.

Manages document state history for reversible operations
using incremental snapshots stored in memory and Redis.
"""

import copy
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from app.middleware.error_handler import DocumentNotFoundError, InvalidOperationError
from app.models.document import DocumentObject
from app.models.history import HistoryEntry, HistoryState
from app.repositories.document_repo import DocumentSession, document_sessions
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


@dataclass
class DocumentSnapshot:
    """
    Snapshot of document state for history.

    Stores the complete state needed to restore a document
    to a previous point in time.
    """

    snapshot_id: str
    timestamp: datetime
    action: str
    # Store serialized page states (JSON)
    pages_data: dict[int, dict]  # page_number -> page dict
    # Store which elements were affected
    affected_elements: list[str] = field(default_factory=list)
    affected_pages: list[int] = field(default_factory=list)


class HistoryManager:
    """
    Manages document editing history with real snapshots.

    Provides true undo/redo functionality by storing
    incremental snapshots of document state.
    """

    def __init__(self, max_snapshots: int = 100):
        """
        Initialize history manager.

        Args:
            max_snapshots: Maximum snapshots to keep per document.
        """
        self.max_snapshots = max_snapshots
        # In-memory snapshot storage: document_id -> list of snapshots
        self._snapshots: dict[str, list[DocumentSnapshot]] = {}
        # Current position in history: document_id -> index
        self._positions: dict[str, int] = {}

    def init_document(self, document_id: str, scene_graph: DocumentObject) -> None:
        """
        Initialize history for a new document.

        Args:
            document_id: Document identifier.
            scene_graph: Initial document state.
        """
        # Create initial snapshot
        initial_snapshot = self._create_snapshot(
            scene_graph,
            "Document opened",
            affected_pages=list(range(1, len(scene_graph.pages) + 1)),
        )

        self._snapshots[document_id] = [initial_snapshot]
        self._positions[document_id] = 0

        logger.debug(f"Initialized history for document {document_id}")

    def push_state(
        self,
        document_id: str,
        scene_graph: DocumentObject,
        action: str,
        affected_elements: Optional[list[str]] = None,
        affected_pages: Optional[list[int]] = None,
    ) -> None:
        """
        Save current state to history.

        Args:
            document_id: Document identifier.
            scene_graph: Current document state.
            action: Description of the action.
            affected_elements: Elements modified by this action.
            affected_pages: Pages modified by this action.
        """
        if document_id not in self._snapshots:
            self.init_document(document_id, scene_graph)
            return

        snapshots = self._snapshots[document_id]
        current_pos = self._positions[document_id]

        # Truncate any redo history (snapshots after current position)
        self._snapshots[document_id] = snapshots[: current_pos + 1]

        # Create new snapshot
        snapshot = self._create_snapshot(
            scene_graph,
            action,
            affected_elements or [],
            affected_pages or [],
        )

        self._snapshots[document_id].append(snapshot)
        self._positions[document_id] = len(self._snapshots[document_id]) - 1

        # Trim if exceeding max
        if len(self._snapshots[document_id]) > self.max_snapshots:
            self._snapshots[document_id].pop(0)
            self._positions[document_id] -= 1

        logger.debug(f"Pushed state for {document_id}: {action}")

    def undo(
        self,
        document_id: str,
        session: DocumentSession,
        steps: int = 1,
    ) -> tuple[list[str], DocumentObject]:
        """
        Undo operations and restore previous state.

        Args:
            document_id: Document identifier.
            session: Active document session.
            steps: Number of steps to undo.

        Returns:
            tuple: (list of undone actions, restored document)
        """
        if document_id not in self._snapshots:
            raise InvalidOperationError("No history available for this document")

        snapshots = self._snapshots[document_id]
        current_pos = self._positions[document_id]
        undone_actions = []

        for _ in range(steps):
            if current_pos <= 0:
                break

            # Get the action being undone
            undone_actions.append(snapshots[current_pos].action)
            current_pos -= 1

        if current_pos != self._positions[document_id]:
            # Restore state from snapshot
            target_snapshot = snapshots[current_pos]
            self._restore_snapshot(session, target_snapshot)
            self._positions[document_id] = current_pos

            logger.info(f"Undid {len(undone_actions)} actions for {document_id}")

        return undone_actions, session.scene_graph

    def redo(
        self,
        document_id: str,
        session: DocumentSession,
        steps: int = 1,
    ) -> tuple[list[str], DocumentObject]:
        """
        Redo previously undone operations.

        Args:
            document_id: Document identifier.
            session: Active document session.
            steps: Number of steps to redo.

        Returns:
            tuple: (list of redone actions, restored document)
        """
        if document_id not in self._snapshots:
            raise InvalidOperationError("No history available for this document")

        snapshots = self._snapshots[document_id]
        current_pos = self._positions[document_id]
        redone_actions = []

        for _ in range(steps):
            if current_pos >= len(snapshots) - 1:
                break

            current_pos += 1
            redone_actions.append(snapshots[current_pos].action)

        if current_pos != self._positions[document_id]:
            # Restore state from snapshot
            target_snapshot = snapshots[current_pos]
            self._restore_snapshot(session, target_snapshot)
            self._positions[document_id] = current_pos

            logger.info(f"Redid {len(redone_actions)} actions for {document_id}")

        return redone_actions, session.scene_graph

    def goto_index(
        self,
        document_id: str,
        session: DocumentSession,
        index: int,
    ) -> DocumentObject:
        """
        Jump to a specific point in history.

        Args:
            document_id: Document identifier.
            session: Active document session.
            index: Target history index.

        Returns:
            DocumentObject: Restored document state.
        """
        if document_id not in self._snapshots:
            raise InvalidOperationError("No history available for this document")

        snapshots = self._snapshots[document_id]

        if index < 0 or index >= len(snapshots):
            raise InvalidOperationError(
                f"Invalid history index: {index}. Valid range: 0-{len(snapshots) - 1}"
            )

        target_snapshot = snapshots[index]
        self._restore_snapshot(session, target_snapshot)
        self._positions[document_id] = index

        logger.info(f"Jumped to history index {index} for {document_id}")

        return session.scene_graph

    def get_history(self, document_id: str) -> HistoryState:
        """
        Get the history state for a document.

        Args:
            document_id: Document identifier.

        Returns:
            HistoryState: Current history information.
        """
        if document_id not in self._snapshots:
            return HistoryState(current_index=-1, history=[], max_history_size=self.max_snapshots)

        snapshots = self._snapshots[document_id]
        current_pos = self._positions[document_id]

        entries = []
        for i, snapshot in enumerate(snapshots):
            entries.append(
                HistoryEntry(
                    index=i,
                    action=snapshot.action,
                    timestamp=snapshot.timestamp,
                    can_undo=i <= current_pos and i > 0,
                    can_redo=i > current_pos,
                    affected_elements=snapshot.affected_elements,
                    affected_pages=snapshot.affected_pages,
                )
            )

        return HistoryState(
            current_index=current_pos,
            history=entries,
            max_history_size=self.max_snapshots,
        )

    def clear(self, document_id: str) -> None:
        """
        Clear history for a document.

        Args:
            document_id: Document identifier.
        """
        if document_id in self._snapshots:
            del self._snapshots[document_id]
        if document_id in self._positions:
            del self._positions[document_id]

        logger.info(f"Cleared history for {document_id}")

    def _create_snapshot(
        self,
        scene_graph: DocumentObject,
        action: str,
        affected_elements: Optional[list[str]] = None,
        affected_pages: Optional[list[int]] = None,
    ) -> DocumentSnapshot:
        """
        Create a snapshot of the current document state.

        For efficiency, we store only the pages that were affected.
        """
        pages_data = {}

        # Determine which pages to snapshot
        pages_to_store = affected_pages if affected_pages else list(
            range(1, len(scene_graph.pages) + 1)
        )

        for page_num in pages_to_store:
            if page_num <= len(scene_graph.pages):
                page = scene_graph.pages[page_num - 1]
                # Deep copy the page data
                pages_data[page_num] = page.model_dump()

        return DocumentSnapshot(
            snapshot_id=generate_uuid(),
            timestamp=now_utc(),
            action=action,
            pages_data=pages_data,
            affected_elements=affected_elements or [],
            affected_pages=affected_pages or [],
        )

    def _restore_snapshot(
        self,
        session: DocumentSession,
        snapshot: DocumentSnapshot,
    ) -> None:
        """
        Restore document state from a snapshot.

        Args:
            session: Document session to restore.
            snapshot: Snapshot to restore from.
        """
        from app.models.page import PageObject

        # Restore pages from snapshot
        for page_num, page_data in snapshot.pages_data.items():
            if page_num <= len(session.scene_graph.pages):
                # Reconstruct page from data
                restored_page = PageObject(**page_data)
                session.scene_graph.pages[page_num - 1] = restored_page

        logger.debug(f"Restored snapshot {snapshot.snapshot_id}")


# Global history manager instance
history_manager = HistoryManager()


class HistoryService:
    """
    History management service.

    High-level interface for undo/redo operations.
    """

    def __init__(self):
        """Initialize history service."""
        self.manager = history_manager

    def get_history(self, document_id: str) -> HistoryState:
        """
        Get document editing history.

        Args:
            document_id: Document identifier.

        Returns:
            HistoryState: Current history state.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        return self.manager.get_history(document_id)

    def push_state(
        self,
        document_id: str,
        action: str,
        affected_elements: Optional[list[str]] = None,
        affected_pages: Optional[list[int]] = None,
    ) -> None:
        """
        Record a new state in history.

        Args:
            document_id: Document identifier.
            action: Action description.
            affected_elements: Modified element IDs.
            affected_pages: Modified page numbers.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        self.manager.push_state(
            document_id,
            session.scene_graph,
            action,
            affected_elements,
            affected_pages,
        )

    def undo(
        self,
        document_id: str,
        steps: int = 1,
    ) -> tuple[list[str], DocumentObject]:
        """
        Undo recent operations.

        Args:
            document_id: Document identifier.
            steps: Number of steps to undo.

        Returns:
            tuple: (undone_actions, current_document)
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        return self.manager.undo(document_id, session, steps)

    def redo(
        self,
        document_id: str,
        steps: int = 1,
    ) -> tuple[list[str], DocumentObject]:
        """
        Redo undone operations.

        Args:
            document_id: Document identifier.
            steps: Number of steps to redo.

        Returns:
            tuple: (redone_actions, current_document)
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        return self.manager.redo(document_id, session, steps)

    def goto_state(
        self,
        document_id: str,
        index: int,
    ) -> DocumentObject:
        """
        Go to a specific history state.

        Args:
            document_id: Document identifier.
            index: History index to go to.

        Returns:
            DocumentObject: Document at that state.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        return self.manager.goto_index(document_id, session, index)

    def clear_history(self, document_id: str) -> None:
        """
        Clear history for a document.

        Args:
            document_id: Document identifier.
        """
        self.manager.clear(document_id)


# Global service instance
history_service = HistoryService()
