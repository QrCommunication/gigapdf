"""
PDF security endpoints.

Handles PDF encryption, decryption, and permission management.
"""

import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

router = APIRouter()


class EncryptDocumentRequest(BaseModel):
    """Request to encrypt a PDF document."""

    user_password: Optional[str] = Field(
        default=None,
        description="Password required to open the document (user password)",
    )
    owner_password: Optional[str] = Field(
        default=None,
        description="Password required to change permissions (owner password)",
    )
    allow_printing: bool = Field(
        default=True,
        description="Allow printing the document",
    )
    allow_copying: bool = Field(
        default=True,
        description="Allow copying text and graphics",
    )
    allow_annotation: bool = Field(
        default=True,
        description="Allow adding or modifying annotations",
    )
    allow_form_filling: bool = Field(
        default=True,
        description="Allow filling form fields",
    )
    allow_modification: bool = Field(
        default=False,
        description="Allow modifying the document",
    )
    allow_assembly: bool = Field(
        default=False,
        description="Allow inserting, deleting, and rotating pages",
    )
    encryption_algorithm: str = Field(
        default="AES-256",
        description="Encryption algorithm (RC4-128, AES-128, AES-256)",
    )


class DecryptDocumentRequest(BaseModel):
    """Request to decrypt a PDF document."""

    password: str = Field(
        description="Password to decrypt the document",
    )


@router.post(
    "/{document_id}/security/encrypt",
    response_model=APIResponse[dict],
    summary="Encrypt PDF document",
    description="""
Add password protection and set permissions for a PDF document.

You can set two types of passwords:
- **User password**: Required to open and view the document
- **Owner password**: Required to change security settings and permissions

You can also control various permissions:
- Printing
- Copying text and graphics
- Adding annotations
- Filling form fields
- Modifying content
- Assembling pages

## Path Parameters
- **document_id**: Document identifier (UUID v4)

## Request Body
```json
{
  "user_password": "secret123",
  "owner_password": "admin456",
  "allow_printing": true,
  "allow_copying": false,
  "allow_annotation": true,
  "allow_form_filling": true,
  "allow_modification": false,
  "allow_assembly": false,
  "encryption_algorithm": "AES-256"
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/security/encrypt" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_password": "secret123",
    "allow_copying": false,
    "encryption_algorithm": "AES-256"
  }'
```

## Example (Python)
```python
import requests

# Chiffrer un document PDF avec mot de passe
response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/security/encrypt",
    headers={"Authorization": "Bearer <token>"},
    json={
        "user_password": "secret123",
        "owner_password": "admin456",
        "allow_printing": True,
        "allow_copying": False,
        "allow_modification": False,
        "encryption_algorithm": "AES-256"
    }
)
result = response.json()
```

## Example (JavaScript)
```javascript
// Protéger un PDF par mot de passe
const response = await fetch(
  `/api/v1/documents/${documentId}/security/encrypt`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_password: 'secret123',
      allow_copying: false,
      encryption_algorithm: 'AES-256'
    })
  }
);
const result = await response.json();
```

## Example (PHP)
```php
// Chiffrer un document PDF
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/security/encrypt",
    [
        'headers' => [
            'Authorization' => 'Bearer <token>',
            'Content-Type' => 'application/json'
        ],
        'json' => [
            'user_password' => 'secret123',
            'owner_password' => 'admin456',
            'allow_printing' => true,
            'allow_copying' => false,
            'encryption_algorithm' => 'AES-256'
        ]
    ]
);
$result = json_decode($response->getBody(), true);
```
""",
    responses={
        200: {
            "description": "Document encrypted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "encrypted": True,
                            "algorithm": "AES-256",
                            "permissions": {
                                "printing": True,
                                "copying": False,
                                "annotation": True,
                                "form_filling": True,
                                "modification": False,
                                "assembly": False,
                            },
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid encryption parameters"},
        404: {"description": "Document not found"},
    },
)
async def encrypt_document(
    document_id: str,
    request: EncryptDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Add password protection and set permissions."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions

    session = document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    # Validate at least one password is provided
    if not request.user_password and not request.owner_password:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError("At least one password (user or owner) is required")

    # Validate encryption algorithm
    valid_algorithms = ("RC4-128", "AES-128", "AES-256")
    if request.encryption_algorithm not in valid_algorithms:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(
            f"Invalid encryption algorithm. Must be one of: {', '.join(valid_algorithms)}"
        )

    # Build permissions bitmask for PyMuPDF
    import fitz

    perm = 0
    if request.allow_printing:
        perm |= fitz.PDF_PERM_PRINT
    if request.allow_modification:
        perm |= fitz.PDF_PERM_MODIFY
    if request.allow_copying:
        perm |= fitz.PDF_PERM_COPY
    if request.allow_annotation:
        perm |= fitz.PDF_PERM_ANNOTATE
    if request.allow_form_filling:
        perm |= fitz.PDF_PERM_FORM
    if request.allow_assembly:
        perm |= fitz.PDF_PERM_ASSEMBLE

    # Map algorithm to PyMuPDF encryption method
    encryption_map = {
        "RC4-128": fitz.PDF_ENCRYPT_RC4_128,
        "AES-128": fitz.PDF_ENCRYPT_AES_128,
        "AES-256": fitz.PDF_ENCRYPT_AES_256,
    }
    encryption_method = encryption_map[request.encryption_algorithm]

    # Set encryption on the document
    session.pdf_doc.set_metadata({"encryption": request.encryption_algorithm})
    session.pdf_doc.permissions = perm

    # Note: PyMuPDF applies encryption when saving, not immediately
    # We'll store the encryption parameters in the session for later use
    if not hasattr(session, "encryption_params"):
        session.encryption_params = {}

    session.encryption_params = {
        "user_password": request.user_password,
        "owner_password": request.owner_password,
        "permissions": perm,
        "encryption_method": encryption_method,
    }

    # Add history entry
    document_sessions.push_history(
        document_id,
        f"Encrypted document with {request.encryption_algorithm}",
        affected_pages=None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "encrypted": True,
            "algorithm": request.encryption_algorithm,
            "permissions": {
                "printing": request.allow_printing,
                "copying": request.allow_copying,
                "annotation": request.allow_annotation,
                "form_filling": request.allow_form_filling,
                "modification": request.allow_modification,
                "assembly": request.allow_assembly,
            },
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/security/decrypt",
    response_model=APIResponse[dict],
    summary="Decrypt PDF document",
    description="""
Remove password protection from a PDF document.

This requires the owner password or user password with modification permissions.

## Path Parameters
- **document_id**: Document identifier (UUID v4)

## Request Body
```json
{
  "password": "secret123"
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/security/decrypt" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"password": "secret123"}'
```

## Example (Python)
```python
import requests

# Déchiffrer un document PDF
response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/security/decrypt",
    headers={"Authorization": "Bearer <token>"},
    json={"password": "secret123"}
)
result = response.json()
```

## Example (JavaScript)
```javascript
// Supprimer la protection d'un PDF
const response = await fetch(
  `/api/v1/documents/${documentId}/security/decrypt`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      password: 'secret123'
    })
  }
);
const result = await response.json();
```

## Example (PHP)
```php
// Déchiffrer un document PDF
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/security/decrypt",
    [
        'headers' => [
            'Authorization' => 'Bearer <token>',
            'Content-Type' => 'application/json'
        ],
        'json' => ['password' => 'secret123']
    ]
);
$result = json_decode($response->getBody(), true);
```
""",
    responses={
        200: {
            "description": "Document decrypted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "decrypted": True,
                            "message": "Document decrypted successfully",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        401: {"description": "Invalid password"},
        404: {"description": "Document not found"},
    },
)
async def decrypt_document(
    document_id: str,
    request: DecryptDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Remove password protection."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions

    session = document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    # Check if document is encrypted
    if not session.pdf_doc.is_encrypted:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError("Document is not encrypted")

    # Try to authenticate with the password
    auth_result = session.pdf_doc.authenticate(request.password)
    if not auth_result:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError("Invalid password")

    # Remove encryption parameters if they exist
    if hasattr(session, "encryption_params"):
        delattr(session, "encryption_params")

    # Add history entry
    document_sessions.push_history(
        document_id,
        "Removed document encryption",
        affected_pages=None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "decrypted": True,
            "message": "Document decrypted successfully",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{document_id}/security/permissions",
    response_model=APIResponse[dict],
    summary="Get document permissions",
    description="""
Get the current security permissions for a PDF document.

Returns information about:
- Whether the document is encrypted
- Encryption algorithm used
- Allowed permissions (printing, copying, modification, etc.)

## Path Parameters
- **document_id**: Document identifier (UUID v4)

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/security/permissions" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir les permissions du document
response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/security/permissions",
    headers={"Authorization": "Bearer <token>"}
)
permissions = response.json()["data"]
print(f"Encrypted: {permissions['is_encrypted']}")
print(f"Can print: {permissions['permissions']['printing']}")
```

## Example (JavaScript)
```javascript
// Récupérer les permissions du document
const response = await fetch(
  `/api/v1/documents/${documentId}/security/permissions`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
const result = await response.json();
const permissions = result.data.permissions;
```

## Example (PHP)
```php
// Obtenir les permissions du document
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/security/permissions",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$permissions = json_decode($response->getBody(), true)['data'];
echo "Encrypted: " . ($permissions['is_encrypted'] ? 'Yes' : 'No');
```
""",
    responses={
        200: {
            "description": "Permissions retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "is_encrypted": True,
                            "encryption_algorithm": "AES-256",
                            "permissions": {
                                "printing": True,
                                "copying": False,
                                "annotation": True,
                                "form_filling": True,
                                "modification": False,
                                "assembly": False,
                            },
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        404: {"description": "Document not found"},
    },
)
async def get_permissions(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get current security permissions."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions

    session = document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    import fitz

    pdf_doc = session.pdf_doc

    # Get encryption info
    is_encrypted = pdf_doc.is_encrypted
    encryption_algorithm = None

    if is_encrypted:
        # Try to determine encryption algorithm from metadata
        metadata = pdf_doc.metadata
        encryption_algorithm = metadata.get("encryption", "Unknown")

    # Get permissions
    perm = pdf_doc.permissions if is_encrypted else -1

    permissions = {
        "printing": bool(perm & fitz.PDF_PERM_PRINT) if is_encrypted else True,
        "copying": bool(perm & fitz.PDF_PERM_COPY) if is_encrypted else True,
        "annotation": bool(perm & fitz.PDF_PERM_ANNOTATE) if is_encrypted else True,
        "form_filling": bool(perm & fitz.PDF_PERM_FORM) if is_encrypted else True,
        "modification": bool(perm & fitz.PDF_PERM_MODIFY) if is_encrypted else True,
        "assembly": bool(perm & fitz.PDF_PERM_ASSEMBLE) if is_encrypted else True,
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "is_encrypted": is_encrypted,
            "encryption_algorithm": encryption_algorithm,
            "permissions": permissions,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
