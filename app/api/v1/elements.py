"""
Element management endpoints.

Handles CRUD operations for page elements (text, images, shapes,
annotations, form fields).
"""

import time
from typing import Optional

from fastapi import APIRouter, Query

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.models.elements import ElementType
from app.schemas.requests.elements import (
    BatchOperationRequest,
    CreateElementRequest,
    DuplicateElementRequest,
    MoveElementRequest,
    UpdateElementRequest,
)
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services.element_service import element_service
from app.utils.helpers import now_utc

router = APIRouter()


@router.get(
    "/pages/{page_number}/elements",
    response_model=APIResponse[dict],
    summary="List page elements",
    description="""
Get all elements on a specific page with pagination support.

## Query Parameters
- **type**: Filter by element type (text, image, shape, annotation, form_field)
- **layer_id**: Filter by layer ID
- **page**: Page number for pagination (default: 1)
- **per_page**: Items per page (default: 50, max: 200)

## Response
Returns paginated list of elements.

```json
{
  "success": true,
  "data": {
    "elements": [...],
    "pagination": {
      "total": 150,
      "page": 1,
      "per_page": 50,
      "total_pages": 3
    }
  }
}
```

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/pages/1/elements?page=1&per_page=50" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir les éléments avec pagination
response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1/elements",
    headers={"Authorization": "Bearer <token>"},
    params={"type": "text", "page": 1, "per_page": 50}
)
data = response.json()["data"]
elements = data["elements"]
pagination = data["pagination"]
print(f"Page {pagination['page']}/{pagination['total_pages']}")
```

## Example (JavaScript)
```javascript
// Récupérer les éléments avec pagination
const params = new URLSearchParams({
  type: 'text',
  page: '1',
  per_page: '50'
});
const response = await fetch(
  `/api/v1/documents/${documentId}/pages/1/elements?${params}`,
  { headers: { 'Authorization': 'Bearer <token>' } }
);
const result = await response.json();
console.log(`Page ${result.data.pagination.page}/${result.data.pagination.total_pages}`);
```

## Example (PHP)
```php
// Obtenir les éléments avec pagination
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/pages/1/elements",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => ['type' => 'text', 'page' => 1, 'per_page' => 50]
    ]
);
$data = json_decode($response->getBody(), true)['data'];
echo "Page {$data['pagination']['page']}/{$data['pagination']['total_pages']}";
```
""",
)
async def list_elements(
    document_id: str,
    page_number: int,
    type: Optional[str] = Query(default=None, description="Filter by element type"),
    layer_id: Optional[str] = Query(default=None, description="Filter by layer"),
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=50, ge=1, le=200, description="Items per page"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """List elements on a page with pagination."""
    start_time = time.time()

    element_type = ElementType(type) if type else None

    # Get all elements matching criteria
    all_elements = element_service.get_elements(
        document_id=document_id,
        page_number=page_number,
        element_type=element_type,
        layer_id=layer_id,
    )

    # Calculate pagination
    total = len(all_elements)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    offset = (page - 1) * per_page
    paginated_elements = all_elements[offset : offset + per_page]

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "elements": [e.model_dump() for e in paginated_elements],
            "pagination": PaginationInfo(
                total=total,
                page=page,
                per_page=per_page,
                total_pages=total_pages,
            ).model_dump(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/elements/{element_id}",
    response_model=APIResponse[dict],
    summary="Get element",
    description="""
Get a specific element by ID.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/elements/{element_id}" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def get_element(
    document_id: str,
    element_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get a specific element."""
    element, page_number = element_service.get_element(
        document_id=document_id,
        element_id=element_id,
    )

    return APIResponse(
        success=True,
        data={
            "element": element.model_dump(),
            "page_number": page_number,
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/pages/{page_number}/elements",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create element",
    description="""
Create a new element on a page.

## Request Body
```json
{
  "type": "text",
  "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
  "content": "Hello, World!",
  "style": {
    "font_family": "Helvetica",
    "font_size": 14,
    "color": "#000000"
  }
}
```

## Element Types
- **text**: Text content with styling
- **image**: Image (requires separate image upload)
- **shape**: Rectangle, ellipse, line, polygon, path
- **annotation**: Highlight, underline, note, link, etc.
- **form_field**: Text input, checkbox, dropdown, etc.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/1/elements" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "text",
    "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
    "content": "Hello, World!",
    "style": {"font_size": 14, "color": "#000000"}
  }'
```

## Example (Python)
```python
import requests

element_data = {
    "type": "text",
    "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
    "content": "Hello, World!",
    "style": {"font_size": 14, "color": "#000000"}
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1/elements",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=element_data
)
new_element = response.json()["data"]
```

## Example (JavaScript)
```javascript
const elementData = {
  type: 'text',
  bounds: { x: 100, y: 100, width: 200, height: 50 },
  content: 'Hello, World!',
  style: { fontSize: 14, color: '#000000' }
};

const response = await fetch(`/api/v1/documents/${documentId}/pages/1/elements`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(elementData)
});
const result = await response.json();
```

## Example (PHP)
```php
$elementData = [
    'type' => 'text',
    'bounds' => ['x' => 100, 'y' => 100, 'width' => 200, 'height' => 50],
    'content' => 'Hello, World!',
    'style' => ['font_size' => 14, 'color' => '#000000']
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/pages/1/elements",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $elementData
    ]
);
```
""",
)
async def create_element(
    document_id: str,
    page_number: int,
    request: CreateElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a new element on a page."""
    start_time = time.time()

    element_data = request.model_dump(exclude_none=True)

    element = element_service.create_element(
        document_id=document_id,
        page_number=page_number,
        element_data=element_data,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=element.model_dump(),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.patch(
    "/elements/{element_id}",
    response_model=APIResponse[dict],
    summary="Update element",
    description="""
Update an existing element.

Only include fields you want to change in the request body.

## Request Body
```json
{
  "bounds": {"x": 150, "y": 150, "width": 200, "height": 50},
  "style": {"color": "#FF0000"}
}
```

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/documents/{document_id}/elements/{element_id}" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"bounds": {"x": 150, "y": 150}, "style": {"color": "#FF0000"}}'
```
""",
)
async def update_element(
    document_id: str,
    element_id: str,
    request: UpdateElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Update an element."""
    start_time = time.time()

    updates = request.model_dump(exclude_none=True)

    element = element_service.update_element(
        document_id=document_id,
        element_id=element_id,
        updates=updates,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=element.model_dump(),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/elements/{element_id}",
    status_code=204,
    summary="Delete element",
    description="""
Delete an element from the document.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/documents/{document_id}/elements/{element_id}" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def delete_element(
    document_id: str,
    element_id: str,
    user: OptionalUser = None,
) -> None:
    """Delete an element."""
    element_service.delete_element(
        document_id=document_id,
        element_id=element_id,
    )


@router.put(
    "/elements/{element_id}/move",
    response_model=APIResponse[dict],
    summary="Move element to another page",
    description="""
Move an element to a different page.

## Request Body
```json
{
  "target_page_number": 3,
  "new_bounds": {"x": 100, "y": 200}
}
```

## Example (curl)
```bash
curl -X PUT "http://localhost:8000/api/v1/documents/{document_id}/elements/{element_id}/move" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"target_page_number": 3}'
```
""",
)
async def move_element(
    document_id: str,
    element_id: str,
    request: MoveElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Move element to another page."""
    from app.models.elements import Bounds

    new_bounds = None
    if request.new_bounds:
        # Get current element to fill in missing bounds
        element, _ = element_service.get_element(document_id, element_id)
        new_bounds = Bounds(
            x=request.new_bounds.get("x", element.bounds.x),
            y=request.new_bounds.get("y", element.bounds.y),
            width=request.new_bounds.get("width", element.bounds.width),
            height=request.new_bounds.get("height", element.bounds.height),
        )

    element = element_service.move_element(
        document_id=document_id,
        element_id=element_id,
        target_page=request.target_page_number,
        new_bounds=new_bounds,
    )

    return APIResponse(
        success=True,
        data=element.model_dump(),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/elements/{element_id}/duplicate",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Duplicate element",
    description="""
Create a copy of an element.

## Request Body
```json
{
  "target_page_number": null,
  "offset": {"x": 10, "y": 10}
}
```

If target_page_number is null, duplicates to the same page.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/elements/{element_id}/duplicate" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"offset": {"x": 20, "y": 20}}'
```
""",
)
async def duplicate_element(
    document_id: str,
    element_id: str,
    request: DuplicateElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Duplicate an element."""
    element = element_service.duplicate_element(
        document_id=document_id,
        element_id=element_id,
        target_page=request.target_page_number,
        offset_x=request.offset.get("x", 10),
        offset_y=request.offset.get("y", 10),
    )

    return APIResponse(
        success=True,
        data=element.model_dump(),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/elements/batch",
    response_model=APIResponse[dict],
    summary="Batch element operations",
    description="""
Perform multiple element operations in a single request.

## Request Body
```json
{
  "operations": [
    {
      "action": "create",
      "page_number": 1,
      "data": {
        "type": "text",
        "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
        "content": "New text"
      }
    },
    {
      "action": "update",
      "element_id": "element-uuid",
      "data": {"content": "Updated text"}
    },
    {
      "action": "delete",
      "element_id": "another-element-uuid"
    }
  ]
}
```

## Actions
- **create**: Create a new element (requires page_number and data)
- **update**: Update an existing element (requires element_id and data)
- **delete**: Delete an element (requires element_id)

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/elements/batch" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"operations": [...]}'
```
""",
)
async def batch_operations(
    document_id: str,
    request: BatchOperationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Perform batch element operations."""
    start_time = time.time()

    results = element_service.batch_operations(
        document_id=document_id,
        operations=request.operations,
    )

    processing_time = int((time.time() - start_time) * 1000)

    failed_count = sum(1 for r in results if not r.get("success", False))

    return APIResponse(
        success=True,
        data={
            "results": results,
            "failed_count": failed_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
