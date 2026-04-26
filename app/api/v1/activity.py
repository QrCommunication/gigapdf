"""
Activity log endpoints.

Provides endpoints to view document activity history.
Only users with access to the document can view its history.
"""

import time

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
Retrieve the complete activity history for a specific document.

Returns a chronological list of all actions performed on the document, including who performed each action and when.
This endpoint is useful for auditing, compliance, and understanding document usage patterns.

## Access Control
Only the document owner or users with explicit shared access can view the activity history.
Unauthorized access attempts will return a 404 error.

## Path Parameters
- **document_id**: Document identifier (UUID v4 format)

## Query Parameters
- **limit**: Maximum number of activities to return (default: 50, max: 100)
- **offset**: Number of activities to skip for pagination (default: 0)
- **action**: Filter by action type (create, view, download, edit, rename, delete, share, export)

## Activity Entry Fields
Each activity entry includes:
- **id**: Unique activity identifier
- **action**: Type of action performed
- **user_id**: ID of the user who performed the action
- **user_email**: Email of the user
- **user_name**: Display name of the user
- **resource_type**: Type of resource (always "document" for this endpoint)
- **metadata**: Additional context about the action
- **created_at**: ISO 8601 timestamp of when the action occurred

## Use Cases
- Audit trails for compliance requirements
- Tracking document collaboration
- Understanding document usage patterns
- Security monitoring and access reviews
""",
    responses={
        200: {
            "description": "Activity history retrieved successfully",
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
                            "document_id": "doc_123",
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 45,
                            "pagination": {
                                "page": 1,
                                "page_size": 50,
                                "total_items": 1,
                                "total_pages": 1,
                            },
                        },
                    }
                }
            },
        },
        401: {"description": "Authentication required"},
        404: {"description": "Document not found or no access"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/activity/documents/{document_id}/history?limit=20" \\
  -H "Authorization: Bearer $TOKEN\"""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"

# Get document activity history
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/activity/documents/{document_id}/history",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"},
    params={
        "limit": 20,
        "offset": 0,
        "action": "edit"  # Optional: filter by action type
    }
)

if response.status_code == 200:
    result = response.json()
    activities = result["data"]["activities"]
    pagination = result["meta"]["pagination"]

    print(f"Total activities: {pagination['total_items']}")
    print(f"Page {pagination['page']} of {pagination['total_pages']}")

    for activity in activities:
        print(f"{activity['created_at']}: {activity['user_name']} - {activity['action']}")
        if activity.get('metadata'):
            print(f"  Details: {activity['metadata']}")
else:
    print(f"Error: {response.status_code}")

# Paginate through all activities
def get_all_activities(doc_id):
    all_activities = []
    offset = 0
    limit = 100

    while True:
        resp = requests.get(
            f"https://api.giga-pdf.com/api/v1/activity/documents/{doc_id}/history",
            headers={"Authorization": "Bearer YOUR_API_TOKEN"},
            params={"limit": limit, "offset": offset}
        )
        data = resp.json()
        activities = data["data"]["activities"]
        all_activities.extend(activities)

        if len(activities) < limit:
            break
        offset += limit

    return all_activities""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = '550e8400-e29b-41d4-a716-446655440000';

// Get document activity history
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/activity/documents/${documentId}/history?limit=20`,
  {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN'
    }
  }
);

const result = await response.json();

if (result.success) {
  const { activities, document_id } = result.data;
  const { pagination } = result.meta;

  console.log(`Document: ${document_id}`);
  console.log(`Total activities: ${pagination.total_items}`);
  console.log(`Page ${pagination.page} of ${pagination.total_pages}`);

  activities.forEach(activity => {
    console.log(`${activity.created_at}: ${activity.user_name} - ${activity.action}`);
  });
}

// Filter by action type
const editActivities = await fetch(
  `https://api.giga-pdf.com/api/v1/activity/documents/${documentId}/history?action=edit`,
  {
    headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
  }
);

// Paginate through all activities
async function getAllActivities(docId) {
  const allActivities = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const resp = await fetch(
      `https://api.giga-pdf.com/api/v1/activity/documents/${docId}/history?limit=${limit}&offset=${offset}`,
      { headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' } }
    );
    const data = await resp.json();
    allActivities.push(...data.data.activities);

    if (data.data.activities.length < limit) break;
    offset += limit;
  }

  return allActivities;
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = '550e8400-e29b-41d4-a716-446655440000';

$client = new GuzzleHttp\\Client();

// Get document activity history
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/activity/documents/{$documentId}/history",
    [
        'headers' => ['Authorization' => 'Bearer YOUR_API_TOKEN'],
        'query' => [
            'limit' => 20,
            'offset' => 0,
            'action' => 'edit'  // Optional: filter by action type
        ]
    ]
);

$result = json_decode($response->getBody(), true);

if ($result['success']) {
    $activities = $result['data']['activities'];
    $pagination = $result['meta']['pagination'];

    echo "Total activities: {$pagination['total_items']}\\n";
    echo "Page {$pagination['page']} of {$pagination['total_pages']}\\n";

    foreach ($activities as $activity) {
        echo "{$activity['created_at']}: {$activity['user_name']} - {$activity['action']}\\n";
    }
}

// Paginate through all activities
function getAllActivities($client, $docId) {
    $allActivities = [];
    $offset = 0;
    $limit = 100;

    while (true) {
        $resp = $client->get(
            "https://api.giga-pdf.com/api/v1/activity/documents/{$docId}/history",
            [
                'headers' => ['Authorization' => 'Bearer YOUR_API_TOKEN'],
                'query' => ['limit' => $limit, 'offset' => $offset]
            ]
        );
        $data = json_decode($resp->getBody(), true);
        $activities = $data['data']['activities'];
        $allActivities = array_merge($allActivities, $activities);

        if (count($activities) < $limit) break;
        $offset += $limit;
    }

    return $allActivities;
}
?>""",
            },
        ]
    },
)
async def get_document_history(
    document_id: str,
    user: AuthenticatedUser,
    limit: int = Query(default=50, ge=1, le=100, description="Max results"),
    offset: int = Query(default=0, ge=0, description="Skip N results"),
    action: str | None = Query(
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
    summary="Get current user's activity history",
    description="""
Retrieve the activity history for the currently authenticated user.

Returns a chronological list of all actions performed by the user across all documents and resources they have access to.
This endpoint is useful for personal activity dashboards and tracking your own document interactions.

## Query Parameters
- **limit**: Maximum number of activities to return (default: 50, max: 100)
- **offset**: Number of activities to skip for pagination (default: 0)
- **action**: Filter by action type (create, view, download, edit, rename, delete, share, export)
- **resource_type**: Filter by resource type (document, folder)

## Activity Entry Fields
Each activity entry includes:
- **id**: Unique activity identifier
- **action**: Type of action performed
- **document_id**: ID of the document involved (if applicable)
- **resource_type**: Type of resource affected
- **metadata**: Additional context about the action
- **created_at**: ISO 8601 timestamp of when the action occurred

## Use Cases
- Personal activity dashboard
- Tracking recent document interactions
- Finding recently edited documents
- Activity reports for productivity tracking

## Pagination
Results are paginated. Use the `offset` parameter to navigate through pages.
The response includes pagination metadata with total counts and page information.
""",
    responses={
        200: {
            "description": "User activity history retrieved successfully",
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
                                },
                                {
                                    "id": "660e8400-e29b-41d4-a716-446655440001",
                                    "action": "edit",
                                    "document_id": "doc_456",
                                    "resource_type": "document",
                                    "metadata": {"changes": ["Added signature"]},
                                    "created_at": "2024-01-15T11:00:00Z",
                                }
                            ],
                        },
                        "meta": {
                            "request_id": "uuid",
                            "timestamp": "2024-01-15T12:00:00Z",
                            "processing_time_ms": 32,
                            "pagination": {
                                "page": 1,
                                "page_size": 50,
                                "total_items": 2,
                                "total_pages": 1,
                            },
                        },
                    }
                }
            },
        },
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/activity/me?limit=20" \\
  -H "Authorization: Bearer $TOKEN"

