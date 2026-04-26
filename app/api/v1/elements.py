"""
Element management endpoints.

Handles CRUD operations for page elements (text, images, shapes,
annotations, form fields).
"""

import time

from fastapi import APIRouter, Query

from app.dependencies import preload_document_session
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
Retrieve all elements on a specific page with optional filtering and pagination support.

This endpoint returns a paginated list of elements that exist on the specified page of a document.
Elements can be filtered by type (text, image, shape, annotation, form_field) or by layer ID.

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | null | Filter by element type: `text`, `image`, `shape`, `annotation`, `form_field` |
| `layer_id` | string | null | Filter elements belonging to a specific layer |
| `page` | integer | 1 | Page number for pagination (min: 1) |
| `per_page` | integer | 50 | Number of items per page (min: 1, max: 200) |

## Response Structure

The response includes an array of elements and pagination metadata:

```json
{
  "success": true,
  "data": {
    "elements": [
      {
        "id": "elem_abc123",
        "type": "text",
        "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
        "content": "Sample text",
        "style": {"fontSize": 14, "color": "#000000"}
      }
    ],
    "pagination": {
      "total": 150,
      "page": 1,
      "perPage": 50,
      "totalPages": 3
    }
  },
  "meta": {
    "requestId": "req_xyz789",
    "timestamp": "2024-01-15T10:30:00Z",
    "processingTimeMs": 45
  }
}
```

## Element Types

