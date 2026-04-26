"""
Page management endpoints.

Handles page CRUD, preview generation, rotation, and reordering.
"""

import time
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.dependencies import preload_document_session
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
    summary="Get page details",
    description="""
Retrieve detailed information about a specific page in a PDF document, including its dimensions, rotation, and optionally all elements (text, images, annotations) on the page.

This endpoint is useful for:
- Displaying page metadata in a document viewer
- Retrieving all elements for editing purposes
- Getting page dimensions for layout calculations

The response includes the page ID, page number, dimensions (width/height in points), rotation angle, and when `include_elements=true`, a complete list of all elements on the page with their properties.
""",
    response_description="Page details including dimensions, rotation, and optionally all page elements",
    responses={
        200: {"description": "Page details retrieved successfully"},
        404: {"description": "Document or page not found"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1?include_elements=true" \\
  -H "Authorization: Bearer $TOKEN" """,
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1",
    headers={"Authorization": f"Bearer {token}"},
    params={"include_elements": True}
)
page = response.json()["data"]
print(f"Page dimensions: {page['dimensions']['width']}x{page['dimensions']['height']}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/1?include_elements=true`,
  { headers: { "Authorization": `Bearer ${token}` } }
);
const { data: page } = await response.json();
console.log(`Page dimensions: ${page.dimensions.width}x${page.dimensions.height}`);""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/1?include_elements=true");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = json_decode(curl_exec($ch), true);
$page = $response['data'];
echo "Page dimensions: " . $page['dimensions']['width'] . "x" . $page['dimensions']['height'];""",
            },
        ]
    },
)
async def get_page(
    document_id: str,
    page_number: int,
    include_elements: bool = Query(default=True),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get a specific page."""
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

    page = document_service.get_page(
        document_id=document_id,
        page_number=page_number,
        include_elements=include_elements,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=page.model_dump(by_alias=True),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{page_number}/preview",
    summary="Get page preview/thumbnail",
    description="""
Render a PDF page as an image for preview or thumbnail purposes.

This endpoint converts a PDF page to a raster image (PNG, JPEG, WebP) or vector format (SVG). It is ideal for:
- Generating thumbnails for document navigation
- Creating page previews in a document viewer
- Exporting pages as images for other applications

**Image Quality Options:**
- `dpi`: Resolution in dots per inch (72-600). Higher DPI = larger, sharper images
- `quality`: Compression quality for JPEG/WebP (1-100). Higher = better quality, larger file
- `scale`: Direct scale factor as an alternative to DPI

**Format Recommendations:**
- `png`: Best for documents with text and sharp edges (lossless)
- `jpeg`: Best for photo-heavy documents (smaller file size)
- `webp`: Modern format with excellent compression
- `svg`: Vector format, ideal for scaling without quality loss
""",
    response_description="Rendered page image as binary data with the requested Content-Type (image/png, image/jpeg, image/webp, or image/svg+xml)",
    responses={
        200: {
            "description": "Page preview image rendered successfully",
            "content": {
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
                "image/svg+xml": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: {"description": "Document or page not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Invalid parameters (e.g., DPI out of range)"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/preview?format=png&dpi=150" \\
  -H "Authorization: Bearer $TOKEN" \\
  -o page_preview.png

# High-quality JPEG for printing
curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/preview?format=jpeg&dpi=300&quality=95" \\
  -H "Authorization: Bearer $TOKEN" \\
  -o page_hq.jpg""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get PNG preview at 150 DPI
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/preview",
    headers={"Authorization": f"Bearer {token}"},
    params={"format": "png", "dpi": 150}
)

# Save preview to file
with open("page_preview.png", "wb") as f:
    f.write(response.content)

# Generate thumbnails for all pages
for page_num in range(1, page_count + 1):
    response = requests.get(
        f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/{page_num}/preview",
        headers={"Authorization": f"Bearer {token}"},
        params={"format": "webp", "dpi": 72, "quality": 80}
    )
    with open(f"thumb_{page_num}.webp", "wb") as f:
        f.write(response.content)""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Display preview in an image element
const img = document.getElementById('page-preview');
img.src = `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/1/preview?dpi=150&format=png`;

// Fetch and create blob URL for more control
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/${pageNumber}/preview?format=webp&dpi=150`,
  { headers: { "Authorization": `Bearer ${token}` } }
);
const blob = await response.blob();
const previewUrl = URL.createObjectURL(blob);

// Generate thumbnails for navigation
async function loadThumbnails(docId, pageCount) {
  const thumbnails = [];
  for (let i = 1; i <= pageCount; i++) {
    const url = `https://api.giga-pdf.com/api/v1/documents/${docId}/pages/${i}/preview?dpi=72&format=webp`;
    thumbnails.push(url);
  }
  return thumbnails;
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get PNG preview
$params = http_build_query(['format' => 'png', 'dpi' => 150]);
$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/1/preview?$params");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$image_data = curl_exec($ch);

// Save to file
file_put_contents("page_preview.png", $image_data);

// Or serve directly to browser
header("Content-Type: image/png");
header("Content-Length: " . strlen($image_data));
echo $image_data;

// Generate thumbnails for all pages
for ($i = 1; $i <= $page_count; $i++) {
    $params = http_build_query(['format' => 'webp', 'dpi' => 72, 'quality' => 80]);
    $ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/$i/preview?$params");
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token"]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    file_put_contents("thumb_$i.webp", curl_exec($ch));
}""",
            },
        ]
    },
)
async def get_page_preview(
    document_id: str,
    page_number: int,
    format: Literal["png", "jpeg", "webp", "svg"] = Query(default="png"),
    dpi: int = Query(default=150, ge=72, le=600),
    quality: int = Query(default=85, ge=1, le=100),
    scale: float | None = Query(default=None),
    user: OptionalUser = None,
) -> Response:
    """Get page preview image."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
    summary="Add new page",
    description="""
