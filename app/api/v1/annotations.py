"""
Annotation endpoints.

Handles creation of various annotation types (highlights, notes, links, etc.).
"""

import time
from typing import Optional

from fastapi import APIRouter

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc
from pydantic import BaseModel, Field

router = APIRouter()


class CreateMarkupAnnotationRequest(BaseModel):
    """Request to create a markup annotation (highlight, underline, etc.)."""

    annotation_type: str = Field(
        description="Type of markup (highlight, underline, strikeout, squiggly)"
    )
    bounds: dict = Field(description="Annotation bounds {x, y, width, height}")
    content: Optional[str] = Field(default="", description="Annotation comment text")
    color: Optional[str] = Field(
        default="#FFFF00", pattern=r"^#[0-9A-Fa-f]{6}$", description="Annotation color"
    )
    opacity: Optional[float] = Field(default=0.5, ge=0, le=1, description="Annotation opacity")

    class Config:
        json_schema_extra = {
            "example": {
                "annotation_type": "highlight",
                "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},
                "content": "Important text",
                "color": "#FFFF00",
                "opacity": 0.5,
            }
        }


class CreateNoteAnnotationRequest(BaseModel):
    """Request to create a note annotation."""

    bounds: dict = Field(description="Note icon bounds {x, y, width, height}")
    content: str = Field(description="Note text content")
    color: Optional[str] = Field(
        default="#FFD700", pattern=r"^#[0-9A-Fa-f]{6}$", description="Note color"
    )
    icon: Optional[str] = Field(
        default="Comment", description="Note icon (Comment, Key, Note, Help, etc.)"
    )
    popup_open: Optional[bool] = Field(default=False, description="Whether popup is initially open")

    class Config:
        json_schema_extra = {
            "example": {
                "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},
                "content": "This is an important note",
                "color": "#FFD700",
                "icon": "Comment",
                "popup_open": False,
            }
        }


class CreateLinkAnnotationRequest(BaseModel):
    """Request to create a link annotation."""

    bounds: dict = Field(description="Link area bounds {x, y, width, height}")
    link_type: str = Field(description="Link type (internal or external)")
    url: Optional[str] = Field(default=None, description="External URL (for external links)")
    target_page: Optional[int] = Field(
        default=None, ge=1, description="Target page number (for internal links)"
    )
    target_position: Optional[dict] = Field(
        default=None, description="Position on target page {x, y}"
    )
    border_style: Optional[str] = Field(
        default="none", description="Border style (solid, dashed, underline, none)"
    )
    color: Optional[str] = Field(
        default="#0000FF", pattern=r"^#[0-9A-Fa-f]{6}$", description="Link color"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
                "link_type": "external",
                "url": "https://example.com",
                "border_style": "underline",
                "color": "#0000FF",
            }
        }


@router.post(
    "/{document_id}/pages/{page_number}/annotations/markup",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create markup annotation",
    description="""
Create a markup annotation (highlight, underline, strikeout, squiggly).

## Request Body
```json
{
  "annotation_type": "highlight",
  "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},
  "content": "Important text",
  "color": "#FFFF00",
  "opacity": 0.5
}
```

## Annotation Types
- **highlight**: Yellow highlighting over text
- **underline**: Underline text
- **strikeout**: Strike through text
- **squiggly**: Squiggly underline

## Response
Returns the created annotation element.

```json
{
  "success": true,
  "data": {
    "element_id": "uuid",
    "type": "annotation",
    "annotation_type": "highlight",
    "bounds": {...},
    "content": "Important text",
    "style": {"color": "#FFFF00", "opacity": 0.5}
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/markup" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "annotation_type": "highlight",
    "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},
    "color": "#FFFF00"
  }'
```

## Example (Python)
```python
import requests

annotation_data = {
    "annotation_type": "highlight",
    "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},
    "content": "Important section",
    "color": "#FFFF00",
    "opacity": 0.5
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/markup",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=annotation_data
)
annotation = response.json()["data"]
print(f"Created {annotation['annotation_type']} annotation")
```

## Example (JavaScript)
```javascript
const annotationData = {
  annotationType: 'highlight',
  bounds: { x: 100, y: 200, width: 200, height: 20 },
  content: 'Important section',
  color: '#FFFF00',
  opacity: 0.5
};

const response = await fetch(
  `/api/v1/documents/${documentId}/pages/1/annotations/markup`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(annotationData)
  }
);
const result = await response.json();
console.log(`Created ${result.data.annotation_type} annotation`);
```

## Example (PHP)
```php
$annotationData = [
    'annotation_type' => 'highlight',
    'bounds' => ['x' => 100, 'y' => 200, 'width' => 200, 'height' => 20],
    'content' => 'Important section',
    'color' => '#FFFF00',
    'opacity' => 0.5
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/pages/1/annotations/markup",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $annotationData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Created " . $result['data']['annotation_type'] . " annotation";
```
""",
)
async def create_markup_annotation(
    document_id: str,
    page_number: int,
    request: CreateMarkupAnnotationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a markup annotation (highlight, underline, etc.)."""
    start_time = time.time()

    # TODO: Implement annotation creation using element service
    # This is a placeholder implementation
    annotation_data = {
        "element_id": "placeholder-uuid",
        "type": "annotation",
        "annotation_type": request.annotation_type,
        "bounds": request.bounds,
        "content": request.content,
        "style": {
            "color": request.color,
            "opacity": request.opacity,
        },
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=annotation_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/pages/{page_number}/annotations/note",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create note annotation",
    description="""
Create a sticky note annotation.

## Request Body
```json
{
  "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},
  "content": "This is an important note",
  "color": "#FFD700",
  "icon": "Comment",
  "popup_open": false
}
```

## Icon Types
- **Comment**: Standard comment icon
- **Key**: Key icon
- **Note**: Note icon
- **Help**: Help/question icon
- **NewParagraph**: New paragraph icon
- **Paragraph**: Paragraph icon
- **Insert**: Insert icon

## Response
Returns the created note annotation.

```json
{
  "success": true,
  "data": {
    "element_id": "uuid",
    "type": "annotation",
    "annotation_type": "note",
    "bounds": {...},
    "content": "This is an important note",
    "style": {"color": "#FFD700"}
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/note" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},
    "content": "Important note",
    "icon": "Comment"
  }'
```

## Example (Python)
```python
import requests

note_data = {
    "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},
    "content": "This is a critical section that needs review",
    "color": "#FFD700",
    "icon": "Comment",
    "popup_open": True
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/note",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=note_data
)
note = response.json()["data"]
print(f"Created note annotation: {note['content']}")
```

## Example (JavaScript)
```javascript
const noteData = {
  bounds: { x: 50, y: 100, width: 20, height: 20 },
  content: 'This is a critical section that needs review',
  color: '#FFD700',
  icon: 'Comment',
  popupOpen: true
};

const response = await fetch(
  `/api/v1/documents/${documentId}/pages/1/annotations/note`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(noteData)
  }
);
const result = await response.json();
console.log(`Created note: ${result.data.content}`);
```

## Example (PHP)
```php
$noteData = [
    'bounds' => ['x' => 50, 'y' => 100, 'width' => 20, 'height' => 20],
    'content' => 'This is a critical section that needs review',
    'color' => '#FFD700',
    'icon' => 'Comment',
    'popup_open' => true
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/pages/1/annotations/note",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $noteData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Created note: " . $result['data']['content'];
```
""",
)
async def create_note_annotation(
    document_id: str,
    page_number: int,
    request: CreateNoteAnnotationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a note annotation."""
    start_time = time.time()

    # TODO: Implement note annotation creation using element service
    # This is a placeholder implementation
    annotation_data = {
        "element_id": "placeholder-uuid",
        "type": "annotation",
        "annotation_type": "note",
        "bounds": request.bounds,
        "content": request.content,
        "style": {
            "color": request.color,
        },
        "popup": {
            "is_open": request.popup_open,
        },
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=annotation_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/pages/{page_number}/annotations/link",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create link annotation",
    description="""
Create a link annotation (hyperlink to URL or internal page).

## Request Body
```json
{
  "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
  "link_type": "external",
  "url": "https://example.com",
  "border_style": "underline",
  "color": "#0000FF"
}
```

## Link Types
- **external**: Link to external URL
- **internal**: Link to another page in the document

For external links, provide `url`.
For internal links, provide `target_page` and optionally `target_position`.

## Border Styles
- **none**: No border
- **solid**: Solid border
- **dashed**: Dashed border
- **underline**: Underline style

## Response
Returns the created link annotation.

```json
{
  "success": true,
  "data": {
    "element_id": "uuid",
    "type": "annotation",
    "annotation_type": "link",
    "bounds": {...},
    "link_destination": {
      "type": "external",
      "url": "https://example.com"
    }
  }
}
```

## Example (curl) - External Link
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/link" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
    "link_type": "external",
    "url": "https://example.com"
  }'
```

## Example (curl) - Internal Link
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/link" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
    "link_type": "internal",
    "target_page": 5,
    "target_position": {"x": 0, "y": 0}
  }'
```

## Example (Python)
```python
import requests

# External link
link_data = {
    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
    "link_type": "external",
    "url": "https://example.com",
    "border_style": "underline",
    "color": "#0000FF"
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1/annotations/link",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=link_data
)
link = response.json()["data"]
print(f"Created link to {link_data['url']}")
```

## Example (JavaScript)
```javascript
// Internal link
const linkData = {
  bounds: { x: 100, y: 200, width: 150, height: 20 },
  linkType: 'internal',
  targetPage: 5,
  targetPosition: { x: 0, y: 0 },
  borderStyle: 'none',
  color: '#0000FF'
};

const response = await fetch(
  `/api/v1/documents/${documentId}/pages/1/annotations/link`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(linkData)
  }
);
const result = await response.json();
console.log(`Created link to page ${linkData.targetPage}`);
```

## Example (PHP)
```php
// External link
$linkData = [
    'bounds' => ['x' => 100, 'y' => 200, 'width' => 150, 'height' => 20],
    'link_type' => 'external',
    'url' => 'https://example.com',
    'border_style' => 'underline',
    'color' => '#0000FF'
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/pages/1/annotations/link",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $linkData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Created link to " . $linkData['url'];
```
""",
)
async def create_link_annotation(
    document_id: str,
    page_number: int,
    request: CreateLinkAnnotationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a link annotation."""
    start_time = time.time()

    # TODO: Implement link annotation creation using element service
    # This is a placeholder implementation
    link_destination = {
        "type": request.link_type,
    }

    if request.link_type == "external":
        link_destination["url"] = request.url
    else:
        link_destination["page_number"] = request.target_page
        link_destination["position"] = request.target_position

    annotation_data = {
        "element_id": "placeholder-uuid",
        "type": "annotation",
        "annotation_type": "link",
        "bounds": request.bounds,
        "link_destination": link_destination,
        "style": {
            "color": request.color,
        },
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=annotation_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