# Filter by action type
curl -X GET "https://api.giga-pdf.com/api/v1/activity/me?action=edit&limit=50" \\
  -H "Authorization: Bearer $TOKEN"

# Filter by resource type
curl -X GET "https://api.giga-pdf.com/api/v1/activity/me?resource_type=document" \\
  -H "Authorization: Bearer $TOKEN\"""",
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get my recent activity
response = requests.get(
    "https://api.giga-pdf.com/api/v1/activity/me",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"},
    params={"limit": 20}
)

if response.status_code == 200:
    result = response.json()
    activities = result["data"]["activities"]
    pagination = result["meta"]["pagination"]

    print(f"My total activities: {pagination['total_items']}")

    for activity in activities:
        print(f"{activity['created_at']}: {activity['action']} - {activity['resource_type']}")
        if activity.get('document_id'):
            print(f"  Document: {activity['document_id']}")

# Filter by action type (e.g., only edits)
edit_response = requests.get(
    "https://api.giga-pdf.com/api/v1/activity/me",
    headers={"Authorization": "Bearer YOUR_API_TOKEN"},
    params={"action": "edit", "limit": 50}
)

# Get recently edited documents
def get_recently_edited_documents():
    response = requests.get(
        "https://api.giga-pdf.com/api/v1/activity/me",
        headers={"Authorization": "Bearer YOUR_API_TOKEN"},
        params={"action": "edit", "resource_type": "document", "limit": 10}
    )
    activities = response.json()["data"]["activities"]
    return [a["document_id"] for a in activities if a.get("document_id")]""",
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get my recent activity
const response = await fetch(
  'https://api.giga-pdf.com/api/v1/activity/me?limit=20',
  {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN'
    }
  }
);

const result = await response.json();

if (result.success) {
  const { activities } = result.data;
  const { pagination } = result.meta;

  console.log(`My total activities: ${pagination.total_items}`);

  activities.forEach(activity => {
    console.log(`${activity.created_at}: ${activity.action} - ${activity.resource_type}`);
    if (activity.document_id) {
      console.log(`  Document: ${activity.document_id}`);
    }
  });
}

// Filter by action type
const editActivities = await fetch(
  'https://api.giga-pdf.com/api/v1/activity/me?action=edit&limit=50',
  {
    headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
  }
);

// Get recently edited documents
async function getRecentlyEditedDocuments() {
  const resp = await fetch(
    'https://api.giga-pdf.com/api/v1/activity/me?action=edit&resource_type=document&limit=10',
    { headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' } }
  );
  const data = await resp.json();
  return data.data.activities
    .filter(a => a.document_id)
    .map(a => a.document_id);
}

// Build activity feed component
async function loadActivityFeed(limit = 20, offset = 0) {
  const resp = await fetch(
    `https://api.giga-pdf.com/api/v1/activity/me?limit=${limit}&offset=${offset}`,
    { headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' } }
  );
  return resp.json();
}""",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$client = new GuzzleHttp\\Client();

