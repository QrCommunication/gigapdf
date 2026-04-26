"""
PDF modification endpoints.

Handles batch modifications to PDF documents: add, update, and delete
elements (text, images, shapes, annotations) on specific pages.
"""

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

router = APIRouter()


class ElementStyle(BaseModel):
    """Style properties for an element."""

    font_family: str | None = Field(default=None, description="Font family name")
    font_size: float | None = Field(default=None, ge=1, le=1000, description="Font size in points")
    color: str | None = Field(default=None, description="Color in hex format (#RRGGBB)")
    opacity: float | None = Field(default=None, ge=0.0, le=1.0, description="Opacity (0.0 to 1.0)")
    bold: bool | None = Field(default=None, description="Bold text")
    italic: bool | None = Field(default=None, description="Italic text")
    line_width: float | None = Field(default=None, ge=0, description="Stroke line width")
    fill_color: str | None = Field(default=None, description="Fill color in hex format (#RRGGBB)")


class ElementBounds(BaseModel):
    """Position and dimensions of an element."""

    x: float = Field(description="X coordinate (from left)")
    y: float = Field(description="Y coordinate (from top)")
    width: float = Field(ge=0, description="Width in points")
    height: float = Field(ge=0, description="Height in points")


class ElementData(BaseModel):
    """Data describing an element to add or update."""

    content: str | None = Field(default=None, description="Text content or image URL/base64")
    bounds: ElementBounds = Field(description="Position and dimensions")
    style: ElementStyle | None = Field(default=None, description="Visual style properties")
    rotation: float | None = Field(default=None, description="Rotation angle in degrees")


class ModifyOperation(BaseModel):
    """A single modification operation on a PDF document."""

    action: str = Field(
        description="Operation type: 'add', 'update', or 'delete'",
        json_schema_extra={"enum": ["add", "update", "delete"]},
    )
    element_type: str = Field(
        description="Type of element: 'text', 'image', 'shape', or 'annotation'",
        json_schema_extra={"enum": ["text", "image", "shape", "annotation"]},
    )
    page_number: int = Field(ge=1, description="Target page number (1-indexed)")
    element: ElementData | None = Field(
        default=None,
        description="Element data. Required for 'add' and 'update' actions.",
    )
    element_id: str | None = Field(
        default=None,
        description="Element ID. Required for 'update' and 'delete' actions.",
    )
    old_bounds: ElementBounds | None = Field(
        default=None,
        description="Previous bounds of the element. Required for 'update' action.",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "action": "add",
                "element_type": "text",
                "page_number": 1,
                "element": {
                    "content": "Hello World",
                    "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
                    "style": {
                        "font_family": "Helvetica",
                        "font_size": 14,
                        "color": "#000000",
                    },
                },
            }
        }


class ModifyRequest(BaseModel):
    """Batch modification request for a PDF document."""

    operations: list[ModifyOperation] = Field(
        min_length=1,
        max_length=100,
        description="Ordered list of modification operations to apply.",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "operations": [
                    {
                        "action": "add",
                        "element_type": "text",
                        "page_number": 1,
                        "element": {
                            "content": "New Title",
                            "bounds": {"x": 100, "y": 50, "width": 400, "height": 40},
                            "style": {
                                "font_family": "Helvetica-Bold",
                                "font_size": 24,
                                "color": "#1a1a1a",
                            },
                        },
                    },
                    {
                        "action": "add",
                        "element_type": "image",
                        "page_number": 1,
                        "element": {
                            "content": "data:image/png;base64,...",
                            "bounds": {"x": 100, "y": 100, "width": 200, "height": 150},
                        },
                    },
                    {
                        "action": "update",
                        "element_type": "text",
                        "page_number": 2,
                        "element_id": "txt-001-abc123",
                        "element": {
                            "content": "Updated text content",
                            "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
                            "style": {"font_size": 16, "color": "#333333"},
                        },
                        "old_bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
                    },
                    {
                        "action": "delete",
                        "element_type": "annotation",
                        "page_number": 3,
                        "element_id": "ann-002-def456",
                    },
                ]
            }
        }


