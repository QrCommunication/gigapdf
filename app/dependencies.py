"""
FastAPI dependency injection.

Provides reusable dependencies for routes including
authentication, services, and database sessions.
"""

from typing import Annotated

from fastapi import Depends, Header

from app.config import Settings, get_settings
from app.middleware.auth import CurrentUser, get_current_user, get_optional_user
from app.repositories.document_repo import DocumentSession, document_sessions
from app.services.document_service import DocumentService, document_service
from app.services.element_service import ElementService, element_service
from app.services.history_service import HistoryService, history_service


# Settings dependency
def get_app_settings() -> Settings:
    """Get application settings."""
    return get_settings()


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


# Authentication dependencies
AuthenticatedUser = Annotated[CurrentUser, Depends(get_current_user)]
OptionalUser = Annotated[CurrentUser | None, Depends(get_optional_user)]


# Service dependencies
def get_document_service() -> DocumentService:
    """Get document service instance."""
    return document_service


def get_element_service() -> ElementService:
    """Get element service instance."""
    return element_service


def get_history_service() -> HistoryService:
    """Get history service instance."""
    return history_service


DocumentServiceDep = Annotated[DocumentService, Depends(get_document_service)]
ElementServiceDep = Annotated[ElementService, Depends(get_element_service)]
HistoryServiceDep = Annotated[HistoryService, Depends(get_history_service)]


# Document session dependency
async def get_document_session(
    document_id: str,
) -> DocumentSession:
    """
    Get document session or raise 404.

    Loads from Redis if not in local cache.

    Args:
        document_id: Document identifier from path.

    Returns:
        DocumentSession: Active document session.

    Raises:
        HTTPException: If document not found.
    """
    from fastapi import HTTPException, status

    # Try async loading (checks local cache then Redis)
    session = await document_sessions.get_session_async(document_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document not found: {document_id}",
        )
    return session


async def preload_document_session(document_id: str) -> bool:
    """
    Preload document session from Redis to local cache.

    Use this in endpoints before calling sync service methods.

    Args:
        document_id: Document identifier.

    Returns:
        bool: True if session is available.
    """
    return await document_sessions.preload_session(document_id)


DocumentSessionDep = Annotated[DocumentSession, Depends(get_document_session)]


# Language header for i18n
def get_accept_language(
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> str:
    """
    Get preferred language from Accept-Language header.

    Args:
        accept_language: Accept-Language header value.

    Returns:
        str: Language code (default: en).
    """
    if not accept_language:
        return "en"

    # Parse Accept-Language header (simplified)
    # Full implementation would parse q values
    lang = accept_language.split(",")[0].split("-")[0].lower()

    supported = {"en", "fr", "es", "de", "pt", "it", "nl", "ru", "zh", "ja", "ko"}
    return lang if lang in supported else "en"


LanguageDep = Annotated[str, Depends(get_accept_language)]