- **text**: Text boxes with formatting options
- **image**: Embedded images with positioning
- **shape**: Geometric shapes (rectangles, ellipses, lines, polygons)
- **annotation**: PDF annotations (highlights, notes, links)
- **form_field**: Interactive form fields (inputs, checkboxes, dropdowns)
""",
    responses={
        200: {
            "description": "Elements retrieved successfully with pagination info"
        },
        400: {
            "description": "Invalid query parameters (e.g., invalid element type)"
        },
        401: {"description": "Authentication required or invalid token"},
        404: {"description": "Document or page not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/1/elements?type=text&page=1&per_page=50" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Accept: application/json\"""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# List all text elements on page 1
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/1/elements",
    headers={"Authorization": f"Bearer {token}"},
    params={
        "type": "text",
        "page": 1,
        "per_page": 50
    }
)

data = response.json()
elements = data["data"]["elements"]
pagination = data["data"]["pagination"]

print(f"Found {pagination['total']} elements")
print(f"Page {pagination['page']} of {pagination['totalPages']}")

for element in elements:
    print(f"Element {element['id']}: {element['type']}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// List elements with filtering and pagination
const params = new URLSearchParams({
  type: 'text',
  page: '1',
  per_page: '50'
});

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/pages/1/elements?${params}`,
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  }
);

const result = await response.json();
const { elements, pagination } = result.data;

console.log(`Found ${pagination.total} elements`);
console.log(`Page ${pagination.page} of ${pagination.totalPages}`);

elements.forEach(el => {
  console.log(`Element ${el.id}: ${el.type}`);
});""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// List elements on page 1 with filtering
$ch = curl_init();

$queryParams = http_build_query([
    'type' => 'text',
    'page' => 1,
    'per_page' => 50
]);

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/pages/1/elements?{$queryParams}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Accept: application/json"
    ]
]);

$response = curl_exec($ch);
$data = json_decode($response, true);
curl_close($ch);

$elements = $data['data']['elements'];
$pagination = $data['data']['pagination'];

echo "Found {$pagination['total']} elements\\n";
echo "Page {$pagination['page']} of {$pagination['totalPages']}\\n";

foreach ($elements as $element) {
    echo "Element {$element['id']}: {$element['type']}\\n";
}""",
            },
        ]
    },
)
async def list_elements(
    document_id: str,
    page_number: int,
    type: str | None = Query(default=None, description="Filter by element type"),
    layer_id: str | None = Query(default=None, description="Filter by layer"),
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=50, ge=1, le=200, description="Items per page"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    List elements on a page with pagination.

    Retrieves all elements on the specified page of a document with optional
    filtering by element type and layer. Results are paginated for efficient
    handling of pages with many elements.

    Args:
        document_id: The unique identifier of the document.
        page_number: The page number to retrieve elements from (1-indexed).
        type: Optional filter for element type (text, image, shape, etc.).
        layer_id: Optional filter for elements in a specific layer.
        page: Page number for pagination results.
        per_page: Number of elements to return per page (max 200).
        user: The authenticated user (optional).

    Returns:
        APIResponse containing the list of elements and pagination metadata.

    Raises:
        HTTPException: 404 if document or page not found.
        HTTPException: 400 if invalid element type specified.
    """
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
            "elements": [e.model_dump(by_alias=True) for e in paginated_elements],
            "pagination": PaginationInfo(
                total=total,
                page=page,
                per_page=per_page,
                total_pages=total_pages,
            ).model_dump(by_alias=True),
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
    summary="Get element by ID",
    description="""
Retrieve a specific element by its unique identifier.

This endpoint returns the complete details of an element, including its type,
position, dimensions, content, and styling. The response also includes the
page number where the element is located.

## Response Structure

```json
{
  "success": true,
  "data": {
    "element": {
      "id": "elem_abc123",
      "type": "text",
      "bounds": {
        "x": 100,
        "y": 200,
        "width": 300,
        "height": 50
      },
      "content": "Hello, World!",
      "style": {
        "fontFamily": "Helvetica",
        "fontSize": 14,
        "fontWeight": "normal",
        "color": "#000000"
      },
      "layerId": "layer_main",
      "locked": false,
      "visible": true,
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    },
    "pageNumber": 1
  }
}
```

## Use Cases

- Fetching element details for editing in a UI
- Retrieving element properties before performing updates
- Getting the current state of an element after async operations
""",
    responses={
        200: {"description": "Element retrieved successfully"},
        401: {"description": "Authentication required or invalid token"},
        404: {"description": "Document or element not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Accept: application/json\"""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get a specific element by ID
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()
element = data["data"]["element"]
page_number = data["data"]["pageNumber"]

print(f"Element type: {element['type']}")
print(f"Located on page: {page_number}")
print(f"Position: ({element['bounds']['x']}, {element['bounds']['y']})")
print(f"Size: {element['bounds']['width']}x{element['bounds']['height']}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Fetch a specific element
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/elements/${elementId}`,
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  }
);

const result = await response.json();
const { element, pageNumber } = result.data;

console.log(`Element type: ${element.type}`);
console.log(`Located on page: ${pageNumber}`);
console.log(`Position: (${element.bounds.x}, ${element.bounds.y})`);
console.log(`Size: ${element.bounds.width}x${element.bounds.height}`);""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get element by ID
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/elements/{$elementId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Accept: application/json"
    ]
]);

$response = curl_exec($ch);
$data = json_decode($response, true);
curl_close($ch);

$element = $data['data']['element'];
$pageNumber = $data['data']['pageNumber'];

echo "Element type: {$element['type']}\\n";
echo "Located on page: {$pageNumber}\\n";
echo "Position: ({$element['bounds']['x']}, {$element['bounds']['y']})\\n";""",
            },
        ]
    },
)
async def get_element(
    document_id: str,
    element_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Get a specific element by ID.

    Retrieves complete details of an element including its properties,
    styling, and the page number where it is located.

    Args:
        document_id: The unique identifier of the document.
        element_id: The unique identifier of the element to retrieve.
        user: The authenticated user (optional).

    Returns:
        APIResponse containing the element data and its page number.

    Raises:
        HTTPException: 404 if document or element not found.
    """
    # Preload session from Redis if needed
    await preload_document_session(document_id)

    element, page_number = element_service.get_element(
        document_id=document_id,
        element_id=element_id,
    )

    return APIResponse(
        success=True,
        data={
            "element": element.model_dump(by_alias=True),
            "page_number": page_number,
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/pages/{page_number}/elements",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create a new element",
    description="""
Create a new element on a specific page of the document.

This endpoint allows you to add various types of elements to a PDF page,
including text boxes, images, shapes, annotations, and form fields.

## Element Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `text` | Text content with styling | `content`, `bounds`, `style` |
| `image` | Image element | `bounds`, `imageId` or `imageUrl` |
| `shape` | Geometric shape | `bounds`, `shapeType`, `style` |
| `annotation` | PDF annotation | `bounds`, `annotationType` |
| `form_field` | Form input field | `bounds`, `fieldType`, `fieldName` |

## Request Body Schema

```json
{
  "type": "text",
  "bounds": {
    "x": 100,
    "y": 200,
    "width": 300,
    "height": 50
  },
  "content": "Your text content here",
  "style": {
    "fontFamily": "Helvetica",
    "fontSize": 14,
    "fontWeight": "normal",
    "fontStyle": "normal",
    "color": "#000000",
    "backgroundColor": null,
    "textAlign": "left",
    "lineHeight": 1.2
  },
  "layerId": "layer_main",
  "locked": false,
  "visible": true,
  "opacity": 1.0,
  "rotation": 0
}
```

## Shape Types

For `shape` elements, use one of: `rectangle`, `ellipse`, `line`, `polygon`, `path`

## Annotation Types

For `annotation` elements: `highlight`, `underline`, `strikeout`, `note`, `link`, `stamp`

## Form Field Types

For `form_field` elements: `text_input`, `checkbox`, `radio`, `dropdown`, `signature`
""",
    responses={
        201: {"description": "Element created successfully"},
        400: {
            "description": "Invalid element data or missing required fields"
        },
        401: {"description": "Authentication required or invalid token"},
        404: {"description": "Document or page not found"},
        413: {"description": "Element data too large"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/1/elements" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "text",
    "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
    "content": "Hello, World!",
    "style": {
      "fontFamily": "Helvetica",
      "fontSize": 14,
      "color": "#000000"
    }
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Create a text element
element_data = {
    "type": "text",
    "bounds": {
        "x": 100,
        "y": 200,
        "width": 300,
        "height": 50
    },
    "content": "Hello, World!",
    "style": {
        "fontFamily": "Helvetica",
        "fontSize": 14,
        "color": "#000000"
    }
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/1/elements",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=element_data
)

if response.status_code == 201:
    new_element = response.json()["data"]
    print(f"Created element with ID: {new_element['id']}")
else:
    print(f"Error: {response.json()}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Create a text element on page 1
const elementData = {
  type: 'text',
  bounds: {
    x: 100,
    y: 200,
    width: 300,
    height: 50
  },
  content: 'Hello, World!',
  style: {
    fontFamily: 'Helvetica',
    fontSize: 14,
    color: '#000000'
  }
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/pages/1/elements`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(elementData)
  }
);

if (response.status === 201) {
  const result = await response.json();
  console.log(`Created element with ID: ${result.data.id}`);
} else {
  const error = await response.json();
  console.error('Error:', error);
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Create a text element
$elementData = [
    'type' => 'text',
    'bounds' => [
        'x' => 100,
        'y' => 200,
        'width' => 300,
        'height' => 50
    ],
    'content' => 'Hello, World!',
    'style' => [
        'fontFamily' => 'Helvetica',
        'fontSize' => 14,
        'color' => '#000000'
    ]
];

$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/pages/1/elements",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($elementData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 201) {
    $data = json_decode($response, true);
    echo "Created element with ID: {$data['data']['id']}\\n";
} else {
    echo "Error: {$response}\\n";
}""",
            },
        ]
    },
)
async def create_element(
    document_id: str,
    page_number: int,
    request: CreateElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Create a new element on a page.

    Adds a new element (text, image, shape, annotation, or form field)
    to the specified page of the document.

    Args:
        document_id: The unique identifier of the document.
        page_number: The page number to add the element to (1-indexed).
        request: The element creation request containing type, bounds, and properties.
        user: The authenticated user (optional).

    Returns:
        APIResponse containing the newly created element data.

    Raises:
        HTTPException: 400 if element data is invalid.
        HTTPException: 404 if document or page not found.
    """
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

    element_data = request.model_dump(exclude_none=True)

    element = element_service.create_element(
        document_id=document_id,
        page_number=page_number,
        element_data=element_data,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=element.model_dump(by_alias=True),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.patch(
    "/elements/{element_id}",
    response_model=APIResponse[dict],
    summary="Update an element",
    description="""
Update an existing element's properties.

This endpoint allows partial updates - only include the fields you want to change.
All other properties will remain unchanged.

## Updatable Properties

| Property | Type | Description |
|----------|------|-------------|
| `bounds` | object | Position and dimensions `{x, y, width, height}` |
| `content` | string | Text content (for text elements) |
| `style` | object | Styling properties (fonts, colors, etc.) |
| `layerId` | string | Move element to a different layer |
| `locked` | boolean | Prevent further modifications |
| `visible` | boolean | Show/hide the element |
| `opacity` | number | Transparency (0.0 to 1.0) |
| `rotation` | number | Rotation angle in degrees |

## Partial Update Example

To change only the text color and font size:

```json
{
  "style": {
    "color": "#FF0000",
    "fontSize": 18
  }
}
```

## Moving an Element

To reposition an element:

```json
{
  "bounds": {
    "x": 200,
    "y": 300
  }
}
```

Note: Omitting `width` and `height` keeps the current dimensions.

## Response

Returns the complete updated element with all properties.
""",
    responses={
        200: {"description": "Element updated successfully"},
        400: {"description": "Invalid update data"},
        401: {"description": "Authentication required or invalid token"},
        403: {"description": "Element is locked and cannot be modified"},
        404: {"description": "Document or element not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X PATCH "https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "bounds": {"x": 150, "y": 250},
    "style": {"color": "#FF0000", "fontSize": 18},
    "content": "Updated text content"
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Update element properties (partial update)
updates = {
    "bounds": {"x": 150, "y": 250},
    "style": {
        "color": "#FF0000",
        "fontSize": 18
    },
    "content": "Updated text content"
}

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=updates
)

if response.status_code == 200:
    updated_element = response.json()["data"]
    print(f"Element updated: {updated_element['id']}")
    print(f"New position: ({updated_element['bounds']['x']}, {updated_element['bounds']['y']})")
else:
    print(f"Error: {response.json()}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Update element with partial data
const updates = {
  bounds: { x: 150, y: 250 },
  style: {
    color: '#FF0000',
    fontSize: 18
  },
  content: 'Updated text content'
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/elements/${elementId}`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  }
);

if (response.ok) {
  const result = await response.json();
  const element = result.data;
  console.log(`Element updated: ${element.id}`);
  console.log(`New position: (${element.bounds.x}, ${element.bounds.y})`);
} else {
  const error = await response.json();
  console.error('Error:', error);
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Update element with partial data
$updates = [
    'bounds' => ['x' => 150, 'y' => 250],
    'style' => [
        'color' => '#FF0000',
        'fontSize' => 18
    ],
    'content' => 'Updated text content'
];

$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/elements/{$elementId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'PATCH',
    CURLOPT_POSTFIELDS => json_encode($updates),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200) {
    $data = json_decode($response, true);
    $element = $data['data'];
    echo "Element updated: {$element['id']}\\n";
    echo "New position: ({$element['bounds']['x']}, {$element['bounds']['y']})\\n";
} else {
    echo "Error: {$response}\\n";
}""",
            },
        ]
    },
)
async def update_element(
    document_id: str,
    element_id: str,
    request: UpdateElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Update an element.

    Performs a partial update on an element, modifying only the properties
    that are included in the request. Unchanged properties remain intact.

    Args:
        document_id: The unique identifier of the document.
        element_id: The unique identifier of the element to update.
        request: The update request containing fields to modify.
        user: The authenticated user (optional).

    Returns:
        APIResponse containing the updated element data.

    Raises:
        HTTPException: 400 if update data is invalid.
        HTTPException: 403 if element is locked.
        HTTPException: 404 if document or element not found.
    """
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

    updates = request.model_dump(exclude_none=True)

    element = element_service.update_element(
        document_id=document_id,
        element_id=element_id,
        updates=updates,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=element.model_dump(by_alias=True),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/elements/{element_id}",
    status_code=204,
    summary="Delete an element",
    description="""
Permanently delete an element from the document.

This operation removes the element and cannot be undone through the API.
For undo functionality, implement version history on the client side.

## Important Notes

- Deleting an element is permanent
- Locked elements cannot be deleted (unlock first)
- The element is removed from its page and layer
- Associated resources (e.g., images) may be garbage collected

## Response

Returns HTTP 204 No Content on successful deletion.
""",
    responses={
        204: {"description": "Element deleted successfully (no content returned)"},
        401: {"description": "Authentication required or invalid token"},
        403: {"description": "Element is locked and cannot be deleted"},
        404: {"description": "Document or element not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X DELETE "https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}" \\
  -H "Authorization: Bearer $TOKEN\"""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Delete an element
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}",
    headers={"Authorization": f"Bearer {token}"}
)

if response.status_code == 204:
    print("Element deleted successfully")
elif response.status_code == 404:
    print("Element not found")
elif response.status_code == 403:
    print("Element is locked - cannot delete")
else:
    print(f"Error: {response.status_code}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Delete an element
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/elements/${elementId}`,
  {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

if (response.status === 204) {
  console.log('Element deleted successfully');
} else if (response.status === 404) {
  console.log('Element not found');
} else if (response.status === 403) {
  console.log('Element is locked - cannot delete');
} else {
  console.error(`Error: ${response.status}`);
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Delete an element
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/elements/{$elementId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'DELETE',
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}"
    ]
]);

curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

switch ($httpCode) {
    case 204:
        echo "Element deleted successfully\\n";
        break;
    case 404:
        echo "Element not found\\n";
        break;
    case 403:
        echo "Element is locked - cannot delete\\n";
        break;
    default:
        echo "Error: {$httpCode}\\n";
}""",
            },
        ]
    },
)
async def delete_element(
    document_id: str,
    element_id: str,
    user: OptionalUser = None,
) -> None:
    """
    Delete an element.

    Permanently removes an element from the document. This operation
    cannot be undone through the API.

    Args:
        document_id: The unique identifier of the document.
        element_id: The unique identifier of the element to delete.
        user: The authenticated user (optional).

    Returns:
        None (HTTP 204 No Content).

    Raises:
        HTTPException: 403 if element is locked.
        HTTPException: 404 if document or element not found.
    """
    # Preload session from Redis if needed
    await preload_document_session(document_id)

    element_service.delete_element(
        document_id=document_id,
        element_id=element_id,
    )


