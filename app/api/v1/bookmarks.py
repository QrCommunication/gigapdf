"""
Bookmark management endpoints.

Handles PDF bookmarks (document outline/table of contents).
"""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.schemas.responses.common import APIResponse

router = APIRouter()


class CreateBookmarkRequest(BaseModel):
    """Request to create a bookmark."""

    title: str = Field(description="Bookmark display title")
    page_number: int = Field(ge=1, description="Target page number")
    position: dict | None = Field(default=None, description="Position on page {x, y}")
    zoom: str | float | None = Field(default=None, description="Zoom level or fit mode")
    parent_id: str | None = Field(default=None, description="Parent bookmark ID for nesting")
    style: dict | None = Field(default=None, description="Bookmark style (bold, italic, color)")

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

    title: str | None = Field(default=None, description="Bookmark display title")
    page_number: int | None = Field(default=None, ge=1, description="Target page number")
    position: dict | None = Field(default=None, description="Position on page")
    zoom: str | float | None = Field(default=None, description="Zoom level or fit mode")
    parent_id: str | None = Field(default=None, description="Parent bookmark ID")
    style: dict | None = Field(default=None, description="Bookmark style")

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
    description="""Retrieve all bookmarks (document outline/table of contents) from a PDF document.

Bookmarks are returned as a hierarchical tree structure, preserving the nested organization
of chapters, sections, and subsections. Each bookmark contains navigation information
including target page, position, zoom level, and visual styling.

The response includes the complete bookmark tree with all nested children, along with
a total count of all bookmarks in the document.""",
    responses={
        200: {
            "description": "Bookmarks retrieved successfully. Returns the hierarchical bookmark tree and total count.",
        },
        401: {"description": "Unauthorized. Invalid or missing authentication token."},
        404: {"description": "Document not found. The specified document_id does not exist."},
        500: {"description": "Internal server error. Failed to retrieve bookmarks."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks" \\\n  -H "Authorization: Bearer $TOKEN"'
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "doc_abc123"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"}
)

result = response.json()
bookmarks = result["data"]["bookmarks"]
total = result["data"]["total_bookmarks"]

print(f"Found {total} bookmarks")

# Recursively print bookmark tree
def print_tree(bookmarks, level=0):
    for bm in bookmarks:
        indent = "  " * level
        page = bm["destination"]["page_number"]
        print(f"{indent}- {bm['title']} (page {page})")
        if bm["children"]:
            print_tree(bm["children"], level + 1)

print_tree(bookmarks)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "doc_abc123";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks`,
  {
    headers: {
      "Authorization": "Bearer YOUR_API_TOKEN"
    }
  }
);

const result = await response.json();
const { bookmarks, total_bookmarks } = result.data;

console.log(`Found ${total_bookmarks} bookmarks`);

// Recursively print bookmark tree
function printTree(bookmarks, level = 0) {
  bookmarks.forEach(bm => {
    const indent = "  ".repeat(level);
    const page = bm.destination.page_number;
    console.log(`${indent}- ${bm.title} (page ${page})`);
    if (bm.children.length > 0) {
      printTree(bm.children, level + 1);
    }
  });
}

printTree(bookmarks);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "doc_abc123";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/bookmarks",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_API_TOKEN"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$bookmarks = $result["data"]["bookmarks"];
$total = $result["data"]["total_bookmarks"];

echo "Found {$total} bookmarks\\n";

// Recursively print bookmark tree
function printTree($bookmarks, $level = 0) {
    foreach ($bookmarks as $bm) {
        $indent = str_repeat("  ", $level);
        $page = $bm["destination"]["page_number"];
        echo "{$indent}- {$bm['title']} (page {$page})\\n";
        if (!empty($bm["children"])) {
            printTree($bm["children"], $level + 1);
        }
    }
}

printTree($bookmarks);'''
            }
        ]
    },
)
async def list_bookmarks(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """List all bookmarks in a document."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.post(
    "/{document_id}/bookmarks",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create bookmark",
    description="""Create a new bookmark in the PDF document outline.

Add a navigation bookmark that links to a specific page and position within the document.
Bookmarks can be nested under parent bookmarks to create a hierarchical table of contents.

**Parameters:**
- **title**: Display title shown in the bookmark panel
- **page_number**: Target page number (1-indexed)
- **position**: Optional {x, y} coordinates on the target page
- **zoom**: Zoom level (numeric) or fit mode ("fit", "fit-width", "fit-height")
- **parent_id**: Parent bookmark ID for nesting (null for root level)
- **style**: Visual styling including bold, italic, and color""",
    responses={
        201: {
            "description": "Bookmark created successfully. Returns the new bookmark with its generated ID.",
        },
        400: {"description": "Bad request. Invalid bookmark data or page number out of range."},
        401: {"description": "Unauthorized. Invalid or missing authentication token."},
        404: {"description": "Document or parent bookmark not found."},
        422: {"description": "Validation error. Required fields missing or invalid format."},
        500: {"description": "Internal server error. Failed to create bookmark."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
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
  }' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "doc_abc123"
bookmark_data = {
    "title": "Chapter 1: Introduction",
    "page_number": 1,
    "position": {"x": 0, "y": 792},
    "zoom": "fit",
    "parent_id": None,
    "style": {
        "bold": True,
        "italic": False,
        "color": "#000000"
    }
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=bookmark_data
)

result = response.json()
bookmark = result["data"]
print(f"Created bookmark: {bookmark['title']} (ID: {bookmark['bookmark_id']})")

# Create a nested sub-bookmark
sub_bookmark = {
    "title": "1.1 Overview",
    "page_number": 3,
    "parent_id": bookmark["bookmark_id"],
    "style": {"bold": False}
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=sub_bookmark
)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "doc_abc123";

const bookmarkData = {
  title: "Chapter 1: Introduction",
  page_number: 1,
  position: { x: 0, y: 792 },
  zoom: "fit",
  parent_id: null,
  style: {
    bold: true,
    italic: false,
    color: "#000000"
  }
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks`,
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer YOUR_API_TOKEN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(bookmarkData)
  }
);