@router.post(
    "/{document_id}/modify",
    response_model=APIResponse[dict],
    summary="Modify PDF document",
    response_description="Summary of applied modifications: total operations, successful count, failed count, and per-operation results with element IDs",
    description="""Apply batch modifications to a PDF document. Supports adding, updating, and deleting
elements (text, images, shapes, annotations) on specific pages.

Operations are applied in order. If one operation fails, subsequent operations are still attempted
(partial success is possible). Check `results` for per-operation status.

**Supported Actions:**
- `add` — Add a new element to a page. Requires `element` with `content`, `bounds`, and optionally `style`.
- `update` — Modify an existing element. Requires `element_id`, `element` (new data), and `old_bounds`.
- `delete` — Remove an element from a page. Requires `element_id`.

**Supported Element Types:**
- `text` — Text boxes with font, size, color, and formatting options
- `image` — Images (base64 data or URL) with positioning and sizing
- `shape` — Geometric shapes (rectangles, ellipses, lines) with stroke and fill
- `annotation` — PDF annotations (highlights, notes, stamps)

**Use Cases:**
- Add watermarks or stamps to multiple pages
- Batch update text content (e.g., update headers/footers)
- Programmatically build PDF documents from templates
- Remove sensitive annotations before sharing
- Add images (logos, signatures) to specific positions

**Limits:**
- Maximum 100 operations per request
- Maximum file size depends on your plan""",
    responses={
        200: {
            "description": "Modifications applied (fully or partially). Check `results` for per-operation details.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "doc_123abc",
                            "total_operations": 4,
                            "successful": 3,
                            "failed": 1,
                            "results": [
                                {
                                    "index": 0,
                                    "action": "add",
                                    "element_type": "text",
                                    "page_number": 1,
                                    "status": "success",
                                    "element_id": "txt-new-001",
                                },
                                {
                                    "index": 1,
                                    "action": "add",
                                    "element_type": "image",
                                    "page_number": 1,
                                    "status": "success",
                                    "element_id": "img-new-002",
                                },
                                {
                                    "index": 2,
                                    "action": "update",
                                    "element_type": "text",
                                    "page_number": 2,
                                    "status": "success",
                                    "element_id": "txt-001-abc123",
                                },
                                {
                                    "index": 3,
                                    "action": "delete",
                                    "element_type": "annotation",
                                    "page_number": 3,
                                    "status": "error",
                                    "error": "Element not found: ann-002-def456",
                                },
                            ],
                        },
                    }
                }
            },
        },
        400: {"description": "Invalid request (e.g., missing required fields, invalid action/type)"},
        404: {"description": "Document not found"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/modify" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "operations": [
      {
        "action": "add",
        "element_type": "text",
        "page_number": 1,
        "element": {
          "content": "Hello World",
          "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
          "style": {"font_family": "Helvetica", "font_size": 14, "color": "#000000"}
        }
      },
      {
        "action": "add",
        "element_type": "image",
        "page_number": 1,
        "element": {
          "content": "https://example.com/logo.png",
          "bounds": {"x": 400, "y": 50, "width": 100, "height": 100}
        }
      },
      {
        "action": "delete",
        "element_type": "annotation",
        "page_number": 2,
        "element_id": "ann-001"
      }
    ]
  }'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "doc_abc123"
api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/modify"

modify_data = {
    "operations": [
        {
            "action": "add",
            "element_type": "text",
            "page_number": 1,
            "element": {
                "content": "Confidential",
                "bounds": {"x": 200, "y": 400, "width": 200, "height": 30},
                "style": {
                    "font_family": "Helvetica-Bold",
                    "font_size": 18,
                    "color": "#FF0000",
                    "opacity": 0.5
                },
                "rotation": -45
            }
        },
        {
            "action": "update",
            "element_type": "text",
            "page_number": 1,
            "element_id": "txt-001",
            "element": {
                "content": "Updated Title",
                "bounds": {"x": 100, "y": 50, "width": 400, "height": 40},
                "style": {"font_size": 24}
            },
            "old_bounds": {"x": 100, "y": 50, "width": 300, "height": 35}
        }
    ]
}

response = requests.post(
    api_url,
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=modify_data
)

result = response.json()
if result["success"]:
    data = result["data"]
    print(f"Applied {data['successful']}/{data['total_operations']} operations")
    for op_result in data["results"]:
        status = "✓" if op_result["status"] == "success" else "✗"
        print(f"  {status} [{op_result['action']}] {op_result['element_type']} on page {op_result['page_number']}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';

const modifyData = {
  operations: [
    {
      action: 'add',
      element_type: 'text',
      page_number: 1,
      element: {
        content: 'Confidential',
        bounds: { x: 200, y: 400, width: 200, height: 30 },
        style: {
          font_family: 'Helvetica-Bold',
          font_size: 18,
          color: '#FF0000',
          opacity: 0.5
        },
        rotation: -45
      }
    },
    {
      action: 'delete',
      element_type: 'annotation',
      page_number: 3,
      element_id: 'ann-002'
    }
  ]
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/modify`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(modifyData)
  }
);

const result = await response.json();
if (result.success) {
  const { successful, total_operations, results } = result.data;
  console.log(`Applied ${successful}/${total_operations} operations`);
  results.forEach(r => {
    const icon = r.status === 'success' ? '✓' : '✗';
    console.log(`  ${icon} [${r.action}] ${r.element_type} on page ${r.page_number}`);
  });
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/modify";

$modifyData = [
    'operations' => [
        [
            'action' => 'add',
            'element_type' => 'text',
            'page_number' => 1,
            'element' => [
                'content' => 'Confidential',
                'bounds' => ['x' => 200, 'y' => 400, 'width' => 200, 'height' => 30],
                'style' => [
                    'font_family' => 'Helvetica-Bold',
                    'font_size' => 18,
                    'color' => '#FF0000',
                    'opacity' => 0.5
                ],
                'rotation' => -45
            ]
        ],
        [
            'action' => 'delete',
            'element_type' => 'annotation',
            'page_number' => 3,
            'element_id' => 'ann-002'
        ]
    ]
];

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_API_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode($modifyData)
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    $data = $result['data'];
    echo "Applied {$data['successful']}/{$data['total_operations']} operations\\n";
    foreach ($data['results'] as $opResult) {
        $icon = $opResult['status'] === 'success' ? '✓' : '✗';
        echo "  {$icon} [{$opResult['action']}] {$opResult['element_type']} on page {$opResult['page_number']}\\n";
    }
}
?>""",
            },
        ],
    },
)
async def modify_document(
    document_id: str,
    request: ModifyRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Apply batch modifications to a PDF document."""
    start_time = time.time()

    results = []
    successful = 0
    failed = 0

    for idx, op in enumerate(request.operations):
        # Validate operation-specific requirements
        op_result: dict = {
            "index": idx,
            "action": op.action,
            "element_type": op.element_type,
            "page_number": op.page_number,
        }

        try:
            if op.action == "add":
                if op.element is None:
                    raise ValueError("'element' is required for 'add' action")
                # TODO: Dispatch to element service to create element on page
                op_result["status"] = "success"
                op_result["element_id"] = f"{op.element_type[:3]}-new-{idx:03d}"
                successful += 1

            elif op.action == "update":
                if op.element_id is None:
                    raise ValueError("'element_id' is required for 'update' action")
                if op.element is None:
                    raise ValueError("'element' is required for 'update' action")
                if op.old_bounds is None:
                    raise ValueError("'old_bounds' is required for 'update' action")
                # TODO: Dispatch to element service to update element
                op_result["status"] = "success"
                op_result["element_id"] = op.element_id
                successful += 1

            elif op.action == "delete":
                if op.element_id is None:
                    raise ValueError("'element_id' is required for 'delete' action")
                # TODO: Dispatch to element service to delete element
                op_result["status"] = "success"
                op_result["element_id"] = op.element_id
                successful += 1

            else:
                raise ValueError(f"Unknown action: {op.action}")

        except (ValueError, Exception) as e:
            op_result["status"] = "error"
            op_result["error"] = str(e)
            failed += 1

        results.append(op_result)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "total_operations": len(request.operations),
            "successful": successful,
            "failed": failed,
            "results": results,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
