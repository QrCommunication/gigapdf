"""
Document sharing endpoints.

Provides endpoints for sharing documents, managing invitations,
notifications, and accessing shared documents.
"""

import time
from typing import Optional, Literal

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services.share_service import share_service, SharePermission
from app.services.notification_service import notification_service
from app.services.activity_service import ActivityService, ActivityAction
from app.utils.helpers import now_utc

router = APIRouter()


# Request schemas
class ShareDocumentRequest(BaseModel):
    """Request body for sharing a document."""

    document_id: str = Field(..., description="Document ID to share")
    invitee_email: EmailStr = Field(..., description="Email of the person to share with")
    permission: Literal["view", "edit"] = Field(
        default="edit", description="Permission level (view or edit)"
    )
    message: Optional[str] = Field(
        default=None, max_length=500, description="Optional message for the invitation"
    )
    expires_in_days: int = Field(
        default=7, ge=1, le=30, description="Days until invitation expires"
    )


class UpdatePermissionRequest(BaseModel):
    """Request body for updating share permission."""

    permission: Literal["view", "edit"] = Field(..., description="New permission level")


class CreatePublicLinkRequest(BaseModel):
    """Request body for creating a public link."""

    expires_in_days: Optional[int] = Field(
        default=None, ge=1, le=365, description="Days until link expires (optional)"
    )