@router.put(
    "/elements/{element_id}/move",
    response_model=APIResponse[dict],
    summary="Move element to another page",
    description="""
Move an element from its current page to a different page in the document.

This operation transfers the element to the target page while preserving
all its properties. Optionally, you can specify new position coordinates.

## Request Body

```json
{
  "targetPageNumber": 3,
  "newBounds": {
    "x": 100,
    "y": 200
  }
}
```

## Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetPageNumber` | integer | Yes | The destination page number (1-indexed) |
| `newBounds` | object | No | Optional new position `{x, y, width, height}` |

## Behavior

- If `newBounds` is omitted, the element keeps its current position coordinates
- If only `x` and `y` are provided in `newBounds`, dimensions are preserved
- The element is removed from its current page and added to the target page
- Element ID remains unchanged after the move

## Use Cases

- Reorganizing document content across pages
- Moving elements during page reordering
- Copying layout patterns to different pages
""",
    responses={
        200: {"description": "Element moved successfully"},
        400: {
            "description": "Invalid target page number or bounds"
        },
        401: {"description": "Authentication required or invalid token"},
        403: {"description": "Element is locked and cannot be moved"},
        404: {"description": "Document, element, or target page not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "targetPageNumber": 3,
    "newBounds": {"x": 100, "y": 200}
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Move element to page 3 with new position
move_data = {
    "targetPageNumber": 3,
    "newBounds": {
        "x": 100,
        "y": 200
    }
}

response = requests.put(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}/move",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=move_data
)

if response.status_code == 200:
    element = response.json()["data"]
    print(f"Element moved to page 3")
    print(f"New position: ({element['bounds']['x']}, {element['bounds']['y']})")
else:
    print(f"Error: {response.json()}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Move element to a different page
const moveData = {
  targetPageNumber: 3,
  newBounds: {
    x: 100,
    y: 200
  }
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/elements/${elementId}/move`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(moveData)
  }
);

if (response.ok) {
  const result = await response.json();
  const element = result.data;
  console.log('Element moved to page 3');
  console.log(`New position: (${element.bounds.x}, ${element.bounds.y})`);
} else {
  const error = await response.json();
  console.error('Error:', error);
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Move element to another page
$moveData = [
    'targetPageNumber' => 3,
    'newBounds' => [
        'x' => 100,
        'y' => 200
    ]
];

$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/elements/{$elementId}/move",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'PUT',
    CURLOPT_POSTFIELDS => json_encode($moveData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200) {
    $data = json_decode($response, true);
    $element = $data['data'];
    echo "Element moved to page 3\\n";
    echo "New position: ({$element['bounds']['x']}, {$element['bounds']['y']})\\n";
} else {
    echo "Error: {$response}\\n";
}""",
            },
        ]
    },
)
async def move_element(
    document_id: str,
    element_id: str,
    request: MoveElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Move element to another page.

    Transfers an element from its current page to a different page in the
    document, optionally with new position coordinates.

    Args:
        document_id: The unique identifier of the document.
        element_id: The unique identifier of the element to move.
        request: The move request with target page and optional new bounds.
        user: The authenticated user (optional).

    Returns:
        APIResponse containing the moved element data.

    Raises:
        HTTPException: 400 if target page is invalid.
        HTTPException: 403 if element is locked.
        HTTPException: 404 if document, element, or target page not found.
    """
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
        data=element.model_dump(by_alias=True),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/elements/{element_id}/duplicate",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Duplicate an element",
    description="""
Create a copy of an existing element.

This endpoint duplicates an element with all its properties, optionally
placing it on a different page or with an offset from the original position.

## Request Body

```json
{
  "targetPageNumber": null,
  "offset": {
    "x": 10,
    "y": 10
  }
}
```

## Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetPageNumber` | integer | null | Page for the duplicate (null = same page) |
| `offset` | object | `{x: 10, y: 10}` | Position offset from original element |

## Behavior

- The duplicate receives a new unique ID
- All properties are copied (style, content, layer, etc.)
- `locked` property is reset to `false` on the duplicate
- Timestamps are set to the current time
- If `targetPageNumber` is null, duplicates to the same page

## Use Cases

- Creating multiple similar elements quickly
- Template-based element creation
- Duplicating complex styled elements
""",
    responses={
        201: {"description": "Element duplicated successfully"},
        400: {"description": "Invalid target page or offset values"},
        401: {"description": "Authentication required or invalid token"},
        404: {"description": "Document, element, or target page not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}/duplicate" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "targetPageNumber": null,
    "offset": {"x": 20, "y": 20}
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Duplicate element on same page with offset
duplicate_data = {
    "targetPageNumber": None,  # Same page
    "offset": {
        "x": 20,
        "y": 20
    }
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}/duplicate",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=duplicate_data
)

if response.status_code == 201:
    new_element = response.json()["data"]
    print(f"Created duplicate with ID: {new_element['id']}")
    print(f"Position: ({new_element['bounds']['x']}, {new_element['bounds']['y']})")
else:
    print(f"Error: {response.json()}")

# Duplicate to a different page
duplicate_to_page = {
    "targetPageNumber": 5,
    "offset": {"x": 0, "y": 0}  # Same position on new page
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/{element_id}/duplicate",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=duplicate_to_page
)""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Duplicate element with offset on same page
const duplicateData = {
  targetPageNumber: null,  // Same page
  offset: {
    x: 20,
    y: 20
  }
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/elements/${elementId}/duplicate`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(duplicateData)
  }
);

if (response.status === 201) {
  const result = await response.json();
  const newElement = result.data;
  console.log(`Created duplicate with ID: ${newElement.id}`);
  console.log(`Position: (${newElement.bounds.x}, ${newElement.bounds.y})`);
} else {
  const error = await response.json();
  console.error('Error:', error);
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Duplicate element on same page with offset
$duplicateData = [
    'targetPageNumber' => null,  // Same page
    'offset' => [
        'x' => 20,
        'y' => 20
    ]
];

$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/elements/{$elementId}/duplicate",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($duplicateData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 201) {
    $data = json_decode($response, true);
    $newElement = $data['data'];
    echo "Created duplicate with ID: {$newElement['id']}\\n";
    echo "Position: ({$newElement['bounds']['x']}, {$newElement['bounds']['y']})\\n";
} else {
    echo "Error: {$response}\\n";
}""",
            },
        ]
    },
)
async def duplicate_element(
    document_id: str,
    element_id: str,
    request: DuplicateElementRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Duplicate an element.

    Creates a copy of an existing element with all its properties,
    optionally on a different page or with a position offset.

    Args:
        document_id: The unique identifier of the document.
        element_id: The unique identifier of the element to duplicate.
        request: The duplicate request with target page and offset.
        user: The authenticated user (optional).

    Returns:
        APIResponse containing the newly created duplicate element.

    Raises:
        HTTPException: 400 if offset or target page is invalid.
        HTTPException: 404 if document, element, or target page not found.
    """
    # Preload session from Redis if needed
    await preload_document_session(document_id)

    element = element_service.duplicate_element(
        document_id=document_id,
        element_id=element_id,
        target_page=request.target_page_number,
        offset_x=request.offset.get("x", 10),
        offset_y=request.offset.get("y", 10),
    )

    return APIResponse(
        success=True,
        data=element.model_dump(by_alias=True),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/elements/batch",
    response_model=APIResponse[dict],
    summary="Batch element operations",
    description="""
Perform multiple element operations in a single API request.

This endpoint allows you to create, update, and delete multiple elements
atomically, reducing API calls and improving performance for bulk operations.

## Request Body

```json
{
  "operations": [
    {
      "action": "create",
      "pageNumber": 1,
      "data": {
        "type": "text",
        "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
        "content": "New text element"
      }
    },
    {
      "action": "update",
      "elementId": "elem_abc123",
      "data": {
        "content": "Updated content",
        "style": {"color": "#FF0000"}
      }
    },
    {
      "action": "delete",
      "elementId": "elem_xyz789"
    }
  ]
}
```

## Supported Actions

| Action | Required Fields | Description |
|--------|-----------------|-------------|
| `create` | `pageNumber`, `data` | Create a new element |
| `update` | `elementId`, `data` | Update existing element |
| `delete` | `elementId` | Delete an element |

## Response Structure

```json
{
  "success": true,
  "data": {
    "results": [
      {"success": true, "action": "create", "elementId": "elem_new123"},
      {"success": true, "action": "update", "elementId": "elem_abc123"},
      {"success": false, "action": "delete", "elementId": "elem_xyz789", "error": "Element not found"}
    ],
    "failedCount": 1
  }
}
```

## Behavior

- Operations are processed in order
- Individual operation failures don't stop the batch
- Each result includes success status and any errors
- `failedCount` provides quick summary of failures

## Limits

- Maximum 100 operations per batch request
- Request body size limit: 10MB
""",
    responses={
        200: {
            "description": "Batch operations completed (check individual results for success/failure)"
        },
        400: {
            "description": "Invalid request format or exceeded operation limit"
        },
        401: {"description": "Authentication required or invalid token"},
        404: {"description": "Document not found"},
        413: {"description": "Request payload too large"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/batch" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "operations": [
      {
        "action": "create",
        "pageNumber": 1,
        "data": {
          "type": "text",
          "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
          "content": "New text"
        }
      },
      {
        "action": "update",
        "elementId": "elem_abc123",
        "data": {"content": "Updated text"}
      },
      {
        "action": "delete",
        "elementId": "elem_xyz789"
      }
    ]
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Batch operations: create, update, and delete in one request
batch_data = {
    "operations": [
        {
            "action": "create",
            "pageNumber": 1,
            "data": {
                "type": "text",
                "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
                "content": "New text element"
            }
        },
        {
            "action": "update",
            "elementId": "elem_abc123",
            "data": {
                "content": "Updated content",
                "style": {"color": "#FF0000"}
            }
        },
        {
            "action": "delete",
            "elementId": "elem_xyz789"
        }
    ]
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/elements/batch",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=batch_data
)

data = response.json()["data"]
results = data["results"]
failed_count = data["failedCount"]

print(f"Completed {len(results)} operations, {failed_count} failed")

for result in results:
    status = "OK" if result["success"] else f"FAILED: {result.get('error')}"
    print(f"  {result['action']} {result.get('elementId', 'new')}: {status}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Perform batch element operations
const batchData = {
  operations: [
    {
      action: 'create',
      pageNumber: 1,
      data: {
        type: 'text',
        bounds: { x: 100, y: 100, width: 200, height: 50 },
        content: 'New text element'
      }
    },
    {
      action: 'update',
      elementId: 'elem_abc123',
      data: {
        content: 'Updated content',
        style: { color: '#FF0000' }
      }
    },
    {
      action: 'delete',
      elementId: 'elem_xyz789'
    }
  ]
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${docId}/elements/batch`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(batchData)
  }
);

const result = await response.json();
const { results, failedCount } = result.data;

console.log(`Completed ${results.length} operations, ${failedCount} failed`);

results.forEach(r => {
  const status = r.success ? 'OK' : `FAILED: ${r.error}`;
  console.log(`  ${r.action} ${r.elementId || 'new'}: ${status}`);
});""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Perform batch element operations
$batchData = [
    'operations' => [
        [
            'action' => 'create',
            'pageNumber' => 1,
            'data' => [
                'type' => 'text',
                'bounds' => ['x' => 100, 'y' => 100, 'width' => 200, 'height' => 50],
                'content' => 'New text element'
            ]
        ],
        [
            'action' => 'update',
            'elementId' => 'elem_abc123',
            'data' => [
                'content' => 'Updated content',
                'style' => ['color' => '#FF0000']
            ]
        ],
        [
            'action' => 'delete',
            'elementId' => 'elem_xyz789'
        ]
    ]
];

$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/elements/batch",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($batchData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true)['data'];
$results = $data['results'];
$failedCount = $data['failedCount'];

echo "Completed " . count($results) . " operations, {$failedCount} failed\\n";

foreach ($results as $result) {
    $status = $result['success'] ? 'OK' : "FAILED: {$result['error']}";
    $elementId = $result['elementId'] ?? 'new';
    echo "  {$result['action']} {$elementId}: {$status}\\n";
}""",
            },
        ]
    },
)
async def batch_operations(
    document_id: str,
    request: BatchOperationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Perform batch element operations.

    Executes multiple create, update, and delete operations in a single
    request for improved performance when modifying many elements.

    Args:
        document_id: The unique identifier of the document.
        request: The batch request containing an array of operations.
        user: The authenticated user (optional).

    Returns:
        APIResponse containing results for each operation and failure count.

    Raises:
        HTTPException: 400 if request format is invalid or limit exceeded.
        HTTPException: 404 if document not found.
    """
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
