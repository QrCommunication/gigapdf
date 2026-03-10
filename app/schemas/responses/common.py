"""Common response schemas."""

from datetime import datetime
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel, Field

from app.middleware.request_id import get_request_id
from app.utils.helpers import now_utc

T = TypeVar("T")


class MetaInfo(BaseModel):
    """Response metadata."""

    request_id: Optional[str] = Field(description="Request tracking ID")
    timestamp: datetime = Field(description="Response timestamp")
    processing_time_ms: Optional[int] = Field(
        default=None, description="Processing time in milliseconds"
    )


class ErrorDetail(BaseModel):
    """Error detail information."""

    code: str = Field(description="Error code")
    message: str = Field(description="Human-readable error message")
    details: Optional[dict[str, Any]] = Field(
        default=None, description="Additional error details"
    )


class PaginationInfo(BaseModel):
    """Pagination metadata."""

    total: int = Field(ge=0, description="Total number of items")
    page: int = Field(ge=1, description="Current page number")
    per_page: int = Field(ge=1, description="Items per page")
    total_pages: int = Field(ge=0, description="Total number of pages")


class APIResponse(BaseModel, Generic[T]):
    """
    Standard API response wrapper.

    All API responses follow this format for consistency.
    """

    success: bool = Field(description="Whether the request succeeded")
    data: Optional[T] = Field(default=None, description="Response data")
    error: Optional[ErrorDetail] = Field(default=None, description="Error details")
    meta: MetaInfo = Field(description="Response metadata")

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "data": {"document_id": "uuid-here"},
                "error": None,
                "meta": {
                    "request_id": "uuid-here",
                    "timestamp": "2024-01-15T10:30:00Z",
                    "processing_time_ms": 150,
                },
            }
        }


class SuccessResponse(BaseModel, Generic[T]):
    """Helper for successful responses."""

    success: bool = True
    data: T
    error: None = None
    meta: MetaInfo

    @classmethod
    def create(cls, data: T, processing_time_ms: Optional[int] = None) -> "SuccessResponse[T]":
        """Create a success response."""
        return cls(
            data=data,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time_ms,
            ),
        )


class ErrorResponse(BaseModel):
    """Helper for error responses."""

    success: bool = False
    data: None = None
    error: ErrorDetail
    meta: MetaInfo

    @classmethod
    def create(
        cls,
        code: str,
        message: str,
        details: Optional[dict] = None,
    ) -> "ErrorResponse":
        """Create an error response."""
        return cls(
            error=ErrorDetail(code=code, message=message, details=details),
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
            ),
        )