# Endpoints
@router.post(
    "/share",
    response_model=APIResponse[dict],
    summary="Share a document",
    description="""
Share a document with another user by email.

If the invitee is a registered user, they will receive an in-app notification.
An email invitation will also be sent.

## Request Body
- **document_id**: Document to share (must be owned by you)
- **invitee_email**: Email address of the person to share with
- **permission**: "view" (read-only) or "edit" (can modify) - default is "edit"
- **message**: Optional personal message to include in the invitation
- **expires_in_days**: Days until invitation expires (default: 7)

## Response
Returns invitation details including the invitation ID.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/sharing/share" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"document_id": "doc-uuid", "invitee_email": "colleague@example.com", "permission": "edit"}'
```

## Example (Python)
```python
import requests

# Partager un document avec un collègue
response = requests.post(
    "http://localhost:8000/api/v1/sharing/share",
    headers={"Authorization": "Bearer <token>"},
    json={
        "document_id": "doc-uuid",
        "invitee_email": "colleague@example.com",
        "permission": "edit",
        "message": "Voici le rapport à revoir"
    }
)
invitation = response.json()["data"]
print(f"Invitation envoyée: {invitation['invitation_id']}")
```

## Example (JavaScript)
```javascript
// Partager un document
const response = await fetch('/api/v1/sharing/share', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    document_id: 'doc-uuid',
    invitee_email: 'colleague@example.com',
    permission: 'edit'
  })
});
const result = await response.json();
console.log('Invitation ID:', result.data.invitation_id);
```

## Example (PHP)
```php
// Partager un document
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/sharing/share",
    [
        'headers' => [
            'Authorization' => 'Bearer <token>',
            'Content-Type' => 'application/json'
        ],
        'json' => [
            'document_id' => 'doc-uuid',
            'invitee_email' => 'colleague@example.com',
            'permission' => 'edit'
        ]
    ]
);
$invitation = json_decode($response->getBody(), true)['data'];
```
""",
    responses={
        201: {"description": "Invitation created successfully"},
        400: {"description": "Invalid request or already shared"},
        404: {"description": "Document not found"},
    },
)
async def share_document(
    request: ShareDocumentRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Share a document with another user."""
    start_time = time.time()

    try:
        result = await share_service.share_document(
            document_id=request.document_id,
            inviter_id=user.user_id,
            invitee_email=request.invitee_email,
            permission=request.permission,
            message=request.message,
            expires_in_days=request.expires_in_days,
        )

        # Log activity
        await ActivityService.log_activity(
            user_id=user.user_id,
            action=ActivityAction.SHARE,
            document_id=request.document_id,
            user_email=user.email,
            extra_data={
                "invitee_email": request.invitee_email,
                "permission": request.permission,
            },
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/shared-with-me",
    response_model=APIResponse[dict],
    summary="Get documents shared with me",
    description="""
Get a list of documents that have been shared with the current user.

This includes both direct shares and documents shared through organizations.

## Query Parameters
- **page**: Page number (default: 1)
- **per_page**: Items per page (default: 20, max: 100)
- **source**: Filter by share source: "direct", "organization", or "all" (default)

## Response
Returns a paginated list of shared documents with owner and permission info.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/sharing/shared-with-me?page=1" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir les documents partagés avec moi
response = requests.get(
    "http://localhost:8000/api/v1/sharing/shared-with-me",
    headers={"Authorization": "Bearer <token>"},
    params={"page": 1, "per_page": 20}
)
shared_docs = response.json()["data"]["documents"]
for doc in shared_docs:
    print(f"{doc['name']} - {doc['permission']} - from {doc['owner']['email']}")
```

## Example (JavaScript)
```javascript
// Obtenir les documents partagés avec moi
const response = await fetch('/api/v1/sharing/shared-with-me', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const sharedDocs = result.data.documents;
sharedDocs.forEach(doc => {
  console.log(`${doc.name} - ${doc.permission}`);
});
```

## Example (PHP)
```php
// Obtenir les documents partagés avec moi
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/sharing/shared-with-me",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$sharedDocs = json_decode($response->getBody(), true)['data']['documents'];
```
""",
    responses={
        200: {"description": "Shared documents retrieved"},
    },
)
async def get_shared_with_me(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
    source: Literal["direct", "organization", "all"] = Query(
        default="all", description="Filter by share source"
    ),
) -> APIResponse[dict]:
    """Get documents shared with the current user."""
    start_time = time.time()

    result = await share_service.get_shared_with_me(
        user_id=user.user_id,
        user_email=user.email,
        user_quota_id=user.quota_id if hasattr(user, 'quota_id') else None,
        page=page,
        per_page=per_page,
        source_filter=source,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=result["page"],
                page_size=result["per_page"],
                total_items=result["total"],
                total_pages=result["total_pages"],
            ),
        ),
    )


@router.get(
    "/shared-by-me",
    response_model=APIResponse[dict],
    summary="Get documents I've shared",
    description="""
Get a list of documents that the current user has shared with others.

## Query Parameters
- **page**: Page number (default: 1)
- **per_page**: Items per page (default: 20, max: 100)

## Response
Returns a paginated list of shares with document and recipient info.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/sharing/shared-by-me" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir les documents que j'ai partagés
response = requests.get(
    "http://localhost:8000/api/v1/sharing/shared-by-me",
    headers={"Authorization": "Bearer <token>"}
)
my_shares = response.json()["data"]["shares"]
for share in my_shares:
    print(f"{share['document']['name']} partagé avec {share['shared_with']['email']}")
```

## Example (JavaScript)
```javascript
// Obtenir les documents que j'ai partagés
const response = await fetch('/api/v1/sharing/shared-by-me', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
result.data.shares.forEach(share => {
  console.log(`${share.document.name} shared with ${share.shared_with.email}`);
});
```

## Example (PHP)
```php
// Obtenir les documents que j'ai partagés
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/sharing/shared-by-me",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$myShares = json_decode($response->getBody(), true)['data']['shares'];
```
""",
    responses={
        200: {"description": "Shares retrieved"},
    },
)
async def get_shared_by_me(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
) -> APIResponse[dict]:
    """Get documents the current user has shared."""
    start_time = time.time()

    result = await share_service.get_shared_by_me(
        user_id=user.user_id,
        page=page,
        per_page=per_page,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=result["page"],
                page_size=result["per_page"],
                total_items=result["total"],
                total_pages=result["total_pages"],
            ),
        ),
    )


@router.get(
    "/invitations/pending",
    response_model=APIResponse[dict],
    summary="Get pending invitations",
    description="""
Get pending share invitations for the current user.

## Response
Returns a list of pending invitations with document and inviter info.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/sharing/invitations/pending" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir mes invitations en attente
response = requests.get(
    "http://localhost:8000/api/v1/sharing/invitations/pending",
    headers={"Authorization": "Bearer <token>"}
)
invitations = response.json()["data"]["invitations"]
for inv in invitations:
    print(f"{inv['document']['name']} de {inv['inviter']['email']}")
```

## Example (JavaScript)
```javascript
// Obtenir mes invitations en attente
const response = await fetch('/api/v1/sharing/invitations/pending', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const invitations = result.data.invitations;
```

## Example (PHP)
```php
// Obtenir mes invitations en attente
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/sharing/invitations/pending",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$invitations = json_decode($response->getBody(), true)['data']['invitations'];
```
""",
    responses={
        200: {"description": "Pending invitations retrieved"},
    },
)
async def get_pending_invitations(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Get pending share invitations for the current user."""
    start_time = time.time()

    invitations = await share_service.get_pending_invitations(user_email=user.email)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"invitations": invitations, "count": len(invitations)},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/invitations/{token}/accept",
    response_model=APIResponse[dict],
    summary="Accept share invitation",
    description="""
Accept a share invitation and gain access to the shared document.

## Path Parameters
- **token**: Invitation token

## Response
Returns the created share with document details.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/sharing/invitations/{token}/accept" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Accepter une invitation
response = requests.post(
    f"http://localhost:8000/api/v1/sharing/invitations/{invitation_token}/accept",
    headers={"Authorization": "Bearer <token>"}
)
share = response.json()["data"]
print(f"Accès accordé au document: {share['document_name']}")
```

## Example (JavaScript)
```javascript
// Accepter une invitation
const response = await fetch(`/api/v1/sharing/invitations/${token}/accept`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
console.log('Access granted to:', result.data.document_name);
```

## Example (PHP)
```php
// Accepter une invitation
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/sharing/invitations/{$token}/accept",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$share = json_decode($response->getBody(), true)['data'];
```
""",
    responses={
        200: {"description": "Invitation accepted"},
        400: {"description": "Invalid or expired invitation"},
        404: {"description": "Invitation not found"},
    },
)
async def accept_invitation(
    token: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Accept a share invitation."""
    start_time = time.time()

    try:
        result = await share_service.accept_invitation(
            token=token,
            user_id=user.user_id,
            user_email=user.email,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/invitations/{token}/decline",
    response_model=APIResponse[dict],
    summary="Decline share invitation",
    description="""
Decline a share invitation.

## Path Parameters
- **token**: Invitation token

## Response
Returns confirmation of the declined invitation.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/sharing/invitations/{token}/decline" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Refuser une invitation
response = requests.post(
    f"http://localhost:8000/api/v1/sharing/invitations/{invitation_token}/decline",
    headers={"Authorization": "Bearer <token>"}
)
result = response.json()["data"]
print("Invitation refusée")
```

## Example (JavaScript)
```javascript
// Refuser une invitation
const response = await fetch(`/api/v1/sharing/invitations/${token}/decline`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
```

## Example (PHP)
```php
// Refuser une invitation
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/sharing/invitations/{$token}/decline",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
```
""",
    responses={
        200: {"description": "Invitation declined"},
        400: {"description": "Invalid invitation"},
        404: {"description": "Invitation not found"},
    },
)
async def decline_invitation(
    token: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Decline a share invitation."""
    start_time = time.time()

    try:
        result = await share_service.decline_invitation(
            token=token,
            user_id=user.user_id,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/shares/{share_id}",
    response_model=APIResponse[dict],
    summary="Revoke a share",
    description="""
Revoke access to a shared document.

Only the document owner can revoke shares.

## Path Parameters
- **share_id**: Share ID to revoke

## Response
Returns confirmation of the revoked share.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/sharing/shares/{share_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Révoquer un partage
response = requests.delete(
    f"http://localhost:8000/api/v1/sharing/shares/{share_id}",
    headers={"Authorization": "Bearer <token>"}
)
print("Partage révoqué")
```

## Example (JavaScript)
```javascript
// Révoquer un partage
const response = await fetch(`/api/v1/sharing/shares/${shareId}`, {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer <token>' }
});
```

## Example (PHP)
```php
// Révoquer un partage
$client = new GuzzleHttp\\Client();
$response = $client->delete(
    "http://localhost:8000/api/v1/sharing/shares/{$shareId}",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
```
""",
    responses={
        200: {"description": "Share revoked"},
        403: {"description": "Not authorized to revoke"},
        404: {"description": "Share not found"},
    },
)
async def revoke_share(
    share_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Revoke a document share."""
    start_time = time.time()

    try:
        result = await share_service.revoke_share(
            share_id=share_id,
            revoker_id=user.user_id,
        )

        # Log activity
        await ActivityService.log_activity(
            user_id=user.user_id,
            action=ActivityAction.UNSHARE,
            extra_data={"share_id": share_id},
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch(
    "/shares/{share_id}/permission",
    response_model=APIResponse[dict],
    summary="Update share permission",
    description="""
Update the permission level for an existing share.

Only the document owner can modify permissions.

## Path Parameters
- **share_id**: Share ID to update

## Request Body
- **permission**: New permission level ("view" or "edit")

## Response
Returns the updated share details.

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/sharing/shares/{share_id}/permission" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"permission": "view"}'
```

## Example (Python)
```python
import requests

# Modifier la permission
response = requests.patch(
    f"http://localhost:8000/api/v1/sharing/shares/{share_id}/permission",
    headers={"Authorization": "Bearer <token>"},
    json={"permission": "view"}
)
result = response.json()["data"]
print(f"Permission changée: {result['old_permission']} -> {result['permission']}")
```

## Example (JavaScript)
```javascript
// Modifier la permission
const response = await fetch(`/api/v1/sharing/shares/${shareId}/permission`, {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ permission: 'view' })
});
```

## Example (PHP)
```php
// Modifier la permission
$client = new GuzzleHttp\\Client();
$response = $client->patch(
    "http://localhost:8000/api/v1/sharing/shares/{$shareId}/permission",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'json' => ['permission' => 'view']
    ]
);
```
""",
    responses={
        200: {"description": "Permission updated"},
        400: {"description": "Invalid permission"},
        403: {"description": "Not authorized"},
        404: {"description": "Share not found"},
    },
)
async def update_share_permission(
    share_id: str,
    request: UpdatePermissionRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Update the permission level for a share."""
    start_time = time.time()

    try:
        result = await share_service.update_permission(
            share_id=share_id,
            owner_id=user.user_id,
            new_permission=request.permission,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/documents/{document_id}/shares",
    response_model=APIResponse[dict],
    summary="Get document shares",
    description="""
Get all active shares for a document.

Only the document owner can view this list.

## Path Parameters
- **document_id**: Document ID

## Response
Returns a list of all shares and pending invitations.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/sharing/documents/{document_id}/shares" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir tous les partages d'un document
response = requests.get(
    f"http://localhost:8000/api/v1/sharing/documents/{document_id}/shares",
    headers={"Authorization": "Bearer <token>"}
)
shares = response.json()["data"]["shares"]
for share in shares:
    email = share.get('shared_with', {}).get('email') or share.get('invitee_email')
    print(f"Partagé avec {email} ({share['permission']})")
```

## Example (JavaScript)
```javascript
// Obtenir tous les partages d'un document
const response = await fetch(`/api/v1/sharing/documents/${documentId}/shares`, {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const shares = result.data.shares;
```

## Example (PHP)
```php
// Obtenir tous les partages d'un document
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/sharing/documents/{$documentId}/shares",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$shares = json_decode($response->getBody(), true)['data']['shares'];
```
""",
    responses={
        200: {"description": "Shares retrieved"},
        403: {"description": "Not authorized"},
        404: {"description": "Document not found"},
    },
)
async def get_document_shares(
    document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Get all shares for a document."""
    start_time = time.time()

    try:
        shares = await share_service.get_document_shares(
            document_id=document_id,
            owner_id=user.user_id,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data={"shares": shares, "count": len(shares)},
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/documents/{document_id}/public-link",
    response_model=APIResponse[dict],
    summary="Create public link",
    description="""
Create a public view-only link for a document.

Public links allow anyone with the link to view the document.

## Path Parameters
- **document_id**: Document ID

## Request Body
- **expires_in_days**: Optional expiration in days (1-365)

## Response
Returns the public link token.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/sharing/documents/{document_id}/public-link" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"expires_in_days": 30}'
```

## Example (Python)
```python
import requests

# Créer un lien public
response = requests.post(
    f"http://localhost:8000/api/v1/sharing/documents/{document_id}/public-link",
    headers={"Authorization": "Bearer <token>"},
    json={"expires_in_days": 30}
)
link = response.json()["data"]
print(f"Lien public: /share/{link['token']}")
```

## Example (JavaScript)
```javascript
// Créer un lien public
const response = await fetch(`/api/v1/sharing/documents/${documentId}/public-link`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ expires_in_days: 30 })
});
const result = await response.json();
const shareUrl = `/share/${result.data.token}`;
```

## Example (PHP)
```php
// Créer un lien public
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/sharing/documents/{$documentId}/public-link",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'json' => ['expires_in_days' => 30]
    ]
);
$link = json_decode($response->getBody(), true)['data'];
```
""",
    responses={
        201: {"description": "Public link created"},
        400: {"description": "Invalid request"},
        403: {"description": "Not authorized"},
        404: {"description": "Document not found"},
    },
)
async def create_public_link(
    document_id: str,
    request: CreatePublicLinkRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Create a public link for a document."""
    start_time = time.time()

    try:
        result = await share_service.create_public_link(
            document_id=document_id,
            owner_id=user.user_id,
            expires_in_days=request.expires_in_days,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/documents/{document_id}/public-link",
    response_model=APIResponse[dict],
    summary="Revoke public link",
    description="""
Revoke the public link for a document.

## Path Parameters
- **document_id**: Document ID

## Response
Returns confirmation of the revoked link.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/sharing/documents/{document_id}/public-link" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Révoquer le lien public
response = requests.delete(
    f"http://localhost:8000/api/v1/sharing/documents/{document_id}/public-link",
    headers={"Authorization": "Bearer <token>"}
)
print("Lien public révoqué")
```

## Example (JavaScript)
```javascript
// Révoquer le lien public
const response = await fetch(`/api/v1/sharing/documents/${documentId}/public-link`, {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer <token>' }
});
```

## Example (PHP)
```php
// Révoquer le lien public
$client = new GuzzleHttp\\Client();
$response = $client->delete(
    "http://localhost:8000/api/v1/sharing/documents/{$documentId}/public-link",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
```
""",
    responses={
        200: {"description": "Public link revoked"},
        404: {"description": "No public link found"},
    },
)
async def revoke_public_link(
    document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Revoke the public link for a document."""
    start_time = time.time()

    try:
        result = await share_service.revoke_public_link(
            document_id=document_id,
            owner_id=user.user_id,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Notification endpoints
@router.get(
    "/notifications",
    response_model=APIResponse[dict],
    summary="Get my notifications",
    description="""
Get sharing notifications for the current user.

## Query Parameters
- **page**: Page number (default: 1)
- **per_page**: Items per page (default: 20)
- **unread_only**: Only return unread notifications (default: false)

## Response
Returns a paginated list of notifications.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/sharing/notifications" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir mes notifications
response = requests.get(
    "http://localhost:8000/api/v1/sharing/notifications",
    headers={"Authorization": "Bearer <token>"},
    params={"unread_only": True}
)
notifications = response.json()["data"]["notifications"]
```

## Example (JavaScript)
```javascript
// Obtenir mes notifications
const response = await fetch('/api/v1/sharing/notifications?unread_only=true', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const notifications = result.data.notifications;
```

## Example (PHP)
```php
// Obtenir mes notifications
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/sharing/notifications",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => ['unread_only' => true]
    ]
);
$notifications = json_decode($response->getBody(), true)['data']['notifications'];
```
""",
    responses={
        200: {"description": "Notifications retrieved"},
    },
)
async def get_notifications(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
) -> APIResponse[dict]:
    """Get notifications for the current user."""
    start_time = time.time()

    result = await notification_service.get_notifications(
        user_id=user.user_id,
        unread_only=unread_only,
        page=page,
        per_page=per_page,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=result["page"],
                page_size=result["per_page"],
                total_items=result["total"],
                total_pages=result["total_pages"],
            ),
        ),
    )


@router.get(
    "/notifications/unread-count",
    response_model=APIResponse[dict],
    summary="Get unread notification count",
    description="""
Get the count of unread notifications.

## Response
Returns the unread count.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/sharing/notifications/unread-count" \\
  -H "Authorization: Bearer <token>"
```
""",
    responses={
        200: {"description": "Count retrieved"},
    },
)
async def get_unread_count(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Get count of unread notifications."""
    start_time = time.time()

    count = await notification_service.get_unread_count(user_id=user.user_id)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"unread_count": count},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/notifications/{notification_id}/read",
    response_model=APIResponse[dict],
    summary="Mark notification as read",
    description="""
Mark a notification as read.

## Path Parameters
- **notification_id**: Notification ID

## Response
Returns confirmation.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/sharing/notifications/{notification_id}/read" \\
  -H "Authorization: Bearer <token>"
```
""",
    responses={
        200: {"description": "Notification marked as read"},
        404: {"description": "Notification not found"},
    },
)
async def mark_notification_read(
    notification_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Mark a notification as read."""
    start_time = time.time()

    success = await notification_service.mark_as_read(
        notification_id=notification_id,
        user_id=user.user_id,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"marked_as_read": True},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/notifications/read-all",
    response_model=APIResponse[dict],
    summary="Mark all notifications as read",
    description="""
Mark all notifications as read for the current user.

## Response
Returns the count of notifications marked as read.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/sharing/notifications/read-all" \\
  -H "Authorization: Bearer <token>"
```
""",
    responses={
        200: {"description": "All notifications marked as read"},
    },
)
async def mark_all_notifications_read(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Mark all notifications as read."""
    start_time = time.time()

    count = await notification_service.mark_all_as_read(user_id=user.user_id)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"marked_count": count},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
