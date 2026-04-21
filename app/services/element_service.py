"""
Element Service - Element manipulation operations.

Handles CRUD operations for page elements (text, images, shapes,
annotations, form fields).
"""

import logging
from typing import Any, Optional, Union

from app.middleware.error_handler import (
    DocumentNotFoundError,
    ElementNotFoundError,
    InvalidOperationError,
    PageNotFoundError,
)
from app.models.elements import (
    AnnotationElement,
    Bounds,
    Element,
    ElementType,
    FormFieldElement,
    ImageElement,
    ShapeElement,
    TextElement,
)
from app.repositories.document_repo import document_sessions
from app.utils.helpers import generate_uuid

logger = logging.getLogger(__name__)


class ElementService:
    """
    Element manipulation service.

    Handles creating, updating, and deleting elements on PDF pages.
    """

    def get_elements(
        self,
        document_id: str,
        page_number: int,
        element_type: Optional[ElementType] = None,
        layer_id: Optional[str] = None,
    ) -> list[Element]:
        """
        Get elements from a page.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).
            element_type: Filter by element type.
            layer_id: Filter by layer.

        Returns:
            list[Element]: Page elements.
        """
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        if page_number < 1 or page_number > len(session.scene_graph.pages):
            raise PageNotFoundError(page_number)

        page = session.scene_graph.pages[page_number - 1]
        elements = page.elements

        # Apply filters
        if element_type:
            elements = [e for e in elements if e.type == element_type]

        if layer_id:
            elements = [e for e in elements if e.layer_id == layer_id]

        return elements

    def get_element(
        self,
        document_id: str,
        element_id: str,
    ) -> tuple[Element, int]:
        """
        Get a specific element.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.

        Returns:
            tuple: (element, page_number)
        """
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Search all pages for element
        for page in session.scene_graph.pages:
            for element in page.elements:
                if element.element_id == element_id:
                    return element, page.page_number

        raise ElementNotFoundError(element_id)

    def create_element(
        self,
        document_id: str,
        page_number: int,
        element_data: dict[str, Any],
    ) -> Element:
        """
        Create a new element on a page.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).
            element_data: Element data including type.

        Returns:
            Element: Created element.
        """
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        if page_number < 1 or page_number > len(session.scene_graph.pages):
            raise PageNotFoundError(page_number)

        # Generate element ID if not provided
        if "element_id" not in element_data:
            element_data["element_id"] = generate_uuid()

        element_type = element_data.get("type")

        # Create element based on type
        element: Element
        if element_type == ElementType.TEXT or element_type == "text":
            element = TextElement(**element_data)
        elif element_type == ElementType.IMAGE or element_type == "image":
            element = ImageElement(**element_data)
        elif element_type == ElementType.SHAPE or element_type == "shape":
            element = ShapeElement(**element_data)
        elif element_type == ElementType.ANNOTATION or element_type == "annotation":
            element = AnnotationElement(**element_data)
        elif element_type == ElementType.FORM_FIELD or element_type == "form_field":
            element = FormFieldElement(**element_data)
        else:
            raise InvalidOperationError(f"Unknown element type: {element_type}")

        # Add to scene graph
        session.scene_graph.pages[page_number - 1].elements.append(element)

        # Rendering is handled by @giga-pdf/pdf-engine (TypeScript); no Python render needed.

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Created {element_type} element",
            affected_elements=[element.element_id],
            affected_pages=[page_number],
        )

        logger.info(f"Created element {element.element_id} on page {page_number}")
        return element

    def update_element(
        self,
        document_id: str,
        element_id: str,
        updates: dict[str, Any],
    ) -> Element:
        """
        Update an existing element.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.
            updates: Fields to update.

        Returns:
            Element: Updated element.
        """
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Find element
        element, page_number = self.get_element(document_id, element_id)
        page = session.scene_graph.pages[page_number - 1]

        # Store old bounds for re-rendering
        old_bounds = element.bounds.model_copy()

        # Find element index
        element_index = None
        for i, e in enumerate(page.elements):
            if e.element_id == element_id:
                element_index = i
                break

        if element_index is None:
            raise ElementNotFoundError(element_id)

        # Update element fields
        element_dict = element.model_dump()
        for key, value in updates.items():
            if key not in ["element_id", "type"]:  # Don't allow changing ID or type
                if key in element_dict:
                    element_dict[key] = value
                elif "." in key:
                    # Handle nested updates like "style.color"
                    parts = key.split(".")
                    target = element_dict
                    for part in parts[:-1]:
                        target = target[part]
                    target[parts[-1]] = value

        # Recreate element with updates
        if element.type == ElementType.TEXT:
            updated_element = TextElement(**element_dict)
        elif element.type == ElementType.IMAGE:
            updated_element = ImageElement(**element_dict)
        elif element.type == ElementType.SHAPE:
            updated_element = ShapeElement(**element_dict)
        elif element.type == ElementType.ANNOTATION:
            updated_element = AnnotationElement(**element_dict)
        elif element.type == ElementType.FORM_FIELD:
            updated_element = FormFieldElement(**element_dict)
        else:
            raise InvalidOperationError(f"Unknown element type: {element.type}")

        # Update in scene graph
        page.elements[element_index] = updated_element

        # Rendering handled by @giga-pdf/pdf-engine (TypeScript); no Python render needed.

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Updated element {element_id}",
            affected_elements=[element_id],
            affected_pages=[page_number],
        )

        logger.info(f"Updated element {element_id}")
        return updated_element

    def delete_element(
        self,
        document_id: str,
        element_id: str,
    ) -> None:
        """
        Delete an element.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.
        """
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Find element
        element, page_number = self.get_element(document_id, element_id)
        page = session.scene_graph.pages[page_number - 1]

        # Remove from scene graph
        page.elements = [e for e in page.elements if e.element_id != element_id]

        # Rendering handled by @giga-pdf/pdf-engine (TypeScript); no Python render needed.

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Deleted element {element_id}",
            affected_elements=[element_id],
            affected_pages=[page_number],
        )

        logger.info(f"Deleted element {element_id}")

    def move_element(
        self,
        document_id: str,
        element_id: str,
        target_page: int,
        new_bounds: Optional[Bounds] = None,
    ) -> Element:
        """
        Move an element to a different page.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.
            target_page: Target page number (1-indexed).
            new_bounds: Optional new position.

        Returns:
            Element: Moved element.
        """
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        if target_page < 1 or target_page > len(session.scene_graph.pages):
            raise PageNotFoundError(target_page)

        # Get element and source page
        element, source_page = self.get_element(document_id, element_id)
        source_page_obj = session.scene_graph.pages[source_page - 1]
        target_page_obj = session.scene_graph.pages[target_page - 1]

        # Remove from source page
        source_page_obj.elements = [
            e for e in source_page_obj.elements if e.element_id != element_id
        ]

        # Update bounds if provided
        if new_bounds:
            element_dict = element.model_dump()
            element_dict["bounds"] = new_bounds.model_dump()

            # Recreate element
            if element.type == ElementType.TEXT:
                element = TextElement(**element_dict)
            elif element.type == ElementType.IMAGE:
                element = ImageElement(**element_dict)
            elif element.type == ElementType.SHAPE:
                element = ShapeElement(**element_dict)
            elif element.type == ElementType.ANNOTATION:
                element = AnnotationElement(**element_dict)
            elif element.type == ElementType.FORM_FIELD:
                element = FormFieldElement(**element_dict)

        # Add to target page
        target_page_obj.elements.append(element)

        # Rendering handled by @giga-pdf/pdf-engine (TypeScript); no Python render needed.

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Moved element from page {source_page} to {target_page}",
            affected_elements=[element_id],
            affected_pages=[source_page, target_page],
        )

        return element

    def duplicate_element(
        self,
        document_id: str,
        element_id: str,
        target_page: Optional[int] = None,
        offset_x: float = 10,
        offset_y: float = 10,
    ) -> Element:
        """
        Duplicate an element.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.
            target_page: Target page (same page if None).
            offset_x: X offset for the copy.
            offset_y: Y offset for the copy.

        Returns:
            Element: Duplicated element.
        """
        # Get original element
        element, source_page = self.get_element(document_id, element_id)

        if target_page is None:
            target_page = source_page

        # Create copy with new ID and offset
        element_dict = element.model_dump()
        element_dict["element_id"] = generate_uuid()
        element_dict["bounds"]["x"] += offset_x
        element_dict["bounds"]["y"] += offset_y

        # Create new element
        return self.create_element(document_id, target_page, element_dict)

    def batch_operations(
        self,
        document_id: str,
        operations: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Perform batch element operations.

        Args:
            document_id: Document identifier.
            operations: List of operations to perform.

        Returns:
            list: Results of each operation.
        """
        results = []

        for op in operations:
            action = op.get("action")
            element_id = op.get("element_id")
            page_number = op.get("page_number")
            data = op.get("data", {})

            try:
                if action == "create":
                    element = self.create_element(document_id, page_number, data)
                    results.append({
                        "action": "create",
                        "success": True,
                        "element": element.model_dump(),
                    })
                elif action == "update":
                    element = self.update_element(document_id, element_id, data)
                    results.append({
                        "action": "update",
                        "success": True,
                        "element": element.model_dump(),
                    })
                elif action == "delete":
                    self.delete_element(document_id, element_id)
                    results.append({
                        "action": "delete",
                        "success": True,
                        "element_id": element_id,
                    })
                else:
                    results.append({
                        "action": action,
                        "success": False,
                        "error": f"Unknown action: {action}",
                    })
            except Exception as e:
                results.append({
                    "action": action,
                    "success": False,
                    "error": str(e),
                })

        return results

    def _render_element(
        self,
        page_number: int,
        element: Element,
        image_data: Optional[bytes] = None,
    ) -> None:
        """
        No-op stub — rendering is handled by @giga-pdf/pdf-engine (TypeScript).

        Scene graph is the source of truth; the TS engine applies elements to
        the PDF bytes when saving. This method is retained for call-site
        compatibility during migration and can be removed once all callers
        are confirmed migrated.

        Args:
            page_number: Page number (1-indexed).
            element: Element that was added/updated.
            image_data: Image bytes (unused).
        """
        # No-op: TS engine handles rendering.


# Global service instance
element_service = ElementService()
