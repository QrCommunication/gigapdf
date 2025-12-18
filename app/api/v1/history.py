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
Get the editing history for the document.

## Response
Returns the list of actions performed on the document
with undo/redo availability.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/history" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/history",
    headers={"Authorization": "Bearer <token>"}
)
history = response.json()["data"]
print(f"Can undo: {history['current_index'] > 0}")
```
""",
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
    summary="Undo operations",
    description="""
Undo recent editing operations.

## Request Body
```json
{
  "steps": 1
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/history/undo" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"steps": 1}'
```

## Example (JavaScript)
```javascript
// Undo last action
const response = await fetch(`/api/v1/documents/${documentId}/history/undo`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ steps: 1 })
});
const result = await response.json();
console.log('Undone actions:', result.data.undone_actions);
```
""",
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
    summary="Redo operations",
    description="""
Redo previously undone operations.

## Request Body
```json
{
  "steps": 1
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/history/redo" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"steps": 1}'
```
""",
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
    summary="Go to specific history state",
    description="""
Jump to a specific point in the editing history.

## Request Body
```json
{
  "index": 5
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/history/goto" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"index": 5}'
```
""",
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
