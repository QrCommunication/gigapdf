"""
History management endpoints (Undo/Redo).

Handles document editing history for reversible operations.
"""

from fastapi import APIRouter

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.history_service import history_service
from app.utils.helpers import now_utc

router = APIRouter()


@router.get(
    "",
    response_model=APIResponse[dict],
    summary="Get editing history",
    description="""
Retrieve the complete editing history for a document, including all actions performed and their undo/redo availability.

This endpoint returns a chronological list of all editing operations performed on the document, allowing users to:
- View all past actions with timestamps
- Check which actions can be undone or redone
- Navigate through the document's editing timeline

## Response Fields
- **current_index**: Current position in the history stack
- **history**: Array of history entries with action details
- **max_history_size**: Maximum number of history entries retained

## Use Cases
- Building an undo/redo UI with action descriptions
- Displaying editing timeline to users
- Debugging document state issues
""",
    responses={
        200: {
            "description": "History entries retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "current_index": 3,
                            "history": [
                                {
                                    "index": 0,
                                    "action": "add_page",
                                    "timestamp": "2024-01-15T10:30:00Z",
                                    "can_undo": True,
                                    "can_redo": False,
                                }
                            ],
                            "max_history_size": 50,
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/history" \\
  -H "Authorization: Bearer $TOKEN\"""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"

response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"}
)

if response.status_code == 200:
    data = response.json()["data"]
    print(f"Current index: {data['current_index']}")
    print(f"Can undo: {data['current_index'] > 0}")

    for entry in data["history"]:
        print(f"  [{entry['index']}] {entry['action']} - {entry['timestamp']}")
else:
    print(f"Error: {response.status_code}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = '550e8400-e29b-41d4-a716-446655440000';

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/history`,
  {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN'
    }
  }
);

const result = await response.json();

if (result.success) {
  const { current_index, history, max_history_size } = result.data;
  console.log(`Current position: ${current_index}/${history.length}`);
  console.log(`Max history size: ${max_history_size}`);

  history.forEach(entry => {
    console.log(`[${entry.index}] ${entry.action} - Can undo: ${entry.can_undo}`);
  });
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = '550e8400-e29b-41d4-a716-446655440000';

$client = new GuzzleHttp\\Client();
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history",
    [
        'headers' => [
            'Authorization' => 'Bearer YOUR_API_TOKEN'
        ]
    ]
);

$result = json_decode($response->getBody(), true);

if ($result['success']) {
    $data = $result['data'];
    echo "Current index: " . $data['current_index'] . "\\n";
    echo "Max history size: " . $data['max_history_size'] . "\\n";

    foreach ($data['history'] as $entry) {
        echo "[{$entry['index']}] {$entry['action']} - {$entry['timestamp']}\\n";
    }
}
?>""",
            },
        ]
    },
)
async def get_history(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get document editing history."""
    history = history_service.get_history(document_id)

    return APIResponse(
        success=True,
        data={
            "current_index": history.current_index,
            "history": [
                {
                    "index": e.index,
                    "action": e.action,
                    "timestamp": e.timestamp.isoformat(),
                    "can_undo": e.can_undo,
                    "can_redo": e.can_redo,
                }
                for e in history.history
            ],
            "max_history_size": history.max_history_size,
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/undo",
    response_model=APIResponse[dict],
    summary="Undo editing operations",
    description="""
Undo one or more recent editing operations on the document.

This endpoint allows you to revert recent changes to the document by stepping back through the editing history.
You can undo multiple operations at once by specifying the number of steps.

## Request Parameters
- **steps** (optional): Number of operations to undo (default: 1)

## Response Fields
- **undone_actions**: List of action names that were undone
- **current_index**: New position in the history stack after undo
- **document**: Updated document state after undoing operations

## Important Notes
- Cannot undo beyond the beginning of history
- Undone actions can be redone using the redo endpoint
- The document state is returned after applying the undo

## Use Cases
- Implementing undo functionality in document editors
- Reverting accidental changes
- Batch undoing multiple operations
""",
    responses={
        200: {
            "description": "Operations undone successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "undone_actions": ["add_text", "move_element"],
                            "current_index": 1,
                            "document": {"id": "doc_123", "pages": []},
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
        400: {"description": "Cannot undo - no more actions in history"},
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/history/undo" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"steps": 1}'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"

# Undo single operation
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history/undo",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    params={"steps": 1}
)

if response.status_code == 200:
    data = response.json()["data"]
    print(f"Undone actions: {data['undone_actions']}")
    print(f"New history position: {data['current_index']}")
else:
    print(f"Error: {response.json()}")

# Undo multiple operations at once
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history/undo",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    params={"steps": 5}
)""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = '550e8400-e29b-41d4-a716-446655440000';

// Undo last action
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/history/undo?steps=1`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();

if (result.success) {
  console.log('Undone actions:', result.data.undone_actions);
  console.log('New position:', result.data.current_index);

  // Update UI with new document state
  updateDocument(result.data.document);
}

// Undo multiple operations
async function undoMultiple(steps) {
  const res = await fetch(
    `https://api.giga-pdf.com/api/v1/documents/${documentId}/history/undo?steps=${steps}`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN',
        'Content-Type': 'application/json'
      }
    }
  );
  return res.json();
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = '550e8400-e29b-41d4-a716-446655440000';

$client = new GuzzleHttp\\Client();

// Undo single operation
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history/undo",
    [
        'headers' => [
            'Authorization' => 'Bearer YOUR_API_TOKEN',
            'Content-Type' => 'application/json'
        ],
        'query' => ['steps' => 1]
    ]
);

$result = json_decode($response->getBody(), true);

if ($result['success']) {
    echo "Undone actions: " . implode(', ', $result['data']['undone_actions']) . "\\n";
    echo "New position: " . $result['data']['current_index'] . "\\n";
}

// Undo multiple operations
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history/undo",
    [
        'headers' => [
            'Authorization' => 'Bearer YOUR_API_TOKEN',
            'Content-Type' => 'application/json'
        ],
        'query' => ['steps' => 5]
    ]
);
?>""",
            },
        ]
    },
)
async def undo(
    document_id: str,
    steps: int = 1,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Undo recent operations."""
    undone_actions, document = history_service.undo(
        document_id=document_id,
        steps=steps,
    )

    history = history_service.get_history(document_id)

    return APIResponse(
        success=True,
        data={
            "undone_actions": undone_actions,
            "current_index": history.current_index,
            "document": document.model_dump(by_alias=True),
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/redo",
    response_model=APIResponse[dict],
    summary="Redo undone operations",
    description="""
Redo one or more previously undone editing operations on the document.

This endpoint allows you to re-apply operations that were previously undone, stepping forward through the editing history.
You can redo multiple operations at once by specifying the number of steps.

## Request Parameters
- **steps** (optional): Number of operations to redo (default: 1)

## Response Fields
- **redone_actions**: List of action names that were redone
- **current_index**: New position in the history stack after redo
- **document**: Updated document state after redoing operations

## Important Notes
- Cannot redo beyond the end of the undo history
- Redo is only available after performing an undo
- New edits after an undo will clear the redo history
- The document state is returned after applying the redo

## Use Cases
- Implementing redo functionality in document editors
- Restoring accidentally undone changes
- Navigating through editing history
""",
    responses={
        200: {
            "description": "Operations redone successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "redone_actions": ["add_text"],
                            "current_index": 2,
                            "document": {"id": "doc_123", "pages": []},
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
        400: {"description": "Cannot redo - no more actions to redo"},
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/history/redo" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"steps": 1}'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"

# Redo single operation
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history/redo",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    params={"steps": 1}
)

if response.status_code == 200:
    data = response.json()["data"]
    print(f"Redone actions: {data['redone_actions']}")
    print(f"New history position: {data['current_index']}")
else:
    print(f"Error: {response.json()}")

# Redo multiple operations at once
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history/redo",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    params={"steps": 3}
)""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = '550e8400-e29b-41d4-a716-446655440000';

// Redo last undone action
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/history/redo?steps=1`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();

if (result.success) {
  console.log('Redone actions:', result.data.redone_actions);
  console.log('New position:', result.data.current_index);

  // Update UI with new document state
  updateDocument(result.data.document);
}

// Helper function to redo multiple steps
async function redoMultiple(steps) {
  const res = await fetch(
    `https://api.giga-pdf.com/api/v1/documents/${documentId}/history/redo?steps=${steps}`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN',
        'Content-Type': 'application/json'
      }
    }
  );
  return res.json();
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = '550e8400-e29b-41d4-a716-446655440000';