const result = await response.json();
const bookmark = result.data;
console.log(`Created bookmark: ${bookmark.title} (ID: ${bookmark.bookmark_id})`);

// Create a nested sub-bookmark
const subBookmark = {
  title: "1.1 Overview",
  page_number: 3,
  parent_id: bookmark.bookmark_id,
  style: { bold: false }
};

await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks`,
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer YOUR_API_TOKEN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(subBookmark)
  }
);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "doc_abc123";

$bookmarkData = [
    "title" => "Chapter 1: Introduction",
    "page_number" => 1,
    "position" => ["x" => 0, "y" => 792],
    "zoom" => "fit",
    "parent_id" => null,
    "style" => [
        "bold" => true,
        "italic" => false,
        "color" => "#000000"
    ]
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/bookmarks",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_API_TOKEN",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode($bookmarkData)
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 201) {
    $result = json_decode($response, true);
    $bookmark = $result["data"];
    echo "Created bookmark: {$bookmark['title']} (ID: {$bookmark['bookmark_id']})\\n";

    // Create a nested sub-bookmark
    $subBookmark = [
        "title" => "1.1 Overview",
        "page_number" => 3,
        "parent_id" => $bookmark["bookmark_id"],
        "style" => ["bold" => false]
    ];

    // ... make another request with $subBookmark
}'''
            }
        ]
    },
)
async def create_bookmark(
    document_id: str,
    request: CreateBookmarkRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a new bookmark."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.patch(
    "/{document_id}/bookmarks/{bookmark_id}",
    response_model=APIResponse[dict],
    summary="Update bookmark",
    description="""Update an existing bookmark's properties.

Partially update a bookmark by providing only the fields you want to change.
All fields are optional - omitted fields will retain their current values.

**Updatable fields:**
- **title**: Change the display title
- **page_number**: Change the target page
- **position**: Update the {x, y} position on the target page
- **zoom**: Change zoom level or fit mode
- **parent_id**: Move bookmark to a different parent (reorganize hierarchy)
- **style**: Update visual styling (bold, italic, color)""",
    responses={
        200: {
            "description": "Bookmark updated successfully. Returns the complete updated bookmark.",
        },
        400: {"description": "Bad request. Invalid update data or page number out of range."},
        401: {"description": "Unauthorized. Invalid or missing authentication token."},
        404: {"description": "Document or bookmark not found."},
        422: {"description": "Validation error. Invalid field format."},
        500: {"description": "Internal server error. Failed to update bookmark."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PATCH "https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks/{bookmark_id}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Chapter 1: Getting Started",
    "page_number": 5,
    "style": {
      "bold": true,
      "color": "#0000FF"
    }
  }' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "doc_abc123"
bookmark_id = "bm_xyz789"

# Update only specific fields
updates = {
    "title": "Chapter 1: Getting Started",
    "page_number": 5,
    "style": {
        "bold": True,
        "color": "#0000FF"
    }
}

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks/{bookmark_id}",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=updates
)

result = response.json()
bookmark = result["data"]
print(f"Updated bookmark: {bookmark['title']}")
print(f"Now points to page {bookmark['destination']['page_number']}")

# Move bookmark to a different parent
move_update = {
    "parent_id": "bm_new_parent_id"
}

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks/{bookmark_id}",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=move_update
)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "doc_abc123";
const bookmarkId = "bm_xyz789";

// Update only specific fields
const updates = {
  title: "Chapter 1: Getting Started",
  page_number: 5,
  style: {
    bold: true,
    color: "#0000FF"
  }
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks/${bookmarkId}`,
  {
    method: "PATCH",
    headers: {
      "Authorization": "Bearer YOUR_API_TOKEN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updates)
  }
);

