"""
Job models for async task management.

Jobs represent long-running operations like OCR, export, merge, etc.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    """Status of an async job."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobType(str, Enum):
    """Types of async jobs."""

    OCR = "ocr"
    EXPORT = "export"
    MERGE = "merge"
    SPLIT = "split"
    UPLOAD = "upload"
    CONVERT = "convert"


class JobError(BaseModel):
    """Error details for a failed job."""

    code: str = Field(description="Error code")
    message: str = Field(description="Error message")
    details: Optional[dict[str, Any]] = Field(default=None, description="Additional details")


class JobObject(BaseModel):
    """
    Async job representation.

    Jobs track long-running operations and provide
    progress updates via WebSocket.
    """

    job_id: str = Field(description="Unique job identifier (UUID v4)")
    type: JobType = Field(description="Job type")
    status: JobStatus = Field(default=JobStatus.PENDING, description="Current status")
    progress: float = Field(default=0.0, ge=0, le=100, description="Progress percentage")
    created_at: datetime = Field(description="Job creation time")
    started_at: Optional[datetime] = Field(default=None, description="Processing start time")
    completed_at: Optional[datetime] = Field(default=None, description="Completion time")
    result: Optional[dict[str, Any]] = Field(default=None, description="Job result on completion")
    error: Optional[JobError] = Field(default=None, description="Error details if failed")
    document_id: Optional[str] = Field(default=None, description="Associated document ID")
    websocket_channel: Optional[str] = Field(
        default=None, description="WebSocket channel for progress updates"
    )

    @property
    def is_complete(self) -> bool:
        """Check if job has finished (success or failure)."""
        return self.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)

    @property
    def is_running(self) -> bool:
        """Check if job is currently running."""
        return self.status == JobStatus.PROCESSING

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "job_id": "550e8400-e29b-41d4-a716-446655440030",
                "type": "ocr",
                "status": "processing",
                "progress": 45.5,
                "created_at": "2024-01-15T10:30:00Z",
                "started_at": "2024-01-15T10:30:05Z",
                "completed_at": None,
                "result": None,
                "error": None,
                "document_id": "550e8400-e29b-41d4-a716-446655440000",
                "websocket_channel": "jobs:550e8400-e29b-41d4-a716-446655440030",
            }
        }