// Get my recent activity
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/activity/me",
    [
        'headers' => ['Authorization' => 'Bearer YOUR_API_TOKEN'],
        'query' => ['limit' => 20]
    ]
);

$result = json_decode($response->getBody(), true);

if ($result['success']) {
    $activities = $result['data']['activities'];
    $pagination = $result['meta']['pagination'];

    echo "My total activities: {$pagination['total_items']}\\n";

    foreach ($activities as $activity) {
        echo "{$activity['created_at']}: {$activity['action']} - {$activity['resource_type']}\\n";
        if (isset($activity['document_id'])) {
            echo "  Document: {$activity['document_id']}\\n";
        }
    }
}

// Filter by action type (e.g., only edits)
$editResponse = $client->get(
    "https://api.giga-pdf.com/api/v1/activity/me",
    [
        'headers' => ['Authorization' => 'Bearer YOUR_API_TOKEN'],
        'query' => ['action' => 'edit', 'limit' => 50]
    ]
);

// Get recently edited documents
function getRecentlyEditedDocuments($client) {
    $response = $client->get(
        "https://api.giga-pdf.com/api/v1/activity/me",
        [
            'headers' => ['Authorization' => 'Bearer YOUR_API_TOKEN'],
            'query' => [
                'action' => 'edit',
                'resource_type' => 'document',
                'limit' => 10
            ]
        ]
    );
    $data = json_decode($response->getBody(), true);
    $documentIds = [];
    foreach ($data['data']['activities'] as $activity) {
        if (isset($activity['document_id'])) {
            $documentIds[] = $activity['document_id'];
        }
    }
    return array_unique($documentIds);
}
?>""",
            },
        ]
    },
)
async def get_my_activity(
    user: AuthenticatedUser,
    limit: int = Query(default=50, ge=1, le=100, description="Max results"),
    offset: int = Query(default=0, ge=0, description="Skip N results"),
    action: str | None = Query(default=None, description="Filter by action"),
    resource_type: str | None = Query(
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