const result = await response.json();
const bookmark = result.data;
console.log(`Updated bookmark: ${bookmark.title}`);
console.log(`Now points to page ${bookmark.destination.page_number}`);

// Move bookmark to a different parent
const moveUpdate = {
  parent_id: "bm_new_parent_id"
};

await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks/${bookmarkId}`,
  {
    method: "PATCH",
    headers: {
      "Authorization": "Bearer YOUR_API_TOKEN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(moveUpdate)
  }
);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "doc_abc123";
$bookmarkId = "bm_xyz789";

// Update only specific fields
$updates = [
    "title" => "Chapter 1: Getting Started",
    "page_number" => 5,
    "style" => [
        "bold" => true,
        "color" => "#0000FF"
    ]
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/bookmarks/{$bookmarkId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "PATCH",
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_API_TOKEN",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode($updates)
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200) {
    $result = json_decode($response, true);
    $bookmark = $result["data"];
    echo "Updated bookmark: {$bookmark['title']}\\n";
    echo "Now points to page {$bookmark['destination']['page_number']}\\n";
}

// Move bookmark to a different parent
$moveUpdate = [
    "parent_id" => "bm_new_parent_id"
];
// ... make another PATCH request with $moveUpdate'''
            }
        ]
    },
)
async def update_bookmark(
    document_id: str,
    bookmark_id: str,
    request: UpdateBookmarkRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Update a bookmark."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.delete(
    "/{document_id}/bookmarks/{bookmark_id}",
    status_code=204,
    summary="Delete bookmark",
    description="""Delete a bookmark from the PDF document outline.

Permanently removes the specified bookmark from the document. If the bookmark
has nested children, they will be automatically promoted up one level in the
hierarchy (moved to the deleted bookmark's parent, or to root level if the
deleted bookmark was at root level).

**Note:** This operation cannot be undone. The bookmark and its reference
will be permanently removed from the document outline.""",
    responses={
        204: {"description": "Bookmark deleted successfully. No content returned."},
        401: {"description": "Unauthorized. Invalid or missing authentication token."},
        404: {"description": "Document or bookmark not found."},
        500: {"description": "Internal server error. Failed to delete bookmark."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X DELETE "https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks/{bookmark_id}" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "doc_abc123"
bookmark_id = "bm_xyz789"

response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks/{bookmark_id}",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"}
)

if response.status_code == 204:
    print("Bookmark deleted successfully")
else:
    print(f"Failed to delete bookmark: {response.status_code}")
    print(response.json())

# Delete multiple bookmarks
bookmark_ids_to_delete = ["bm_001", "bm_002", "bm_003"]

for bm_id in bookmark_ids_to_delete:
    response = requests.delete(
        f"https://api.giga-pdf.com/api/v1/documents/{document_id}/bookmarks/{bm_id}",
        headers={"Authorization": "Bearer YOUR_API_TOKEN"}
    )
    if response.status_code == 204:
        print(f"Deleted bookmark {bm_id}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "doc_abc123";
const bookmarkId = "bm_xyz789";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks/${bookmarkId}`,
  {
    method: "DELETE",
    headers: {
      "Authorization": "Bearer YOUR_API_TOKEN"
    }
  }
);

if (response.status === 204) {
  console.log("Bookmark deleted successfully");
} else {
  const error = await response.json();
  console.error("Failed to delete bookmark:", error);
}

// Delete multiple bookmarks
const bookmarkIdsToDelete = ["bm_001", "bm_002", "bm_003"];

for (const bmId of bookmarkIdsToDelete) {
  const res = await fetch(
    `https://api.giga-pdf.com/api/v1/documents/${documentId}/bookmarks/${bmId}`,
    {
      method: "DELETE",
      headers: {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  );
  if (res.status === 204) {
    console.log(`Deleted bookmark ${bmId}`);
  }
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "doc_abc123";
$bookmarkId = "bm_xyz789";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/bookmarks/{$bookmarkId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "DELETE",
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_API_TOKEN"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 204) {
    echo "Bookmark deleted successfully\\n";
} else {
    echo "Failed to delete bookmark: {$httpCode}\\n";
    $error = json_decode($response, true);
    print_r($error);
}

// Delete multiple bookmarks
$bookmarkIdsToDelete = ["bm_001", "bm_002", "bm_003"];

foreach ($bookmarkIdsToDelete as $bmId) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/bookmarks/{$bmId}",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => "DELETE",
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer YOUR_API_TOKEN"
        ]
    ]);

    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 204) {
        echo "Deleted bookmark {$bmId}\\n";
    }
}'''
            }
        ]
    },
)
async def delete_bookmark(
    document_id: str,
    bookmark_id: str,
    user: OptionalUser = None,
) -> None:
    """Delete a bookmark."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )
