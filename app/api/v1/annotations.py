"""
Annotation endpoints.

Handles creation of various annotation types (highlights, notes, links, etc.).
"""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.schemas.responses.common import APIResponse

router = APIRouter()


class CreateMarkupAnnotationRequest(BaseModel):
    """Request to create a markup annotation (highlight, underline, etc.)."""

    annotation_type: str = Field(
        description="Type of markup (highlight, underline, strikeout, squiggly)"
    )
    bounds: dict = Field(description="Annotation bounds {x, y, width, height}")
    content: str | None = Field(default="", description="Annotation comment text")
    color: str | None = Field(
        default="#FFFF00", pattern=r"^#[0-9A-Fa-f]{6}$", description="Annotation color"
    )
    opacity: float | None = Field(default=0.5, ge=0, le=1, description="Annotation opacity")

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
    color: str | None = Field(
        default="#FFD700", pattern=r"^#[0-9A-Fa-f]{6}$", description="Note color"
    )
    icon: str | None = Field(
        default="Comment", description="Note icon (Comment, Key, Note, Help, etc.)"
    )
    popup_open: bool | None = Field(default=False, description="Whether popup is initially open")

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
    url: str | None = Field(default=None, description="External URL (for external links)")
    target_page: int | None = Field(
        default=None, ge=1, description="Target page number (for internal links)"
    )
    target_position: dict | None = Field(
        default=None, description="Position on target page {x, y}"
    )
    border_style: str | None = Field(
        default="none", description="Border style (solid, dashed, underline, none)"
    )
    color: str | None = Field(
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
    description="""Create a markup annotation on a specific page of a PDF document.

Markup annotations allow you to highlight, underline, strikeout, or add squiggly underlines to text content in your PDF documents. These annotations are commonly used for document review, proofreading, and collaborative editing workflows.

## Annotation Types

| Type | Description | Common Use Case |
|------|-------------|-----------------|
| `highlight` | Yellow (or custom color) highlighting over text | Emphasizing important content |
| `underline` | Underline beneath text | Drawing attention to key terms |
| `strikeout` | Line through text | Marking content for deletion |
| `squiggly` | Wavy underline beneath text | Indicating spelling/grammar issues |

## Bounds Object

The `bounds` object defines the rectangular area for the annotation:
- `x`: Horizontal position from left edge (in points)
- `y`: Vertical position from top edge (in points)
- `width`: Width of the annotation area (in points)
- `height`: Height of the annotation area (in points)

## Color Format

Colors must be specified as 6-digit hexadecimal values with a `#` prefix (e.g., `#FFFF00` for yellow).
""",
    responses={
        201: {
            "description": "Markup annotation created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "element_id": "annot-abc123",
                            "type": "annotation",
                            "annotation_type": "highlight",
                            "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},
                            "content": "Important text",
                            "style": {"color": "#FFFF00", "opacity": 0.5},
                        },
                        "meta": {
                            "request_id": "req-xyz789",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 45,
                        },
                    }
                }
            },
        },
        400: {"description": "Invalid annotation data - check bounds, color format, or annotation type"},
        401: {"description": "Unauthorized - valid authentication token required"},
        404: {"description": "Document or page not found"},
        422: {"description": "Validation error - request body does not match schema"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/annotations/markup" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "annotation_type": "highlight",\n    "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},\n    "content": "Important section",\n    "color": "#FFFF00",\n    "opacity": 0.5\n  }\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ndocument_id = "your-document-id"\npage_number = 1\n\nannotation_data = {\n    "annotation_type": "highlight",\n    "bounds": {"x": 100, "y": 200, "width": 200, "height": 20},\n    "content": "Important section",\n    "color": "#FFFF00",\n    "opacity": 0.5\n}\n\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/{page_number}/annotations/markup",\n    headers={\n        "Authorization": "Bearer YOUR_TOKEN",\n        "Content-Type": "application/json"\n    },\n    json=annotation_data\n)\n\nresult = response.json()\nif result["success"]:\n    annotation = result["data"]\n    print(f"Created {annotation[\'annotation_type\']} annotation: {annotation[\'element_id\']}")\nelse:\n    print(f"Error: {result.get(\'error\', \'Unknown error\')}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const documentId = 'your-document-id';\nconst pageNumber = 1;\n\nconst annotationData = {\n  annotation_type: 'highlight',\n  bounds: { x: 100, y: 200, width: 200, height: 20 },\n  content: 'Important section',\n  color: '#FFFF00',\n  opacity: 0.5\n};\n\nconst response = await fetch(\n  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/${pageNumber}/annotations/markup`,\n  {\n    method: 'POST',\n    headers: {\n      'Authorization': 'Bearer YOUR_TOKEN',\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify(annotationData)\n  }\n);\n\nconst result = await response.json();\nif (result.success) {\n  console.log(`Created ${result.data.annotation_type} annotation: ${result.data.element_id}`);\n} else {\n  console.error('Error:', result.error);\n}",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$documentId = 'your-document-id';\n$pageNumber = 1;\n\n$annotationData = [\n    'annotation_type' => 'highlight',\n    'bounds' => ['x' => 100, 'y' => 200, 'width' => 200, 'height' => 20],\n    'content' => 'Important section',\n    'color' => '#FFFF00',\n    'opacity' => 0.5\n];\n\n$ch = curl_init();\ncurl_setopt_array($ch, [\n    CURLOPT_URL => \"https://api.giga-pdf.com/api/v1/documents/{$documentId}/pages/{$pageNumber}/annotations/markup\",\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_POST => true,\n    CURLOPT_HTTPHEADER => [\n        'Authorization: Bearer YOUR_TOKEN',\n        'Content-Type: application/json'\n    ],\n    CURLOPT_POSTFIELDS => json_encode($annotationData)\n]);\n\n$response = curl_exec($ch);\n$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\ncurl_close($ch);\n\n$result = json_decode($response, true);\nif ($result['success']) {\n    echo \"Created {$result['data']['annotation_type']} annotation: {$result['data']['element_id']}\";\n} else {\n    echo \"Error: \" . ($result['error'] ?? 'Unknown error');\n}",
            },
        ]
    },
)
async def create_markup_annotation(
    document_id: str,
    page_number: int,
    request: CreateMarkupAnnotationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a markup annotation (highlight, underline, etc.)."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.post(
    "/{document_id}/pages/{page_number}/annotations/note",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create note annotation",
    description="""Create a sticky note annotation on a specific page of a PDF document.

Note annotations (also known as sticky notes or text annotations) allow you to add comments and notes to PDF documents without modifying the actual content. They appear as small icons that can be clicked to reveal the full note text in a popup.

## Icon Types

| Icon | Description | Common Use Case |
|------|-------------|-----------------|
| `Comment` | Speech bubble icon | General comments |
| `Key` | Key icon | Important points |
| `Note` | Note/paper icon | Additional information |
| `Help` | Question mark icon | Questions or clarifications needed |
| `NewParagraph` | Paragraph marker | Suggesting new paragraph |
| `Paragraph` | Paragraph icon | Paragraph-related notes |
| `Insert` | Caret/insert icon | Suggesting text insertion |

## Bounds Object

The `bounds` object defines the position and size of the note icon:
- `x`: Horizontal position from left edge (in points)
- `y`: Vertical position from top edge (in points)
- `width`: Width of the icon (typically 20-24 points)
- `height`: Height of the icon (typically 20-24 points)

## Popup Behavior

Set `popup_open` to `true` if you want the note's popup to be visible immediately when the document is opened.
""",
    responses={
        201: {
            "description": "Note annotation created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "element_id": "note-def456",
                            "type": "annotation",
                            "annotation_type": "note",
                            "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},
                            "content": "This is an important note",
                            "style": {"color": "#FFD700"},
                            "popup": {"is_open": False},
                        },
                        "meta": {
                            "request_id": "req-abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 32,
                        },
                    }
                }
            },
        },
        400: {"description": "Invalid note data - check bounds or color format"},
        401: {"description": "Unauthorized - valid authentication token required"},
        404: {"description": "Document or page not found"},
        422: {"description": "Validation error - request body does not match schema"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/annotations/note" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},\n    "content": "This is a critical section that needs review",\n    "color": "#FFD700",\n    "icon": "Comment",\n    "popup_open": false\n  }\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ndocument_id = "your-document-id"\npage_number = 1\n\nnote_data = {\n    "bounds": {"x": 50, "y": 100, "width": 20, "height": 20},\n    "content": "This is a critical section that needs review",\n    "color": "#FFD700",\n    "icon": "Comment",\n    "popup_open": True\n}\n\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/{page_number}/annotations/note",\n    headers={\n        "Authorization": "Bearer YOUR_TOKEN",\n        "Content-Type": "application/json"\n    },\n    json=note_data\n)\n\nresult = response.json()\nif result["success"]:\n    note = result["data"]\n    print(f"Created note annotation: {note[\'element_id\']}")\n    print(f"Content: {note[\'content\']}")\nelse:\n    print(f"Error: {result.get(\'error\', \'Unknown error\')}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const documentId = 'your-document-id';\nconst pageNumber = 1;\n\nconst noteData = {\n  bounds: { x: 50, y: 100, width: 20, height: 20 },\n  content: 'This is a critical section that needs review',\n  color: '#FFD700',\n  icon: 'Comment',\n  popup_open: true\n};\n\nconst response = await fetch(\n  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/${pageNumber}/annotations/note`,\n  {\n    method: 'POST',\n    headers: {\n      'Authorization': 'Bearer YOUR_TOKEN',\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify(noteData)\n  }\n);\n\nconst result = await response.json();\nif (result.success) {\n  console.log(`Created note annotation: ${result.data.element_id}`);\n  console.log(`Content: ${result.data.content}`);\n} else {\n  console.error('Error:', result.error);\n}",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$documentId = 'your-document-id';\n$pageNumber = 1;\n\n$noteData = [\n    'bounds' => ['x' => 50, 'y' => 100, 'width' => 20, 'height' => 20],\n    'content' => 'This is a critical section that needs review',\n    'color' => '#FFD700',\n    'icon' => 'Comment',\n    'popup_open' => true\n];\n\n$ch = curl_init();\ncurl_setopt_array($ch, [\n    CURLOPT_URL => \"https://api.giga-pdf.com/api/v1/documents/{$documentId}/pages/{$pageNumber}/annotations/note\",\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_POST => true,\n    CURLOPT_HTTPHEADER => [\n        'Authorization: Bearer YOUR_TOKEN',\n        'Content-Type: application/json'\n    ],\n    CURLOPT_POSTFIELDS => json_encode($noteData)\n]);\n\n$response = curl_exec($ch);\n$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\ncurl_close($ch);\n\n$result = json_decode($response, true);\nif ($result['success']) {\n    echo \"Created note annotation: {$result['data']['element_id']}\\n\";\n    echo \"Content: {$result['data']['content']}\";\n} else {\n    echo \"Error: \" . ($result['error'] ?? 'Unknown error');\n}",
            },
        ]
    },
)
async def create_note_annotation(
    document_id: str,
    page_number: int,
    request: CreateNoteAnnotationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a note annotation."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.post(
    "/{document_id}/pages/{page_number}/annotations/link",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create link annotation",
    description="""Create a link annotation on a specific page of a PDF document.

Link annotations allow you to add clickable hyperlinks to PDF documents. Links can navigate to external URLs (websites, email addresses) or internal destinations (other pages within the same document).

## Link Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `external` | Opens an external URL in browser | `url` |
| `internal` | Navigates to another page in the document | `target_page`, optionally `target_position` |

## Border Styles

| Style | Description |
|-------|-------------|
| `none` | No visible border (invisible link area) |
| `solid` | Solid line border around link |
| `dashed` | Dashed line border around link |
| `underline` | Underline beneath link text |

## Bounds Object

The `bounds` object defines the clickable area for the link:
- `x`: Horizontal position from left edge (in points)
- `y`: Vertical position from top edge (in points)
- `width`: Width of the clickable area (in points)
- `height`: Height of the clickable area (in points)

## Target Position (Internal Links)

For internal links, `target_position` specifies where on the target page to scroll:
- `x`: Horizontal scroll position (in points)
- `y`: Vertical scroll position (in points, 0 = top of page)
""",
    responses={
        201: {
            "description": "Link annotation created successfully",
            "content": {
                "application/json": {
                    "examples": {
                        "external_link": {
                            "summary": "External URL link",
                            "value": {
                                "success": True,
                                "data": {
                                    "element_id": "link-ghi789",
                                    "type": "annotation",
                                    "annotation_type": "link",
                                    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
                                    "link_destination": {
                                        "type": "external",
                                        "url": "https://example.com",
                                    },
                                    "style": {"color": "#0000FF"},
                                },
                                "meta": {
                                    "request_id": "req-link123",
                                    "timestamp": "2024-01-15T10:30:00Z",
                                    "processing_time_ms": 28,
                                },
                            },
                        },
                        "internal_link": {
                            "summary": "Internal page link",
                            "value": {
                                "success": True,
                                "data": {
                                    "element_id": "link-jkl012",
                                    "type": "annotation",
                                    "annotation_type": "link",
                                    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},
                                    "link_destination": {
                                        "type": "internal",
                                        "page_number": 5,
                                        "position": {"x": 0, "y": 0},
                                    },
                                    "style": {"color": "#0000FF"},
                                },
                                "meta": {
                                    "request_id": "req-link456",
                                    "timestamp": "2024-01-15T10:30:00Z",
                                    "processing_time_ms": 25,
                                },
                            },
                        },
                    }
                }
            },
        },
        400: {"description": "Invalid link data - check URL format, target page, or bounds"},
        401: {"description": "Unauthorized - valid authentication token required"},
        404: {"description": "Document or page not found"},
        422: {"description": "Validation error - request body does not match schema"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL (External Link)",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/annotations/link" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},\n    "link_type": "external",\n    "url": "https://example.com",\n    "border_style": "underline",\n    "color": "#0000FF"\n  }\'',
            },
            {
                "lang": "curl",
                "label": "cURL (Internal Link)",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/annotations/link" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},\n    "link_type": "internal",\n    "target_page": 5,\n    "target_position": {"x": 0, "y": 0},\n    "border_style": "none"\n  }\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ndocument_id = "your-document-id"\npage_number = 1\n\n# External link example\nexternal_link_data = {\n    "bounds": {"x": 100, "y": 200, "width": 150, "height": 20},\n    "link_type": "external",\n    "url": "https://example.com",\n    "border_style": "underline",\n    "color": "#0000FF"\n}\n\n# Internal link example\ninternal_link_data = {\n    "bounds": {"x": 200, "y": 300, "width": 100, "height": 20},\n    "link_type": "internal",\n    "target_page": 5,\n    "target_position": {"x": 0, "y": 0},\n    "border_style": "none"\n}\n\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/{page_number}/annotations/link",\n    headers={\n        "Authorization": "Bearer YOUR_TOKEN",\n        "Content-Type": "application/json"\n    },\n    json=external_link_data\n)\n\nresult = response.json()\nif result["success"]:\n    link = result["data"]\n    dest = link["link_destination"]\n    if dest["type"] == "external":\n        print(f"Created external link to: {dest[\'url\']}")\n    else:\n        print(f"Created internal link to page: {dest[\'page_number\']}")\nelse:\n    print(f"Error: {result.get(\'error\', \'Unknown error\')}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const documentId = 'your-document-id';\nconst pageNumber = 1;\n\n// External link example\nconst externalLinkData = {\n  bounds: { x: 100, y: 200, width: 150, height: 20 },\n  link_type: 'external',\n  url: 'https://example.com',\n  border_style: 'underline',\n  color: '#0000FF'\n};\n\n// Internal link example\nconst internalLinkData = {\n  bounds: { x: 200, y: 300, width: 100, height: 20 },\n  link_type: 'internal',\n  target_page: 5,\n  target_position: { x: 0, y: 0 },\n  border_style: 'none'\n};\n\nconst response = await fetch(\n  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/${pageNumber}/annotations/link`,\n  {\n    method: 'POST',\n    headers: {\n      'Authorization': 'Bearer YOUR_TOKEN',\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify(externalLinkData)\n  }\n);\n\nconst result = await response.json();\nif (result.success) {\n  const dest = result.data.link_destination;\n  if (dest.type === 'external') {\n    console.log(`Created external link to: ${dest.url}`);\n  } else {\n    console.log(`Created internal link to page: ${dest.page_number}`);\n  }\n} else {\n  console.error('Error:', result.error);\n}",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$documentId = 'your-document-id';\n$pageNumber = 1;\n\n// External link example\n$externalLinkData = [\n    'bounds' => ['x' => 100, 'y' => 200, 'width' => 150, 'height' => 20],\n    'link_type' => 'external',\n    'url' => 'https://example.com',\n    'border_style' => 'underline',\n    'color' => '#0000FF'\n];\n\n// Internal link example\n$internalLinkData = [\n    'bounds' => ['x' => 200, 'y' => 300, 'width' => 100, 'height' => 20],\n    'link_type' => 'internal',\n    'target_page' => 5,\n    'target_position' => ['x' => 0, 'y' => 0],\n    'border_style' => 'none'\n];\n\n$ch = curl_init();\ncurl_setopt_array($ch, [\n    CURLOPT_URL => \"https://api.giga-pdf.com/api/v1/documents/{$documentId}/pages/{$pageNumber}/annotations/link\",\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_POST => true,\n    CURLOPT_HTTPHEADER => [\n        'Authorization: Bearer YOUR_TOKEN',\n        'Content-Type: application/json'\n    ],\n    CURLOPT_POSTFIELDS => json_encode($externalLinkData)\n]);\n\n$response = curl_exec($ch);\n$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\ncurl_close($ch);\n\n$result = json_decode($response, true);\nif ($result['success']) {\n    $dest = $result['data']['link_destination'];\n    if ($dest['type'] === 'external') {\n        echo \"Created external link to: {$dest['url']}\";\n    } else {\n        echo \"Created internal link to page: {$dest['page_number']}\";\n    }\n} else {\n    echo \"Error: \" . ($result['error'] ?? 'Unknown error');\n}",
            },
        ]
    },
)
async def create_link_annotation(
    document_id: str,
    page_number: int,
    request: CreateLinkAnnotationRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a link annotation."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )
