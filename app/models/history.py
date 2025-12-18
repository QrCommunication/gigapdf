"""
History models for undo/redo functionality.

Maintains a stack of document states for reversible operations.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class HistoryEntry(BaseModel):
    """Single entry in the history stack."""

    index: int = Field(ge=0, description="Position in history stack")
    action: str = Field(description="Description of the action")
    timestamp: datetime = Field(description="When the action was performed")
    can_undo: bool = Field(default=True, description="Whether this action can be undone")
    can_redo: bool = Field(default=False, description="Whether this action can be redone")
    affected_elements: list[str] = Field(
        default_factory=list, description="Element IDs affected by this action"
    )
    affected_pages: list[int] = Field(
        default_factory=list, description="Page numbers affected by this action"
    )


class HistoryState(BaseModel):
    """
    Complete history state for a document.

    Tracks all changes made to a document for undo/redo.
    """

    current_index: int = Field(default=-1, description="Current position in history")
    history: list[HistoryEntry] = Field(default_factory=list, description="History entries")
    max_history_size: int = Field(default=100, description="Maximum history entries to keep")

    @property
    def can_undo(self) -> bool:
        """Check if undo is available."""
        return self.current_index >= 0

    @property
    def can_redo(self) -> bool:
        """Check if redo is available."""
        return self.current_index < len(self.history) - 1

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "current_index": 2,
                "history": [
                    {
                        "index": 0,
                        "action": "Document opened",
                        "timestamp": "2024-01-15T10:30:00Z",
                        "can_undo": False,
                        "can_redo": True,
                    },
                    {
                        "index": 1,
                        "action": "Text modified on page 1",
                        "timestamp": "2024-01-15T10:31:00Z",
                        "can_undo": True,
                        "can_redo": True,
                    },
                    {
                        "index": 2,
                        "action": "Image added to page 2",
                        "timestamp": "2024-01-15T10:32:00Z",
                        "can_undo": True,
                        "can_redo": False,
                    },
                ],
                "max_history_size": 100,
            }
        }


class DocumentSnapshot(BaseModel):
    """
    Snapshot of document state for history.

    Stores minimal data needed to restore a previous state.
    """

    snapshot_id: str = Field(description="Unique snapshot identifier")
    timestamp: datetime = Field(description="When snapshot was taken")
    action: str = Field(description="Action that triggered this snapshot")
    page_states: dict[int, Any] = Field(
        default_factory=dict, description="Page number to page state mapping"
    )
    element_states: dict[str, Any] = Field(
        default_factory=dict, description="Element ID to element state mapping"
    )
    metadata_state: Optional[dict[str, Any]] = Field(
        default=None, description="Document metadata state if changed"
    )
