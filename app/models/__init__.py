"""
Pydantic models for Giga-PDF data structures.

This module exports all domain models used throughout the application.
"""

from app.models.bookmarks import BookmarkDestination, BookmarkObject, BookmarkStyle
from app.models.document import (
    DocumentMetadata,
    DocumentObject,
    DocumentPermissions,
    EmbeddedFileObject,
)
from app.models.elements import (
    AnnotationElement,
    Bounds,
    ElementBase,
    ElementType,
    FormFieldElement,
    ImageElement,
    ShapeElement,
    TextElement,
    Transform,
)
from app.models.history import HistoryEntry, HistoryState
from app.models.jobs import JobObject, JobStatus, JobType
from app.models.layers import LayerObject
from app.models.page import Dimensions, MediaBox, PageObject, PagePreview

__all__ = [
    # Document
    "DocumentObject",
    "DocumentMetadata",
    "DocumentPermissions",
    "EmbeddedFileObject",
    # Page
    "PageObject",
    "Dimensions",
    "MediaBox",
    "PagePreview",
    # Elements
    "ElementBase",
    "ElementType",
    "Bounds",
    "Transform",
    "TextElement",
    "ImageElement",
    "ShapeElement",
    "AnnotationElement",
    "FormFieldElement",
    # Layers
    "LayerObject",
    # Bookmarks
    "BookmarkObject",
    "BookmarkDestination",
    "BookmarkStyle",
    # History
    "HistoryState",
    "HistoryEntry",
    # Jobs
    "JobObject",
    "JobStatus",
    "JobType",
]
