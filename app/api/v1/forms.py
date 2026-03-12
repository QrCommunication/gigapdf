"""
Form operations endpoints.

Handles form field listing, filling, creation, and flattening operations.
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


class FillFormRequest(BaseModel):
    """Request to fill form fields in bulk."""

    fields: dict[str, str | bool | list[str]] = Field(
        description="Field name to value mapping"
    )
    validate_fields: bool = Field(
        default=True, description="Validate field values before applying"
    )
    create_if_missing: bool = Field(
        default=False, description="Create fields if they don't exist"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "fields": {
                    "name": "John Doe",
                    "email": "john@example.com",
                    "subscribe": True,
                    "preferences": ["option1", "option2"],
                },
                "validate_fields": True,
                "create_if_missing": False,
            }
        }


class CreateFormFieldRequest(BaseModel):
    """Request to create a form field."""

    field_type: str = Field(description="Type of form field (text, checkbox, radio, dropdown, etc.)")
    field_name: str = Field(description="Technical field name")
    bounds: dict = Field(description="Field bounds {x, y, width, height}")
    value: Optional[str | bool | list[str]] = Field(default=None, description="Initial value")
    options: Optional[list[str]] = Field(default=None, description="Options for dropdown/listbox/radio")
    properties: Optional[dict] = Field(default=None, description="Field properties")
    style: Optional[dict] = Field(default=None, description="Field styling")

    class Config:
        json_schema_extra = {
            "example": {
                "field_type": "text",
                "field_name": "email_field",
                "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
                "value": "",
                "properties": {"required": True, "max_length": 100},
                "style": {"font_size": 12, "text_color": "#000000"},
            }
        }


@router.get(
    "/{document_id}/forms/fields",
    response_model=APIResponse[dict],
    summary="Get form fields",
    response_description="Complete list of form fields with name, type, current value, page number, position bounds, and properties. Includes total field count and filled field count",
    description="""Retrieve all interactive form fields from a PDF document.

This endpoint returns a comprehensive list of all form fields present in the document,
including text inputs, checkboxes, radio buttons, dropdowns, and signature fields.
Each field includes its current value, type, position, and properties.

Use this endpoint to:
- Inspect form structure before filling
- Get current field values
- Validate field requirements
- Map field names for bulk fill operations
""",
    responses={
        200: {
            "description": "Form fields retrieved successfully. Returns field list with metadata.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "fields": [
                                {
                                    "field_name": "name",
                                    "field_type": "text",
                                    "value": "John Doe",
                                    "page_number": 1,
                                    "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
                                    "properties": {
                                        "required": True,
                                        "read_only": False,
                                        "max_length": 100
                                    }
                                }
                            ],
                            "total_fields": 15,
                            "filled_fields": 8
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 45
                        }
                    }
                }
            }
        },
        404: {
            "description": "Document not found or document has no form fields"
        },
        401: {
            "description": "Unauthorized - Invalid or missing authentication token"
        }
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/forms/fields" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"

response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/forms/fields",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)

result = response.json()
if result["success"]:
    fields = result["data"]["fields"]
    print(f"Found {result['data']['total_fields']} fields")
    for field in fields:
        print(f"  {field['field_name']} ({field['field_type']}): {field['value']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/forms/fields`,
  {
    method: "GET",
    headers: {
      "Authorization": "Bearer YOUR_TOKEN"
    }
  }
);

const result = await response.json();
if (result.success) {
  console.log(`Found ${result.data.total_fields} fields`);
  result.data.fields.forEach(field => {
    console.log(`  ${field.field_name} (${field.field_type}): ${field.value}`);
  });
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/forms/fields",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_TOKEN"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    echo "Found " . $result["data"]["total_fields"] . " fields\\n";
    foreach ($result["data"]["fields"] as $field) {
        echo "  {$field['field_name']} ({$field['field_type']}): {$field['value']}\\n";
    }
}'''
            }
        ]
    }
)
async def list_form_fields(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    List all form fields in a document.

    Retrieves all interactive form fields from the specified PDF document,
    including their current values, types, positions, and properties.

    Args:
        document_id: The unique identifier of the PDF document
        user: Optional authenticated user

    Returns:
        APIResponse containing:
        - fields: List of form field objects with complete metadata
        - total_fields: Total count of form fields in the document
        - filled_fields: Count of fields that have values
    """
    start_time = time.time()

    # TODO: Implement form field listing using document service
    # This is a placeholder implementation
    fields = []

    processing_time = int((time.time() - start_time) * 1000)

    filled_count = sum(1 for f in fields if f.get("value"))

    return APIResponse(
        success=True,
        data={
            "fields": fields,
            "total_fields": len(fields),
            "filled_fields": filled_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.put(
    "/{document_id}/forms/fill",
    response_model=APIResponse[dict],
    summary="Fill form fields",
    response_description="Fill operation results with success/failure count per field, old and new values for each field processed",
    description="""Fill multiple form fields in a PDF document with provided values.

This endpoint allows bulk filling of form fields by providing a mapping of field names
to their desired values. It supports various field types including text inputs,
checkboxes, radio buttons, and multi-select dropdowns.

**Supported value types:**
- **String**: For text fields, dropdowns, and radio buttons
- **Boolean**: For checkbox fields (true = checked, false = unchecked)
- **Array of strings**: For multi-select listboxes

**Options:**
- `validate_fields`: When true, validates values against field constraints before applying
- `create_if_missing`: When true, creates fields that don't exist in the document
""",
    responses={
        200: {
            "description": "Form fields filled successfully. Returns fill results with status per field.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "filled_count": 4,
                            "failed_count": 0,
                            "results": [
                                {
                                    "field_name": "name",
                                    "success": True,
                                    "old_value": "",
                                    "new_value": "John Doe"
                                },
                                {
                                    "field_name": "email",
                                    "success": True,
                                    "old_value": "",
                                    "new_value": "john@example.com"
                                }
                            ]
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 120
                        }
                    }
                }
            }
        },
        400: {
            "description": "Invalid request - Field validation failed or invalid field values"
        },
        404: {
            "description": "Document not found or specified fields do not exist"
        },
        401: {
            "description": "Unauthorized - Invalid or missing authentication token"
        }
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/forms/fill" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fields": {
      "name": "John Doe",
      "email": "john@example.com",
      "subscribe": true,
      "preferences": ["newsletter", "updates"]
    },
    "validate_fields": true,
    "create_if_missing": false
  }'
'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"

fill_data = {
    "fields": {
        "name": "John Doe",
        "email": "john@example.com",
        "subscribe": True,
        "preferences": ["newsletter", "updates"]
    },
    "validate_fields": True,
    "create_if_missing": False
}

response = requests.put(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/forms/fill",
    headers={
        "Authorization": "Bearer YOUR_TOKEN",
        "Content-Type": "application/json"
    },
    json=fill_data
)

result = response.json()
if result["success"]:
    data = result["data"]
    print(f"Filled {data['filled_count']} fields, {data['failed_count']} failed")
    for field_result in data["results"]:
        status = "OK" if field_result["success"] else "FAILED"
        print(f"  [{status}] {field_result['field_name']}: {field_result['new_value']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";

const fillData = {
  fields: {
    name: "John Doe",
    email: "john@example.com",
    subscribe: true,
    preferences: ["newsletter", "updates"]
  },
  validate_fields: true,
  create_if_missing: false
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/forms/fill`,
  {
    method: "PUT",
    headers: {
      "Authorization": "Bearer YOUR_TOKEN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(fillData)
  }
);

const result = await response.json();
if (result.success) {
  const { filled_count, failed_count, results } = result.data;
  console.log(`Filled ${filled_count} fields, ${failed_count} failed`);
  results.forEach(r => {
    const status = r.success ? "OK" : "FAILED";
    console.log(`  [${status}] ${r.field_name}: ${r.new_value}`);
  });
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";

$fillData = [
    "fields" => [
        "name" => "John Doe",
        "email" => "john@example.com",
        "subscribe" => true,
        "preferences" => ["newsletter", "updates"]
    ],
    "validate_fields" => true,
    "create_if_missing" => false
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/forms/fill",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "PUT",
    CURLOPT_POSTFIELDS => json_encode($fillData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_TOKEN",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    $data = $result["data"];
    echo "Filled {$data['filled_count']} fields, {$data['failed_count']} failed\\n";
    foreach ($data["results"] as $fieldResult) {
        $status = $fieldResult["success"] ? "OK" : "FAILED";
        echo "  [{$status}] {$fieldResult['field_name']}: {$fieldResult['new_value']}\\n";
    }
}'''
            }
        ]
    }
)
async def fill_form_fields(
    document_id: str,
    request: FillFormRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Fill form fields in bulk.

    Populates multiple form fields in a PDF document with the provided values.
    Supports text fields, checkboxes, radio buttons, and multi-select fields.

    Args:
        document_id: The unique identifier of the PDF document
        request: FillFormRequest containing field mappings and options
        user: Optional authenticated user

    Returns:
        APIResponse containing:
        - filled_count: Number of fields successfully filled
        - failed_count: Number of fields that failed to fill
        - results: Detailed results for each field operation
    """
    start_time = time.time()

    # TODO: Implement form filling logic using document service
    # This is a placeholder implementation
    results = []
    filled_count = 0
    failed_count = 0

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "filled_count": filled_count,
            "failed_count": failed_count,
            "results": results,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/pages/{page_number}/forms/fields",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create form field",
    response_description="Created form field object with generated element_id, field type, name, position bounds, initial value, options (for dropdowns/listboxes), and applied style",
    description="""Create a new interactive form field on a specific page of a PDF document.

This endpoint allows you to programmatically add form fields to PDF documents.
You can create various field types and customize their appearance and behavior.

**Supported field types:**
- `text`: Single-line or multi-line text input
- `checkbox`: Boolean checkbox field
- `radio`: Radio button (requires options)
- `dropdown`: Dropdown/combo box selection (requires options)
- `listbox`: Multi-select list box (requires options)
- `signature`: Digital signature field
- `button`: Push button for actions

**Field properties:**
- `required`: Whether the field must be filled
- `read_only`: Whether the field is editable
- `max_length`: Maximum character length (text fields)
- `multi_line`: Enable multi-line text input
- `password`: Mask input characters

**Styling options:**
- `font_size`: Text size in points
- `font_name`: Font family name
- `text_color`: Hex color code for text
- `background_color`: Hex color code for background
- `border_color`: Hex color code for border
""",
    responses={
        201: {
            "description": "Form field created successfully. Returns the created field object.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "element_id": "field_abc123",
                            "type": "form_field",
                            "field_type": "text",
                            "field_name": "email_field",
                            "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
                            "value": "",
                            "options": None,
                            "properties": {"required": True, "max_length": 100},
                            "style": {"font_size": 12, "text_color": "#000000"}
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 85
                        }
                    }
                }
            }
        },
        400: {
            "description": "Invalid request - Invalid field type, missing required properties, or invalid bounds"
        },
        404: {
            "description": "Document not found or page number out of range"
        },
        401: {
            "description": "Unauthorized - Invalid or missing authentication token"
        },
        409: {
            "description": "Conflict - A field with the same name already exists"
        }
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/1/forms/fields" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "field_type": "text",
    "field_name": "email_field",
    "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
    "value": "",
    "properties": {"required": true, "max_length": 100},
    "style": {"font_size": 12, "text_color": "#000000"}
  }'
'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"
page_number = 1

field_data = {
    "field_type": "text",
    "field_name": "email_field",
    "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
    "value": "",
    "properties": {"required": True, "max_length": 100},
    "style": {"font_size": 12, "text_color": "#000000"}
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/pages/{page_number}/forms/fields",
    headers={
        "Authorization": "Bearer YOUR_TOKEN",
        "Content-Type": "application/json"
    },
    json=field_data
)

result = response.json()
if result["success"]:
    field = result["data"]
    print(f"Created field: {field['field_name']} (ID: {field['element_id']})")
    print(f"  Type: {field['field_type']}")
    print(f"  Position: ({field['bounds']['x']}, {field['bounds']['y']})")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";
const pageNumber = 1;

const fieldData = {
  field_type: "text",
  field_name: "email_field",
  bounds: { x: 100, y: 200, width: 200, height: 30 },
  value: "",
  properties: { required: true, max_length: 100 },
  style: { font_size: 12, text_color: "#000000" }
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/pages/${pageNumber}/forms/fields`,
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer YOUR_TOKEN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(fieldData)
  }
);

const result = await response.json();
if (result.success) {
  const field = result.data;
  console.log(`Created field: ${field.field_name} (ID: ${field.element_id})`);
  console.log(`  Type: ${field.field_type}`);
  console.log(`  Position: (${field.bounds.x}, ${field.bounds.y})`);
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";
$pageNumber = 1;

$fieldData = [
    "field_type" => "text",
    "field_name" => "email_field",
    "bounds" => ["x" => 100, "y" => 200, "width" => 200, "height" => 30],
    "value" => "",
    "properties" => ["required" => true, "max_length" => 100],
    "style" => ["font_size" => 12, "text_color" => "#000000"]
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/pages/{$pageNumber}/forms/fields",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($fieldData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_TOKEN",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    $field = $result["data"];
    echo "Created field: {$field['field_name']} (ID: {$field['element_id']})\\n";
    echo "  Type: {$field['field_type']}\\n";
    echo "  Position: ({$field['bounds']['x']}, {$field['bounds']['y']})\\n";
}'''
            }
        ]
    }
)
async def create_form_field(
    document_id: str,
    page_number: int,
    request: CreateFormFieldRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Create a new form field on a page.

    Adds an interactive form field to the specified page of the PDF document.
    Supports various field types including text inputs, checkboxes, radio buttons,
    dropdowns, and signature fields.

    Args:
        document_id: The unique identifier of the PDF document
        page_number: The 1-based page number where the field will be created
        request: CreateFormFieldRequest containing field configuration
        user: Optional authenticated user

    Returns:
        APIResponse containing the created field object with:
        - element_id: Unique identifier for the created field
        - field_type: Type of the form field
        - field_name: Technical name of the field
        - bounds: Position and dimensions of the field
        - value: Current/initial value
        - properties: Field behavior properties
        - style: Visual styling properties
    """
    start_time = time.time()

    # TODO: Implement form field creation using element service
    # This is a placeholder implementation
    field_data = {
        "element_id": "placeholder-uuid",
        "type": "form_field",
        "field_type": request.field_type,
        "field_name": request.field_name,
        "bounds": request.bounds,
        "value": request.value or "",
        "options": request.options,
        "properties": request.properties or {},
        "style": request.style or {},
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=field_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/forms/flatten",
    response_model=APIResponse[dict],
    summary="Flatten form fields",
    response_description="Number of fields flattened into static content, list of affected page numbers, and names of all flattened fields",
    description="""Flatten all form fields in a PDF document into static content.

This operation permanently converts interactive form fields into static PDF content,
preserving the current field values as rendered text/graphics while removing
the ability to edit them.

**Use cases:**
- Finalize filled forms before distribution
- Prevent further modifications to submitted forms
- Reduce file size by removing form metadata
- Ensure consistent appearance across PDF viewers

**Important notes:**
- This operation is irreversible - consider keeping a backup
- All current field values are preserved visually
- Form field metadata and interactivity are removed
- Signature fields become static images
""",
    responses={
        200: {
            "description": "Form fields flattened successfully. Returns flatten operation results.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "flattened_count": 15,
                            "pages_affected": [1, 2, 3],
                            "field_names": ["name", "email", "address", "phone", "signature"]
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 250
                        }
                    }
                }
            }
        },
        404: {
            "description": "Document not found or document has no form fields to flatten"
        },
        401: {
            "description": "Unauthorized - Invalid or missing authentication token"
        },
        409: {
            "description": "Conflict - Document is locked or already flattened"
        }
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/forms/flatten" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json"
'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/forms/flatten",
    headers={
        "Authorization": "Bearer YOUR_TOKEN",
        "Content-Type": "application/json"
    }
)

result = response.json()
if result["success"]:
    data = result["data"]
    print(f"Flattened {data['flattened_count']} fields")
    print(f"Pages affected: {data['pages_affected']}")
    print(f"Fields flattened: {', '.join(data['field_names'])}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/forms/flatten`,
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer YOUR_TOKEN",
      "Content-Type": "application/json"
    }
  }
);

const result = await response.json();
if (result.success) {
  const { flattened_count, pages_affected, field_names } = result.data;
  console.log(`Flattened ${flattened_count} fields`);
  console.log(`Pages affected: ${pages_affected.join(", ")}`);
  console.log(`Fields flattened: ${field_names.join(", ")}`);
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/forms/flatten",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer YOUR_TOKEN",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    $data = $result["data"];
    echo "Flattened {$data['flattened_count']} fields\\n";
    echo "Pages affected: " . implode(", ", $data["pages_affected"]) . "\\n";
    echo "Fields flattened: " . implode(", ", $data["field_names"]) . "\\n";
}'''
            }
        ]
    }
)
async def flatten_form_fields(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Flatten all form fields into static content.

    Converts all interactive form fields in the document to static PDF content,
    preserving their current visual appearance while removing editability.
    This operation is irreversible.

    Args:
        document_id: The unique identifier of the PDF document
        user: Optional authenticated user

    Returns:
        APIResponse containing:
        - flattened_count: Number of fields that were flattened
        - pages_affected: List of page numbers containing flattened fields
        - field_names: Names of all fields that were flattened
    """
    start_time = time.time()

    # TODO: Implement form flattening logic using document service
    # This is a placeholder implementation
    flattened_count = 0
    pages_affected = []
    field_names = []

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "flattened_count": flattened_count,
            "pages_affected": pages_affected,
            "field_names": field_names,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