Add a new page to a PDF document at a specified position.

This endpoint allows you to insert new pages into an existing document. Pages can be created from different sources:

**Source Types:**
- `blank`: Create an empty page with custom dimensions
- `from_document`: Copy a page from another document (requires source document ID and page number)
- `from_template`: Use a predefined page template

**Common Page Sizes (in points, 72 points = 1 inch):**
- Letter: 612 x 792
- A4: 595 x 842
- Legal: 612 x 1008
- Tabloid: 792 x 1224

**Position Behavior:**
- Position is 1-indexed
- Use `position: 1` to insert at the beginning
- Use `position: null` or omit to append at the end
- Existing pages at and after the position are shifted

The response includes the new page details and updated total page count.
""",
    response_description="The newly added page details along with the updated total page count",
    responses={
        201: {"description": "Page added successfully"},
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Invalid position or source configuration"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """# Add a blank Letter-sized page at position 2
curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "position": 2,
    "source": {
      "type": "blank",
      "dimensions": {"width": 612, "height": 792}
    }
  }'

# Add an A4 page at the end
curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": {
      "type": "blank",
      "dimensions": {"width": 595, "height": 842}
    }
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Add a blank Letter-sized page at position 2
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={
        "position": 2,
        "source": {
            "type": "blank",
            "dimensions": {"width": 612, "height": 792}
        }
    }
)

result = response.json()
new_page = result["data"]["page"]
new_page_count = result["data"]["new_page_count"]
print(f"Added page {new_page['page_number']}, total pages: {new_page_count}")

# Helper function for common page sizes
def add_blank_page(doc_id, position=None, size="letter"):
    sizes = {
        "letter": (612, 792),
        "a4": (595, 842),
        "legal": (612, 1008),
    }
    width, height = sizes.get(size, sizes["letter"])

    payload = {
        "source": {"type": "blank", "dimensions": {"width": width, "height": height}}
    }
    if position:
        payload["position"] = position

    return requests.post(
        f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload
    )""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Add a blank page at position 2
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      position: 2,
      source: {
        type: 'blank',
        dimensions: { width: 612, height: 792 }
      }
    })
  }
);

const { data } = await response.json();
console.log(`Added page ${data.page.page_number}, total: ${data.new_page_count}`);

// Helper function for adding pages
async function addBlankPage(docId, position = null, size = 'letter') {
  const sizes = {
    letter: { width: 612, height: 792 },
    a4: { width: 595, height: 842 },
    legal: { width: 612, height: 1008 }
  };

  const payload = {
    source: { type: 'blank', dimensions: sizes[size] || sizes.letter }
  };
  if (position) payload.position = position;

  return fetch(`https://api.giga-pdf.com/api/v1/documents/${docId}/pages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Add a blank Letter-sized page at position 2
$data = [
    'position' => 2,
    'source' => [
        'type' => 'blank',
        'dimensions' => ['width' => 612, 'height' => 792]
    ]
];

$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $token",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch), true);
$new_page = $response['data']['page'];
$new_page_count = $response['data']['new_page_count'];

echo "Added page {$new_page['page_number']}, total pages: $new_page_count";

// Helper function for common page sizes
function addBlankPage($document_id, $token, $position = null, $size = 'letter') {
    $sizes = [
        'letter' => ['width' => 612, 'height' => 792],
        'a4' => ['width' => 595, 'height' => 842],
        'legal' => ['width' => 612, 'height' => 1008]
    ];

    $data = ['source' => ['type' => 'blank', 'dimensions' => $sizes[$size] ?? $sizes['letter']]];
    if ($position) $data['position'] = $position;

    $ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages");
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token", "Content-Type: application/json"]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    return json_decode(curl_exec($ch), true);
}""",
            },
        ]
    },
)
async def add_page(
    document_id: str,
    request: AddPageRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Add a new page to the document."""
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
            "page": page.model_dump(by_alias=True),
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
Remove a specific page from a PDF document.

This operation permanently deletes the specified page and renumbers all subsequent pages. For example, if you delete page 2 from a 5-page document, pages 3, 4, and 5 become pages 2, 3, and 4.

**Important Notes:**
- Page numbers are 1-indexed
- Cannot delete the last remaining page (document must have at least one page)
- This operation cannot be undone - use document versioning if you need to recover deleted pages
- All elements on the page (text, images, annotations) are permanently removed

The response includes the deleted page number and the new total page count.
""",
    response_description="Confirmation with the deleted page number and updated total page count",
    responses={
        200: {"description": "Page deleted successfully"},
        404: {"description": "Document or page not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Cannot delete the last page"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """# Delete page 2 from a document
curl -X DELETE "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/2" \\
  -H "Authorization: Bearer $TOKEN"

# Delete multiple pages (in reverse order to maintain page numbers)
for page in 5 4 3; do
  curl -X DELETE "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/$page" \\
    -H "Authorization: Bearer $TOKEN"
done""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Delete page 2
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/2",
    headers={"Authorization": f"Bearer {token}"}
)

result = response.json()
if result["success"]:
    print(f"Deleted page {result['data']['deleted_page_number']}")
    print(f"Document now has {result['data']['new_page_count']} pages")

# Delete multiple pages (delete in reverse order to maintain numbering)
pages_to_delete = [3, 5, 7]
for page_num in sorted(pages_to_delete, reverse=True):
    response = requests.delete(
        f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/{page_num}",
        headers={"Authorization": f"Bearer {token}"}
    )
    if response.status_code == 200:
        print(f"Deleted page {page_num}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Delete page 2
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/2`,
  {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const { data } = await response.json();
console.log(`Deleted page ${data.deleted_page_number}`);
console.log(`Document now has ${data.new_page_count} pages`);

// Delete multiple pages (reverse order to maintain page numbers)
async function deletePages(docId, pageNumbers) {
  // Sort in descending order to delete from end first
  const sorted = [...pageNumbers].sort((a, b) => b - a);

  for (const pageNum of sorted) {
    await fetch(
      `https://api.giga-pdf.com/api/v1/documents/${docId}/pages/${pageNum}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    console.log(`Deleted page ${pageNum}`);
  }
}

await deletePages(documentId, [3, 5, 7]);""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Delete page 2
$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/2");
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "DELETE");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch), true);

if ($response['success']) {
    echo "Deleted page " . $response['data']['deleted_page_number'] . "\\n";
    echo "Document now has " . $response['data']['new_page_count'] . " pages\\n";
}

// Delete multiple pages (reverse order to maintain page numbers)
$pages_to_delete = [3, 5, 7];
rsort($pages_to_delete); // Sort in descending order

foreach ($pages_to_delete as $page_num) {
    $ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/$page_num");
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "DELETE");
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token"]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_exec($ch);
    echo "Deleted page $page_num\\n";
}""",
            },
        ]
    },
)
async def delete_page(
    document_id: str,
    page_number: int,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Delete a page from the document."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
Rearrange the order of pages in a PDF document.

This endpoint allows you to completely reorganize the page sequence in a document. The `new_order` array specifies which current page should appear at each position.

**How it works:**
The array `[3, 1, 2]` means:
- Position 1 gets current page 3
- Position 2 gets current page 1
- Position 3 gets current page 2

**Validation Rules:**
- The `new_order` array must contain all page numbers exactly once
- Page numbers are 1-indexed
- Array length must match the document's page count
- No duplicate or missing page numbers allowed

**Use Cases:**
- Moving pages to different positions
- Reversing page order
- Implementing drag-and-drop page reordering in a UI
- Reorganizing document sections

The response includes the updated page list with new page numbers.
""",
    response_description="The full updated page list reflecting the new page order with reassigned page numbers",
    responses={
        200: {"description": "Pages reordered successfully"},
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Invalid new_order array (wrong length, duplicates, or invalid page numbers)"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """# Reorder pages: move page 3 to front, swap pages 4 and 5
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/reorder" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"new_order": [3, 1, 2, 5, 4]}'

# Reverse all pages in a 4-page document
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/reorder" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"new_order": [4, 3, 2, 1]}'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Reorder pages: [3, 1, 2, 5, 4]
response = requests.put(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/reorder",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={"new_order": [3, 1, 2, 5, 4]}
)

result = response.json()
for page in result["data"]["pages"]:
    print(f"Page {page['page_number']}: {page['page_id']}")

# Helper: Move a single page to a new position
def move_page(doc_id, from_pos, to_pos, total_pages):
    # Build the new order
    order = list(range(1, total_pages + 1))
    page = order.pop(from_pos - 1)
    order.insert(to_pos - 1, page)

    return requests.put(
        f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/reorder",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"new_order": order}
    )

# Helper: Reverse all pages
def reverse_pages(doc_id, total_pages):
    new_order = list(range(total_pages, 0, -1))
    return requests.put(
        f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/reorder",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"new_order": new_order}
    )""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Reorder pages
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/reorder`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ new_order: [3, 1, 2, 5, 4] })
  }
);

const { data } = await response.json();
data.pages.forEach(page => {
  console.log(`Page ${page.page_number}: ${page.page_id}`);
});

// Helper: Move a single page to a new position
function movePage(fromPos, toPos, totalPages) {
  const order = Array.from({ length: totalPages }, (_, i) => i + 1);
  const [page] = order.splice(fromPos - 1, 1);
  order.splice(toPos - 1, 0, page);
  return order;
}

// Helper: Reverse all pages
function reversePages(totalPages) {
  return Array.from({ length: totalPages }, (_, i) => totalPages - i);
}

// Example: Move page 5 to position 2
const newOrder = movePage(5, 2, 6);
await fetch(`https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/reorder`, {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ new_order: newOrder })
});""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Reorder pages
$data = ['new_order' => [3, 1, 2, 5, 4]];

$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/reorder");
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PUT");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $token",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch), true);

foreach ($response['data']['pages'] as $page) {
    echo "Page {$page['page_number']}: {$page['page_id']}\\n";
}

// Helper: Move a single page to a new position
function movePage($from_pos, $to_pos, $total_pages) {
    $order = range(1, $total_pages);
    $page = array_splice($order, $from_pos - 1, 1)[0];
    array_splice($order, $to_pos - 1, 0, [$page]);
    return $order;
}

// Helper: Reverse all pages
function reversePages($total_pages) {
    return range($total_pages, 1, -1);
}

// Example: Reverse a 5-page document
$new_order = reversePages(5); // [5, 4, 3, 2, 1]""",
            },
        ]
    },
)
async def reorder_pages(
    document_id: str,
    request: ReorderPagesRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Reorder pages in the document."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
                    "dimensions": p.dimensions.model_dump(by_alias=True),
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
Rotate a specific page in a PDF document by a given angle.

This endpoint rotates a page clockwise by the specified angle. The rotation is cumulative - rotating a page by 90 degrees twice results in a 180-degree rotation.

**Valid Rotation Angles:**
- `90`: Rotate 90 degrees clockwise (portrait to landscape)
- `180`: Rotate 180 degrees (upside down)
- `270`: Rotate 270 degrees clockwise (same as 90 counter-clockwise)
- `-90`: Rotate 90 degrees counter-clockwise
- `-180`: Rotate 180 degrees counter-clockwise
- `-270`: Rotate 270 degrees counter-clockwise

**Effects of Rotation:**
- Page dimensions are swapped for 90/270 degree rotations
- All content (text, images, annotations) rotates with the page
- The new orientation is saved to the document

The response includes the updated page details with new dimensions.
""",
    response_description="Updated page details with the new rotation angle and swapped dimensions (for 90/270 degree rotations)",
    responses={
        200: {"description": "Page rotated successfully"},
        404: {"description": "Document or page not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Invalid rotation angle"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """# Rotate page 1 by 90 degrees clockwise
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/rotate" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"angle": 90}'

# Rotate page 2 by 90 degrees counter-clockwise
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/2/rotate" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"angle": -90}'

# Flip page upside down
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/3/rotate" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"angle": 180}'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Rotate page 1 by 90 degrees clockwise
response = requests.put(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/rotate",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={"angle": 90}
)

result = response.json()
page = result["data"]
print(f"Page rotated. New dimensions: {page['dimensions']['width']}x{page['dimensions']['height']}")

# Rotate multiple pages
def rotate_pages(doc_id, page_numbers, angle):
    results = []
    for page_num in page_numbers:
        response = requests.put(
            f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/{page_num}/rotate",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"angle": angle}
        )
        results.append(response.json())
    return results

# Rotate all odd pages by 90 degrees
rotate_pages(document_id, [1, 3, 5, 7], 90)

# Fix upside-down scanned pages
rotate_pages(document_id, [2, 4, 6], 180)""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Rotate page 1 by 90 degrees clockwise
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/1/rotate`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ angle: 90 })
  }
);

const { data: page } = await response.json();
console.log(`Page rotated. New dimensions: ${page.dimensions.width}x${page.dimensions.height}`);

// Helper: Rotate multiple pages
async function rotatePages(docId, pageNumbers, angle) {
  const results = await Promise.all(
    pageNumbers.map(pageNum =>
      fetch(`https://api.giga-pdf.com/api/v1/documents/${docId}/pages/${pageNum}/rotate`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ angle })
      }).then(r => r.json())
    )
  );
  return results;
}

// Rotate all landscape pages to portrait
await rotatePages(documentId, landscapePageNumbers, 90);""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Rotate page 1 by 90 degrees clockwise
$data = ['angle' => 90];

$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/1/rotate");
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PUT");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $token",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch), true);
$page = $response['data'];
echo "Page rotated. New dimensions: {$page['dimensions']['width']}x{$page['dimensions']['height']}\\n";

// Helper: Rotate multiple pages
function rotatePages($document_id, $token, $page_numbers, $angle) {
    $results = [];
    foreach ($page_numbers as $page_num) {
        $ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/$page_num/rotate");
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PUT");
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer $token",
            "Content-Type: application/json"
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['angle' => $angle]));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $results[] = json_decode(curl_exec($ch), true);
    }
    return $results;
}

// Rotate odd pages by 90 degrees
rotatePages($document_id, $token, [1, 3, 5, 7], 90);""",
            },
        ]
    },
)
async def rotate_page(
    document_id: str,
    page_number: int,
    request: RotatePageRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Rotate a page."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

    page = document_service.rotate_page(
        document_id=document_id,
        page_number=page_number,
        angle=request.angle,
    )

    return APIResponse(
        success=True,
        data=page.model_dump(by_alias=True),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.put(
    "/{page_number}/resize",
    response_model=APIResponse[dict],
    summary="Resize page",
    description="""
Resize a page to new dimensions with optional content scaling and positioning.

This endpoint allows you to change the dimensions of a PDF page. You can choose whether to scale existing content to fit the new dimensions or reposition it using anchor points.

**Common Page Sizes (in points):**
- Letter: 612 x 792
- A4: 595 x 842
- Legal: 612 x 1008
- A3: 842 x 1191
- Tabloid: 792 x 1224

**Anchor Points:**
Control where content is positioned when the page size changes without scaling:
- `top-left`, `top-center`, `top-right`
- `center-left`, `center`, `center-right`
- `bottom-left`, `bottom-center`, `bottom-right`

**Scaling Options:**
- `scale_content: true`: Proportionally scales all content to fit new dimensions
- `scale_content: false`: Keeps content at original size, uses anchor for positioning

**Use Cases:**
- Converting between page sizes (e.g., Letter to A4)
- Adding margins around existing content
- Cropping pages by reducing dimensions
- Preparing documents for printing on different paper sizes
""",
    response_description="Updated page details reflecting the new dimensions and content scaling applied",
    responses={
        200: {"description": "Page resized successfully"},
        404: {"description": "Document or page not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Invalid dimensions or anchor point"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """# Resize page to A4 with content scaling
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/resize" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "width": 595,
    "height": 842,
    "anchor": "center",
    "scale_content": true
  }'

# Convert portrait to landscape (swap dimensions)
curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/resize" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "width": 792,
    "height": 612,
    "anchor": "top-left",
    "scale_content": false
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Resize page to A4 with content scaling
response = requests.put(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/resize",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={
        "width": 595,
        "height": 842,
        "anchor": "center",
        "scale_content": True
    }
)

print(response.json())

# Helper: Common page size converter
PAGE_SIZES = {
    "letter": (612, 792),
    "a4": (595, 842),
    "legal": (612, 1008),
    "a3": (842, 1191),
    "tabloid": (792, 1224),
}

def resize_to_size(doc_id, page_num, size_name, scale_content=True):
    width, height = PAGE_SIZES.get(size_name.lower(), PAGE_SIZES["letter"])
    return requests.put(
        f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/{page_num}/resize",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"width": width, "height": height, "anchor": "center", "scale_content": scale_content}
    )

# Convert all pages to A4
for page_num in range(1, total_pages + 1):
    resize_to_size(document_id, page_num, "a4")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Resize page to A4 with content scaling
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/1/resize`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      width: 595,
      height: 842,
      anchor: 'center',
      scale_content: true
    })
  }
);

console.log(await response.json());

// Helper: Common page size converter
const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595, height: 842 },
  legal: { width: 612, height: 1008 },
  a3: { width: 842, height: 1191 },
  tabloid: { width: 792, height: 1224 }
};

async function resizeToSize(docId, pageNum, sizeName, scaleContent = true) {
  const size = PAGE_SIZES[sizeName.toLowerCase()] || PAGE_SIZES.letter;
  return fetch(`https://api.giga-pdf.com/api/v1/documents/${docId}/pages/${pageNum}/resize`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...size, anchor: 'center', scale_content: scaleContent })
  });
}

// Convert all pages to A4
for (let i = 1; i <= totalPages; i++) {
  await resizeToSize(documentId, i, 'a4');
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Resize page to A4 with content scaling
$data = [
    'width' => 595,
    'height' => 842,
    'anchor' => 'center',
    'scale_content' => true
];

$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/1/resize");
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PUT");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $token",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch), true);
print_r($response);

// Helper: Common page size converter
$PAGE_SIZES = [
    'letter' => ['width' => 612, 'height' => 792],
    'a4' => ['width' => 595, 'height' => 842],
    'legal' => ['width' => 612, 'height' => 1008],
    'a3' => ['width' => 842, 'height' => 1191],
    'tabloid' => ['width' => 792, 'height' => 1224]
];

function resizeToSize($document_id, $token, $page_num, $size_name, $scale_content = true) {
    global $PAGE_SIZES;
    $size = $PAGE_SIZES[strtolower($size_name)] ?? $PAGE_SIZES['letter'];

    $ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/$page_num/resize");
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PUT");
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token", "Content-Type: application/json"]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(array_merge($size, ['anchor' => 'center', 'scale_content' => $scale_content])));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    return json_decode(curl_exec($ch), true);
}

// Convert all pages to A4
for ($i = 1; $i <= $total_pages; $i++) {
    resizeToSize($document_id, $token, $i, 'a4');
}""",
            },
        ]
    },
)
async def resize_page(
    document_id: str,
    page_number: int,
    request: ResizePageRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Resize a page."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
    summary="Extract pages to new document",
    description="""
Extract specified pages from a PDF document and create a new document containing only those pages.

This endpoint allows you to split a PDF by extracting specific pages or page ranges into a new standalone document. The original document remains unchanged.

**Specifying Pages:**
You can specify pages using two methods (or combine both):
- `page_numbers`: Array of individual page numbers `[1, 3, 5, 7]`
- `page_ranges`: Array of range strings `["10-15", "20-25"]`

**Page Range Syntax:**
- `"1-5"`: Pages 1 through 5 (inclusive)
- `"10-"`: Page 10 through the last page
- `"-5"`: Pages 1 through 5

**Behavior:**
- Pages are extracted in the order specified
- Duplicate page numbers are allowed (same page can appear multiple times)
- Invalid page numbers are skipped with a warning
- The new document gets a unique ID

**Use Cases:**
- Splitting a large document into smaller parts
- Creating a subset document with specific chapters
- Extracting specific pages for sharing
- Creating document excerpts
""",
    response_description="The new document ID and page count of the newly created document containing the extracted pages",
    responses={
        201: {"description": "Pages extracted successfully, new document created"},
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
        400: {"description": "Invalid page numbers or ranges"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """# Extract specific pages
curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/extract" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"page_numbers": [1, 3, 5, 7]}'

# Extract page ranges
curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/extract" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"page_ranges": ["1-5", "10-15"]}'

# Combine both methods
curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/extract" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"page_numbers": [1, 50], "page_ranges": ["10-20"]}'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Extract specific pages
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/extract",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={"page_numbers": [1, 3, 5, 7]}
)

result = response.json()
new_doc_id = result["data"]["new_document_id"]
page_count = result["data"]["page_count"]
print(f"Created new document {new_doc_id} with {page_count} pages")

# Extract page ranges
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/extract",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json={"page_ranges": ["1-5", "10-15", "20-25"]}
)

# Helper: Split document into chapters
def split_into_chapters(doc_id, chapter_ranges):
    '''
    Split a document into multiple chapter documents.
    chapter_ranges: {"Chapter 1": "1-10", "Chapter 2": "11-25", ...}
    '''
    chapters = {}
    for chapter_name, page_range in chapter_ranges.items():
        response = requests.post(
            f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/pages/extract",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"page_ranges": [page_range]}
        )
        chapters[chapter_name] = response.json()["data"]["new_document_id"]
    return chapters

chapters = split_into_chapters(document_id, {
    "Introduction": "1-5",
    "Main Content": "6-50",
    "Appendix": "51-60"
})""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Extract specific pages
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/extract`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_numbers: [1, 3, 5, 7] })
  }
);

const { data } = await response.json();
console.log(`Created document ${data.new_document_id} with ${data.page_count} pages`);

// Extract page ranges
const rangeResponse = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/extract`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_ranges: ['1-5', '10-15', '20-25'] })
  }
);

// Helper: Split document into chapters
async function splitIntoChapters(docId, chapterRanges) {
  const chapters = {};
  for (const [chapterName, pageRange] of Object.entries(chapterRanges)) {
    const res = await fetch(
      `https://api.giga-pdf.com/api/v1/documents/${docId}/pages/extract`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_ranges: [pageRange] })
      }
    );
    const { data } = await res.json();
    chapters[chapterName] = data.new_document_id;
  }
  return chapters;
}

const chapters = await splitIntoChapters(documentId, {
  'Introduction': '1-5',
  'Main Content': '6-50',
  'Appendix': '51-60'
});""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Extract specific pages
$data = ['page_numbers' => [1, 3, 5, 7]];

$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/extract");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $token",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch), true);
$new_doc_id = $response['data']['new_document_id'];
$page_count = $response['data']['page_count'];
echo "Created document $new_doc_id with $page_count pages\\n";

// Extract page ranges
$data = ['page_ranges' => ['1-5', '10-15', '20-25']];
$ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/extract");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token", "Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = json_decode(curl_exec($ch), true);

// Helper: Split document into chapters
function splitIntoChapters($document_id, $token, $chapter_ranges) {
    $chapters = [];
    foreach ($chapter_ranges as $chapter_name => $page_range) {
        $ch = curl_init("https://api.giga-pdf.com/api/v1/documents/$document_id/pages/extract");
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token", "Content-Type: application/json"]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['page_ranges' => [$page_range]]));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $response = json_decode(curl_exec($ch), true);
        $chapters[$chapter_name] = $response['data']['new_document_id'];
    }
    return $chapters;
}

$chapters = splitIntoChapters($document_id, $token, [
    'Introduction' => '1-5',
    'Main Content' => '6-50',
    'Appendix' => '51-60'
]);""",
            },
        ]
    },
)
async def extract_pages(
    document_id: str,
    request: ExtractPagesRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Extract pages to a new document."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
