"""
Layer management endpoints.

Handles PDF Optional Content Groups (OCG) - layers that can be shown/hidden.
"""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.schemas.responses.common import APIResponse

router = APIRouter()


class CreateLayerRequest(BaseModel):
    """Request to create a new layer."""

    name: str = Field(description="Layer display name")
    visible: bool | None = Field(default=True, description="Initial visibility state")
    locked: bool | None = Field(default=False, description="Whether layer is locked for editing")
    opacity: float | None = Field(default=1.0, ge=0, le=1, description="Layer opacity")
    print: bool | None = Field(default=True, description="Include layer when printing")
    order: int | None = Field(default=0, description="Z-order (higher = front)")

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

    name: str | None = Field(default=None, description="Layer display name")
    visible: bool | None = Field(default=None, description="Visibility state")
    locked: bool | None = Field(default=None, description="Lock state")
    opacity: float | None = Field(default=None, ge=0, le=1, description="Layer opacity")
    print: bool | None = Field(default=None, description="Print state")
    order: int | None = Field(default=None, description="Z-order")

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
    description="Retrieve all layers (Optional Content Groups) in a PDF document. Layers control the visibility of different content groups within a PDF, allowing you to show or hide specific elements. Each layer includes properties such as visibility state, lock status, opacity, and z-order.",
    responses={
        200: {
            "description": "Layers retrieved successfully. Returns a list of all layers with their properties including layer_id, name, visible, locked, opacity, print, and order."
        },
        401: {
            "description": "Unauthorized. Invalid or missing authentication token."
        },
        404: {
            "description": "Document not found. The specified document_id does not exist."
        },
        500: {
            "description": "Internal server error. An unexpected error occurred while retrieving layers."
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/layers" \\
  -H "Authorization: Bearer $TOKEN"''',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"
token = "your-api-token"

response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/layers",
    headers={"Authorization": f"Bearer {token}"}
)

result = response.json()
if result["success"]:
    layers = result["data"]["layers"]
    for layer in layers:
        print(f"{layer['name']}: visible={layer['visible']}, order={layer['order']}")
    print(f"Total layers: {result['data']['total_layers']}")''',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";
const token = "your-api-token";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/layers`,
  {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  }
);

const result = await response.json();
if (result.success) {
  result.data.layers.forEach(layer => {
    console.log(`${layer.name}: visible=${layer.visible}, order=${layer.order}`);
  });
  console.log(`Total layers: ${result.data.total_layers}`);
}''',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";
$token = "your-api-token";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/layers",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    foreach ($result["data"]["layers"] as $layer) {
        echo "{$layer['name']}: visible={$layer['visible']}, order={$layer['order']}\\n";
    }
    echo "Total layers: {$result['data']['total_layers']}\\n";
}''',
            },
        ]
    },
)
async def list_layers(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    List all layers in a document.

    Retrieves all Optional Content Groups (OCGs) from the specified PDF document.
    Each layer contains metadata about its visibility, lock state, opacity, and
    rendering order.

    Args:
        document_id: The unique identifier of the PDF document.
        user: Optional authenticated user context.

    Returns:
        APIResponse containing a list of layers and total count.
    """
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.post(
    "/{document_id}/layers",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create layer",
    description="Create a new layer (Optional Content Group) in the PDF document. Layers allow you to organize content into groups that can be independently shown or hidden. You can specify the layer name, initial visibility, lock state, opacity, print behavior, and z-order position.",
    responses={
        201: {
            "description": "Layer created successfully. Returns the created layer with its assigned layer_id and all properties."
        },
        400: {
            "description": "Bad request. Invalid layer properties provided (e.g., opacity out of range, missing required fields)."
        },
        401: {
            "description": "Unauthorized. Invalid or missing authentication token."
        },
        404: {
            "description": "Document not found. The specified document_id does not exist."
        },
        409: {
            "description": "Conflict. A layer with the same name already exists in the document."
        },
        500: {
            "description": "Internal server error. An unexpected error occurred while creating the layer."
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/layers" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Watermarks",
    "visible": true,
    "locked": false,
    "opacity": 0.5,
    "print": false,
    "order": 10
  }' ''',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"
token = "your-api-token"

layer_data = {
    "name": "Watermarks",
    "visible": True,
    "locked": False,
    "opacity": 0.5,
    "print": False,
    "order": 10
}

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/layers",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=layer_data
)

result = response.json()
if result["success"]:
    layer = result["data"]
    print(f"Created layer: {layer['name']} (ID: {layer['layer_id']})")''',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";
const token = "your-api-token";

const layerData = {
  name: "Watermarks",
  visible: true,
  locked: false,
  opacity: 0.5,
  print: false,
  order: 10
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/layers`,
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(layerData)
  }
);

const result = await response.json();
if (result.success) {
  console.log(`Created layer: ${result.data.name} (ID: ${result.data.layer_id})`);
}''',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";
$token = "your-api-token";

$layerData = [
    "name" => "Watermarks",
    "visible" => true,
    "locked" => false,
    "opacity" => 0.5,
    "print" => false,
    "order" => 10
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/layers",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($layerData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    $layer = $result["data"];
    echo "Created layer: {$layer['name']} (ID: {$layer['layer_id']})\\n";
}''',
            },
        ]
    },
)
async def create_layer(
    document_id: str,
    request: CreateLayerRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Create a new layer in the document.

    Creates a new Optional Content Group (OCG) with the specified properties.
    The layer can be used to group related content that can be shown or hidden
    together.

    Args:
        document_id: The unique identifier of the PDF document.
        request: Layer creation request containing name and optional properties.
        user: Optional authenticated user context.

    Returns:
        APIResponse containing the created layer data with its assigned ID.
    """
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.patch(
    "/{document_id}/layers/{layer_id}",
    response_model=APIResponse[dict],
    summary="Update layer",
    description="Update the properties of an existing layer. You can modify any combination of properties including name, visibility, lock state, opacity, print behavior, and z-order. Only the fields you include in the request will be updated; other properties remain unchanged.",
    responses={
        200: {
            "description": "Layer updated successfully. Returns the updated layer with all current properties."
        },
        400: {
            "description": "Bad request. Invalid layer properties provided (e.g., opacity out of range)."
        },
        401: {
            "description": "Unauthorized. Invalid or missing authentication token."
        },
        403: {
            "description": "Forbidden. The layer is locked and cannot be modified."
        },
        404: {
            "description": "Not found. The specified document_id or layer_id does not exist."
        },
        500: {
            "description": "Internal server error. An unexpected error occurred while updating the layer."
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PATCH "https://api.giga-pdf.com/api/v1/documents/{document_id}/layers/{layer_id}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "visible": false,
    "opacity": 0.5
  }' ''',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"
layer_id = "your-layer-id"
token = "your-api-token"

updates = {
    "visible": False,
    "opacity": 0.5
}

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/layers/{layer_id}",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=updates
)

result = response.json()
if result["success"]:
    layer = result["data"]
    print(f"Updated layer: {layer['name']} - visible={layer['visible']}")''',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";
const layerId = "your-layer-id";
const token = "your-api-token";

const updates = {
  visible: false,
  opacity: 0.5
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/layers/${layerId}`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updates)
  }
);

const result = await response.json();
if (result.success) {
  console.log(`Updated layer: ${result.data.name} - visible=${result.data.visible}`);
}''',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";
$layerId = "your-layer-id";
$token = "your-api-token";

$updates = [
    "visible" => false,
    "opacity" => 0.5
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/layers/{$layerId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "PATCH",
    CURLOPT_POSTFIELDS => json_encode($updates),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    $layer = $result["data"];
    echo "Updated layer: {$layer['name']} - visible={$layer['visible']}\\n";
}''',
            },
        ]
    },
)
async def update_layer(
    document_id: str,
    layer_id: str,
    request: UpdateLayerRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Update a layer's properties.

    Performs a partial update on the specified layer. Only the properties
    included in the request will be modified; all other properties remain
    unchanged.

    Args:
        document_id: The unique identifier of the PDF document.
        layer_id: The unique identifier of the layer to update.
        request: Layer update request containing properties to modify.
        user: Optional authenticated user context.

    Returns:
        APIResponse containing the updated layer data.
    """
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.delete(
    "/{document_id}/layers/{layer_id}",
    status_code=204,
    summary="Delete layer",
    description="Delete a layer from the document. All elements on the deleted layer will be moved to the default layer to preserve document content. This operation cannot be undone.",
    responses={
        204: {
            "description": "Layer deleted successfully. No content returned."
        },
        401: {
            "description": "Unauthorized. Invalid or missing authentication token."
        },
        403: {
            "description": "Forbidden. The layer is locked or is the default layer and cannot be deleted."
        },
        404: {
            "description": "Not found. The specified document_id or layer_id does not exist."
        },
        500: {
            "description": "Internal server error. An unexpected error occurred while deleting the layer."
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X DELETE "https://api.giga-pdf.com/api/v1/documents/{document_id}/layers/{layer_id}" \\
  -H "Authorization: Bearer $TOKEN"''',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"
layer_id = "your-layer-id"
token = "your-api-token"

response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/layers/{layer_id}",
    headers={"Authorization": f"Bearer {token}"}
)

if response.status_code == 204:
    print("Layer deleted successfully")
else:
    print(f"Error: {response.status_code}")''',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";
const layerId = "your-layer-id";
const token = "your-api-token";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/layers/${layerId}`,
  {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  }
);

if (response.status === 204) {
  console.log("Layer deleted successfully");
} else {
  console.log(`Error: ${response.status}`);
}''',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";
$layerId = "your-layer-id";
$token = "your-api-token";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/layers/{$layerId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "DELETE",
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 204) {
    echo "Layer deleted successfully\\n";
} else {
    echo "Error: {$httpCode}\\n";
}''',
            },
        ]
    },
)
async def delete_layer(
    document_id: str,
    layer_id: str,
    user: OptionalUser = None,
) -> None:
    """
    Delete a layer from the document.

    Removes the specified layer from the document. Content from the deleted
    layer is automatically moved to the default layer to prevent data loss.

    Args:
        document_id: The unique identifier of the PDF document.
        layer_id: The unique identifier of the layer to delete.
        user: Optional authenticated user context.

    Returns:
        None. Returns 204 No Content on success.
    """
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.put(
    "/{document_id}/layers/reorder",
    response_model=APIResponse[dict],
    summary="Reorder layers",
    description="Change the z-order of layers in the document. Layers are ordered from front to back, where the first layer in the array will be rendered on top of all others. All layer IDs must be included in the request.",
    responses={
        200: {
            "description": "Layers reordered successfully. Returns the updated list of layers with their new order values."
        },
        400: {
            "description": "Bad request. Invalid layer order provided (e.g., missing layer IDs, duplicate IDs, or unknown layer IDs)."
        },
        401: {
            "description": "Unauthorized. Invalid or missing authentication token."
        },
        404: {
            "description": "Document not found. The specified document_id does not exist."
        },
        500: {
            "description": "Internal server error. An unexpected error occurred while reordering layers."
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PUT "https://api.giga-pdf.com/api/v1/documents/{document_id}/layers/reorder" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "layer_order": [
      "layer-uuid-1",
      "layer-uuid-2",
      "layer-uuid-3"
    ]
  }' ''',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

document_id = "your-document-id"
token = "your-api-token"

reorder_data = {
    "layer_order": [
        "layer-uuid-1",
        "layer-uuid-2",
        "layer-uuid-3"
    ]
}

response = requests.put(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/layers/reorder",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json=reorder_data
)

result = response.json()
if result["success"]:
    for layer in result["data"]["layers"]:
        print(f"{layer['name']}: order={layer['order']}")''',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const documentId = "your-document-id";
const token = "your-api-token";

const reorderData = {
  layer_order: [
    "layer-uuid-1",
    "layer-uuid-2",
    "layer-uuid-3"
  ]
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/layers/reorder`,
  {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(reorderData)
  }
);

const result = await response.json();
if (result.success) {
  result.data.layers.forEach(layer => {
    console.log(`${layer.name}: order=${layer.order}`);
  });
}''',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$documentId = "your-document-id";
$token = "your-api-token";

$reorderData = [
    "layer_order" => [
        "layer-uuid-1",
        "layer-uuid-2",
        "layer-uuid-3"
    ]
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/layers/reorder",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "PUT",
    CURLOPT_POSTFIELDS => json_encode($reorderData),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    foreach ($result["data"]["layers"] as $layer) {
        echo "{$layer['name']}: order={$layer['order']}\\n";
    }
}''',
            },
        ]
    },
)
async def reorder_layers(
    document_id: str,
    request: ReorderLayersRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Reorder layers in the document.

    Changes the z-order (stacking order) of all layers. The first layer in
    the provided order array will be rendered on top of all others.

    Args:
        document_id: The unique identifier of the PDF document.
        request: Reorder request containing the new layer order.
        user: Optional authenticated user context.

    Returns:
        APIResponse containing the updated list of layers with new order values.
    """
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )
