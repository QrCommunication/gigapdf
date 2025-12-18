"""
Layer management endpoints.

Handles PDF Optional Content Groups (OCG) - layers that can be shown/hidden.
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


class CreateLayerRequest(BaseModel):
    """Request to create a new layer."""

    name: str = Field(description="Layer display name")
    visible: Optional[bool] = Field(default=True, description="Initial visibility state")
    locked: Optional[bool] = Field(default=False, description="Whether layer is locked for editing")
    opacity: Optional[float] = Field(default=1.0, ge=0, le=1, description="Layer opacity")
    print: Optional[bool] = Field(default=True, description="Include layer when printing")
    order: Optional[int] = Field(default=0, description="Z-order (higher = front)")

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Annotations",
                "visible": True,
                "locked": False,
                "opacity": 1.0,
                "print": True,
                "order": 1,
            }
        }


class UpdateLayerRequest(BaseModel):
    """Request to update a layer."""

    name: Optional[str] = Field(default=None, description="Layer display name")
    visible: Optional[bool] = Field(default=None, description="Visibility state")
    locked: Optional[bool] = Field(default=None, description="Lock state")
    opacity: Optional[float] = Field(default=None, ge=0, le=1, description="Layer opacity")
    print: Optional[bool] = Field(default=None, description="Print state")
    order: Optional[int] = Field(default=None, description="Z-order")

    class Config:
        json_schema_extra = {
            "example": {
                "visible": False,
                "locked": True,
            }
        }


class ReorderLayersRequest(BaseModel):
    """Request to reorder layers."""

    layer_order: list[str] = Field(
        description="List of layer IDs in desired order (front to back)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "layer_order": [
                    "layer-uuid-1",
                    "layer-uuid-2",
                    "layer-uuid-3",
                ]
            }
        }


@router.get(
    "/{document_id}/layers",
    response_model=APIResponse[dict],
    summary="List all layers",
    description="""
Get all layers (Optional Content Groups) in a PDF document.

## Response
Returns all layers with their properties.

```json
{
  "success": true,
  "data": {
    "layers": [
      {
        "layer_id": "uuid",
        "name": "Annotations",
        "visible": true,
        "locked": false,
        "opacity": 1.0,
        "print": true,
        "order": 1
      }
    ],
    "total_layers": 3
  }
}
```

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/layers" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/layers",
    headers={"Authorization": "Bearer <token>"}
)
layers = response.json()["data"]["layers"]
for layer in layers:
    print(f"{layer['name']}: visible={layer['visible']}, order={layer['order']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(`/api/v1/documents/${documentId}/layers`, {
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
result.data.layers.forEach(layer => {
  console.log(`${layer.name}: visible=${layer.visible}, order=${layer.order}`);
});
```

## Example (PHP)
```php
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/layers",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$result = json_decode($response->getBody(), true);
foreach ($result['data']['layers'] as $layer) {
    echo "{$layer['name']}: visible={$layer['visible']}, order={$layer['order']}\n";
}
```
""",
)
async def list_layers(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """List all layers in a document."""
    start_time = time.time()

    # TODO: Implement layer listing using document service
    # This is a placeholder implementation
    layers = []

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "layers": layers,
            "total_layers": len(layers),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/layers",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create layer",
    description="""
Create a new layer (Optional Content Group).

## Request Body
```json
{
  "name": "Annotations",
  "visible": true,
  "locked": false,
  "opacity": 1.0,
  "print": true,
  "order": 1
}
```

## Parameters
- **name**: Display name for the layer
- **visible**: Initial visibility state (default: true)
- **locked**: Whether layer is locked for editing (default: false)
- **opacity**: Layer opacity 0-1 (default: 1.0)
- **print**: Include layer when printing (default: true)
- **order**: Z-order, higher values appear in front (default: 0)

## Response
Returns the created layer.

```json
{
  "success": true,
  "data": {
    "layer_id": "uuid",
    "name": "Annotations",
    "visible": true,
    "locked": false,
    "opacity": 1.0,
    "print": true,
    "order": 1
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/layers" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Watermarks",
    "visible": true,
    "opacity": 0.5
  }'
```

## Example (Python)
```python
import requests

layer_data = {
    "name": "Watermarks",
    "visible": True,
    "locked": False,
    "opacity": 0.5,
    "print": False,
    "order": 10
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/layers",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=layer_data
)
layer = response.json()["data"]
print(f"Created layer: {layer['name']} (ID: {layer['layer_id']})")
```

## Example (JavaScript)
```javascript
const layerData = {
  name: 'Watermarks',
  visible: true,
  locked: false,
  opacity: 0.5,
  print: false,
  order: 10
};

const response = await fetch(`/api/v1/documents/${documentId}/layers`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(layerData)
});
const result = await response.json();
console.log(`Created layer: ${result.data.name}`);
```

## Example (PHP)
```php
$layerData = [
    'name' => 'Watermarks',
    'visible' => true,
    'locked' => false,
    'opacity' => 0.5,
    'print' => false,
    'order' => 10
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/layers",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $layerData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Created layer: " . $result['data']['name'];
```
""",
)
async def create_layer(
    document_id: str,
    request: CreateLayerRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Create a new layer."""
    start_time = time.time()

    # TODO: Implement layer creation using document service
    # This is a placeholder implementation
    layer_data = {
        "layer_id": "placeholder-uuid",
        "name": request.name,
        "visible": request.visible,
        "locked": request.locked,
        "opacity": request.opacity,
        "print": request.print,
        "order": request.order,
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=layer_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.patch(
    "/{document_id}/layers/{layer_id}",
    response_model=APIResponse[dict],
    summary="Update layer",
    description="""
Update a layer's properties.

## Request Body
Only include fields you want to change.

```json
{
  "visible": false,
  "locked": true,
  "opacity": 0.7
}
```

## Response
Returns the updated layer.

```json
{
  "success": true,
  "data": {
    "layer_id": "uuid",
    "name": "Annotations",
    "visible": false,
    "locked": true,
    "opacity": 0.7,
    "print": true,
    "order": 1
  }
}
```

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/documents/{document_id}/layers/{layer_id}" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "visible": false,
    "opacity": 0.5
  }'
```

## Example (Python)
```python
import requests

updates = {
    "visible": False,
    "opacity": 0.5
}

response = requests.patch(
    f"http://localhost:8000/api/v1/documents/{document_id}/layers/{layer_id}",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=updates
)
layer = response.json()["data"]
print(f"Updated layer: {layer['name']} - visible={layer['visible']}")
```

## Example (JavaScript)
```javascript
const updates = {
  visible: false,
  opacity: 0.5
};

const response = await fetch(
  `/api/v1/documents/${documentId}/layers/${layerId}`,
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
console.log(`Updated layer: ${result.data.name}`);
```

## Example (PHP)
```php
$updates = [
    'visible' => false,
    'opacity' => 0.5
];

$response = $client->patch(
    "http://localhost:8000/api/v1/documents/{$documentId}/layers/{$layerId}",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $updates
    ]
);
$result = json_decode($response->getBody(), true);
echo "Updated layer: " . $result['data']['name'];
```
""",
)
async def update_layer(
    document_id: str,
    layer_id: str,
    request: UpdateLayerRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Update a layer."""
    start_time = time.time()

    # TODO: Implement layer update using document service
    # This is a placeholder implementation
    updates = request.model_dump(exclude_none=True)

    layer_data = {
        "layer_id": layer_id,
        **updates,
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=layer_data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/{document_id}/layers/{layer_id}",
    status_code=204,
    summary="Delete layer",
    description="""
Delete a layer from the document.

All elements on this layer will be moved to the default layer.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/documents/{document_id}/layers/{layer_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.delete(
    f"http://localhost:8000/api/v1/documents/{document_id}/layers/{layer_id}",
    headers={"Authorization": "Bearer <token>"}
)
if response.status_code == 204:
    print("Layer deleted successfully")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `/api/v1/documents/${documentId}/layers/${layerId}`,
  {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
if (response.status === 204) {
  console.log('Layer deleted successfully');
}
```

## Example (PHP)
```php
$response = $client->delete(
    "http://localhost:8000/api/v1/documents/{$documentId}/layers/{$layerId}",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
if ($response->getStatusCode() === 204) {
    echo "Layer deleted successfully";
}
```
""",
)
async def delete_layer(
    document_id: str,
    layer_id: str,
    user: OptionalUser = None,
) -> None:
    """Delete a layer."""
    # TODO: Implement layer deletion using document service
    pass


@router.put(
    "/{document_id}/layers/reorder",
    response_model=APIResponse[dict],
    summary="Reorder layers",
    description="""
Change the order of layers (z-order).

## Request Body
```json
{
  "layer_order": [
    "layer-uuid-1",
    "layer-uuid-2",
    "layer-uuid-3"
  ]
}
```

Layers are ordered from front to back. The first layer in the array
will be rendered on top of all others.

## Response
Returns the updated layer list with new order.

```json
{
  "success": true,
  "data": {
    "layers": [
      {
        "layer_id": "layer-uuid-1",
        "name": "Top Layer",
        "order": 3
      },
      {
        "layer_id": "layer-uuid-2",
        "name": "Middle Layer",
        "order": 2
      },
      {
        "layer_id": "layer-uuid-3",
        "name": "Bottom Layer",
        "order": 1
      }
    ]
  }
}
```

## Example (curl)
```bash
curl -X PUT "http://localhost:8000/api/v1/documents/{document_id}/layers/reorder" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "layer_order": ["uuid1", "uuid2", "uuid3"]
  }'
```

## Example (Python)
```python
import requests

reorder_data = {
    "layer_order": [
        "layer-uuid-1",
        "layer-uuid-2",
        "layer-uuid-3"
    ]
}

response = requests.put(
    f"http://localhost:8000/api/v1/documents/{document_id}/layers/reorder",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=reorder_data
)
layers = response.json()["data"]["layers"]
for layer in layers:
    print(f"{layer['name']}: order={layer['order']}")
```

## Example (JavaScript)
```javascript
const reorderData = {
  layerOrder: [
    'layer-uuid-1',
    'layer-uuid-2',
    'layer-uuid-3'
  ]
};

const response = await fetch(
  `/api/v1/documents/${documentId}/layers/reorder`,
  {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(reorderData)
  }
);
const result = await response.json();
result.data.layers.forEach(layer => {
  console.log(`${layer.name}: order=${layer.order}`);
});
```

## Example (PHP)
```php
$reorderData = [
    'layer_order' => [
        'layer-uuid-1',
        'layer-uuid-2',
        'layer-uuid-3'
    ]
];

$response = $client->put(
    "http://localhost:8000/api/v1/documents/{$documentId}/layers/reorder",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $reorderData
    ]
);
$result = json_decode($response->getBody(), true);
foreach ($result['data']['layers'] as $layer) {
    echo "{$layer['name']}: order={$layer['order']}\n";
}
```
""",
)
async def reorder_layers(
    document_id: str,
    request: ReorderLayersRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Reorder layers."""
    start_time = time.time()

    # TODO: Implement layer reordering using document service
    # This is a placeholder implementation
    layers = []

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "layers": layers,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
