"""
Global exception handlers for the Giga-PDF API.

Provides consistent error responses across all endpoints
with proper error codes and messages.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.middleware.request_id import get_request_id

logger = logging.getLogger(__name__)


class GigaPDFException(Exception):
    """Base exception for all Giga-PDF errors."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ):
        """
        Initialize the exception.

        Args:
            code: Error code (e.g., PDF_PARSE_ERROR).
            message: Human-readable error message.
            status_code: HTTP status code.
            details: Additional error details.
        """
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


# Specific exception classes
class PDFParseError(GigaPDFException):
    """Raised when PDF parsing fails."""

    def __init__(self, message: str = "Failed to parse PDF", details: dict | None = None):
        super().__init__("PDF_PARSE_ERROR", message, status.HTTP_400_BAD_REQUEST, details)


class PDFEncryptedError(GigaPDFException):
    """Raised when PDF is encrypted and password is required."""

    def __init__(self, message: str = "PDF is encrypted, password required"):
        super().__init__("PDF_ENCRYPTED", message, status.HTTP_400_BAD_REQUEST)


class PDFInvalidPasswordError(GigaPDFException):
    """Raised when provided PDF password is incorrect."""

    def __init__(self, message: str = "Invalid PDF password"):
        super().__init__("PDF_INVALID_PASSWORD", message, status.HTTP_400_BAD_REQUEST)


class PDFCorruptedError(GigaPDFException):
    """Raised when PDF file is corrupted."""

    def __init__(self, message: str = "PDF file is corrupted"):
        super().__init__("PDF_CORRUPTED", message, status.HTTP_400_BAD_REQUEST)


class ElementNotFoundError(GigaPDFException):
    """Raised when an element is not found."""

    def __init__(self, element_id: str):
        super().__init__(
            "ELEMENT_NOT_FOUND",
            f"Element not found: {element_id}",
            status.HTTP_404_NOT_FOUND,
            {"element_id": element_id},
        )


class PageNotFoundError(GigaPDFException):
    """Raised when a page is not found."""

    def __init__(self, page_number: int):
        super().__init__(
            "PAGE_NOT_FOUND",
            f"Page not found: {page_number}",
            status.HTTP_404_NOT_FOUND,
            {"page_number": page_number},
        )


class DocumentNotFoundError(GigaPDFException):
    """Raised when a document is not found."""

    def __init__(self, document_id: str):
        super().__init__(
            "DOCUMENT_NOT_FOUND",
            f"Document not found: {document_id}",
            status.HTTP_404_NOT_FOUND,
            {"document_id": document_id},
        )


class InvalidOperationError(GigaPDFException):
    """Raised when an operation is not permitted."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__("INVALID_OPERATION", message, status.HTTP_400_BAD_REQUEST, details)


class QuotaExceededError(GigaPDFException):
    """Raised when storage quota is exceeded."""

    def __init__(self, message: str = "Storage quota exceeded"):
        super().__init__("QUOTA_EXCEEDED", message, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)


class JobNotFoundError(GigaPDFException):
    """Raised when a job is not found."""

    def __init__(self, job_id: str):
        super().__init__(
            "JOB_NOT_FOUND",
            f"Job not found: {job_id}",
            status.HTTP_404_NOT_FOUND,
            {"job_id": job_id},
        )


class JobFailedError(GigaPDFException):
    """Raised when a job has failed."""

    def __init__(self, job_id: str, reason: str):
        super().__init__(
            "JOB_FAILED",
            f"Job failed: {reason}",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            {"job_id": job_id, "reason": reason},
        )


class AuthRequiredError(GigaPDFException):
    """Raised when authentication is required."""

    def __init__(self, message: str = "Authentication required"):
        super().__init__("AUTH_REQUIRED", message, status.HTTP_401_UNAUTHORIZED)


class AuthInvalidError(GigaPDFException):
    """Raised when authentication token is invalid."""

    def __init__(self, message: str = "Invalid or expired token"):
        super().__init__("AUTH_INVALID", message, status.HTTP_401_UNAUTHORIZED)


class NotFoundError(GigaPDFException):
    """Generic not found error for resources."""

    def __init__(self, message: str = "Resource not found"):
        super().__init__("NOT_FOUND", message, status.HTTP_404_NOT_FOUND)


def create_error_response(
    code: str,
    message: str,
    status_code: int,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    """
    Create a standardized error response.

    Args:
        code: Error code.
        message: Error message.
        status_code: HTTP status code.
        details: Additional error details.

    Returns:
        JSONResponse: Formatted error response.
    """
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": code,
                "message": message,
                "details": details,
            },
            "meta": {
                "request_id": get_request_id(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        },
    )


def setup_exception_handlers(app: FastAPI) -> None:
    """
    Configure global exception handlers for the application.

    Args:
        app: FastAPI application instance.
    """

    @app.exception_handler(GigaPDFException)
    async def gigapdf_exception_handler(
        request: Request, exc: GigaPDFException
    ) -> JSONResponse:
        """Handle Giga-PDF specific exceptions."""
        logger.warning(
            f"GigaPDFException: {exc.code} - {exc.message}",
            extra={"request_id": get_request_id(), "details": exc.details},
        )
        return create_error_response(
            exc.code, exc.message, exc.status_code, exc.details
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Handle request validation errors."""
        errors = []
        for error in exc.errors():
            errors.append({
                "field": ".".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            })

        logger.warning(
            f"Validation error: {errors}",
            extra={"request_id": get_request_id()},
        )
        return create_error_response(
            "VALIDATION_ERROR",
            "Request validation failed",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"errors": errors},
        )

    @app.exception_handler(ValidationError)
    async def pydantic_validation_handler(
        request: Request, exc: ValidationError
    ) -> JSONResponse:
        """Handle Pydantic validation errors."""
        errors = []
        for error in exc.errors():
            errors.append({
                "field": ".".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            })

        return create_error_response(
            "VALIDATION_ERROR",
            "Data validation failed",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"errors": errors},
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        """Handle all unhandled exceptions."""
        logger.exception(
            f"Unhandled exception: {exc}",
            extra={"request_id": get_request_id()},
        )
        return create_error_response(
            "INTERNAL_ERROR",
            "An internal error occurred",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
