"""
Bookmark management endpoints.

Handles PDF bookmarks (document outline/table of contents).
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


class CreateBookmarkRequest(BaseModel):
    """Request to create a bookmark."""

    title: str = Field(description="Bookmark display title")
    page_number: int = Field(ge=1, description="Target page number")
    position: Optional[dict] = Field(default=None, description="Position on page {x, y}")
    zoom: Optional[str | float] = Field(default=None, description="Zoom level or fit mode")
    parent_id: Optional[str] = Field(default=None, description="Parent bookmark ID for nesting")
    style: Optional[dict] = Field(default=None, description="Bookmark style (bold, italic, color)")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Chapter 1: Introduction",
                "page_number": 1,
                "position": {"x": 0, "y": 792},
                "zoom": "fit",
                "parent_id": None,
                "style": {"bold": True, "italic": False, "color": "#000000"},
            }
        }


class UpdateBookmarkRequest(BaseModel):
    """Request to update a bookmark."""

    title: Optional[str] = Field(default=None, description="Bookmark display title")
    page_number: Optional[int] = Field(default=None, ge=1, description="Target page number")
    position: Optional[dict] = Field(default=None, description="Position on page")
    zoom: Optional[str | float] = Field(default=None, description="Zoom level or fit mode")
    parent_id: Optional[str] = Field(default=None, description="Parent bookmark ID")
    style: Optional[dict] = Field(default=None, description="Bookmark style")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Chapter 1: Getting Started",
                "style": {"bold": True, "color": "#0000FF"},
            }
        }


@router.get(
    "/{document_id}/bookmarks",
    response_model=APIResponse[dict],
    summary="List all bookmarks",
    description="""
Get all bookmarks (document outline/table of contents) from a PDF.

Bookmarks are returned as a hierarchical tree structure.

## Response
Returns all bookmarks with their hierarchy.

```json
{
  "success": true,
  "data": {
    "bookmarks": [
      {
        "bookmark_id": "uuid",
        "title": "Chapter 1: Introduction",
        "destination": {
          "page_number": 1,
          "position": {"x": 0, "y": 792},
          "zoom": "fit"
        },
        "style": {
          "bold": true,
          "italic": false,
          "color": "#000000"
        },
        "children": [
          {
            "bookmark_id": "uuid2",
            "title": "1.1 Overview",
            "destination": {
              "page_number": 2,
              "position": null,
              "zoom": null
            },
            "style": {
              "bold": false,
              "italic": false,
              "color": "#000000"
            },
            "children": []
          }
        ]
      }
    ],
    "total_bookmarks": 15
  }
}
```

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/bookmarks" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/bookmarks",
    headers={"Authorization": "Bearer <token>"}
)
bookmarks = response.json()["data"]["bookmarks"]

def print_bookmarks(bookmarks, level=0):
    for bookmark in bookmarks:
        indent = "  " * level
        print(f"{indent}{bookmark['title']} -> Page {bookmark['destination']['page_number']}")
        if bookmark['children']:
            print_bookmarks(bookmark['children'], level + 1)

print_bookmarks(bookmarks)
```

## Example (JavaScript)
```javascript
const response = await fetch(`/api/v1/documents/${documentId}/bookmarks`, {
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();

function printBookmarks(bookmarks, level = 0) {
  bookmarks.forEach(bookmark => {
    const indent = '  '.repeat(level);
    console.log(`${indent}${bookmark.title} -> Page ${bookmark.destination.page_number}`);
    if (bookmark.children.length > 0) {
      printBookmarks(bookmark.children, level + 1);
    }
  });
}

printBookmarks(result.data.bookmarks);
```

## Example (PHP)
```php
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/bookmarks",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$result = json_decode($response->getBody(), true);

function printBookmarks($bookmarks, $level = 0) {
    foreach ($bookmarks as $bookmark) {
        $indent = str_repeat('  ', $level);
        echo "{$indent}{$bookmark['title']} -> Page {$bookmark['destination']['page_number']}\n";
        if (!empty($bookmark['children'])) {
            printBookmarks($bookmark['children'], $level + 1);
        }
    }
}

printBookmarks($result['data']['bookmarks']);
```
""",
)
async def list_bookmarks(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """List all bookmarks in a document."""
    start_time = time.time()

    # TODO: Implement bookmark listing using document service
    # This is a placeholder implementation
    bookmarks = []

    def count_bookmarks(bookmark_list):
        count = len(bookmark_list)
        for bookmark in bookmark_list:
            count += count_bookmarks(bookmark.get("children", []))
        return count

    total = count_bookmarks(bookmarks)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "bookmarks": bookmarks,
            "total_bookmarks": total,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/bookmarks",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create bookmark",
    description="""
Create a new bookmark in the document outline.

## Request Body
```json
{
  "title": "Chapter 1: Introduction",
  "page_number": 1,
  "position": {"x": 0, "y": 792},
  "zoom": "fit",
  "parent_id": null,
  "style": {
    "bold": true,
    "italic": false,
    "color": "#000000"
  }
}
```

## Parameters
- **title**: Display title for the bookmark
- **page_number**: Target page number (1-indexed)
- **position**: Optional position on page {x, y}
- **zoom**: Zoom level (number) or fit mode ("fit", "fit-width", "fit-height")
- **parent_id**: Parent bookmark ID for creating nested bookmarks (null for root level)
- **style**: Visual style (bold, italic, color)

## Response
Returns the created bookmark.

```json
{
  "success": true,
  "data": {
    "bookmark_id": "uuid",
    "title": "Chapter 1: Introduction",
    "destination": {
      "page_number": 1,
      "position": {"x": 0, "y": 792},
      "zoom": "fit"
    },
    "style": {
      "bold": true,
      "italic": false,
      "color": "#000000"
    },
    "children": []
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/bookmarks" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Chapter 1: Introduction",
    "page_number": 1,
    "zoom": "fit",
    "style": {"bold": true}
  }'
```

## Example (Python)
```python
import requests

bookmark_data = {
    "title": "Chapter 1: Introduction",
    "page_number": 1,
    "position": {"x": 0, "y": 792},
    "zoom": "fit",
    "style": {
        "bold": True,
        "italic": False,
        "color": "#000000"
    }
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/bookmarks",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=bookmark_data
)
bookmark = response.json()["data"]
print(f"Created bookmark: {bookmark['title']} (ID: {bookmark['bookmark_id']})")
```

## Example (JavaScript)
```javascript
const bookmarkData = {
  title: 'Chapter 1: Introduction',
  pageNumber: 1,
  position: { x: 0, y: 792 },
  zoom: 'fit',
  style: {
    bold: true,
    italic: false,
    color: '#000000'
  }
};

const response = await fetch(`/api/v1/documents/${documentId}/bookmarks`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(bookmarkData)
});
const result = await response.json();
console.log(`Created bookmark: ${result.data.title}`);
```

## Example (PHP)
```php
$bookmarkData = [
    'title' => 'Chapter 1: Introduction',
    'page_number' => 1,
    'position' => ['x' => 0, 'y' => 792],
    'zoom' => 'fit',
    'style' => [
        'bold' => true,
        'italic' => false,
        'color' => '#000000'
    ]
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/bookmarks",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $bookmarkData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Created bookmark: " . $result['data']['title'];
```
""",
)
async def create_bookmark(
    document_id: str,
    request: CreateBookmarkRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a new bookmark."""
    start_time = time.time()

    # TODO: Implement bookmark creation using document service
    # This is a placeholder implementation
    bookmark_data = {
        "bookmark_id": "placeholder-uuid",
        "title": request.title,
        "destination": {
            "page_number": request.page_number,
            "position": request.position,
            "zoom": request.zoom,
        },
        "style": request.style or {
            "bold": False,
            "italic": False,
            "color": "#000000",
        },
        "children": [],
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=bookmark_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.patch(
    "/{document_id}/bookmarks/{bookmark_id}",
    response_model=APIResponse[dict],
    summary="Update bookmark",
    description="""
Update a bookmark's properties.

## Request Body
Only include fields you want to change.

```json
{
  "title": "Chapter 1: Getting Started",
  "style": {
    "bold": true,
    "color": "#0000FF"
  }
}
```

## Response
Returns the updated bookmark.

```json
{
  "success": true,
  "data": {
    "bookmark_id": "uuid",
    "title": "Chapter 1: Getting Started",
    "destination": {
      "page_number": 1,
      "position": {"x": 0, "y": 792},
      "zoom": "fit"
    },
    "style": {
      "bold": true,
      "italic": false,
      "color": "#0000FF"
    },
    "children": []
  }
}
```

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/documents/{document_id}/bookmarks/{bookmark_id}" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Updated Title",
    "page_number": 5
  }'
```

## Example (Python)
```python
import requests

updates = {
    "title": "Chapter 1: Getting Started",
    "style": {
        "bold": True,
        "color": "#0000FF"
    }
}

response = requests.patch(
    f"http://localhost:8000/api/v1/documents/{document_id}/bookmarks/{bookmark_id}",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=updates
)
bookmark = response.json()["data"]
print(f"Updated bookmark: {bookmark['title']}")
```

## Example (JavaScript)
```javascript
const updates = {
  title: 'Chapter 1: Getting Started',
  style: {
    bold: true,
    color: '#0000FF'
  }
};

const response = await fetch(
  `/api/v1/documents/${documentId}/bookmarks/${bookmarkId}`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  }
);
const result = await response.json();
console.log(`Updated bookmark: ${result.data.title}`);
```

## Example (PHP)
```php
$updates = [
    'title' => 'Chapter 1: Getting Started',
    'style' => [
        'bold' => true,
        'color' => '#0000FF'
    ]
];

$response = $client->patch(
    "http://localhost:8000/api/v1/documents/{$documentId}/bookmarks/{$bookmarkId}",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $updates
    ]
);
$result = json_decode($response->getBody(), true);
echo "Updated bookmark: " . $result['data']['title'];
```
""",
)
async def update_bookmark(
    document_id: str,
    bookmark_id: str,
    request: UpdateBookmarkRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Update a bookmark."""
    start_time = time.time()

    # TODO: Implement bookmark update using document service
    # This is a placeholder implementation
    updates = request.model_dump(exclude_none=True)

    bookmark_data = {
        "bookmark_id": bookmark_id,
        "title": updates.get("title", "Bookmark"),
        "destination": {
            "page_number": updates.get("page_number", 1),
            "position": updates.get("position"),
            "zoom": updates.get("zoom"),
        },
        "style": updates.get("style", {
            "bold": False,
            "italic": False,
            "color": "#000000",
        }),
        "children": [],
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=bookmark_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/{document_id}/bookmarks/{bookmark_id}",
    status_code=204,
    summary="Delete bookmark",
    description="""
Delete a bookmark from the document outline.

If the bookmark has children, they will be moved up one level
(or to root level if deleting a top-level bookmark).

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/documents/{document_id}/bookmarks/{bookmark_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.delete(
    f"http://localhost:8000/api/v1/documents/{document_id}/bookmarks/{bookmark_id}",
    headers={"Authorization": "Bearer <token>"}
)
if response.status_code == 204:
    print("Bookmark deleted successfully")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `/api/v1/documents/${documentId}/bookmarks/${bookmarkId}`,
  {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
if (response.status === 204) {
  console.log('Bookmark deleted successfully');
}
```

## Example (PHP)
```php
$response = $client->delete(
    "http://localhost:8000/api/v1/documents/{$documentId}/bookmarks/{$bookmarkId}",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
if ($response->getStatusCode() === 204) {
    echo "Bookmark deleted successfully";
}
```
""",
)
async def delete_bookmark(
    document_id: str,
    bookmark_id: str,
    user: OptionalUser = None,
) -> None:
    """Delete a bookmark."""
    # TODO: Implement bookmark deletion using document service
    pass
