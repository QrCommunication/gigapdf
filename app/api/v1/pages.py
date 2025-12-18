"""
Page management endpoints.

Handles page CRUD, preview generation, rotation, and reordering.
"""

import time
from typing import Literal, Optional

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.requests.pages import (
    AddPageRequest,
    ExtractPagesRequest,
    ReorderPagesRequest,
    ResizePageRequest,
    RotatePageRequest,
)
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.document_service import document_service
from app.utils.helpers import now_utc

router = APIRouter()


@router.get(
    "/{page_number}",
    response_model=APIResponse[dict],
    summary="Get page",
    description="""
Retrieve a specific page with all its elements.

## Path Parameters
- **document_id**: Document identifier
- **page_number**: Page number (1-indexed)

## Query Parameters
- **include_elements**: Include page elements (default: true)

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/pages/1" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1",
    headers={"Authorization": "Bearer <token>"}
)
page = response.json()["data"]
```
""",
)
async def get_page(
    document_id: str,
    page_number: int,
    include_elements: bool = Query(default=True),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get a specific page."""
    start_time = time.time()

    page = document_service.get_page(
        document_id=document_id,
        page_number=page_number,
        include_elements=include_elements,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=page.model_dump(),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{page_number}/preview",
    summary="Get page preview",
    description="""
Render a page as an image.

## Path Parameters
- **document_id**: Document identifier
- **page_number**: Page number (1-indexed)

## Query Parameters
- **format**: Output format (png, jpeg, webp, svg) - default: png
- **dpi**: Resolution in dots per inch (72-600) - default: 150
- **quality**: JPEG/WebP quality (1-100) - default: 85
- **scale**: Alternative to dpi, direct scale factor

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/pages/1/preview?dpi=150&format=png" \\
  -H "Authorization: Bearer <token>" \\
  -o page1.png
```

## Example (JavaScript)
```javascript
// Display preview in an image element
const img = document.getElementById('preview');
img.src = `/api/v1/documents/${documentId}/pages/1/preview?dpi=150`;
```
""",
    responses={
        200: {
            "description": "Page preview image",
            "content": {
                "image/png": {},
                "image/jpeg": {},
                "image/webp": {},
                "image/svg+xml": {},
            },
        },
    },
)
async def get_page_preview(
    document_id: str,
    page_number: int,
    format: Literal["png", "jpeg", "webp", "svg"] = Query(default="png"),
    dpi: int = Query(default=150, ge=72, le=600),
    quality: int = Query(default=85, ge=1, le=100),
    scale: Optional[float] = Query(default=None),
    user: OptionalUser = None,
) -> Response:
    """Get page preview image."""
    image_data, content_type = document_service.get_page_preview(
        document_id=document_id,
        page_number=page_number,
        dpi=dpi,
        format=format,
        quality=quality,
    )

    return Response(
        content=image_data,
        media_type=content_type,
        headers={"Content-Length": str(len(image_data))},
    )


@router.post(
    "",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Add page",
    description="""
Add a new page to the document.

## Request Body
```json
{
  "position": 2,
  "source": {
    "type": "blank",
    "dimensions": {"width": 612, "height": 792}
  }
}
```

## Source Types
- **blank**: Create an empty page with specified dimensions
- **from_document**: Copy from another document
- **from_template**: Use a predefined template

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"position": 2, "source": {"type": "blank", "dimensions": {"width": 612, "height": 792}}}'
```

## Example (Python)
```python
import requests

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json={"position": 2, "source": {"type": "blank", "dimensions": {"width": 612, "height": 792}}}
)
new_page = response.json()["data"]["page"]
```
""",
)
async def add_page(
    document_id: str,
    request: AddPageRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Add a new page to the document."""
    start_time = time.time()

    source = request.source
    width = source.get("dimensions", {}).get("width", 612)
    height = source.get("dimensions", {}).get("height", 792)

    page = document_service.add_page(
        document_id=document_id,
        position=request.position,
        width=width,
        height=height,
    )

    processing_time = int((time.time() - start_time) * 1000)

    # Get updated page count
    doc = document_service.get_document(document_id, include_elements=False)

    return APIResponse(
        success=True,
        data={
            "page": page.model_dump(),
            "new_page_count": doc.metadata.page_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/{page_number}",
    response_model=APIResponse[dict],
    summary="Delete page",
    description="""
Delete a page from the document.

Note: Cannot delete the last remaining page.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/documents/{document_id}/pages/2" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def delete_page(
    document_id: str,
    page_number: int,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Delete a page from the document."""
    new_page_count = document_service.delete_page(
        document_id=document_id,
        page_number=page_number,
    )

    return APIResponse(
        success=True,
        data={
            "deleted_page_number": page_number,
            "new_page_count": new_page_count,
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.put(
    "/reorder",
    response_model=APIResponse[dict],
    summary="Reorder pages",
    description="""
Reorder pages in the document.

## Request Body
```json
{
  "new_order": [3, 1, 2, 5, 4]
}
```

The new_order array specifies the new positions. For example,
[3, 1, 2] means:
- Current page 3 becomes page 1
- Current page 1 becomes page 2
- Current page 2 becomes page 3

## Example (curl)
```bash
curl -X PUT "http://localhost:8000/api/v1/documents/{document_id}/pages/reorder" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"new_order": [3, 1, 2, 5, 4]}'
```
""",
)
async def reorder_pages(
    document_id: str,
    request: ReorderPagesRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Reorder pages in the document."""
    pages = document_service.reorder_pages(
        document_id=document_id,
        new_order=request.new_order,
    )

    return APIResponse(
        success=True,
        data={
            "pages": [
                {
                    "page_id": p.page_id,
                    "page_number": p.page_number,
                    "dimensions": p.dimensions.model_dump(),
                }
                for p in pages
            ]
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.put(
    "/{page_number}/rotate",
    response_model=APIResponse[dict],
    summary="Rotate page",
    description="""
Rotate a page by the specified angle.

## Request Body
```json
{
  "angle": 90
}
```

Valid angles: 90, 180, 270, -90, -180, -270

## Example (curl)
```bash
curl -X PUT "http://localhost:8000/api/v1/documents/{document_id}/pages/1/rotate" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"angle": 90}'
```
""",
)
async def rotate_page(
    document_id: str,
    page_number: int,
    request: RotatePageRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Rotate a page."""
    page = document_service.rotate_page(
        document_id=document_id,
        page_number=page_number,
        angle=request.angle,
    )

    return APIResponse(
        success=True,
        data=page.model_dump(),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.put(
    "/{page_number}/resize",
    response_model=APIResponse[dict],
    summary="Resize page",
    description="""
Resize a page to new dimensions.

## Request Body
```json
{
  "width": 612,
  "height": 792,
  "anchor": "center",
  "scale_content": false
}
```

## Anchor Points
Controls where content is positioned after resize:
- top-left, top-center, top-right
- center-left, center, center-right
- bottom-left, bottom-center, bottom-right

## Example (curl)
```bash
curl -X PUT "http://localhost:8000/api/v1/documents/{document_id}/pages/1/resize" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"width": 792, "height": 612, "anchor": "center", "scale_content": true}'
```
""",
)
async def resize_page(
    document_id: str,
    page_number: int,
    request: ResizePageRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Resize a page."""
    # Would need implementation in document service
    # Placeholder response
    return APIResponse(
        success=True,
        data={"message": "Page resized"},
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/extract",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Extract pages",
    description="""
Extract specified pages to a new document.

## Request Body
```json
{
  "page_numbers": [1, 3, 5, 7],
  "page_ranges": ["10-15", "20-25"]
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/extract" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"page_numbers": [1, 3, 5]}'
```
""",
)
async def extract_pages(
    document_id: str,
    request: ExtractPagesRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Extract pages to a new document."""
    # Would need implementation in document service
    # Placeholder response
    return APIResponse(
        success=True,
        data={
            "new_document_id": "new-uuid-here",
            "page_count": len(request.page_numbers or []),
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )
