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
    validate: bool = Field(
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
                "validate": True,
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
    summary="List all form fields",
    description="""
Get all form fields in a PDF document.

## Response
Returns all form fields with their properties and current values.

```json
{
  "success": true,
  "data": {
    "fields": [
      {
        "field_name": "name",
        "field_type": "text",
        "value": "John Doe",
        "page_number": 1,
        "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
        "properties": {
          "required": true,
          "read_only": false,
          "max_length": 100
        }
      }
    ],
    "total_fields": 15,
    "filled_fields": 8
  }
}
```

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/forms/fields" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/forms/fields",
    headers={"Authorization": "Bearer <token>"}
)
fields = response.json()["data"]["fields"]
for field in fields:
    print(f"{field['field_name']}: {field['value']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(`/api/v1/documents/${documentId}/forms/fields`, {
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
result.data.fields.forEach(field => {
  console.log(`${field.field_name}: ${field.value}`);
});
```

## Example (PHP)
```php
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/forms/fields",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$result = json_decode($response->getBody(), true);
foreach ($result['data']['fields'] as $field) {
    echo "{$field['field_name']}: {$field['value']}\n";
}
```
""",
)
async def list_form_fields(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """List all form fields in a document."""
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
    summary="Fill form fields in bulk",
    description="""
Fill multiple form fields at once.

## Request Body
```json
{
  "fields": {
    "name": "John Doe",
    "email": "john@example.com",
    "subscribe": true,
    "preferences": ["option1", "option2"]
  },
  "validate": true,
  "create_if_missing": false
}
```

## Parameters
- **fields**: Dictionary mapping field names to values
- **validate**: Validate field values before applying (default: true)
- **create_if_missing**: Create fields if they don't exist (default: false)

## Response
Returns information about filled fields and any errors.

```json
{
  "success": true,
  "data": {
    "filled_count": 4,
    "failed_count": 0,
    "results": [
      {
        "field_name": "name",
        "success": true,
        "old_value": "",
        "new_value": "John Doe"
      }
    ]
  }
}
```

## Example (curl)
```bash
curl -X PUT "http://localhost:8000/api/v1/documents/{document_id}/forms/fill" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fields": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }'
```

## Example (Python)
```python
import requests

fill_data = {
    "fields": {
        "name": "John Doe",
        "email": "john@example.com",
        "subscribe": True
    },
    "validate": True
}

response = requests.put(
    f"http://localhost:8000/api/v1/documents/{document_id}/forms/fill",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=fill_data
)
result = response.json()["data"]
print(f"Filled {result['filled_count']} fields")
```

## Example (JavaScript)
```javascript
const fillData = {
  fields: {
    name: 'John Doe',
    email: 'john@example.com',
    subscribe: true
  },
  validate: true
};

const response = await fetch(`/api/v1/documents/${documentId}/forms/fill`, {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(fillData)
});
const result = await response.json();
console.log(`Filled ${result.data.filled_count} fields`);
```

## Example (PHP)
```php
$fillData = [
    'fields' => [
        'name' => 'John Doe',
        'email' => 'john@example.com',
        'subscribe' => true
    ],
    'validate' => true
];

$response = $client->put(
    "http://localhost:8000/api/v1/documents/{$documentId}/forms/fill",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $fillData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Filled " . $result['data']['filled_count'] . " fields";
```
""",
)
async def fill_form_fields(
    document_id: str,
    request: FillFormRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Fill form fields in bulk."""
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
    description="""
Create a new form field on a page.

## Request Body
```json
{
  "field_type": "text",
  "field_name": "email_field",
  "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
  "value": "",
  "properties": {"required": true, "max_length": 100},
  "style": {"font_size": 12, "text_color": "#000000"}
}
```

## Field Types
- **text**: Text input field
- **checkbox**: Checkbox field
- **radio**: Radio button field
- **dropdown**: Dropdown/combo box
- **listbox**: List box
- **signature**: Signature field
- **button**: Push button

## Response
Returns the created form field element.

```json
{
  "success": true,
  "data": {
    "element_id": "uuid",
    "field_type": "text",
    "field_name": "email_field",
    "value": "",
    "bounds": {...},
    "properties": {...}
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/pages/1/forms/fields" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "field_type": "text",
    "field_name": "email",
    "bounds": {"x": 100, "y": 200, "width": 200, "height": 30}
  }'
```

## Example (Python)
```python
import requests

field_data = {
    "field_type": "text",
    "field_name": "email",
    "bounds": {"x": 100, "y": 200, "width": 200, "height": 30},
    "properties": {"required": True, "max_length": 100}
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/pages/1/forms/fields",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=field_data
)
field = response.json()["data"]
print(f"Created field: {field['field_name']}")
```

## Example (JavaScript)
```javascript
const fieldData = {
  fieldType: 'text',
  fieldName: 'email',
  bounds: { x: 100, y: 200, width: 200, height: 30 },
  properties: { required: true, maxLength: 100 }
};

const response = await fetch(`/api/v1/documents/${documentId}/pages/1/forms/fields`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(fieldData)
});
const result = await response.json();
console.log(`Created field: ${result.data.field_name}`);
```

## Example (PHP)
```php
$fieldData = [
    'field_type' => 'text',
    'field_name' => 'email',
    'bounds' => ['x' => 100, 'y' => 200, 'width' => 200, 'height' => 30],
    'properties' => ['required' => true, 'max_length' => 100]
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/pages/1/forms/fields",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $fieldData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Created field: " . $result['data']['field_name'];
```
""",
)
async def create_form_field(
    document_id: str,
    page_number: int,
    request: CreateFormFieldRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a new form field on a page."""
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
    description="""
Flatten form fields into static content (makes them non-editable).

This operation converts form fields into regular PDF content,
preventing further editing but preserving the current values.

## Response
Returns information about flattened fields.

```json
{
  "success": true,
  "data": {
    "flattened_count": 15,
    "pages_affected": [1, 2, 3],
    "field_names": ["name", "email", "address"]
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/forms/flatten" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json"
```

## Example (Python)
```python
import requests

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/forms/flatten",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"}
)
result = response.json()["data"]
print(f"Flattened {result['flattened_count']} fields on {len(result['pages_affected'])} pages")
```

## Example (JavaScript)
```javascript
const response = await fetch(`/api/v1/documents/${documentId}/forms/flatten`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  }
});
const result = await response.json();
console.log(`Flattened ${result.data.flattened_count} fields`);
```

## Example (PHP)
```php
$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/forms/flatten",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json']
    ]
);
$result = json_decode($response->getBody(), true);
echo "Flattened " . $result['data']['flattened_count'] . " fields";
```
""",
)
async def flatten_form_fields(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Flatten all form fields into static content."""
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
