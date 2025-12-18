"""Request schemas for API endpoints."""

from app.schemas.requests.documents import (
    DocumentUploadParams,
    UnlockDocumentRequest,
)
from app.schemas.requests.elements import (
    BatchOperationRequest,
    CreateElementRequest,
    DuplicateElementRequest,
    MoveElementRequest,
    UpdateElementRequest,
)
from app.schemas.requests.pages import (
    AddPageRequest,
    ReorderPagesRequest,
    ResizePageRequest,
    RotatePageRequest,
)

__all__ = [
    "DocumentUploadParams",
    "UnlockDocumentRequest",
    "AddPageRequest",
    "RotatePageRequest",
    "ResizePageRequest",
    "ReorderPagesRequest",
    "CreateElementRequest",
    "UpdateElementRequest",
    "MoveElementRequest",
    "DuplicateElementRequest",
    "BatchOperationRequest",
]
