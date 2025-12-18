"""
Activity log endpoints.

Provides endpoints to view document activity history.
Only users with access to the document can view its history.
"""

import time
from typing import Optional

from fastapi import APIRouter, Query

from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services.activity_service import activity_service
from app.utils.helpers import now_utc

router = APIRouter()


@router.get(
    "/documents/{document_id}/history",
    response_model=APIResponse[dict],
    summary="Get document activity history",
    description="""
Get the activity history for a specific document.

Returns a chronological list of all actions performed on the document.
Only the document owner or users with shared access can view this history.

## Path Parameters
- **document_id**: Document identifier (UUID v4)

## Query Parameters
- **limit**: Maximum number of activities to return (default: 50, max: 100)
- **offset**: Number of activities to skip for pagination (default: 0)
- **action**: Filter by action type (create, view, download, edit, rename, delete, share, export)

## Response
Returns a list of activity entries with user info, action type, and metadata.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/activity/documents/{document_id}/history" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir l'historique d'un document
response = requests.get(
    f"http://localhost:8000/api/v1/activity/documents/{document_id}/history",
    headers={"Authorization": "Bearer <token>"},
    params={"limit": 20}
)
history = response.json()["data"]["activities"]
for activity in history:
    print(f"{activity['created_at']}: {activity['user_name']} - {activity['action']}")
```

## Example (JavaScript)
```javascript
// Obtenir l'historique du document
const response = await fetch(
  `/api/v1/activity/documents/${documentId}/history?limit=20`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
const result = await response.json();
const activities = result.data.activities;

activities.forEach(activity => {
  console.log(`${activity.created_at}: ${activity.user_name} - ${activity.action}`);
});
```

## Example (PHP)
```php
// Obtenir l'historique d'un document
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/activity/documents/{$documentId}/history",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => ['limit' => 20]
    ]
);
$history = json_decode($response->getBody(), true)['data']['activities'];
foreach ($history as $activity) {
    echo "{$activity['created_at']}: {$activity['user_name']} - {$activity['action']}\\n";
}
```
""",
    responses={
        200: {
            "description": "Activity history retrieved",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "activities": [
                                {
                                    "id": "550e8400-e29b-41d4-a716-446655440000",
                                    "action": "edit",
                                    "user_id": "user_123",
                                    "user_email": "user@example.com",
                                    "user_name": "John Doe",
                                    "resource_type": "document",
                                    "metadata": {"changes": ["Added page 3"]},
                                    "created_at": "2024-01-15T10:30:00Z",
                                }
                            ],
                            "pagination": {
                                "page": 1,
                                "page_size": 50,
                                "total_items": 1,
                                "total_pages": 1,
                            },
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
        404: {"description": "Document not found or no access"},
    },
)
async def get_document_history(
    document_id: str,
    user: AuthenticatedUser,
    limit: int = Query(default=50, ge=1, le=100, description="Max results"),
    offset: int = Query(default=0, ge=0, description="Skip N results"),
    action: Optional[str] = Query(
        default=None, description="Filter by action type"
    ),
) -> APIResponse[dict]:
    """Get activity history for a document."""
    start_time = time.time()

    activities, total = await activity_service.get_document_history(
        document_id=document_id,
        user_id=user.user_id,
        limit=limit,
        offset=offset,
        action_filter=action,
    )

    # Calculate pagination
    page = (offset // limit) + 1 if limit > 0 else 1
    total_pages = (total + limit - 1) // limit if limit > 0 else 1

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "activities": activities,
            "document_id": document_id,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=page,
                page_size=limit,
                total_items=total,
                total_pages=total_pages,
            ),
        ),
    )


@router.get(
    "/me",
    response_model=APIResponse[dict],
    summary="Get my activity history",
    description="""
Get the current user's activity history.

Returns a chronological list of all actions performed by the authenticated user.

## Query Parameters
- **limit**: Maximum number of activities to return (default: 50, max: 100)
- **offset**: Number of activities to skip for pagination (default: 0)
- **action**: Filter by action type
- **resource_type**: Filter by resource type (document, folder)

## Response
Returns a list of activity entries performed by the user.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/activity/me" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir mon historique d'activit\u00e9
response = requests.get(
    "http://localhost:8000/api/v1/activity/me",
    headers={"Authorization": "Bearer <token>"},
    params={"limit": 20, "action": "edit"}
)
my_activities = response.json()["data"]["activities"]
```

## Example (JavaScript)
```javascript
// Obtenir mon historique d'activit\u00e9
const response = await fetch('/api/v1/activity/me?limit=20', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const myActivities = result.data.activities;
```

## Example (PHP)
```php
// Obtenir mon historique d'activit\u00e9
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/activity/me",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => ['limit' => 20]
    ]
);
$myActivities = json_decode($response->getBody(), true)['data']['activities'];
```
""",
    responses={
        200: {
            "description": "User activity history retrieved",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "activities": [
                                {
                                    "id": "550e8400-e29b-41d4-a716-446655440000",
                                    "action": "create",
                                    "document_id": "doc_123",
                                    "resource_type": "document",
                                    "metadata": {"name": "Report.pdf"},
                                    "created_at": "2024-01-15T10:30:00Z",
                                }
                            ],
                            "pagination": {
                                "page": 1,
                                "page_size": 50,
                                "total_items": 1,
                                "total_pages": 1,
                            },
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
    },
)
async def get_my_activity(
    user: AuthenticatedUser,
    limit: int = Query(default=50, ge=1, le=100, description="Max results"),
    offset: int = Query(default=0, ge=0, description="Skip N results"),
    action: Optional[str] = Query(default=None, description="Filter by action"),
    resource_type: Optional[str] = Query(
        default=None, description="Filter by resource type"
    ),
) -> APIResponse[dict]:
    """Get current user's activity history."""
    start_time = time.time()

    activities, total = await activity_service.get_user_activity(
        user_id=user.user_id,
        limit=limit,
        offset=offset,
        action_filter=action,
        resource_type_filter=resource_type,
    )

    # Calculate pagination
    page = (offset // limit) + 1 if limit > 0 else 1
    total_pages = (total + limit - 1) // limit if limit > 0 else 1

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "activities": activities,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=page,
                page_size=limit,
                total_items=total,
                total_pages=total_pages,
            ),
        ),
    )