$client = new GuzzleHttp\\Client();

// Redo single operation
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history/redo",
    [
        'headers' => [
            'Authorization' => 'Bearer YOUR_API_TOKEN',
            'Content-Type' => 'application/json'
        ],
        'query' => ['steps' => 1]
    ]
);

$result = json_decode($response->getBody(), true);

if ($result['success']) {
    echo "Redone actions: " . implode(', ', $result['data']['redone_actions']) . "\\n";
    echo "New position: " . $result['data']['current_index'] . "\\n";
}

// Redo multiple operations
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history/redo",
    [
        'headers' => [
            'Authorization' => 'Bearer YOUR_API_TOKEN',
            'Content-Type' => 'application/json'
        ],
        'query' => ['steps' => 3]
    ]
);
?>""",
            },
        ]
    },
)
async def redo(
    document_id: str,
    steps: int = 1,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Redo undone operations."""
    redone_actions, document = history_service.redo(
        document_id=document_id,
        steps=steps,
    )

    history = history_service.get_history(document_id)

    return APIResponse(
        success=True,
        data={
            "redone_actions": redone_actions,
            "current_index": history.current_index,
            "document": document.model_dump(by_alias=True),
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.post(
    "/goto",
    response_model=APIResponse[dict],
    summary="Jump to specific history state",
    description="""
Jump directly to a specific point in the document's editing history.

This endpoint allows you to navigate to any point in the editing history by specifying the target index.
This is useful for implementing visual history navigation or restoring the document to a known state.

## Request Parameters
- **index** (required): Target position in the history stack (0-based)

## Response Fields
- **document**: Document state at the specified history position

## Important Notes
- Index must be within the valid history range (0 to history length - 1)
- This operation may involve multiple undo/redo operations internally
- Use the get history endpoint first to see available indices
- Going to index 0 restores the document to its initial state

## Use Cases
- Visual history timeline with clickable states
- Restoring document to a specific known good state
- Comparing document states at different points in time
- Quick navigation without multiple undo/redo calls
""",
    responses={
        200: {
            "description": "Successfully jumped to history state",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document": {
                                "id": "doc_123",
                                "pages": [],
                                "updated_at": "2024-01-15T10:30:00Z",
                            }
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
        400: {"description": "Invalid index - out of history range"},
        404: {"description": "Document not found"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/history/goto" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"index": 5}'""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"

# First, get the history to see available states
history_response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"}
)

history = history_response.json()["data"]["history"]
print(f"Available states: 0 to {len(history) - 1}")

# Jump to a specific state
target_index = 5
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/history/goto",
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    params={"index": target_index}
)

if response.status_code == 200:
    document = response.json()["data"]["document"]
    print(f"Document restored to state {target_index}")
else:
    print(f"Error: {response.json()}")""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = '550e8400-e29b-41d4-a716-446655440000';

// First, get available history states
const historyResponse = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/history`,
  {
    headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
  }
);
const historyData = await historyResponse.json();
console.log(`Available states: 0 to ${historyData.data.history.length - 1}`);

// Jump to specific history state
const targetIndex = 5;

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/history/goto?index=${targetIndex}`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();

if (result.success) {
  console.log(`Document restored to state ${targetIndex}`);
  updateDocument(result.data.document);
}

// Helper for history navigation UI
async function goToHistoryState(index) {
  const res = await fetch(
    `https://api.giga-pdf.com/api/v1/documents/${documentId}/history/goto?index=${index}`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN',
        'Content-Type': 'application/json'
      }
    }
  );
  return res.json();
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = '550e8400-e29b-41d4-a716-446655440000';

$client = new GuzzleHttp\\Client();

// First, get available history states
$historyResponse = $client->get(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history",
    [
        'headers' => ['Authorization' => 'Bearer YOUR_API_TOKEN']
    ]
);
$historyData = json_decode($historyResponse->getBody(), true);
$historyLength = count($historyData['data']['history']);
echo "Available states: 0 to " . ($historyLength - 1) . "\\n";

// Jump to specific history state
$targetIndex = 5;

$response = $client->post(
    "https://api.giga-pdf.com/api/v1/documents/{$documentId}/history/goto",
    [
        'headers' => [
            'Authorization' => 'Bearer YOUR_API_TOKEN',
            'Content-Type' => 'application/json'
        ],
        'query' => ['index' => $targetIndex]
    ]
);

$result = json_decode($response->getBody(), true);

if ($result['success']) {
    echo "Document restored to state {$targetIndex}\\n";
    $document = $result['data']['document'];
    // Process restored document...
}
?>""",
            },
        ]
    },
)
async def goto_state(
    document_id: str,
    index: int,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Go to a specific history state."""
    document = history_service.goto_state(
        document_id=document_id,
        index=index,
    )

    return APIResponse(
        success=True,
        data={"document": document.model_dump()},
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )
